/**
 * Brace generation.
 *
 * Pipeline per cuff:
 *   1. Radially sample the scan around the cuff axis  -> skin radius grid r(h, θ)
 *   2. Reject outliers, fill holes, Gaussian smooth   -> clean limb surface
 *   3. Inner surface = skin + liner + reliefs (+ edge flare, flat hinge pads)
 *   4. Material field f(h, θ): trim band, hinge tabs, opening, strap slots,
 *      rivet holes, ventilation holes (f <= 0 is material)
 *   5. Outer surface = inner + thickness along the surface normal
 *   6. Marching-squares solid -> watertight printable mesh
 */
import { BufferGeometry, Vector3 } from 'three';
import type { BraceParams } from './params';
import type { Landmarks } from './params';
import { computeFrames, type CuffFrame, type CuffId, type LimbFrames } from './frames';
import type { ScanModel } from './scan';
import { buildShell, checkMesh, type MeshCheck } from './shell';

export interface CuffResult {
  id: CuffId;
  geometry: BufferGeometry;
  check: MeshCheck;
  rows: number;
  cols: number;
  /** Rows of scan the rays could not see (filled by interpolation), 0..1. */
  missingFraction: number;
}

export interface BraceResult {
  frames: LimbFrames;
  cuffs: CuffResult[];
  warnings: string[];
  millis: number;
}

const TAU = Math.PI * 2;

const angDiff = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

const smin = (a: number, b: number, k: number) => {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
};
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Internal per-cuff working state. */
interface Cuff {
  frame: CuffFrame;
  other: CuffFrame;
  N: number;
  M: number;
  hMin: number;
  dh: number;
  dTheta: number;
  rs: Float64Array; // skin radius
  rin: Float64Array; // inner radius
  thick: Float64Array;
  f: Float64Array;
  fTrim: Float64Array; // field before holes, used for flare
  rho: Float64Array; // distance of skin point to hinge axis
  side: Int8Array; // +1 lateral half, -1 medial half
  missing: number;
  trimEndMax: number;
}

export function generateBrace(scan: ScanModel, landmarks: Landmarks, params: BraceParams): BraceResult {
  const t0 = performance.now();
  const warnings: string[] = [];
  const frames = computeFrames(scan, landmarks);
  if (frames.bendAngle > 100) warnings.push(`Joint is flexed ${frames.bendAngle.toFixed(0)}° — check landmarks.`);

  const cuffs = [
    setupCuff(scan, frames, frames.proximal, frames.distal, params),
    setupCuff(scan, frames, frames.distal, frames.proximal, params),
  ];
  for (const c of cuffs) {
    if (c.missing > 0.15) warnings.push(`${c.frame.id} cuff: ${(c.missing * 100).toFixed(0)}% of the surface was not visible in the scan and was interpolated.`);
    prepareInner(c, frames, params);
  }
  if (params.hinged) flattenHinges(cuffs, frames, params);
  for (const c of cuffs) buildFields(c, frames, params);
  applyFlare(cuffs, params);

  const results: CuffResult[] = cuffs.map((c) => {
    const { inner, outer } = surfaces(c);
    const geometry = buildShell({ cols: c.N, rows: c.M, f: c.f, inner, outer });
    const check = checkMesh(geometry);
    if (check.boundaryEdges || check.nonManifoldEdges) warnings.push(`${c.frame.id} cuff mesh is not closed (${check.boundaryEdges} open edges).`);
    return { id: c.frame.id, geometry, check, rows: c.M, cols: c.N, missingFraction: c.missing };
  });

  return { frames, cuffs: results, warnings, millis: performance.now() - t0 };
}

function trimEnd(frame: CuffFrame, p: BraceParams, thetaUser: number): number {
  const isProx = frame.id === 'proximal';
  const off = isProx ? p.proxTrimOffset : p.distTrimOffset;
  const tilt = isProx ? p.proxTrimTilt : p.distTrimTilt;
  return frame.length + off + tilt * Math.cos(thetaUser - Math.PI / 2);
}

