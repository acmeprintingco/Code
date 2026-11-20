/**
 * Brace design parameters, brace-type presets and the parameter schema used
 * to build the UI. All lengths are millimetres, all angles degrees.
 */

export type BraceType = 'stifle' | 'hock' | 'carpal';

export type LandmarkId = 'proximal' | 'distal' | 'jointLateral' | 'jointMedial' | 'cranial';

export type Vec3 = [number, number, number];

export type Landmarks = Partial<Record<LandmarkId, Vec3>>;

/** A local change of the inner surface: positive = relief (away from skin), negative = compression. */
export interface Relief {
  id: string;
  label: string;
  point: Vec3;
  radius: number;
  amount: number;
}

export interface BraceParams {
  braceType: BraceType;

  // Fit
  linerOffset: number;
  smoothing: number;
  edgeFlare: number;
  flareWidth: number;

  // Shell
  wallThickness: number;
  edgeRounding: number;
  resolution: number;

  // Trim lines (relative to the proximal / distal landmarks)
  proxTrimOffset: number;
  proxTrimTilt: number;
  distTrimOffset: number;
  distTrimTilt: number;
  /** Hand-edited trim line: offsets (mm) at 8 points around the limb, 0° = cranial, 45° steps toward lateral. */
  proxTrimShape: number[];
  distTrimShape: number[];

  // Joint / hinge
  hinged: boolean;
  jointGap: number;
  hingeRadius: number;
  hingeHole: number;
  hingeBossThickness: number;
  hingeClearance: number;
  rigidOverlap: number;
  /** Range-of-motion stops: a pin on the proximal pad runs in an arc slot in the distal pad. */
  romStops: boolean;
  /** Most flexed joint angle allowed (deg, 180 = straight). */
  romFlexion: number;
  /** Most extended joint angle allowed (deg, >180 = hyperextension). */
  romExtension: number;
  stopPinDiameter: number;

  // Opening for donning
  openingCenter: number;
  openingWidthProx: number;
  openingWidthDist: number;

  // Straps
  strapsPerCuff: number;
  strapWidth: number;
  strapSlotWidth: number;
  strapMargin: number;

  // Plantar / palmar extension (hock / carpal): the shell continues down the caudal side of the paw
  footPlate: boolean;
  footPlateLength: number;
  footPlateWidth: number;

  // Ventilation
  perforate: boolean;
  perfDiameter: number;
  perfSpacing: number;
  perfMargin: number;

  reliefs: Relief[];
}

export const BRACE_TYPES: Record<BraceType, { label: string; proximalSegment: string; distalSegment: string; joint: string; hints: Record<LandmarkId, string> }> = {
  stifle: {
    label: 'Stifle (knee)',
    proximalSegment: 'Thigh cuff',
    distalSegment: 'Crus (tibial) cuff',
    joint: 'stifle',
    hints: {
      proximal: 'Top of the thigh cuff — mid-femur, below the inguinal fold, on the lateral side.',
      distal: 'Bottom of the crus cuff — above the hock / calcaneal tendon insertion.',
      jointLateral: 'Lateral stifle axis — lateral femoral epicondyle.',
      jointMedial: 'Medial stifle axis — medial femoral epicondyle.',
      cranial: 'Cranial reference — the patella / patellar tendon.',
    },
  },
  hock: {
    label: 'Hock (tarsus)',
    proximalSegment: 'Crus (tibial) cuff',
    distalSegment: 'Metatarsal cuff',
    joint: 'hock',
    hints: {
      proximal: 'Top of the crus cuff — about mid-tibia, below the stifle.',
      distal: 'Bottom of the metatarsal cuff — just above the paw pads / toes.',
      jointLateral: 'Lateral hock axis — lateral malleolus.',
      jointMedial: 'Medial hock axis — medial malleolus.',
      cranial: 'Cranial reference — front (dorsal) of the hock.',
    },
  },
  carpal: {
    label: 'Carpal (wrist)',
    proximalSegment: 'Antebrachial (forearm) cuff',
    distalSegment: 'Metacarpal / paw cuff',
    joint: 'carpus',
    hints: {
      proximal: 'Top of the forearm cuff — mid-radius, below the elbow.',
      distal: 'Bottom of the paw cuff — proximal to the metacarpal pad / toes.',
      jointLateral: 'Lateral carpal axis — ulnar styloid process.',
      jointMedial: 'Medial carpal axis — radial styloid process.',
      cranial: 'Cranial reference — dorsal surface of the carpus.',
    },
  },
};

