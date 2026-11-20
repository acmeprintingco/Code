import { describe, expect, it } from 'vitest';
import { generateBrace } from '../src/core/brace';
import { makeDemoLimb } from '../src/core/demoLimb';
import { defaultParams, trimShapeAt, type BraceType } from '../src/core/params';
import { ScanModel, prepareScanGeometry } from '../src/core/scan';

const load = (t: BraceType) => {
  const demo = makeDemoLimb(t);
  return { demo, scan: new ScanModel(prepareScanGeometry(demo.geometry, { units: 'mm', center: false }).geometry) };
};

describe('trim shape', () => {
  it('interpolates periodically through the control points', () => {
    const s = [0, 10, 0, 0, 0, 0, 0, 0];
    expect(trimShapeAt(s, Math.PI / 4)).toBeCloseTo(10);
    expect(trimShapeAt(s, 0)).toBeCloseTo(0);
    expect(trimShapeAt(s, Math.PI / 4 + Math.PI * 2)).toBeCloseTo(10);
  });

  it('raising a handle lengthens the cuff on that side', () => {
    const { demo, scan } = load('stifle');
    const base = { ...defaultParams('stifle'), perforate: false, resolution: 1.5 };
    const a = generateBrace(scan, demo.landmarks, base);
    const shape = [...base.proxTrimShape];
    shape[4] = 20; // caudal
    const b = generateBrace(scan, demo.landmarks, { ...base, proxTrimShape: shape });
    expect(b.cuffs[0].check.volume).toBeGreaterThan(a.cuffs[0].check.volume * 1.03);
    expect(b.cuffs[0].check.boundaryEdges).toBe(0);
    expect(a.cuffs[0].handles.length).toBeGreaterThan(3);
    // Opening is cranial, so the cranial handle (index 0) is hidden.
    expect(a.cuffs[0].handles.some((h) => h.index === 0)).toBe(false);
  });
});

describe('range-of-motion stops', () => {
  for (const type of ['stifle', 'hock'] as BraceType[]) {
    it(`${type}: reports the scanned joint angle and cuts pin hole + arc slot`, () => {
      const { demo, scan } = load(type);
      const base = { ...defaultParams(type), perforate: false, resolution: 1.25 };
      const a = generateBrace(scan, demo.landmarks, base);
      expect(a.jointAngle).toBeGreaterThan(100);
      expect(a.jointAngle).toBeLessThan(170);
      const b = generateBrace(scan, demo.landmarks, { ...base, romStops: true });
      expect(b.romRange).not.toBeNull();
      for (const c of b.cuffs) {
        expect(c.check.boundaryEdges).toBe(0);
        expect(c.check.nonManifoldEdges).toBe(0);
      }
      // Holes add wall area: the pads now have extra boundaries.
      expect(b.cuffs[1].check.area).not.toBeCloseTo(a.cuffs[1].check.area, 0);
    });
  }

  it('carpal (nearly straight) gets an angle near 180', () => {
    const { demo, scan } = load('carpal');
    const r = generateBrace(scan, demo.landmarks, { ...defaultParams('carpal'), hinged: true, romStops: true, resolution: 1.5 });
    expect(Math.abs(r.jointAngle - 180)).toBeLessThan(25);
    expect(r.romRange![0]).toBeLessThanOrEqual(r.jointAngle);
    expect(r.romRange![1]).toBeGreaterThanOrEqual(r.jointAngle);
  });
});

describe('gap map and edge rounding', () => {
  it('exports the skin gap per vertex, around the liner thickness', () => {
    const { demo, scan } = load('hock');
    const p = { ...defaultParams('hock'), resolution: 1.5 };
    const r = generateBrace(scan, demo.landmarks, p);
    const v = r.cuffs[0].geometry.getAttribute('value');
    expect(v.count).toBe(r.cuffs[0].geometry.getAttribute('position').count);
    const vals = Array.from(v.array as Float32Array).sort((a, b) => a - b);
    expect(vals[vals.length >> 1]).toBeCloseTo(p.linerOffset, 0);
  });

  it('rounding edges removes volume but keeps the mesh closed', () => {
    const { demo, scan } = load('carpal');
    const p = { ...defaultParams('carpal'), resolution: 1.5 };
    const sharp = generateBrace(scan, demo.landmarks, { ...p, edgeRounding: 0 });
    const round = generateBrace(scan, demo.landmarks, { ...p, edgeRounding: 3 });
    expect(round.cuffs[0].check.volume).toBeLessThan(sharp.cuffs[0].check.volume);
    expect(round.cuffs[0].check.boundaryEdges).toBe(0);
  });
});
