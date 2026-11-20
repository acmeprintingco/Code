/** Binary STL export and printing estimates. */
import type { BufferGeometry } from 'three';

export function toBinarySTL(geometries: BufferGeometry[], header = 'PetBrace Studio'): ArrayBuffer {
  let triCount = 0;
  for (const g of geometries) triCount += g.getIndex() ? g.getIndex()!.count / 3 : g.getAttribute('position').count / 3;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  for (let i = 0; i < Math.min(80, header.length); i++) dv.setUint8(i, header.charCodeAt(i) & 0x7f);
  dv.setUint32(80, triCount, true);
  let off = 84;
  for (const g of geometries) {
    const p = g.getAttribute('position').array as ArrayLike<number>;
    const index = g.getIndex();
    const n = index ? index.count : p.length / 3;
    const at = (k: number) => (index ? index.array[k] : k);
    for (let t = 0; t < n; t += 3) {
      const a = at(t) * 3, b = at(t + 1) * 3, c = at(t + 2) * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      dv.setFloat32(off, nx, true); dv.setFloat32(off + 4, ny, true); dv.setFloat32(off + 8, nz, true);
      off += 12;
      for (const v of [a, b, c]) {
        dv.setFloat32(off, p[v], true); dv.setFloat32(off + 4, p[v + 1], true); dv.setFloat32(off + 8, p[v + 2], true);
        off += 12;
      }
      dv.setUint16(off, 0, true);
      off += 2;
    }
  }
  return buf;
}

/** Filament / powder mass estimate in grams from a closed-mesh volume (mm^3). */
export function massGrams(volumeMm3: number, density: number): number {
  return (Math.abs(volumeMm3) / 1000) * density;
}