export const LANDMARK_ORDER: LandmarkId[] = ['proximal', 'jointLateral', 'jointMedial', 'cranial', 'distal'];

export const LANDMARK_LABELS: Record<LandmarkId, string> = {
  proximal: 'Proximal trim',
  jointLateral: 'Joint axis (lateral)',
  jointMedial: 'Joint axis (medial)',
  cranial: 'Cranial reference',
  distal: 'Distal trim',
};

export const LANDMARK_COLORS: Record<LandmarkId, number> = {
  proximal: 0x2f80ed,
  jointLateral: 0xeb5757,
  jointMedial: 0xf2994a,
  cranial: 0x27ae60,
  distal: 0x9b51e0,
};

const BASE: Omit<BraceParams, 'braceType'> = {
  linerOffset: 3,
  smoothing: 2,
  edgeFlare: 2,
  flareWidth: 8,
  wallThickness: 3.5,
  edgeRounding: 1.5,
  resolution: 1.25,
  proxTrimOffset: 0,
  proxTrimTilt: 0,
  distTrimOffset: 0,
  distTrimTilt: 0,
  proxTrimShape: [],
  distTrimShape: [],
  hinged: true,
  jointGap: 12,
  hingeRadius: 11,
  hingeHole: 5,
  hingeBossThickness: 4.5,
  hingeClearance: 0.4,
  rigidOverlap: 1.5,
  romStops: false,
  romFlexion: 80,
  romExtension: 150,
  stopPinDiameter: 3,
  openingCenter: 0,
  openingWidthProx: 70,
  openingWidthDist: 70,
  strapsPerCuff: 2,
  strapWidth: 25,
  strapSlotWidth: 4,
  strapMargin: 7,
  footPlate: false,
  footPlateLength: 30,
  footPlateWidth: 150,
  perforate: false,
  perfDiameter: 7,
  perfSpacing: 13,
  perfMargin: 6,
  reliefs: [],
};

export const TRIM_POINTS = 8;

export function defaultParams(braceType: BraceType): BraceParams {
  const p = presetParams(braceType);
  p.proxTrimShape = new Array(TRIM_POINTS).fill(0);
  p.distTrimShape = new Array(TRIM_POINTS).fill(0);
  return p;
}

