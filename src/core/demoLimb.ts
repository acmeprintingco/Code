/**
 * Procedural canine limb "scans" for demos and automated tests.
 * Frame: +x cranial, +y proximal/up, +z lateral (right limb). Units: mm.
 */
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import type { BraceType, Landmarks, Vec3 } from './params';

interface Bump { t: number; phi: number; amp: number; width: number; angWidth: number }

interface LimbSpec {
  proxLen: number;
  distLen: number;
  proxDir: Vector3; // from joint toward proximal
  distDir: Vector3; // from joint toward distal
  a: (t: number) => number; // cranio-caudal semi-axis
  b: (t: number) => number; // medio-lateral semi-axis
  bumps: Bump[];
  paw: boolean;
  landmarkT: { proximal: number; distal: number };
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const blend = (t: number, distal: number, proximal: number) => distal + (proximal - distal) * smooth(-15, 15, t);
const dirDeg = (deg: number, down: boolean) => {
  const r = (deg * Math.PI) / 180;
  return new Vector3(Math.sin(r), down ? -Math.cos(r) : Math.cos(r), 0);
};
const pawShape = (t: number, tEnd: number, base: number, wide: number) => base + (wide - base) * smooth(tEnd + 40, tEnd + 20, t);

function spec(type: BraceType): LimbSpec {
  switch (type) {
    case 'stifle':
      return {
        proxLen: 175, distLen: 165,
        proxDir: dirDeg(-22, false), distDir: dirDeg(-28, true),
        a: (t) => blend(t, 22 - 9 * Math.min(1, -t / 165), 25 + 15 * Math.pow(Math.max(0, t) / 175, 0.8)),
        b: (t) => blend(t, 19 - 7 * Math.min(1, -t / 165), 21 + 12 * Math.pow(Math.max(0, t) / 175, 0.8)) + 4 * Math.exp(-((t / 15) ** 2)),
        bumps: [{ t: 6, phi: 0, amp: 4, width: 10, angWidth: 0.45 }, { t: -18, phi: 0, amp: 2.5, width: 8, angWidth: 0.35 }],
        paw: false,
        landmarkT: { proximal: 125, distal: -120 },
      };
    case 'hock':
      return {
        proxLen: 150, distLen: 115,
        proxDir: dirDeg(25, false), distDir: dirDeg(8, true),
        a: (t) => blend(t, pawShape(t, -115, 11.5, 19), 14 + 8 * Math.max(0, t) / 150),
        b: (t) => blend(t, pawShape(t, -115, 10.5, 18), 12 + 6 * Math.max(0, t) / 150) + 3 * Math.exp(-((t / 12) ** 2)),
        bumps: [{ t: 14, phi: Math.PI, amp: 7, width: 12, angWidth: 0.5 }],
        paw: true,
        landmarkT: { proximal: 100, distal: -70 },
      };
    case 'carpal':
      return {
        proxLen: 150, distLen: 100,
        proxDir: dirDeg(-4, false), distDir: dirDeg(12, true),
        a: (t) => blend(t, pawShape(t, -100, 10.5, 17), 12.5 + 9 * Math.max(0, t) / 150),
        b: (t) => blend(t, pawShape(t, -100, 12, 19.5), 13.5 + 8 * Math.max(0, t) / 150) + 2 * Math.exp(-((t / 10) ** 2)),
        bumps: [{ t: -4, phi: Math.PI, amp: 6, width: 9, angWidth: 0.45 }],
        paw: true,
        landmarkT: { proximal: 100, distal: -55 },
      };
  }
}

const RHO = 30;

function centerline(s: LimbSpec, t: number): { p: Vector3; tan: Vector3 } {
  if (t >= RHO) return { p: s.proxDir.clone().multiplyScalar(t), tan: s.proxDir.clone() };
  if (t <= -RHO) return { p: s.distDir.clone().multiplyScalar(-t), tan: s.distDir.clone().negate() };
  const u = (t + RHO) / (2 * RHO);
  const p0 = s.distDir.clone().multiplyScalar(RHO);
  const p2 = s.proxDir.clone().multiplyScalar(RHO);
  const p = p0.clone().multiplyScalar((1 - u) ** 2).addScaledVector(p2, u * u);
  const tan = p0.clone().multiplyScalar(-2 * (1 - u)).addScaledVector(p2, 2 * u).normalize();
  return { p, tan };
}

function ringPoint(s: LimbSpec, t: number, phi: number, tEnd: number): Vector3 {
  const { p, tan } = centerline(s, t);
  const Z = new Vector3(0, 0, 1);
  const C = new Vector3().crossVectors(tan, Z).normalize();
  let a = s.a(t), b = s.b(t);
  if (s.paw) {
    const cap = Math.sqrt(Math.max(0.0025, 1 - ((Math.max(0, tEnd + 14 - t)) / 14) ** 2));
    a *= cap;
    b *= cap;
  }
  const dir = C.clone().multiplyScalar(Math.cos(phi)).addScaledVector(Z, Math.sin(phi));
  let r = Math.hypot(a * Math.cos(phi), b * Math.sin(phi));
  for (const bp of s.bumps) {
    let dphi = Math.abs(phi - bp.phi) % (Math.PI * 2);
    if (dphi > Math.PI) dphi = Math.PI * 2 - dphi;
    r += bp.amp * Math.exp(-(((t - bp.t) / bp.width) ** 2)) * Math.exp(-((dphi / bp.angWidth) ** 2));
  }
  r += 0.25 * Math.sin(phi * 7 + t * 0.3) * Math.sin(t * 0.21); // scan texture / fur
  return p.addScaledVector(dir, r);
}

export interface DemoLimb {
  geometry: BufferGeometry;
  landmarks: Landmarks;
}

export function makeDemoLimb(type: BraceType): DemoLimb {
  const s = spec(type);
  const K = 72;
  const tEnd = -s.distLen;
  const ts: number[] = [];
  for (let t = tEnd; t < s.proxLen; t += 1.5) ts.push(t);
  ts.push(s.proxLen);
  const pos: number[] = [];
  for (const t of ts) {
    for (let j = 0; j < K; j++) {
      const q = ringPoint(s, t, (j / K) * Math.PI * 2, tEnd);
      pos.push(q.x, q.y, q.z);
    }
  }
  const idx: number[] = [];
  const R = ts.length;
  for (let r = 0; r < R - 1; r++) {
    for (let j = 0; j < K; j++) {
      const a = r * K + j, b = r * K + ((j + 1) % K), c = (r + 1) * K + j, d = (r + 1) * K + ((j + 1) % K);
      idx.push(a, c, b, b, c, d);
    }
  }
  const capCenter = (t: number) => {
    const { p } = centerline(s, t);
    pos.push(p.x, p.y, p.z);
    return pos.length / 3 - 1;
  };
  const c0 = capCenter(ts[0]);
  for (let j = 0; j < K; j++) idx.push(c0, j, (j + 1) % K);
  const c1 = capCenter(ts[R - 1]);
  const base = (R - 1) * K;
  for (let j = 0; j < K; j++) idx.push(c1, base + ((j + 1) % K), base + j);

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  const pt = (t: number, phi: number): Vec3 => {
    const q = ringPoint(s, t, phi, tEnd);
    return [q.x, q.y, q.z];
  };
  const landmarks: Landmarks = {
    proximal: pt(s.landmarkT.proximal, Math.PI / 2),
    distal: pt(s.landmarkT.distal, Math.PI / 2),
    jointLateral: pt(0, Math.PI / 2),
    jointMedial: pt(0, -Math.PI / 2),
    cranial: pt(0, 0),
  };
  return { geometry: g, landmarks };
}
