/** Application shell: workflow sidebar, viewport toolbar, state and worker orchestration. */
import { BufferAttribute, BufferGeometry, Quaternion, Vector3 } from 'three';
import {
  BRACE_TYPES, LANDMARK_COLORS, LANDMARK_LABELS, LANDMARK_ORDER, MATERIALS, PARAM_SPECS, defaultParams,
  type BraceParams, type BraceType, type LandmarkId, type Landmarks, type ParamSpec, type Relief,
} from '../core/params';
import { missingLandmarks } from '../core/frames';
import { guessUnits, prepareScanGeometry, type Units } from '../core/scan';
import { makeDemoLimb } from '../core/demoLimb';
import { massGrams, toBinarySTL } from '../core/exporters';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Viewer, type ViewName } from './viewer';
import { SCAN_ACCEPT, download, emptyCase, parseProject, pickFile, readScanFile, safeName, serializeProject, type CaseInfo } from './io';
import { openWorkOrder } from './report';
import type { CuffPayload, FromWorker, SerializedFrames, ToWorker } from './protocol';

type Pick = { kind: 'landmark'; id: LandmarkId } | { kind: 'relief' } | null;

const RELIEF_PRESETS: Record<BraceType, string[]> = {
  stifle: ['Patella', 'Fibular head', 'Tibial tuberosity', 'Medial tibial condyle', 'Lateral femoral condyle'],
  hock: ['Calcaneus (point of hock)', 'Lateral malleolus', 'Medial malleolus', 'Calcaneal tendon', 'Base of 5th metatarsal'],
  carpal: ['Accessory carpal pad', 'Ulnar styloid', 'Radial styloid', 'Dewclaw', 'Metacarpal pad'],
};

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: (Node | string | null | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k in el && k !== 'list') (el as any)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== false) el.append(c);
  return el;
}

export class App {
  private caseInfo: CaseInfo = emptyCase();
  private params: BraceParams = defaultParams('stifle');
  private landmarks: Landmarks = {};
  private scan: { name: string; units: Units; geometry: BufferGeometry } | null = null;
  private result: { cuffs: CuffPayload[]; frames: SerializedFrames; warnings: string[]; millis: number } | null = null;
  private pick: Pick = null;
  private selectedRelief: string | null = null;
  private materialIdx = 0;
  private printOrient = true;
  private autoUpdate = true;
  private openSteps = new Set<string>(['case', 'scan']);

  private viewer!: Viewer;
  private worker: Worker;
  private reqId = 0;
  private pendingTimer: number | undefined;
  private sidebar!: HTMLElement;
  private banner!: HTMLElement;
  private busy!: HTMLElement;
  private empty!: HTMLElement;
  private statusMsg!: HTMLElement;
  private statusWarn!: HTMLElement;
  private caseTitle!: HTMLElement;