function setupCuff(scan: ScanModel, frames: LimbFrames, frame: CuffFrame, other: CuffFrame, p: BraceParams): Cuff {
  const res = p.resolution;
  const isProx = frame.id === 'proximal';
  const tilt = Math.abs(isProx ? p.proxTrimTilt : p.distTrimTilt);
  const trimEndMax = frame.length + (isProx ? p.proxTrimOffset : p.distTrimOffset) + tilt;
  const rEst = Math.max(frame.meanRadius, frames.jointWidth / 2) * 1.6 + p.linerOffset;
  let hMin: number;
  if (p.hinged) {
    hMin = -(p.hingeRadius + p.hingeBossThickness + 3 * res + 2);
  } else {
    const half = Math.min((frames.bendAngle * Math.PI) / 360, Math.PI / 3);
    hMin = -(rEst * Math.tan(half) + p.rigidOverlap + 3 * res + 2);
  }
  const hMax = trimEndMax + 3 * res + 1;
  const M = Math.max(8, Math.ceil((hMax - hMin) / res) + 1);
  const dh = (hMax - hMin) / (M - 1);
  let N = Math.round((TAU * rEst) / res);
  N = Math.max(96, Math.min(720, N + (N % 2)));
  const dTheta = TAU / N;

  const rs = new Float64Array(M * N).fill(NaN);
  const reach = rEst * 2.5 + 20;
  const o = new Vector3();
  const d = new Vector3();
  for (let k = 0; k < M; k++) {
    const h = hMin + k * dh;
    o.copy(frame.joint).addScaledVector(frame.axis, h);
    for (let i = 0; i < N; i++) {
      const th = i * dTheta;
      d.copy(frame.e1).multiplyScalar(Math.cos(th)).addScaledVector(frame.e2, Math.sin(th));
      const hit = scan.rayFirst(o, d, 0, reach);
      if (hit !== null) rs[k * N + i] = hit;
    }
  }

  // Outlier rejection per row (rays that leaked through scan holes).
  const row = new Float64Array(N);
  for (let k = 0; k < M; k++) {
    let n = 0;
    for (let i = 0; i < N; i++) {
      const r = rs[k * N + i];
      if (!Number.isNaN(r)) row[n++] = r;
    }
    if (n < N * 0.2) {
      for (let i = 0; i < N; i++) rs[k * N + i] = NaN;
      continue;
    }
    const sorted = Array.from(row.subarray(0, n)).sort((a, b) => a - b);
    const med = sorted[n >> 1];
    for (let i = 0; i < N; i++) {
      const r = rs[k * N + i];
      if (r > med * 1.8 || r < med * 0.25) rs[k * N + i] = NaN;
    }
  }
  let missing = 0;
  for (let j = 0; j < rs.length; j++) if (Number.isNaN(rs[j])) missing++;
  fillHoles(rs, M, N);
  if (p.smoothing > 0) smoothGrid(rs, M, N, p.smoothing / dh, (k) => p.smoothing / (rowMean(rs, k, N) * dTheta));

  return {
    frame, other, N, M, hMin, dh, dTheta, rs,
    rin: new Float64Array(M * N), thick: new Float64Array(M * N).fill(p.wallThickness),
    f: new Float64Array(M * N), fTrim: new Float64Array(M * N), rho: new Float64Array(M * N), side: new Int8Array(M * N),
    missing: missing / rs.length, trimEndMax,
  };
}

function rowMean(a: Float64Array, k: number, N: number) {
  let s = 0;
  for (let i = 0; i < N; i++) s += a[k * N + i];
  return Math.max(1, s / N);
}

/** Fill NaNs: whole empty rows copy the nearest valid row, then iterative neighbour averaging. */
function fillHoles(a: Float64Array, M: number, N: number) {
  const valid: number[] = [];
  for (let k = 0; k < M; k++) {
    let any = false;
    for (let i = 0; i < N; i++) if (!Number.isNaN(a[k * N + i])) { any = true; break; }
    if (any) valid.push(k);
  }
  if (!valid.length) throw new Error('The scan was not found around the limb axis. Check the landmarks.');
  for (let k = 0; k < M; k++) {
    if (valid.includes(k)) continue;
    let best = valid[0];
    for (const v of valid) if (Math.abs(v - k) < Math.abs(best - k)) best = v;
    for (let i = 0; i < N; i++) a[k * N + i] = a[best * N + i];
  }
  for (let pass = 0; pass < 4 * Math.max(M, N); pass++) {
    let changed = 0;
    const next = a.slice();
    for (let k = 0; k < M; k++) {
      for (let i = 0; i < N; i++) {
        if (!Number.isNaN(a[k * N + i])) continue;
        let s = 0, n = 0;
        const nb = [[k, (i + 1) % N], [k, (i + N - 1) % N], [k - 1, i], [k + 1, i]];
        for (const [kk, ii] of nb) {
          if (kk < 0 || kk >= M) continue;
          const val = a[kk * N + ii];
          if (!Number.isNaN(val)) { s += val; n++; }
        }
        if (n) { next[k * N + i] = s / n; changed++; }
      }
    }
    a.set(next);
    if (!changed) break;
  }
}

