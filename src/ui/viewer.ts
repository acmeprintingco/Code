/** Three.js viewport: scan, brace, landmarks, reliefs, axes and surface picking. */
import {
  AmbientLight, BufferGeometry, Color, DirectionalLight, DoubleSide, Group, HemisphereLight, Line, LineBasicMaterial,
  Mesh, MeshStandardMaterial, PerspectiveCamera, Raycaster, Scene, SphereGeometry, Vector2, Vector3, WebGLRenderer, Box3, Object3D,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import { LANDMARK_COLORS, LANDMARK_LABELS, type LandmarkId, type Landmarks, type Relief, type Vec3 } from '../core/params';
import type { SerializedFrames } from './protocol';

(BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

export type ViewName = 'lateral' | 'medial' | 'cranial' | 'caudal' | 'fit';

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
  private frames: SerializedFrames | null = null;
  private markerSize = 3;
  private down = new Vector2();
  private raycaster = new Raycaster();
  onPick: ((p: Vec3) => void) | null = null;
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

    this.scene.add(new HemisphereLight(0xffffff, 0x8899aa, 1.4));
    this.scene.add(new AmbientLight(0xffffff, 0.25));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 1.5, 1);
    this.camera.add(key);
    this.scene.add(this.camera);
    this.scene.add(this.braceGroup, this.markerGroup, this.reliefGroup, this.axesGroup);

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

  private pickSurface(x: number, y: number): Vec3 | null {
    if (!this.scanMesh || !this.scanMesh.visible) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    (this.raycaster as any).firstHitOnly = true;
    const hit = this.raycaster.intersectObject(this.scanMesh, false)[0];
    return hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
  }

  setScan(geometry: BufferGeometry | null) {
    if (this.scanMesh) {
      this.scene.remove(this.scanMesh);
      this.scanMesh.geometry.dispose();
      this.scanMesh = null;
    }
    this.frames = null;
    if (!geometry) return;
    (geometry as any).computeBoundsTree();
    this.scanMesh = new Mesh(geometry, this.scanMat);
    this.scene.add(this.scanMesh);
    geometry.computeBoundingBox();
    const diag = geometry.boundingBox!.getSize(new Vector3()).length();
    this.markerSize = Math.max(1.5, diag * 0.008);
    this.setView('fit');
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