  constructor(private root: HTMLElement) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onWorker(e.data);
    this.buildLayout();
    this.renderSidebar();
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.pick) this.setPick(null);
    });
  }

  // ---------------------------------------------------------------- layout
  private buildLayout() {
    this.caseTitle = h('span', { class: 'case-title' });
    const top = h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, h('div', { class: 'logo' }, 'PB'), 'PetBrace Studio'),
      this.caseTitle,
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => this.openProject() }, 'Open project'),
      h('button', { class: 'btn', onclick: () => this.saveProject() }, 'Save project'),
    );
    this.sidebar = h('aside', { class: 'sidebar' });
    const vp = h('main', { class: 'viewport' });
    this.root.append(top, this.sidebar, vp);
    this.viewer = new Viewer(vp);

    const view = (v: ViewName, label: string) => h('button', { class: 'btn small', onclick: () => this.viewer.setView(v) }, label);
    const slider = (label: string, init: number, fn: (v: number) => void) =>
      h('label', {}, label, h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: init, oninput: (e: Event) => fn(+(e.target as HTMLInputElement).value) }));
    const axes = h('input', { type: 'checkbox', checked: true, onchange: (e: Event) => this.viewer.setAxesVisible((e.target as HTMLInputElement).checked) });
    vp.append(h('div', { class: 'vp-toolbar' },
      h('div', { class: 'vp-card' }, view('fit', 'Fit'), view('lateral', 'Lateral'), view('medial', 'Medial'), view('cranial', 'Cranial'), view('caudal', 'Caudal')),
      h('div', { class: 'sep' }),
      h('div', { class: 'vp-card' }, slider('Scan', 1, (v) => this.viewer.setScanOpacity(v)), slider('Brace', 1, (v) => this.viewer.setBraceOpacity(v)), h('label', {}, axes, 'Axes')),
    ));
    this.empty = h('div', { class: 'vp-empty' }, h('div', {}, h('b', {}, 'No scan loaded'), 'Import an STL, OBJ or PLY limb scan, or load a demo limb.'));
    this.banner = h('div', { class: 'vp-banner' });
    this.busy = h('div', { class: 'busy' }, 'Generating brace…');
    vp.append(this.empty, this.banner, this.busy);

    this.statusMsg = h('span', {}, 'Ready.');
    this.statusWarn = h('span', { class: 'warn' });
    this.root.append(h('footer', { class: 'statusbar' }, this.statusMsg, this.statusWarn));

    vp.addEventListener('dragover', (e) => e.preventDefault());
    vp.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) this.importScan(f);
    });
  }

  private status(msg: string, warn = '') {
    this.statusMsg.textContent = msg;
    this.statusWarn.textContent = warn;
  }

  // ---------------------------------------------------------------- sidebar
  private renderSidebar() {
    const scrollTop = this.sidebar.scrollTop;
    this.sidebar.replaceChildren(
      this.step('case', 1, 'Case & brace type', BRACE_TYPES[this.params.braceType].label, true, () => this.caseStep()),
      this.step('scan', 2, 'Import scan', this.scan ? this.scan.name : '', !!this.scan, () => this.scanStep()),
      this.step('landmarks', 3, 'Landmarks', `${5 - missingLandmarks(this.landmarks).length}/5 placed`, missingLandmarks(this.landmarks).length === 0, () => this.landmarkStep()),
      this.step('design', 4, 'Brace design', this.params.hinged ? 'Hinged' : 'Rigid', !!this.result, () => this.designStep()),
      this.step('reliefs', 5, 'Relief & pressure zones', `${this.params.reliefs.length} zone${this.params.reliefs.length === 1 ? '' : 's'}`, this.params.reliefs.length > 0, () => this.reliefStep()),
      this.step('export', 6, 'Review & export', this.result ? 'Ready' : '', false, () => this.exportStep()),
    );
    this.sidebar.scrollTop = scrollTop;
    const c = this.caseInfo;
    this.caseTitle.textContent = `${c.caseId}${c.patient ? ' · ' + c.patient : ''} · ${BRACE_TYPES[this.params.braceType].label}`;
    this.empty.style.display = this.scan ? 'none' : '';
  }

  private step(id: string, n: number, title: string, summary: string, done: boolean, body: () => HTMLElement[]) {
    const open = this.openSteps.has(id);
    const sec = h('section', { class: `step${open ? ' open' : ''}${done ? ' done' : ''}` },
      h('header', { onclick: () => { open ? this.openSteps.delete(id) : this.openSteps.add(id); this.renderSidebar(); } },
        h('div', { class: 'num' }, done ? '✓' : String(n)), h('h2', {}, title), h('span', { class: 'summary' }, summary), h('span', { class: 'chev' }, '›')),
    );
    if (open) sec.append(h('div', { class: 'body' }, ...body()));
    return sec;
  }

  private caseStep(): HTMLElement[] {
    const c = this.caseInfo;
    const txt = (label: string, key: keyof CaseInfo, full = false) => h('label', { class: 'field', style: full ? 'grid-column: 1 / -1' : '' }, h('span', {}, label),
      h('input', { type: 'text', value: c[key], oninput: (e: Event) => { (c as any)[key] = (e.target as HTMLInputElement).value; this.caseTitle.textContent = `${c.caseId}${c.patient ? ' · ' + c.patient : ''} · ${BRACE_TYPES[this.params.braceType].label}`; } }));
    const sel = (label: string, key: keyof CaseInfo, options: string[]) => h('label', { class: 'field' }, h('span', {}, label),
      h('select', { onchange: (e: Event) => { (c as any)[key] = (e.target as HTMLSelectElement).value; } }, ...options.map((o) => h('option', { value: o, selected: c[key] === o }, o))));
    const types = (Object.keys(BRACE_TYPES) as BraceType[]).map((t) =>
      h('button', { class: `btn${this.params.braceType === t ? ' active' : ''}`, style: 'flex:1', onclick: () => this.setBraceType(t) }, BRACE_TYPES[t].label));
    return [
      h('div', { class: 'btns' }, ...types),
      h('p', { class: 'hint' }, `${BRACE_TYPES[this.params.braceType].proximalSegment} + ${BRACE_TYPES[this.params.braceType].distalSegment}, articulating at the ${BRACE_TYPES[this.params.braceType].joint}.`),
      h('div', { class: 'grid2' },
        txt('Case ID', 'caseId'), txt('Patient name', 'patient'),
        sel('Species', 'species', ['Canine', 'Feline', 'Other']), txt('Breed', 'breed'),
        txt('Weight (kg)', 'weightKg'), txt('Age', 'age'),
        sel('Limb side', 'side', ['Left', 'Right']), txt('Owner', 'owner'),
        txt('Clinic', 'clinic'), txt('Clinician', 'clinician'),
        txt('Diagnosis / indication', 'diagnosis', true),
        h('label', { class: 'field', style: 'grid-column: 1 / -1' }, h('span', {}, 'Notes'), h('textarea', { value: c.notes, oninput: (e: Event) => (c.notes = (e.target as HTMLTextAreaElement).value) })),
      ),
    ];
  }

  private scanStep(): HTMLElement[] {
    const drop = h('div', { class: 'drop', onclick: async () => { const f = await pickFile(SCAN_ACCEPT); if (f) this.importScan(f); } },
      h('b', {}, 'Import 3D scan'), h('div', {}, 'STL · OBJ · PLY — click or drop onto the viewport'));
    const out: HTMLElement[] = [drop];
    if (this.scan) {
      const g = this.scan.geometry;
      g.computeBoundingBox();
      const s = g.boundingBox!.getSize(new Vector3());
      const tris = (g.getIndex()?.count ?? g.getAttribute('position').count) / 3;
      out.push(
        h('div', { class: 'row' }, h('label', {}, 'File units'),
          h('select', { onchange: (e: Event) => this.reimportUnits((e.target as HTMLSelectElement).value as Units) },
            ...(['mm', 'cm', 'm', 'in'] as Units[]).map((u) => h('option', { value: u, selected: u === this.scan!.units }, u)))),
        h('p', { class: 'hint' }, `${tris.toLocaleString()} triangles · ${s.x.toFixed(0)} × ${s.y.toFixed(0)} × ${s.z.toFixed(0)} mm`),
      );
      if (Math.max(s.x, s.y, s.z) > 1500 || Math.max(s.x, s.y, s.z) < 40) out.push(h('div', { class: 'note' }, 'The scan size looks unusual for a limb — check the file units.'));
    }
    out.push(h('p', { class: 'hint' }, 'Scan the limb in a natural standing position. Small disconnected fragments (floor, hair, other limbs) are removed automatically.'));
    out.push(h('div', { class: 'btns' }, h('span', { class: 'hint' }, 'Demo limb:'),
      ...(Object.keys(BRACE_TYPES) as BraceType[]).map((t) => h('button', { class: 'btn small', onclick: () => this.loadDemo(t) }, BRACE_TYPES[t].label.split(' ')[0]))));
    return out;
  }

  private landmarkStep(): HTMLElement[] {
    if (!this.scan) return [h('p', { class: 'hint' }, 'Import a scan first.')];
    const hints = BRACE_TYPES[this.params.braceType].hints;
    const items = LANDMARK_ORDER.map((id) => {
      const set = !!this.landmarks[id];
      const picking = this.pick?.kind === 'landmark' && this.pick.id === id;
      return h('div', { class: `lm${picking ? ' picking' : ''}`, onclick: () => this.setPick(picking ? null : { kind: 'landmark', id }) },
        h('span', { class: 'dot', style: `background:#${LANDMARK_COLORS[id].toString(16).padStart(6, '0')}` }),
        h('div', {}, h('div', { class: 'name' }, LANDMARK_LABELS[id]), h('div', { class: 'desc' }, hints[id])),
        h('span', { class: `state${set ? ' set' : ''}` }, picking ? 'Click scan…' : set ? 'Placed' : 'Place'));
    });
    return [
      h('p', { class: 'hint' }, 'Select a landmark, then click on the scan. The joint points define the hinge axis; the proximal and distal points set the cuff lengths.'),
      ...items,
      h('div', { class: 'btns' },
        h('button', { class: 'btn small', onclick: () => this.setPick({ kind: 'landmark', id: missingLandmarks(this.landmarks)[0] ?? 'proximal' }) }, 'Place next'),
        h('button', { class: 'btn small', onclick: () => { this.landmarks = {}; this.result = null; this.viewer.setBrace([]); this.viewer.setFrames(null); this.refreshMarkers(); this.renderSidebar(); } }, 'Clear all')),
    ];
  }

  private designStep(): HTMLElement[] {
    const groups = new Map<string, ParamSpec[]>();
    for (const s of PARAM_SPECS) {
      if (s.showIf && !s.showIf(this.params)) continue;
      if (!groups.has(s.group)) groups.set(s.group, []);
      groups.get(s.group)!.push(s);
    }
    const out: HTMLElement[] = [];
    for (const [name, specs] of groups) {
      const det = h('details', { class: 'group', open: ['Fit', 'Shell', 'Joint'].includes(name) }, h('summary', {}, name));
      const content = h('div', { class: 'content' });
      for (const s of specs) content.append(this.paramControl(s));
      det.append(content);
      out.push(det);
    }
    const ready = !!this.scan && missingLandmarks(this.landmarks).length === 0;
    out.push(
      h('div', { class: 'row' }, h('label', {}, 'Update automatically'), h('input', { type: 'checkbox', checked: this.autoUpdate, onchange: (e: Event) => (this.autoUpdate = (e.target as HTMLInputElement).checked) })),
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary', disabled: !ready, onclick: () => this.generate() }, 'Generate brace'),
        h('button', { class: 'btn', onclick: () => { const r = this.params.reliefs; this.params = { ...defaultParams(this.params.braceType), reliefs: r }; this.renderSidebar(); this.scheduleGenerate(); } }, 'Reset defaults')),
    );
    if (!ready) out.push(h('p', { class: 'hint' }, 'Place all five landmarks to generate the brace.'));
    return out;
  }

  private paramControl(s: ParamSpec): HTMLElement {
    const p = this.params as any;
    if (s.kind === 'bool') {
      return h('div', { class: 'param bool', title: s.help ?? '' }, h('span', { class: 'lbl' }, s.label),
        h('input', { type: 'checkbox', checked: !!p[s.key], onchange: (e: Event) => { p[s.key] = (e.target as HTMLInputElement).checked; this.renderSidebar(); this.scheduleGenerate(); } }));
    }
    const num = h('input', { type: 'number', min: s.min, max: s.max, step: s.step, value: p[s.key] });
    const range = h('input', { type: 'range', min: s.min, max: s.max, step: s.step, value: p[s.key] });
    const set = (v: number) => {
      if (Number.isNaN(v)) return;
      p[s.key] = v;
      num.value = String(v);
      range.value = String(v);
      this.scheduleGenerate();
    };
    range.addEventListener('input', () => set(+range.value));
    num.addEventListener('change', () => set(+num.value));
    return h('div', { class: 'param', title: s.help ?? '' }, h('span', { class: 'lbl' }, s.label + (s.unit ? ` (${s.unit})` : '')), range, num);
  }

  private reliefStep(): HTMLElement[] {
    if (!this.scan) return [h('p', { class: 'hint' }, 'Import a scan first.')];
    const presets = RELIEF_PRESETS[this.params.braceType];
    const list = this.params.reliefs.map((r) => {
      const field = (label: string, key: 'radius' | 'amount', min: number, max: number, step: number) =>
        h('div', { class: 'param' }, h('span', { class: 'lbl' }, label),
          h('input', { type: 'range', min, max, step, value: r[key], oninput: (e: Event) => { r[key] = +(e.target as HTMLInputElement).value; (e.target as HTMLElement).nextElementSibling!.textContent = String(r[key]); this.refreshMarkers(); this.scheduleGenerate(); } }),
          h('span', { class: 'lbl', style: 'text-align:right' }, String(r[key])));
      return h('div', { class: `relief${r.id === this.selectedRelief ? ' sel' : ''}`, onclick: () => { this.selectedRelief = r.id; this.refreshMarkers(); } },
        h('div', { class: 'top' },
          h('input', { type: 'text', value: r.label, list: 'relief-presets', oninput: (e: Event) => { r.label = (e.target as HTMLInputElement).value; this.refreshMarkers(); } }),
          h('button', { class: 'btn small', onclick: (e: Event) => { e.stopPropagation(); this.params.reliefs = this.params.reliefs.filter((x) => x !== r); this.refreshMarkers(); this.renderSidebar(); this.scheduleGenerate(); } }, 'Remove')),
        field('Radius (mm)', 'radius', 4, 50, 1),
        field('Amount (mm, − = compress)', 'amount', -4, 10, 0.5));
    });
    const picking = this.pick?.kind === 'relief';
    return [
      h('p', { class: 'hint' }, 'Relief zones lift the shell off bony prominences; negative values add gentle compression (e.g. supracondylar grip for suspension).'),
      h('datalist', { id: 'relief-presets' }, ...presets.map((p) => h('option', { value: p }))),
      ...list,
      h('div', { class: 'btns' }, h('button', { class: `btn${picking ? ' active' : ''}`, onclick: () => this.setPick(picking ? null : { kind: 'relief' }) }, picking ? 'Click on scan… (Esc)' : '+ Add zone')),
      h('p', { class: 'hint' }, `Typical for ${BRACE_TYPES[this.params.braceType].joint}: ${presets.slice(0, 3).join(', ')}.`),
    ];
  }

  private exportStep(): HTMLElement[] {
    if (!this.result) return [h('p', { class: 'hint' }, 'Generate a brace to review and export it.')];
    const mat = MATERIALS[this.materialIdx];
    const bt = BRACE_TYPES[this.params.braceType];
    const rows = this.result.cuffs.map((c) => {
      const ok = c.check.boundaryEdges === 0 && c.check.nonManifoldEdges === 0;
      return h('tr', {}, h('td', {}, c.id === 'proximal' ? bt.proximalSegment : bt.distalSegment), h('td', {}, (c.check.volume / 1000).toFixed(1) + ' cm³'),
        h('td', {}, massGrams(c.check.volume, mat.density).toFixed(0) + ' g'), h('td', { class: ok ? 'ok' : 'bad' }, ok ? '✓ closed' : '✗ open'));
    });
    const totalG = this.result.cuffs.reduce((s, c) => s + massGrams(c.check.volume, mat.density), 0);
    const f = this.result.frames;
    const out: HTMLElement[] = [
      h('table', { class: 'stats' }, h('tr', {}, h('th', {}, 'Part'), h('th', {}, 'Volume'), h('th', {}, 'Mass'), h('th', {}, 'Mesh')), ...rows),
      h('p', { class: 'hint' }, `Total ≈ ${totalG.toFixed(0)} g in ${mat.name}. Joint deviation ${f.bendAngle.toFixed(0)}°, joint width ${f.jointWidth.toFixed(1)} mm. Generated in ${this.result.millis.toFixed(0)} ms.`),
      h('div', { class: 'row' }, h('label', {}, 'Material'), h('select', { onchange: (e: Event) => { this.materialIdx = +(e.target as HTMLSelectElement).value; this.renderSidebar(); } },
        ...MATERIALS.map((m, i) => h('option', { value: i, selected: i === this.materialIdx }, m.name)))),
      h('p', { class: 'hint' }, mat.note),
      h('div', { class: 'row' }, h('label', {}, 'Orient for printing (cuff axis vertical, on bed)'), h('input', { type: 'checkbox', checked: this.printOrient, onchange: (e: Event) => (this.printOrient = (e.target as HTMLInputElement).checked) })),
      h('div', { class: 'btns' },
        ...this.result.cuffs.map((c) => h('button', { class: 'btn', onclick: () => this.exportSTL([c.id]) }, `${c.id === 'proximal' ? 'Proximal' : 'Distal'} STL`)),
        h('button', { class: 'btn primary', onclick: () => this.exportSTL(['proximal', 'distal']) }, 'All parts STL')),
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: () => this.workOrder() }, 'Work order (print)'),
        h('button', { class: 'btn', onclick: () => this.saveProject() }, 'Save project')),
    ];
    if (this.result.warnings.length) out.unshift(...this.result.warnings.map((w) => h('div', { class: 'note' }, w)));
    out.push(h('div', { class: 'note' }, 'Custom veterinary device: confirm fit, skin clearance and range of motion with the treating veterinarian before dispensing.'));
    return out;
  }

  // ---------------------------------------------------------------- actions
  private setBraceType(t: BraceType) {
    if (t === this.params.braceType) return;
    this.params = { ...defaultParams(t), reliefs: this.params.reliefs };
    this.status(`Brace type: ${BRACE_TYPES[t].label}. Design parameters reset to ${t} defaults.`);
    this.renderSidebar();
    this.scheduleGenerate();
  }

  private async importScan(file: File) {
    try {
      this.status(`Reading ${file.name}…`);
      const raw = await readScanFile(file);
      this.raw = raw;
      this.setScan(file.name, raw, guessUnits(raw), {});
    } catch (err) {
      this.status('Import failed.', err instanceof Error ? err.message : String(err));
    }
  }

  private raw: BufferGeometry | null = null;

  private reimportUnits(u: Units) {
    if (this.raw && this.scan) this.setScan(this.scan.name, this.raw, u, {});
  }

  private setScan(name: string, raw: BufferGeometry, units: Units, landmarks: Landmarks, center = true) {
    const { geometry, removedTriangles } = prepareScanGeometry(raw, { units, fragmentFraction: 0.05, center });
    this.scan = { name, units, geometry };
    this.landmarks = landmarks;
    this.result = null;
    this.viewer.setBrace([]);
    this.viewer.setFrames(null);
    this.viewer.setScan(geometry);
    this.refreshMarkers();
    const pos = new Float32Array(geometry.getAttribute('position').array);
    const idx = geometry.getIndex() ? Uint32Array.from(geometry.getIndex()!.array) : null;
    this.post({ type: 'scan', position: pos, index: idx }, idx ? [pos.buffer, idx.buffer] : [pos.buffer]);
    this.openSteps.add('landmarks');
    this.status(`Loaded ${name} (${units})${removedTriangles ? ` — removed ${removedTriangles.toLocaleString()} fragment triangles` : ''}.`);
    this.renderSidebar();
    if (missingLandmarks(landmarks).length === 0) this.scheduleGenerate(0);
    else this.setPick({ kind: 'landmark', id: missingLandmarks(landmarks)[0] });
  }

  private loadDemo(t: BraceType) {
    const demo = makeDemoLimb(t);
    if (t !== this.params.braceType) this.params = { ...defaultParams(t), reliefs: [] };
    this.params.reliefs = [];
    this.raw = demo.geometry;
    this.setScan(`demo-${t}-limb.stl`, demo.geometry, 'mm', demo.landmarks, false);
    this.openSteps.add('design');
    this.openSteps.add('export');
    this.renderSidebar();
  }

  private setPick(p: Pick) {
    this.pick = p;
    this.viewer.setPickCursor(!!p);
    if (!p) {
      this.viewer.onPick = null;
      this.banner.classList.remove('show');
    } else if (p.kind === 'landmark') {
      this.banner.textContent = `Click the scan: ${LANDMARK_LABELS[p.id]} — ${BRACE_TYPES[this.params.braceType].hints[p.id]}  (Esc to cancel)`;
      this.banner.classList.add('show');
      this.viewer.onPick = (pt) => {
        this.landmarks[p.id] = pt;
        const next = missingLandmarks(this.landmarks)[0];
        this.setPick(next ? { kind: 'landmark', id: next } : null);
        this.refreshMarkers();
        if (!next) {
          this.openSteps.add('design');
          this.scheduleGenerate(0);
        }
      };
    } else {
      this.banner.textContent = 'Click the scan to place a relief / pressure zone (Esc to cancel)';
      this.banner.classList.add('show');
      this.viewer.onPick = (pt) => {
        const id = Math.random().toString(36).slice(2, 9);
        const used = new Set(this.params.reliefs.map((r) => r.label));
        const label = RELIEF_PRESETS[this.params.braceType].find((x) => !used.has(x)) ?? `Zone ${this.params.reliefs.length + 1}`;
        const r: Relief = { id, label, point: pt, radius: 14, amount: 3 };
        this.params.reliefs.push(r);
        this.selectedRelief = id;
        this.setPick(null);
        this.refreshMarkers();
        this.scheduleGenerate();
      };
    }
    this.renderSidebar();
  }

  private refreshMarkers() {
    this.viewer.setLandmarks(this.landmarks, this.pick?.kind === 'landmark' ? this.pick.id : null);
    this.viewer.setReliefs(this.params.reliefs, this.selectedRelief);
  }

  private scheduleGenerate(delay = 350) {
    if (!this.autoUpdate && delay > 0) return;
    clearTimeout(this.pendingTimer);
    this.pendingTimer = window.setTimeout(() => this.generate(), delay);
  }

  private generate() {
    if (!this.scan || missingLandmarks(this.landmarks).length) return;
    const reqId = ++this.reqId;
    this.busy.classList.add('show');
    this.post({ type: 'generate', reqId, landmarks: structuredClone(this.landmarks), params: structuredClone(this.params) });
  }

  private post(m: ToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(m, transfer);
  }

  private onWorker(m: FromWorker) {
    if (m.type === 'scanReady') return;
    if (m.reqId !== this.reqId) return;
    this.busy.classList.remove('show');
    if (m.type === 'error') {
      this.status('Brace generation failed.', m.message);
      return;
    }
    const first = !this.result;
    this.result = { cuffs: m.cuffs, frames: m.frames, warnings: m.warnings, millis: m.millis };
    this.viewer.setBrace(m.cuffs.map((c) => ({ id: c.id, geometry: toCreasedNormals(toGeometry(c), Math.PI / 5) })));
    this.viewer.setFrames(m.frames);
    if (first) this.viewer.setView('fit');
    const tris = m.cuffs.reduce((s, c) => s + c.check.triangles, 0);
    this.status(`Brace generated in ${m.millis.toFixed(0)} ms · ${tris.toLocaleString()} triangles.`, m.warnings.join(' '));
    this.renderSidebar();
  }

  private exportSTL(ids: ('proximal' | 'distal')[]) {
    if (!this.result) return;
    const geoms = this.result.cuffs.filter((c) => ids.includes(c.id)).map((c) => {
      const g = toGeometry(c);
      if (this.printOrient) orientForPrint(g, this.result!.frames, c.id);
      return g;
    });
    if (this.printOrient && geoms.length === 2) {
      // Place parts side by side on the bed.
      geoms[0].computeBoundingBox();
      geoms[1].computeBoundingBox();
      const w0 = geoms[0].boundingBox!.max.x, w1 = -geoms[1].boundingBox!.min.x;
      geoms[1].translate(w0 + w1 + 10, 0, 0);
    }
    const base = safeName([this.caseInfo.caseId, this.caseInfo.patient, this.params.braceType].filter(Boolean).join('_'));
    const part = ids.length === 2 ? 'all' : ids[0];
    download(`${base}_${part}.stl`, toBinarySTL(geoms, `PetBrace ${this.caseInfo.caseId} ${part}`), 'model/stl');
    this.status(`Exported ${base}_${part}.stl`);
  }

  private workOrder() {
    if (!this.result) return;
    try {
      openWorkOrder({ caseInfo: this.caseInfo, params: this.params, material: MATERIALS[this.materialIdx], cuffs: this.result.cuffs, frames: this.result.frames, image: this.viewer.screenshot(), scanName: this.scan?.name ?? '' });
    } catch (err) {
      this.status('Could not open work order.', err instanceof Error ? err.message : String(err));
    }
  }

  private saveProject() {
    const text = serializeProject(this.caseInfo, this.params, this.landmarks, this.scan);
    const name = `${safeName([this.caseInfo.caseId, this.caseInfo.patient].filter(Boolean).join('_'))}.petbrace.json`;
    download(name, text, 'application/json');
    this.status(`Saved ${name}`);
  }

  private async openProject() {
    const f = await pickFile('.json,.petbrace.json');
    if (!f) return;
    try {
      const { file, geometry } = parseProject(await f.text());
      this.caseInfo = { ...emptyCase(), ...file.caseInfo };
      this.params = { ...defaultParams(file.params.braceType), ...file.params };
      if (geometry && file.scan) {
        this.raw = null;
        this.setScan(file.scan.name, geometry, 'mm', file.landmarks, false);
        this.scan!.units = file.scan.units;
      }
      this.openSteps = new Set(['design', 'export']);
      this.refreshMarkers();
      this.renderSidebar();
      this.status(`Opened ${f.name}`);
    } catch (err) {
      this.status('Could not open project.', err instanceof Error ? err.message : String(err));
    }
  }
}

function toGeometry(c: CuffPayload): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(c.position), 3));
  g.setIndex(new BufferAttribute(new Uint32Array(c.index), 1));
  g.computeVertexNormals();
  return g;
}

/** Rotate a cuff so its long axis is +Z, centre it on X/Y and drop it onto Z = 0. */
function orientForPrint(g: BufferGeometry, f: SerializedFrames, id: 'proximal' | 'distal') {
  const axis = new Vector3(...(id === 'proximal' ? f.proximalAxis : f.distalAxis));
  const J = new Vector3(...f.joint);
  g.translate(-J.x, -J.y, -J.z);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(axis, new Vector3(0, 0, 1)));
  g.computeBoundingBox();
  const b = g.boundingBox!;
  g.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -b.min.z);
}