function gaussKernel(sigma: number): Float64Array {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float64Array(2 * r + 1);
  let s = 0;
  for (let j = -r; j <= r; j++) { k[j + r] = Math.exp(-(j * j) / (2 * sigma * sigma)); s += k[j + r]; }
  for (let j = 0; j < k.length; j++) k[j] /= s;
  return k;
}

function smoothGrid(a: Float64Array, M: number, N: number, sigmaRows: number, sigmaColsForRow: (k: number) => number) {
  const tmp = new Float64Array(a.length);
  for (let k = 0; k < M; k++) {
    const sc = sigmaColsForRow(k);
    if (sc < 0.3) { for (let i = 0; i < N; i++) tmp[k * N + i] = a[k * N + i]; continue; }
    const ker = gaussKernel(Math.min(sc, N / 6));
    const r = (ker.length - 1) / 2;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let j = -r; j <= r; j++) s += ker[j + r] * a[k * N + ((i + j + N * 4) % N)];
      tmp[k * N + i] = s;
    }
  }
  if (sigmaRows < 0.3) { a.set(tmp); return; }
  const ker = gaussKernel(sigmaRows);
  const r = (ker.length - 1) / 2;
  for (let k = 0; k < M; k++) {
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let j = -r; j <= r; j++) {
        const kk = Math.min(M - 1, Math.max(0, k + j));
        s += ker[j + r] * tmp[kk * N + i];
      }
      a[k * N + i] = s;
    }
  }
}

function dirAt(fr: CuffFrame, th: number, out: Vector3) {
  return out.copy(fr.e1).multiplyScalar(Math.cos(th)).addScaledVector(fr.e2, Math.sin(th));
}

/** Inner radius (liner + reliefs) and hinge-axis distance / side of every skin point. */
function prepareInner(c: Cuff, frames: LimbFrames, p: BraceParams) {
  const { frame: fr, N, M } = c;
  const J = frames.joint;
  const ha = frames.hingeAxis;
  const o = new Vector3(), d = new Vector3(), s = new Vector3(), rel = new Vector3();
  for (let k = 0; k < M; k++) {
    o.copy(J).addScaledVector(fr.axis, c.hMin + k * c.dh);
    for (let i = 0; i < N; i++) {
      const j = k * N + i;
      dirAt(fr, i * c.dTheta, d);
      s.copy(o).addScaledVector(d, c.rs[j]);
      let rin = c.rs[j] + p.linerOffset;
      for (const rf of p.reliefs) {
        const dist = Math.hypot(s.x - rf.point[0], s.y - rf.point[1], s.z - rf.point[2]);
        if (dist < rf.radius) {
          const q = 1 - (dist / rf.radius) ** 2;
          rin += rf.amount * q * q;
        }
      }
      c.rin[j] = rin;
      rel.copy(s).sub(J);
      const along = rel.dot(ha);
      c.rho[j] = Math.sqrt(Math.max(0, rel.lengthSq() - along * along));
      c.side[j] = along >= 0 ? 1 : -1;
    }
  }
}

