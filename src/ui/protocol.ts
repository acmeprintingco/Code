/** Messages between the UI thread and the geometry worker. */
import type { BraceParams, Landmarks, Vec3 } from '../core/params';
import type { MeshCheck } from '../core/shell';

export interface SerializedFrames {
  joint: Vec3;
  hingeAxis: Vec3;
  cranial: Vec3;
  proximalAxis: Vec3;
  distalAxis: Vec3;
  proximalLength: number;
  distalLength: number;
  jointWidth: number;
  bendAngle: number;
}

export interface CuffPayload {
  id: 'proximal' | 'distal';
  position: Float32Array;
  index: Uint32Array;
  check: MeshCheck;
  missingFraction: number;
  /** Skin-to-shell gap (mm) per vertex. */
  gap: Float32Array;
  handles: { index: number; position: Vec3 }[];
}

export type ToWorker =
  | { type: 'scan'; position: Float32Array; index: Uint32Array | null }
  | { type: 'generate'; reqId: number; landmarks: Landmarks; params: BraceParams };

export type FromWorker =
  | { type: 'scanReady' }
  | { type: 'result'; reqId: number; cuffs: CuffPayload[]; frames: SerializedFrames; warnings: string[]; millis: number; jointAngle: number; romRange: [number, number] | null }
  | { type: 'error'; reqId: number; message: string };
