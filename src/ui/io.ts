/** File import/export: scans (STL/OBJ/PLY), project files and downloads. */
import { BufferAttribute, BufferGeometry, Mesh, type Object3D } from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BraceParams, Landmarks } from '../core/params';
import type { Units } from '../core/scan';

export const SCAN_ACCEPT = '.stl,.obj,.ply';

export async function readScanFile(file: File): Promise<BufferGeometry> {
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'stl') return new STLLoader().parse(await file.arrayBuffer());
  if (ext === 'ply') return new PLYLoader().parse(await file.arrayBuffer());
  if (ext === 'obj') {
    const group = new OBJLoader().parse(await file.text());
    const parts: BufferGeometry[] = [];
    group.traverse((o: Object3D) => {
      if ((o as Mesh).isMesh) {
        const g = (o as Mesh).geometry as BufferGeometry;
        const p = new BufferGeometry();
        p.setAttribute('position', g.getAttribute('position'));
        if (g.getIndex()) p.setIndex(g.getIndex());
        parts.push(p.index ? p.toNonIndexed() : p);
      }
    });
    if (!parts.length) throw new Error('No mesh found in OBJ file.');
    return mergeGeometries(parts)!;
  }
  throw new Error(`Unsupported file type ".${ext}". Use STL, OBJ or PLY.`);
}

export interface CaseInfo {
  caseId: string;
  patient: string;
  species: 'Canine' | 'Feline' | 'Other';
  breed: string;
  weightKg: string;
  age: string;
  side: 'Left' | 'Right';
  owner: string;
  clinic: string;
  clinician: string;
  diagnosis: string;
  notes: string;
}

export function emptyCase(): CaseInfo {
  const d = new Date();
  const id = `PB-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${Math.floor(Math.random() * 9000 + 1000)}`;
  return { caseId: id, patient: '', species: 'Canine', breed: '', weightKg: '', age: '', side: 'Right', owner: '', clinic: '', clinician: '', diagnosis: '', notes: '' };
}

export interface ProjectFile {
  format: 'petbrace-project';
  version: 1;
  savedAt: string;
  caseInfo: CaseInfo;
  params: BraceParams;
  landmarks: Landmarks;
  scan: { name: string; units: Units; position: string; index: string | null } | null;
}

const toB64 = (buf: ArrayBufferLike) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

export function serializeProject(caseInfo: CaseInfo, params: BraceParams, landmarks: Landmarks, scan: { name: string; units: Units; geometry: BufferGeometry } | null): string {
  let scanData: ProjectFile['scan'] = null;
  if (scan) {
    const pos = new Float32Array(scan.geometry.getAttribute('position').array);
    const idx = scan.geometry.getIndex() ? Uint32Array.from(scan.geometry.getIndex()!.array) : null;
    scanData = { name: scan.name, units: scan.units, position: toB64(pos.buffer), index: idx ? toB64(idx.buffer) : null };
  }
  const file: ProjectFile = { format: 'petbrace-project', version: 1, savedAt: new Date().toISOString(), caseInfo, params, landmarks, scan: scanData };
  return JSON.stringify(file);
}

export function parseProject(text: string): { file: ProjectFile; geometry: BufferGeometry | null } {
  const file = JSON.parse(text) as ProjectFile;
  if (file.format !== 'petbrace-project') throw new Error('Not a PetBrace project file.');
  let geometry: BufferGeometry | null = null;
  if (file.scan) {
    geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(fromB64(file.scan.position)), 3));
    if (file.scan.index) geometry.setIndex(new BufferAttribute(new Uint32Array(fromB64(file.scan.index)), 1));
    geometry.computeVertexNormals();
  }
  return { file, geometry };
}

export function download(name: string, data: BlobPart, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export const safeName = (s: string) => s.replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '') || 'brace';
