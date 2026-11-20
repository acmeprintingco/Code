/**
 * Anatomical frames from landmarks.
 *
 * Each brace is modelled as two cuffs (proximal and distal segment) that meet at
 * the joint centre J. Each cuff gets a right-handed frame (e1, e2, axis) where
 * `axis` points from the joint toward the segment end, e1 points cranially and
 * the circumferential angle θ is measured from cranial.
 */
import { Vector3 } from 'three';
import type { LandmarkId, Landmarks } from './params';
import type { ScanModel } from './scan';

export type CuffId = 'proximal' | 'distal';

export interface CuffFrame {
  id: CuffId;
  joint: Vector3;
  axis: Vector3;
  e1: Vector3;
  e2: Vector3;
  /** +1 if internal angle +90° points laterally, else -1. */
  lateralSign: number;
  /** Distance from the joint centre to the refined segment centre at the trim landmark. */
  length: number;
  center: Vector3;
  meanRadius: number;
}

export interface LimbFrames {
  joint: Vector3;
  /** Unit vector from medial to lateral hinge point. */
  hingeAxis: Vector3;
  jointWidth: number;
  /** Deviation from a straight limb in degrees (0 = straight). */
  bendAngle: number;
  proximal: CuffFrame;
  distal: CuffFrame;
}

export const REQUIRED_LANDMARKS: LandmarkId[] = ['proximal', 'jointLateral', 'jointMedial', 'cranial', 'distal'];

export function missingLandmarks(l: Landmarks): LandmarkId[] {
  return REQUIRED_LANDMARKS.filter((k) => !l[k]);
}

const v = (a: [number, number, number]) => new Vector3(a[0], a[1], a[2]);

function perpendicularBasis(a: Vector3): [Vector3, Vector3] {
  const helper = Math.abs(a.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const u = new Vector3().crossVectors(a, helper).normalize();
  const w = new Vector3().crossVectors(a, u).normalize();
  return [u, w];
}

/**
 * Move a surface point to the centroid of the limb cross-section that contains it,
 * by repeatedly casting rays in the cross-section plane.
 */
export function refineSegmentCenter(scan: ScanModel, surfacePoint: Vector3, joint: Vector3, maxReach: number): { center: Vector3; meanRadius: number } {
  let c = surfacePoint.clone();
  let meanRadius = maxReach / 3;
  const rays = 48;
  const dir = new Vector3();
  for (let it = 0; it < 14; it++) {
    const a = c.clone().sub(joint).normalize();
    const [u, w] = perpendicularBasis(a);
    const sum = new Vector3();
    let n = 0;
    let rsum = 0;
    const hits: Vector3[] = [];
    for (let k = 0; k < rays; k++) {
      const t = (k / rays) * Math.PI * 2;
      dir.copy(u).multiplyScalar(Math.cos(t)).addScaledVector(w, Math.sin(t));
      const d = scan.rayFirst(c, dir, 0.25, maxReach);
      if (d !== null) {
        const p = c.clone().addScaledVector(dir, d);
        hits.push(p);
        sum.add(p);
        n++;
      }
    }
    if (n < 6) break;
    const next = sum.multiplyScalar(1 / n);
    for (const p of hits) rsum += p.distanceTo(next);
    meanRadius = rsum / n;
    const moved = next.distanceTo(c);
    c = next;
    if (moved < 0.05) break;
  }
  return { center: c, meanRadius };
}

export function computeFrames(scan: ScanModel, landmarks: Landmarks): LimbFrames {
  const missing = missingLandmarks(landmarks);
  if (missing.length) throw new Error(`Missing landmarks: ${missing.join(', ')}`);
  const lat = v(landmarks.jointLateral!);
  const med = v(landmarks.jointMedial!);
  const joint = lat.clone().add(med).multiplyScalar(0.5);
  const hingeAxis = lat.clone().sub(med);
  const jointWidth = hingeAxis.length();
  if (jointWidth < 1) throw new Error('Lateral and medial joint landmarks are too close together.');
  hingeAxis.normalize();
  const reach = Math.max(40, jointWidth * 2.5 + 10);
  const cranialPoint = v(landmarks.cranial!);

  const makeCuff = (id: CuffId, lm: [number, number, number]): CuffFrame => {
    const { center, meanRadius } = refineSegmentCenter(scan, v(lm), joint, reach);
    const axis = center.clone().sub(joint);
    const length = axis.length();
    if (length < 5) throw new Error(`The ${id} landmark is too close to the joint.`);
    axis.normalize();
    const k = cranialPoint.clone().sub(joint);
    const e1 = k.addScaledVector(axis, -k.dot(axis));
    if (e1.length() < 1e-3) e1.crossVectors(hingeAxis, axis);
    e1.normalize();
    const e2 = new Vector3().crossVectors(axis, e1).normalize();
    const lateralSign = e2.dot(hingeAxis) >= 0 ? 1 : -1;
    return { id, joint: joint.clone(), axis, e1, e2, lateralSign, length, center, meanRadius };
  };

  const proximal = makeCuff('proximal', landmarks.proximal!);
  const distal = makeCuff('distal', landmarks.distal!);
  const cosDev = Math.min(1, Math.max(-1, -proximal.axis.dot(distal.axis)));
  const bendAngle = (Math.acos(cosDev) * 180) / Math.PI;
  return { joint, hingeAxis, jointWidth, bendAngle, proximal, distal };
}
