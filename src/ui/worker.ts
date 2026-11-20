/// <reference lib="webworker" />
import { BufferAttribute, BufferGeometry, type Vector3 } from 'three';
import { generateBrace } from '../core/brace';
import { ScanModel } from '../core/scan';
import type { CuffPayload, FromWorker, ToWorker } from './protocol';

let scan: ScanModel | null = null;
const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);
const v3 = (v: Vector3): [number, number, number] => [v.x, v.y, v.z];

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'scan') {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(msg.position, 3));
    if (msg.index) g.setIndex(new BufferAttribute(msg.index, 1));
    scan = new ScanModel(g);
    post({ type: 'scanReady' });
    return;
  }
  if (msg.type === 'generate') {
    try {
      if (!scan) throw new Error('No scan loaded.');
      const res = generateBrace(scan, msg.landmarks, msg.params);
      const transfer: Transferable[] = [];
      const cuffs: CuffPayload[] = res.cuffs.map((c) => {
        const position = new Float32Array(c.geometry.getAttribute('position').array);
        const index = Uint32Array.from(c.geometry.getIndex()!.array);
        const gap = new Float32Array(c.geometry.getAttribute('value').array);
        transfer.push(position.buffer, index.buffer, gap.buffer);
        return { id: c.id, position, index, gap, check: c.check, missingFraction: c.missingFraction, handles: c.handles };
      });
      const f = res.frames;
      post({
        type: 'result', reqId: msg.reqId, cuffs, warnings: res.warnings, millis: res.millis, jointAngle: res.jointAngle, romRange: res.romRange,
        frames: {
          joint: v3(f.joint), hingeAxis: v3(f.hingeAxis), cranial: v3(f.proximal.e1),
          proximalAxis: v3(f.proximal.axis), distalAxis: v3(f.distal.axis),
          proximalLength: f.proximal.length, distalLength: f.distal.length,
          jointWidth: f.jointWidth, bendAngle: f.bendAngle,
        },
      }, transfer);
    } catch (err) {
      post({ type: 'error', reqId: msg.reqId, message: err instanceof Error ? err.message : String(err) });
    }
  }
};
