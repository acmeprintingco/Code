/**
 * Watertight shell construction from a periodic parameter grid.
 *
 * Grid vertices (row k = height along the cuff axis, column i = angle around it)
 * carry an inner-surface point, an outer-surface point and a signed "material"
 * field f (mm, f <= 0 means material). Every cell is clipped against f = 0
 * (marching squares with shared, interpolated edge points), producing an inner
 * skin, an outer skin and side walls along the clipped boundary. Because all
 * interpolated points are shared between neighbouring cells the result is a
 * closed 2-manifold with consistent outward winding.
 */
import { BufferAttribute, BufferGeometry } from 'three';

export interface ShellGrid {
  cols: number; // periodic direction (angle)
  rows: number; // open direction (height)
  f: Float64Array; // rows*cols
  inner: Float64Array; // rows*cols*3
  outer: Float64Array; // rows*cols*3
}

const EPS = 1e-7;

export function buildShell(grid: ShellGrid): BufferGeometry {
  const { cols: N, rows: M, inner, outer } = grid;
  const f = Float64Array.from(grid.f, (x) => (Math.abs(x) < EPS ? EPS : x));
  const inside = (k: number, i: number) => f[k * N + i] <= 0;

  const pos: number[] = [];
  const tris: number[] = [];
  const cache = new Map<number, number>();

  const pushPair = (ax: number, bx: number, t: number): number => {
    const id = pos.length / 3;
    for (let c = 0; c < 3; c++) pos.push(inner[ax + c] + (inner[bx + c] - inner[ax + c]) * t);
    for (let c = 0; c < 3; c++) pos.push(outer[ax + c] + (outer[bx + c] - outer[ax + c]) * t);
    return id; // id = inner, id+1 = outer
  };

  const corner = (k: number, i: number): number => {
    const key = (k * N + i) * 3;
    let id = cache.get(key);
    if (id === undefined) {
      id = pushPair(key, key, 0);
      cache.set(key, id);
    }
    return id;
  };

  // Edge between (k,i) and (k,i+1) [horizontal, type 1] or (k,i) and (k+1,i) [vertical, type 2].
  const edgePoint = (k: number, i: number, type: 1 | 2): number => {
    const key = (k * N + i) * 3 + type;
    let id = cache.get(key);
    if (id === undefined) {
      const ka = k, ia = i;
      const kb = type === 2 ? k + 1 : k;
      const ib = type === 1 ? (i + 1) % N : i;
      const fa = f[ka * N + ia];
      const fb = f[kb * N + ib];
      let t = fa / (fa - fb);
      t = Math.min(0.98, Math.max(0.02, t));
      id = pushPair((ka * N + ia) * 3, (kb * N + ib) * 3, t);
      cache.set(key, id);
    }
    return id;
  };

  const poly: number[] = [];
  const isCross: boolean[] = [];

  for (let k = 0; k < M - 1; k++) {
    for (let i = 0; i < N; i++) {
      const i1 = (i + 1) % N;
      // Corners counter-clockwise in (angle, height).
      const ck = [k, k, k + 1, k + 1];
      const ci = [i, i1, i1, i];
      const ins = [inside(k, i), inside(k, i1), inside(k + 1, i1), inside(k + 1, i)];
      if (!ins[0] && !ins[1] && !ins[2] && !ins[3]) continue;
      poly.length = 0;
      isCross.length = 0;
      for (let c = 0; c < 4; c++) {
        if (ins[c]) {
          poly.push(corner(ck[c], ci[c]));
          isCross.push(false);
        }
        const n = (c + 1) & 3;
        if (ins[c] !== ins[n]) {
          let id: number;
          if (c === 0) id = edgePoint(k, i, 1);
          else if (c === 1) id = edgePoint(k, i1, 2);
          else if (c === 2) id = edgePoint(k + 1, i, 1);
          else id = edgePoint(k, i, 2);
          poly.push(id);
          isCross.push(true);
        }
      }
      const n = poly.length;
      // Outer skin (CCW in parameter space = outward) and inner skin (reversed).
      for (let j = 1; j < n - 1; j++) {
        tris.push(poly[0] + 1, poly[j] + 1, poly[j + 1] + 1);
        tris.push(poly[0], poly[j + 1], poly[j]);
      }
      // Side walls along the clipped boundary.
      for (let j = 0; j < n; j++) {
        const jn = (j + 1) % n;
        if (isCross[j] && isCross[jn]) {
          const p = poly[j];
          const q = poly[jn];
          tris.push(q + 1, p + 1, p);
          tris.push(q + 1, p, q);
        }
      }
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  const vcount = pos.length / 3;
  g.setIndex(new BufferAttribute(vcount > 65535 ? new Uint32Array(tris) : new Uint16Array(tris), 1));
  g.computeVertexNormals();
  return g;
}

export interface MeshCheck {
  triangles: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  inconsistentEdges: number;
  volume: number; // mm^3, signed (positive = outward winding)
  area: number; // mm^2
}

/** Edge-manifold, winding and volume check for an indexed mesh. */
export function checkMesh(g: BufferGeometry): MeshCheck {
  const idx = g.getIndex()!.array;
  const p = g.getAttribute('position').array as ArrayLike<number>;
  const edges = new Map<string, number>();
  let volume = 0;
  let area = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    for (const [u, w] of [[a, b], [b, c], [c, a]]) {
      const key = `${u},${w}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    const ax = p[3 * a], ay = p[3 * a + 1], az = p[3 * a + 2];
    const bx = p[3 * b], by = p[3 * b + 1], bz = p[3 * b + 2];
    const cx = p[3 * c], cy = p[3 * c + 1], cz = p[3 * c + 2];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
  }
  let boundary = 0, nonManifold = 0, inconsistent = 0;
  edges.forEach((count, key) => {
    const [u, w] = key.split(',');
    const rev = edges.get(`${w},${u}`) ?? 0;
    if (count > 1) inconsistent++;
    if (rev === 0) boundary++;
    else if (count + rev > 2) nonManifold++;
  });
  return { triangles: idx.length / 3, boundaryEdges: boundary, nonManifoldEdges: nonManifold, inconsistentEdges: inconsistent, volume, area };
}