/** Material field: trim band, hinge tabs, opening, strap slots, rivet hole, vent holes. */
function buildFields(c: Cuff, frames: LimbFrames, p: BraceParams) {
  const { frame: fr, other, N, M } = c;
  const J = frames.joint;
  const ha = frames.hingeAxis;
  const sgn = fr.lateralSign;
  const isProx = fr.id === 'proximal';
  const openC = (sgn * p.openingCenter * Math.PI) / 180;
  const openHalf = ((isProx ? p.openingWidthProx : p.openingWidthDist) * Math.PI) / 360;
  const thLat = Math.atan2(ha.dot(fr.e2), ha.dot(fr.e1));
  const thMed = thLat + Math.PI;
  const R = p.hingeRadius;
  const bis = fr.axis.clone().sub(other.axis).normalize();

  // Strap rows, spaced so that slots never merge.
  const strapH: number[] = [];
  if (p.strapsPerCuff > 0 && openHalf > 0) {
    const lo = (p.hinged ? p.jointGap : 0) + p.strapWidth / 2 + 5;
    const hiTrim = fr.length + (isProx ? p.proxTrimOffset : p.distTrimOffset) - Math.abs(isProx ? p.proxTrimTilt : p.distTrimTilt);
    const hi = hiTrim - p.strapWidth / 2 - 5;
    const fit = hi > lo ? Math.floor((hi - lo) / (p.strapWidth + 8)) + 1 : 1;
    const n = Math.max(1, Math.min(p.strapsPerCuff, fit));
    if (n === 1) strapH.push(hi > lo ? (lo + hi) / 2 : (lo + hiTrim) / 2 - p.strapWidth / 4);
    else for (let j = 0; j < n; j++) strapH.push(lo + ((hi - lo) * j) / (n - 1));
  }
  const slotC = p.strapMargin + p.strapSlotWidth / 2;
  const slotHalfLen = Math.max(0, (p.strapWidth + 1 - p.strapSlotWidth) / 2);

  const o = new Vector3(), d = new Vector3(), s = new Vector3();
  for (let k = 0; k < M; k++) {
    const h = c.hMin + k * c.dh;
    o.copy(J).addScaledVector(fr.axis, h);
    for (let i = 0; i < N; i++) {
      const j = k * N + i;
      const th = i * c.dTheta;
      const r = c.rs[j] + p.linerOffset;
      dirAt(fr, th, d);
      s.copy(o).addScaledVector(d, c.rs[j]).sub(J);

      const upper = h - trimEnd(fr, p, sgn * th);
      const lower = p.hinged ? p.jointGap - h : -(s.dot(bis) + p.rigidOverlap);
      let fv = Math.max(upper, lower);

      if (p.hinged) {
        const disc = c.rho[j] - R;
        const neck = (thS: number) => Math.max(Math.abs(angDiff(th, thS)) * r - R * 0.85, -h, h - (p.jointGap + R));
        fv = smin(fv, Math.min(disc, neck(thLat), neck(thMed)), R * 0.5);
      }

      const edgeDist = (Math.abs(angDiff(th, openC)) - openHalf) * r; // < 0 inside the opening
      if (openHalf > 0) fv = smax(fv, -edgeDist, 4);
      c.fTrim[j] = fv;

      for (const hs of strapH) {
        const dy = Math.max(Math.abs(h - hs) - slotHalfLen, 0);
        const slot = Math.hypot(edgeDist - slotC, dy) - p.strapSlotWidth / 2;
        fv = Math.max(fv, -slot);
      }
      if (p.hinged && p.hingeHole > 0) fv = Math.max(fv, p.hingeHole / 2 - c.rho[j]);
      c.f[j] = fv;
    }
  }

  if (p.perforate) perforate(c, p);
}