/** Periodic Catmull-Rom interpolation of a trim shape at a user angle (radians, 0 = cranial, +π/2 = lateral). */
export function trimShapeAt(shape: number[] | undefined, thetaUser: number): number {
  if (!shape || !shape.length) return 0;
  const n = shape.length;
  let x = ((thetaUser / (Math.PI * 2)) * n) % n;
  if (x < 0) x += n;
  const i1 = Math.floor(x) % n;
  const t = x - Math.floor(x);
  const p0 = shape[(i1 - 1 + n) % n], p1 = shape[i1], p2 = shape[(i1 + 1) % n], p3 = shape[(i1 + 2) % n];
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

/**
 * Default designs per brace type, modelled on the Hero Braces product line:
 * a rigid shell that wraps the caudal side of the limb, wide cranial opening
 * closed with straps, no vent holes; hinged stifle and carpal; rigid
 * one-piece hock. (Hero hock/carpal braces also have a sole under the paw;
 * see footPlate for the current plantar/palmar extension.)
 */
function presetParams(braceType: BraceType): BraceParams {
  switch (braceType) {
    case 'stifle':
      return {
        ...BASE, braceType, linerOffset: 2.5, wallThickness: 3.5, proxTrimTilt: 8, hinged: true, romFlexion: 80, romExtension: 150,
        openingCenter: 0, openingWidthProx: 120, openingWidthDist: 110, strapsPerCuff: 2, strapWidth: 25, reliefs: [],
      };
    case 'hock':
      return {
        ...BASE, braceType, linerOffset: 2.5, wallThickness: 3, hinged: false, jointGap: 10, hingeRadius: 9, hingeHole: 4, romFlexion: 90, romExtension: 165,
        openingCenter: 0, openingWidthProx: 160, openingWidthDist: 140, strapsPerCuff: 2, strapWidth: 25,
        footPlate: false, footPlateLength: 30, footPlateWidth: 150, reliefs: [],
      };
    case 'carpal':
      return {
        ...BASE, braceType, linerOffset: 2.5, wallThickness: 3, hinged: true, jointGap: 8, hingeRadius: 8, hingeHole: 4, romFlexion: 110, romExtension: 190,
        openingCenter: 0, openingWidthProx: 150, openingWidthDist: 140, strapsPerCuff: 2, strapWidth: 22,
        footPlate: false, footPlateLength: 25, footPlateWidth: 150, perfDiameter: 6, perfSpacing: 11, reliefs: [],
      };
  }
}

export type ParamKey = Exclude<keyof BraceParams, 'braceType' | 'reliefs' | 'proxTrimShape' | 'distTrimShape'>;

export interface ParamSpec {
  key: ParamKey;
  label: string;
  group: string;
  kind: 'number' | 'bool';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  help?: string;
  showIf?: (p: BraceParams) => boolean;
}

export const PARAM_SPECS: ParamSpec[] = [
  { key: 'linerOffset', group: 'Fit', label: 'Liner / padding gap', kind: 'number', min: 0, max: 10, step: 0.5, unit: 'mm', help: 'Uniform space between skin and shell for foam liner.' },
  { key: 'smoothing', group: 'Fit', label: 'Scan smoothing', kind: 'number', min: 0, max: 8, step: 0.5, unit: 'mm', help: 'Removes fur and scan noise before fitting.' },
  { key: 'edgeFlare', group: 'Fit', label: 'Edge flare', kind: 'number', min: 0, max: 6, step: 0.5, unit: 'mm', help: 'Trim edges lift away from the skin to avoid pressure.' },
  { key: 'flareWidth', group: 'Fit', label: 'Flare width', kind: 'number', min: 2, max: 20, step: 1, unit: 'mm' },

  { key: 'wallThickness', group: 'Shell', label: 'Wall thickness', kind: 'number', min: 1.5, max: 8, step: 0.25, unit: 'mm' },
  { key: 'edgeRounding', group: 'Shell', label: 'Edge rounding', kind: 'number', min: 0, max: 4, step: 0.25, unit: 'mm', help: 'Rolls the outer edge of trim lines, slots and holes for comfort.' },
  { key: 'resolution', group: 'Shell', label: 'Mesh resolution', kind: 'number', min: 0.5, max: 3, step: 0.25, unit: 'mm', help: 'Smaller = smoother but slower.' },

  { key: 'proxTrimOffset', group: 'Trim lines', label: 'Proximal trim offset', kind: 'number', min: -60, max: 60, step: 1, unit: 'mm', help: '+ moves the top edge further proximal.' },
  { key: 'proxTrimTilt', group: 'Trim lines', label: 'Proximal trim tilt', kind: 'number', min: -40, max: 40, step: 1, unit: 'mm', help: '+ raises the lateral side, lowers the medial side.' },
  { key: 'distTrimOffset', group: 'Trim lines', label: 'Distal trim offset', kind: 'number', min: -60, max: 60, step: 1, unit: 'mm', help: '+ moves the bottom edge further distal.' },
  { key: 'distTrimTilt', group: 'Trim lines', label: 'Distal trim tilt', kind: 'number', min: -40, max: 40, step: 1, unit: 'mm' },

  { key: 'hinged', group: 'Joint', label: 'Hinged (articulating)', kind: 'bool', help: 'Off = rigid one-piece brace that immobilises the joint.' },
  { key: 'jointGap', group: 'Joint', label: 'Cuff gap at joint', kind: 'number', min: 0, max: 40, step: 1, unit: 'mm', showIf: (p) => p.hinged, help: 'Distance from the hinge axis to the end of each cuff.' },
  { key: 'hingeRadius', group: 'Joint', label: 'Hinge tab radius', kind: 'number', min: 5, max: 25, step: 0.5, unit: 'mm', showIf: (p) => p.hinged },
  { key: 'hingeHole', group: 'Joint', label: 'Rivet / screw hole Ø', kind: 'number', min: 0, max: 10, step: 0.5, unit: 'mm', showIf: (p) => p.hinged },
  { key: 'hingeBossThickness', group: 'Joint', label: 'Hinge tab thickness', kind: 'number', min: 2, max: 10, step: 0.25, unit: 'mm', showIf: (p) => p.hinged },
  { key: 'hingeClearance', group: 'Joint', label: 'Hinge clearance', kind: 'number', min: 0, max: 2, step: 0.1, unit: 'mm', showIf: (p) => p.hinged },
  { key: 'romStops', group: 'Joint', label: 'Range-of-motion stops', kind: 'bool', showIf: (p) => p.hinged, help: 'A stop pin on the proximal pad runs in an arc slot in the distal pad.' },
  { key: 'romFlexion', group: 'Joint', label: 'Flexion limit (joint angle)', kind: 'number', min: 30, max: 200, step: 1, unit: '°', showIf: (p) => p.hinged && p.romStops, help: 'Smallest joint angle allowed. 180° = straight limb.' },
  { key: 'romExtension', group: 'Joint', label: 'Extension limit (joint angle)', kind: 'number', min: 60, max: 220, step: 1, unit: '°', showIf: (p) => p.hinged && p.romStops, help: 'Largest joint angle allowed. Above 180° = hyperextension.' },
  { key: 'stopPinDiameter', group: 'Joint', label: 'Stop pin Ø', kind: 'number', min: 2, max: 6, step: 0.5, unit: 'mm', showIf: (p) => p.hinged && p.romStops },
  { key: 'rigidOverlap', group: 'Joint', label: 'Cuff overlap (rigid)', kind: 'number', min: 0, max: 6, step: 0.5, unit: 'mm', showIf: (p) => !p.hinged },

  { key: 'openingCenter', group: 'Opening', label: 'Opening position', kind: 'number', min: 0, max: 359, step: 5, unit: '°', help: '0 = cranial, 90 = lateral, 180 = caudal, 270 = medial.' },
  { key: 'openingWidthProx', group: 'Opening', label: 'Opening width (proximal cuff)', kind: 'number', min: 0, max: 200, step: 5, unit: '°' },
  { key: 'openingWidthDist', group: 'Opening', label: 'Opening width (distal cuff)', kind: 'number', min: 0, max: 200, step: 5, unit: '°' },

  { key: 'strapsPerCuff', group: 'Straps', label: 'Straps per cuff', kind: 'number', min: 0, max: 5, step: 1 },
  { key: 'strapWidth', group: 'Straps', label: 'Strap width', kind: 'number', min: 10, max: 50, step: 1, unit: 'mm' },
  { key: 'strapSlotWidth', group: 'Straps', label: 'Slot width', kind: 'number', min: 2, max: 10, step: 0.5, unit: 'mm' },
  { key: 'strapMargin', group: 'Straps', label: 'Slot distance from edge', kind: 'number', min: 3, max: 25, step: 0.5, unit: 'mm' },

  { key: 'footPlate', group: 'Paw extension', label: 'Plantar / palmar extension', kind: 'bool', help: 'Extends the distal cuff down the caudal side of the paw toward the pads. Not yet a full sole under the paw.' },
  { key: 'footPlateLength', group: 'Paw extension', label: 'Length past distal trim', kind: 'number', min: 5, max: 80, step: 1, unit: 'mm', showIf: (p) => p.footPlate, help: 'Place the distal landmark above the pads; the plate extends this far toward the toes.' },
  { key: 'footPlateWidth', group: 'Paw extension', label: 'Width around the paw', kind: 'number', min: 60, max: 240, step: 5, unit: '°', showIf: (p) => p.footPlate },
  { key: 'perforate', group: 'Ventilation', label: 'Ventilation holes', kind: 'bool' },
  { key: 'perfDiameter', group: 'Ventilation', label: 'Hole diameter', kind: 'number', min: 3, max: 20, step: 0.5, unit: 'mm', showIf: (p) => p.perforate },
  { key: 'perfSpacing', group: 'Ventilation', label: 'Hole spacing', kind: 'number', min: 6, max: 40, step: 0.5, unit: 'mm', showIf: (p) => p.perforate },
  { key: 'perfMargin', group: 'Ventilation', label: 'Solid border', kind: 'number', min: 2, max: 20, step: 0.5, unit: 'mm', showIf: (p) => p.perforate },
];

export interface Material {
  name: string;
  density: number; // g/cm3
  note: string;
}

export const MATERIALS: Material[] = [
  { name: 'PETG', density: 1.27, note: 'Tough, good default for rigid shells.' },
  { name: 'Nylon PA12 (SLS/MJF)', density: 1.01, note: 'Light and durable; best for production.' },
  { name: 'PLA', density: 1.24, note: 'Prototype / test fit only — brittle.' },
  { name: 'TPU 95A', density: 1.21, note: 'Flexible sleeves and soft cuffs.' },
];
