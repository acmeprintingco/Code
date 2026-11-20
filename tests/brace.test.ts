import { describe, expect, it } from 'vitest';
import { generateBrace } from '../src/core/brace';
import { makeDemoLimb } from '../src/core/demoLimb';
import { defaultParams, type BraceType } from '../src/core/params';
import { ScanModel, prepareScanGeometry } from '../src/core/scan';
import { toBinarySTL } from '../src/core/exporters';

const types: BraceType[] = ['stifle', 'hock', 'carpal'];

describe('brace generation on demo limbs', () => {
  for (const type of types) {
    for (const hinged of [true, false]) {
      it(`${type} (${hinged ? 'hinged' : 'rigid'}) produces closed, outward-facing shells`, () => {
        const demo = makeDemoLimb(type);
        const scan = new ScanModel(prepareScanGeometry(demo.geometry, { units: 'mm', center: false }).geometry);
        const params = { ...defaultParams(type), hinged, resolution: 1.5 };
        const res = generateBrace(scan, demo.landmarks, params);
        expect(res.cuffs).toHaveLength(2);
        for (const c of res.cuffs) {
          expect(c.check.boundaryEdges).toBe(0);
          expect(c.check.nonManifoldEdges).toBe(0);
          expect(c.check.inconsistentEdges).toBe(0);
          expect(c.check.volume).toBeGreaterThan(1000);
        }
        const stl = toBinarySTL(res.cuffs.map((c) => c.geometry));
        expect(stl.byteLength).toBeGreaterThan(84);
        console.log(type, hinged ? 'hinged' : 'rigid', res.millis.toFixed(0) + 'ms', res.cuffs.map((c) => `${c.id}: ${(c.check.volume / 1000).toFixed(1)}cm3 ${c.check.triangles} tris`).join(' | '), res.warnings);
      });
    }
  }

  it('relief zones push the shell away from the skin', () => {
    const demo = makeDemoLimb('stifle');
    const scan = new ScanModel(prepareScanGeometry(demo.geometry, { units: 'mm', center: false }).geometry);
    const base = { ...defaultParams('stifle'), perforate: false, resolution: 1.5 };
    const a = generateBrace(scan, demo.landmarks, base);
    const b = generateBrace(scan, demo.landmarks, { ...base, reliefs: [{ id: 'r', label: 'r', point: demo.landmarks.proximal!, radius: 25, amount: 5 }] });
    const bb = (r: typeof a) => { r.cuffs[0].geometry.computeBoundingBox(); return r.cuffs[0].geometry.boundingBox!; };
    expect(bb(b).max.z).toBeGreaterThan(bb(a).max.z + 2);
  });
});