/** Staggered ventilation holes placed only where the shell is solid enough. */
function perforate(c: Cuff, p: BraceParams) {
  const { N, M, rs } = c;
  let rbar = 0;
  for (let j = 0; j < rs.length; j++) rbar += rs[j];
  rbar = rbar / rs.length + p.linerOffset;
  const cols = Math.max(6, Math.floor((TAU * rbar) / p.perfSpacing));
  const dAng = TAU / cols;
  const rowH = (p.perfSpacing * Math.sqrt(3)) / 2;
  const holeR = p.perfDiameter / 2;
  const need = holeR + p.perfMargin;
  const hMax = c.hMin + (M - 1) * c.dh;
  const valid = new Set<number>();
  const qMin = Math.floor(c.hMin / rowH) - 1;
  const qMax = Math.ceil(hMax / rowH) + 1;
  const key = (q: number, col: number) => (q - qMin) * cols + col;
  // Sample the (pre-hole) field at each candidate centre; require a solid neighbourhood.
  const sampleF = (h: number, th: number) => {
    const kf = (h - c.hMin) / c.dh;
    const k0 = Math.floor(kf);
    if (k0 < 0 || k0 >= M - 1) return Infinity;
    const ifl = (((th % TAU) + TAU) % TAU) / c.dTheta;
    const i0 = Math.floor(ifl) % N;
    const i1 = (i0 + 1) % N;
    const tk = kf - k0, ti = ifl - Math.floor(ifl);
    const F = c.f;
    return (1 - tk) * ((1 - ti) * F[k0 * N + i0] + ti * F[k0 * N + i1]) + tk * ((1 - ti) * F[(k0 + 1) * N + i0] + ti * F[(k0 + 1) * N + i1]);
  };
  const sampleRho = (h: number, th: number) => {
    const k0 = Math.round((h - c.hMin) / c.dh);
    const i0 = Math.round((((th % TAU) + TAU) % TAU) / c.dTheta) % N;
    if (k0 < 0 || k0 >= M) return Infinity;
    return c.rho[k0 * N + i0];
  };
  for (let q = qMin; q <= qMax; q++) {
    const h = q * rowH;
    for (let col = 0; col < cols; col++) {
      const th = (col + (q & 1 ? 0.5 : 0)) * dAng;
      // Check the centre and a ring of points around it.
      let ok = sampleF(h, th) < -need && sampleRho(h, th) > p.hingeRadius + need;
      for (let a = 0; ok && a < 8; a++) {
        const ang = (a / 8) * TAU;
        const dh = Math.sin(ang) * holeR;
        const dth = (Math.cos(ang) * holeR) / rbar;
        if (sampleF(h + dh, th + dth) > -p.perfMargin) ok = false;
      }
      if (ok) valid.add(key(q, col));
    }
  }
  if (!valid.size) return;
  for (let k = 0; k < M; k++) {
    const h = c.hMin + k * c.dh;
    const q0 = Math.round(h / rowH);
    for (let i = 0; i < N; i++) {
      const j = k * N + i;
      const th = i * c.dTheta;
      const r = rs[j] + p.linerOffset;
      let best = Infinity;
      for (let q = q0 - 1; q <= q0 + 1; q++) {
        const shift = q & 1 ? 0.5 : 0;
        const colF = th / dAng - shift;
        for (let cc = Math.floor(colF); cc <= Math.floor(colF) + 1; cc++) {
          const col = ((cc % cols) + cols) % cols;
          if (!valid.has(key(q, col))) continue;
          const dTh = angDiff(th, (col + shift) * dAng);
          const dist = Math.hypot(dTh * r, h - q * rowH);
          if (dist < best) best = dist;
        }
      }
      if (best < Infinity) c.f[j] = Math.max(c.f[j], holeR - best);
    }
  }
}

/**
 * Replace the inner surface around the hinge axis by flat pads perpendicular to
 * the hinge axis. The distal cuff's pad sits outside the proximal cuff's pad
 * (boss thickness + clearance) so the two tabs overlap and pivot on a rivet.
 * Afterwards `rho` holds the hinge-axis distance of the final inner surface, so
 * the tab outline and rivet hole are true circles on the flat pad.
 */
