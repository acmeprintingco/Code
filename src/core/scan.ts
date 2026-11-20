/**
 * Scan preparation: unit scaling, vertex welding, fragment removal and a BVH
 * for fast ray casting (used for landmark picking and radial sampling).
 */
import { Box3, BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Units = 'mm' | 'cm' | 'm' | 'in';

export const UNIT_SCALE: Record<Units, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };

/** Guess the file units from the bounding box size (a dog limb scan is ~80–600 mm long). */
export function guessUnits(geometry: BufferGeometry): Units {
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim < 2) return 'm';
  if (maxDim < 15) return 'in';
  if (maxDim < 70) return 'cm';
  return 'mm';
}

export class ScanModel {
  readonly geometry: BufferGeometry;
  readonly bvh: MeshBVH;
  private ray = new Ray();

  constructor(geometry: BufferGeometry) {
    this.geometry = geometry;
    this.bvh = new MeshBVH(geometry);
  }

  /** Distance to the first surface hit along a ray (both face sides), or null. */
  rayFirst(origin: Vector3, dir: Vector3, near = 0, far = Infinity): number | null {
    this.ray.origin.copy(origin);
    this.ray.direction.copy(dir);
    const hit = this.bvh.raycastFirst(this.ray, DoubleSide, near, far);
    return hit ? hit.distance : null;
  }

  get triangleCount(): number {
    const idx = this.geometry.getIndex();
    return idx ? idx.count / 3 : this.geometry.getAttribute('position').count / 3;
  }

  get bounds(): Box3 {
    this.geometry.computeBoundingBox();
    return this.geometry.boundingBox!.clone();
  }
}

export interface PrepareOptions {
  units: Units;
  /** Drop disconnected pieces smaller than this fraction of the largest piece. */
  fragmentFraction?: number;
  center?: boolean;
}

export interface PrepareResult {
  geometry: BufferGeometry;
  removedTriangles: number;
}

/** Scale to millimetres, weld vertices, remove scan debris and centre at the origin. */
export function prepareScanGeometry(input: BufferGeometry, opts: PrepareOptions): PrepareResult {
  let g = new BufferGeometry();
  g.setAttribute('position', input.getAttribute('position').clone());
  if (input.getIndex()) g.setIndex(input.getIndex()!.clone());
  const s = UNIT_SCALE[opts.units];
  if (s !== 1) g.scale(s, s, s);
  g = mergeVertices(g, 1e-4);

  let removed = 0;
  if (opts.fragmentFraction && opts.fragmentFraction > 0) {
    const r = removeFragments(g, opts.fragmentFraction);
    g = r.geometry;
    removed = r.removed;
  }
  if (opts.center !== false) {
    g.computeBoundingBox();
    const c = g.boundingBox!.getCenter(new Vector3());
    g.translate(-c.x, -c.y, -c.z);
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return { geometry: g, removedTriangles: removed };
}

/** Keep connected components whose triangle count is >= fraction * largest component. */
export function removeFragments(g: BufferGeometry, fraction: number): { geometry: BufferGeometry; removed: number } {
  const index = g.getIndex();
  if (!index) return { geometry: g, removed: 0 };
  const idx = index.array;
  const nv = g.getAttribute('position').count;
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const nt = idx.length / 3;
  for (let t = 0; t < nt; t++) {
    unite(idx[3 * t], idx[3 * t + 1]);
    unite(idx[3 * t], idx[3 * t + 2]);
  }
  const counts = new Map<number, number>();
  for (let t = 0; t < nt; t++) {
    const r = find(idx[3 * t]);
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  let largest = 0;
  counts.forEach((c) => (largest = Math.max(largest, c)));
  const keep: number[] = [];
  let removed = 0;
  for (let t = 0; t < nt; t++) {
    const r = find(idx[3 * t]);
    if (counts.get(r)! >= fraction * largest) keep.push(idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]);
    else removed++;
  }
  if (removed === 0) return { geometry: g, removed: 0 };
  const out = new BufferGeometry();
  out.setAttribute('position', g.getAttribute('position'));
  out.setIndex(new BufferAttribute(nv > 65535 ? new Uint32Array(keep) : new Uint16Array(keep), 1));
  return { geometry: out, removed };
}
