/** Three.js viewport: scan, brace, landmarks, reliefs, axes and surface picking. */
import {
  AmbientLight, BufferGeometry, Color, DirectionalLight, DoubleSide, Group, HemisphereLight, Line, LineBasicMaterial,
  Mesh, MeshStandardMaterial, PerspectiveCamera, Raycaster, Scene, SphereGeometry, Vector2, Vector3, WebGLRenderer, Box3, Object3D,
  BufferAttribute, PlaneGeometry, MeshBasicMaterial, Quaternion,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import { LANDMARK_COLORS, LANDMARK_LABELS, type LandmarkId, type Landmarks, type Relief, type Vec3 } from '../core/params';
import type { SerializedFrames } from './protocol';

(BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

export type ViewName = 'lateral' | 'medial' | 'cranial' | 'caudal' | 'fit';

export interface TrimHandle {
  cuff: 'proximal' | 'distal';
  index: number;
  position: Vec3;
  axis: Vec3;
}

/** Gap colour scale relative to the nominal liner gap: tight (red) → nominal (green) → loose (blue). */
export const GAP_STOPS: [number, [number, number, number]][] = [
  [-2, [0.84, 0.19, 0.15]],
  [-1, [0.99, 0.55, 0.23]],
  [0, [0.1, 0.6, 0.31]],
  [2, [0.4, 0.74, 0.86]],
  [5, [0.19, 0.35, 0.8]],
];

function gapColor(d: number): [number, number, number] {
  if (d <= GAP_STOPS[0][0]) return GAP_STOPS[0][1];
  for (let i = 1; i < GAP_STOPS.length; i++) {
    const [x1, c1] = GAP_STOPS[i];
    if (d <= x1) {
      const [x0, c0] = GAP_STOPS[i - 1];
      const t = (d - x0) / (x1 - x0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return GAP_STOPS[GAP_STOPS.length - 1][1];
}

const V = (a: Vec3) => new Vector3(a[0], a[1], a[2]);

export class Viewer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(35, 1, 1, 20000);
  readonly controls: OrbitControls;
  private labels = new CSS2DRenderer();
  private scanMesh: Mesh | null = null;
  private scanMat = new MeshStandardMaterial({ color: 0xd8b79a, roughness: 0.85, metalness: 0, transparent: true, opacity: 1, side: DoubleSide });
  private braceGroup = new Group();
  private markerGroup = new Group();
  private reliefGroup = new Group();
  private axesGroup = new Group();
  private handleGroup = new Group();
  private cutPlane: Mesh | null = null;
  private gapMode = false;
  private liner = 3;
  private drag: { mesh: Mesh; start: Vector3; axis: Vector3; label: HTMLElement; delta: number } | null = null;
  onHandleDrag: ((cuff: 'proximal' | 'distal', index: number, deltaMm: number) => void) | null = null;
  private frames: SerializedFrames | null = null;
  private markerSize = 3;
  private down = new Vector2();
  private raycaster = new Raycaster();
  onPick: ((p: Vec3) => void) | null = null;
  private hemi = new HemisphereLight(0xffffff, 0x8899aa, 1.4);
  private baseColors = { proximal: 0x1aa596, distal: 0x3b7fd1 };
  private braceMats = {
    proximal: new MeshStandardMaterial({ color: 0x1aa596, roughness: 0.45, metalness: 0.05, transparent: true, opacity: 1 }),
    distal: new MeshStandardMaterial({ color: 0x3b7fd1, roughness: 0.45, metalness: 0.05, transparent: true, opacity: 1 }),
  };

  constructor(private container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    container.appendChild(this.renderer.domElement);
    this.labels.domElement.style.position = 'absolute';
    this.labels.domElement.style.inset = '0';
    this.labels.domElement.style.pointerEvents = 'none';
    container.appendChild(this.labels.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.camera.position.set(400, 200, 400);

    this.scene.add(this.hemi);
    this.scene.add(new AmbientLight(0xffffff, 0.25));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 1.5, 1);
    this.camera.add(key);
    this.scene.add(this.camera);
    this.scene.add(this.braceGroup, this.markerGroup, this.reliefGroup, this.axesGroup, this.handleGroup);

    // Handle dragging runs in the capture phase so it pre-empts orbiting.
    container.addEventListener('pointerdown', (e) => this.startDrag(e), { capture: true });
    window.addEventListener('pointermove', (e) => this.moveDrag(e));
    window.addEventListener('pointerup', () => this.endDrag());

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.down.set(e.clientX, e.clientY));
    el.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || !this.onPick) return;
      if (this.down.distanceTo(new Vector2(e.clientX, e.clientY)) > 5) return;
      const p = this.pickSurface(e.clientX, e.clientY);
      if (p) this.onPick(p);
    });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.labels.render(this.scene, this.camera);
    });
  }

  /** Adapt materials and lighting to the UI theme (the background itself is CSS). */
  setTheme(dark: boolean) {
    this.baseColors = dark ? { proximal: 0x26c6b3, distal: 0x5b97ea } : { proximal: 0x1aa596, distal: 0x3b7fd1 };
    this.scanMat.color.set(dark ? 0xc8a68a : 0xd8b79a);
    this.hemi.groundColor.set(dark ? 0x334455 : 0x8899aa);
    this.hemi.intensity = dark ? 1.25 : 1.4;
    this.applyGapColors();
  }

  setPickCursor(on: boolean) {
    this.renderer.domElement.style.cursor = on ? 'crosshair' : '';
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private setRay(x: number, y: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  private pickSurface(x: number, y: number): Vec3 | null {
    if (!this.scanMesh || !this.scanMesh.visible) return null;
    this.setRay(x, y);
    (this.raycaster as any).firstHitOnly = true;
    const hit = this.raycaster.intersectObject(this.scanMesh, false)[0];
    return hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
  }

  setScan(geometry: BufferGeometry | null, keepView = false) {
    if (this.scanMesh) {
      this.scene.remove(this.scanMesh);
      this.scanMesh.geometry.dispose();
      this.scanMesh = null;
    }
    if (!keepView) this.frames = null;
    if (!geometry) return;
    (geometry as any).computeBoundsTree();
    this.scanMesh = new Mesh(geometry, this.scanMat);
    this.scene.add(this.scanMesh);
    geometry.computeBoundingBox();
    const diag = geometry.boundingBox!.getSize(new Vector3()).length();
    this.markerSize = Math.max(1.5, diag * 0.008);
    if (!keepView) this.setView('fit');
  }

  setScanOpacity(o: number) {
    this.scanMat.opacity = o;
    this.scanMat.depthWrite = o > 0.95;
    if (this.scanMesh) this.scanMesh.visible = o > 0.02;
  }

  setBraceOpacity(o: number) {
    for (const m of Object.values(this.braceMats)) {
      m.opacity = o;
      m.depthWrite = o > 0.95;
    }
    this.braceGroup.visible = o > 0.02;
  }

  setBrace(cuffs: { id: 'proximal' | 'distal'; geometry: BufferGeometry }[]) {
    for (const c of [...this.braceGroup.children]) {
      this.braceGroup.remove(c);
      (c as Mesh).geometry.dispose();
    }
    for (const c of cuffs) this.braceGroup.add(new Mesh(c.geometry, this.braceMats[c.id]));
    this.applyGapColors();
  }

  /** Colour the brace by skin-to-shell gap (geometry attribute `gap`) relative to the liner gap. */
  setGapMap(on: boolean, liner: number) {
    this.gapMode = on;
    this.liner = liner;
    this.applyGapColors();
  }

  private applyGapColors() {
    for (const m of Object.values(this.braceMats)) {
      m.vertexColors = this.gapMode;
      m.color.set(this.gapMode ? 0xffffff : m === this.braceMats.proximal ? this.baseColors.proximal : this.baseColors.distal);
      m.needsUpdate = true;
    }
    if (!this.gapMode) return;
    for (const child of this.braceGroup.children) {
      const g = (child as Mesh).geometry;
      const gap = g.getAttribute('gap');
      if (!gap) continue;
      const col = new Float32Array(gap.count * 3);
      for (let i = 0; i < gap.count; i++) col.set(gapColor(gap.getX(i) - this.liner), i * 3);
      g.setAttribute('color', new BufferAttribute(col, 3));
    }
  }

  setHandles(handles: TrimHandle[]) {
    clear(this.handleGroup);
    for (const hd of handles) {
      const m = new Mesh(new SphereGeometry(this.markerSize * 1.15, 20, 14), new MeshStandardMaterial({ color: 0xffffff, emissive: 0x0e5c55, emissiveIntensity: 0.35, roughness: 0.3 }));
      m.position.copy(V(hd.position));
      m.userData = { cuff: hd.cuff, index: hd.index, axis: V(hd.axis) };
      this.handleGroup.add(m);
    }
  }

  setHandlesVisible(on: boolean) {
    this.handleGroup.visible = on;
  }

  private startDrag(e: PointerEvent) {
    if (e.button !== 0 || !this.handleGroup.visible || !this.handleGroup.children.length || this.onPick) return;
    this.setRay(e.clientX, e.clientY);
    const hit = this.raycaster.intersectObjects(this.handleGroup.children, false)[0];
    if (!hit) return;
    e.stopPropagation();
    const mesh = hit.object as Mesh;
    const div = document.createElement('div');
    div.className = 'lbl3d';
    div.style.background = '#178f84';
    div.textContent = '0 mm';
    const label = new CSS2DObject(div);
    mesh.add(label);
    this.drag = { mesh, start: mesh.position.clone(), axis: mesh.userData.axis as Vector3, label: div, delta: 0 };
    this.controls.enabled = false;
  }

  private moveDrag(e: PointerEvent) {
    if (!this.drag) return;
    this.setRay(e.clientX, e.clientY);
    // Closest point on the handle's axis line to the mouse ray.
    const { start, axis } = this.drag;
    const ray = this.raycaster.ray;
    const w0 = start.clone().sub(ray.origin);
    const b = axis.dot(ray.direction);
    const d = axis.dot(w0), e2 = ray.direction.dot(w0);
    const den = 1 - b * b;
    if (den < 1e-6) return;
    const t = (b * e2 - d) / den;
    this.drag.delta = Math.round(t * 2) / 2;
    this.drag.mesh.position.copy(start).addScaledVector(axis, this.drag.delta);
    this.drag.label.textContent = `${this.drag.delta > 0 ? '+' : ''}${this.drag.delta} mm`;
  }

  private endDrag() {
    if (!this.drag) return;
    const { mesh, delta } = this.drag;
    this.drag = null;
    this.controls.enabled = true;
    for (const c of [...mesh.children]) if (c instanceof CSS2DObject) { mesh.remove(c); c.element.remove(); }
    if (Math.abs(delta) >= 0.5) this.onHandleDrag?.(mesh.userData.cuff, mesh.userData.index, delta);
  }

  /** World-space direction that points up on screen. */
  screenUp(): Vec3 {
    const v = new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    return [v.x, v.y, v.z];
  }

  showCutPlane(point: Vec3 | null, normal?: Vec3) {
    if (this.cutPlane) {
      this.scene.remove(this.cutPlane);
      this.cutPlane.geometry.dispose();
      this.cutPlane = null;
    }
    if (!point || !normal || !this.scanMesh) return;
    this.scanMesh.geometry.computeBoundingSphere();
    const size = this.scanMesh.geometry.boundingSphere!.radius * 2.4;
    const m = new Mesh(new PlaneGeometry(size, size), new MeshBasicMaterial({ color: 0xeb5757, transparent: true, opacity: 0.28, side: DoubleSide, depthWrite: false }));
    m.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), V(normal).normalize()));
    m.position.copy(V(point));
    m.renderOrder = 4;
    this.cutPlane = m;
    this.scene.add(m);
  }

  setLandmarks(l: Landmarks, active: LandmarkId | null) {
    clear(this.markerGroup);
    for (const [id, p] of Object.entries(l) as [LandmarkId, Vec3][]) {
      if (!p) continue;
      const color = LANDMARK_COLORS[id];
      const s = new Mesh(new SphereGeometry(this.markerSize * (id === active ? 1.35 : 1), 20, 14), new MeshStandardMaterial({ color, roughness: 0.4, depthTest: false, transparent: true, opacity: 0.95 }));
      s.renderOrder = 10;
      s.position.copy(V(p));
      const div = document.createElement('div');
      div.className = 'lbl3d';
      div.textContent = LANDMARK_LABELS[id];
      div.style.background = '#' + new Color(color).getHexString();
      const lbl = new CSS2DObject(div);
      s.add(lbl);
      this.markerGroup.add(s);
    }
  }

  setReliefs(reliefs: Relief[], selected: string | null) {
    clear(this.reliefGroup);
    for (const r of reliefs) {
      const color = r.amount >= 0 ? 0xf2b134 : 0x8e5bd6;
      const m = new Mesh(new SphereGeometry(r.radius, 28, 18), new MeshStandardMaterial({ color, transparent: true, opacity: r.id === selected ? 0.45 : 0.28, depthWrite: false }));
      m.position.copy(V(r.point));
      m.renderOrder = 5;
      const dot = new Mesh(new SphereGeometry(this.markerSize * 0.6, 12, 8), new MeshStandardMaterial({ color, depthTest: false }));
      dot.renderOrder = 11;
      m.add(dot);
      const div = document.createElement('div');
      div.className = 'lbl3d';
      div.textContent = `${r.label} ${r.amount > 0 ? '+' : ''}${r.amount} mm`;
      div.style.background = '#' + new Color(color).getHexString();
      dot.add(new CSS2DObject(div));
      this.reliefGroup.add(m);
    }
  }

  setFrames(f: SerializedFrames | null) {
    this.frames = f;
    clear(this.axesGroup);
    if (!f) return;
    const J = V(f.joint);
    const line = (a: Vector3, b: Vector3, color: number) => {
      const g = new BufferGeometry().setFromPoints([a, b]);
      const l = new Line(g, new LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 }));
      l.renderOrder = 9;
      this.axesGroup.add(l);
    };
    const h = V(f.hingeAxis).multiplyScalar(f.jointWidth * 0.9);
    line(J.clone().sub(h), J.clone().add(h), 0xeb5757);
    line(J, J.clone().addScaledVector(V(f.proximalAxis), f.proximalLength), 0x2f80ed);
    line(J, J.clone().addScaledVector(V(f.distalAxis), f.distalLength), 0x9b51e0);
  }

  setAxesVisible(on: boolean) {
    this.axesGroup.visible = on;
  }

  setView(view: ViewName) {
    const box = new Box3();
    if (this.scanMesh) box.expandByObject(this.scanMesh);
    if (this.braceGroup.children.length) box.expandByObject(this.braceGroup);
    if (box.isEmpty()) return;
    const f = this.frames;
    const target = f ? V(f.joint) : box.getCenter(new Vector3());
    const size = box.getSize(new Vector3()).length();
    const dist = size / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) * 0.95;
    let dir: Vector3;
    let up = new Vector3(0, 1, 0);
    if (f && view !== 'fit') {
      up = V(f.proximalAxis);
      const lat = V(f.hingeAxis), cr = V(f.cranial);
      dir = { lateral: lat, medial: lat.clone().negate(), cranial: cr, caudal: cr.clone().negate() }[view];
    } else if (f) {
      up = V(f.proximalAxis);
      dir = V(f.hingeAxis).add(V(f.cranial).multiplyScalar(0.6)).normalize();
    } else {
      dir = new Vector3(1, 0.4, 1).normalize();
      if (view === 'fit') target.copy(box.getCenter(new Vector3()));
    }
    this.camera.up.copy(up);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.5, size / 500);
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(target);
    this.controls.update();
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}

function clear(g: Object3D) {
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse((o) => {
      if ((o as Mesh).geometry) (o as Mesh).geometry.dispose();
      if (o instanceof CSS2DObject) o.element.remove();
    });
  }
}