function flattenHinges(cuffs: Cuff[], frames: LimbFrames, p: BraceParams) {
  const J = frames.joint;
  const ha = frames.hingeAxis;
  const R = p.hingeRadius;
  const flatR = R + 2;
  const blend = Math.max(5, R * 0.6);
  const o = new Vector3(), d = new Vector3(), q = new Vector3();
  const dMax: Record<number, number> = { 1: -Infinity, [-1]: -Infinity };
  for (const c of cuffs) {
    for (let k = 0; k < c.M; k++) {
      o.copy(J).addScaledVector(c.frame.axis, c.hMin + k * c.dh);
      for (let i = 0; i < c.N; i++) {
        const j = k * c.N + i;
        if (c.rho[j] > flatR + 1) continue;
        dirAt(c.frame, i * c.dTheta, d);
        const sd = c.side[j];
        const x = q.copy(o).addScaledVector(d, c.rin[j]).sub(J).dot(ha) * sd;
        if (x > dMax[sd]) dMax[sd] = x;
      }
    }
  }
  for (const c of cuffs) {
    const extra = c.frame.id === 'distal' ? p.hingeBossThickness + p.hingeClearance : 0;
    for (let k = 0; k < c.M; k++) {
      o.copy(J).addScaledVector(c.frame.axis, c.hMin + k * c.dh);
      const oJ = q.copy(o).sub(J).clone();
      for (let i = 0; i < c.N; i++) {
        const j = k * c.N + i;
        const sd = c.side[j];
        dirAt(c.frame, i * c.dTheta, d);
        const dn = d.dot(ha) * sd;
        if (dn > 0.2 && Number.isFinite(dMax[sd])) {
          const plane = dMax[sd] + extra;
          const rPlane = (plane - oJ.dot(ha) * sd) / dn;
          // In-plane distance of the ray/plane intersection from the hinge axis.
          q.copy(oJ).addScaledVector(d, rPlane);
          const along = q.dot(ha);
          const rhoP = Math.sqrt(Math.max(0, q.lengthSq() - along * along));
          const w = 1 - smoothstep(flatR, flatR + blend, rhoP);
          if (w > 0) {
            c.rin[j] += (Math.max(c.rin[j], rPlane) - c.rin[j]) * w;
            c.thick[j] = p.wallThickness + (p.hingeBossThickness - p.wallThickness) * w;
          }
        }
        q.copy(oJ).addScaledVector(d, c.rin[j]);
        const along = q.dot(ha);
        c.rho[j] = Math.sqrt(Math.max(0, q.lengthSq() - along * along));
      }
    }
  }
}

function applyFlare(cuffs: Cuff[], p: BraceParams) {
  if (p.edgeFlare <= 0) return;
  for (const c of cuffs) {
    for (let j = 0; j < c.f.length; j++) {
      const ft = c.fTrim[j];
      if (ft <= -p.flareWidth) continue;
      const near = p.hinged ? smoothstep(p.hingeRadius + 2, p.hingeRadius * 1.6 + 9, c.rho[j]) : 1;
      const t = Math.min(1, 1 + ft / p.flareWidth);
      c.rin[j] += p.edgeFlare * t * t * near;
    }
  }
}

function surfaces(c: Cuff): { inner: Float64Array; outer: Float64Array } {
  const { N, M, frame: fr } = c;
  const inner = new Float64Array(M * N * 3);
  const outer = new Float64Array(M * N * 3);
  const o = new Vector3(), d = new Vector3();
  for (let k = 0; k < M; k++) {
    o.copy(fr.joint).addScaledVector(fr.axis, c.hMin + k * c.dh);
    for (let i = 0; i < N; i++) {
      dirAt(fr, i * c.dTheta, d);
      const j = k * N + i;
      inner[3 * j] = o.x + d.x * c.rin[j];
      inner[3 * j + 1] = o.y + d.y * c.rin[j];
      inner[3 * j + 2] = o.z + d.z * c.rin[j];
    }
  }
  const ta = new Vector3(), tb = new Vector3(), n = new Vector3();
  const P = (k: number, i: number, out: Vector3) => out.set(inner[3 * (k * N + i)], inner[3 * (k * N + i) + 1], inner[3 * (k * N + i) + 2]);
  const A = new Vector3(), B = new Vector3();
  for (let k = 0; k < M; k++) {
    const k0 = Math.max(0, k - 1), k1 = Math.min(M - 1, k + 1);
    for (let i = 0; i < N; i++) {
      P(k, (i + 1) % N, A); P(k, (i + N - 1) % N, B); ta.subVectors(A, B);
      P(k1, i, A); P(k0, i, B); tb.subVectors(A, B);
      n.crossVectors(ta, tb);
      const len = n.length();
      if (len < 1e-9) {
        dirAt(fr, i * c.dTheta, n);
      } else n.multiplyScalar(1 / len);
      const j = k * N + i;
      const t = c.thick[j];
      outer[3 * j] = inner[3 * j] + n.x * t;
      outer[3 * j + 1] = inner[3 * j + 1] + n.y * t;
      outer[3 * j + 2] = inner[3 * j + 2] + n.z * t;
    }
  }
  return { inner, outer };
}
