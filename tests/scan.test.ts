import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { generateBrace } from '../src/core/brace';
import { makeDemoLimb } from '../src/core/demoLimb';
import { defaultParams, type Landmarks, type Vec3 } from '../src/core/params';
import { ScanModel, guessUnits, prepareScanGeometry } from '../src/core/scan';

/** A demo limb rotated arbitrarily, exported in centimetres, with a floor fragment. */
function messyScan() {
  const demo = makeDemoLimb('stifle');
  const m = new Matrix4().makeRotationAxis(new Vector3(1, 2, 0.5).normalize(), 1.1).premultiply(new Matrix4().makeScale(0.1, 0.1, 0.1));
  const limb = demo.geometry.clone().toNonIndexed();
  limb.deleteAttribute('normal');
  limb.applyMatrix4(m);
  const floor = new BufferGeometry();
  floor.setAttribute('position', new BufferAttribute(new Float32Array([-30, -30, -30, 30, -30, -30, 30, -30, 30, -30, -30, -30, 30, -30, 30, -30, -30, 30]), 3));
  const scan = mergeGeometries([limb, floor])!;
  const landmarks: Landmarks = {};
  for (const [k, p] of Object.entries(demo.landmarks)) {
    const v = new Vector3(...(p as Vec3)).applyMatrix4(m).multiplyScalar(10);
    (landmarks as any)[k] = [v.x, v.y, v.z];
  }
  return { scan, landmarks };
}

describe('scan preparation', () => {
  it('detects centimetre units, removes fragments and still builds a closed brace', () => {
    const { scan, landmarks } = messyScan();
    expect(guessUnits(scan)).toBe('cm');
    const prep = prepareScanGeometry(scan, { units: 'cm', fragmentFraction: 0.05, center: false });
    expect(prep.removedTriangles).toBe(2);
    const res = generateBrace(new ScanModel(prep.geometry), landmarks, { ...defaultParams('stifle'), resolution: 1.5 });
    for (const c of res.cuffs) {
      expect(c.check.boundaryEdges).toBe(0);
      expect(c.check.volume).toBeGreaterThan(10000);
    }
  });

  it('reports missing landmarks clearly', () => {
    const demo = makeDemoLimb('hock');
    const scan = new ScanModel(prepareScanGeometry(demo.geometry, { units: 'mm', center: false }).geometry);
    expect(() => generateBrace(scan, { proximal: demo.landmarks.proximal }, defaultParams('hock'))).toThrow(/Missing landmarks/);
  });
});

describe('scan cutting', () => {
  it('removes the side of the plane opposite the normal and keeps landmarks valid', async () => {
    const { cutScan } = await import('../src/core/scan');
    const demo = makeDemoLimb('hock');
    const g = prepareScanGeometry(demo.geometry, { units: 'mm', center: false }).geometry;
    const before = g.getIndex()!.count / 3;
    // Remove everything above y = 120 mm (e.g. the rest of the body).
    const { geometry, removed } = cutScan(g, new Vector3(0, 120, 0), new Vector3(0, -1, 0));
    expect(removed).toBeGreaterThan(100);
    expect(geometry.getIndex()!.count / 3).toBe(before - removed);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.y).toBeLessThan(122);
    const res = generateBrace(new ScanModel(geometry), demo.landmarks, { ...defaultParams('hock'), resolution: 1.5 });
    expect(res.cuffs[0].check.boundaryEdges).toBe(0);
  });
});
