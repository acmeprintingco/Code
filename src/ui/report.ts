/** Printable work order / fabrication sheet for a brace case. */
import { BRACE_TYPES, PARAM_SPECS, type BraceParams, type Material } from '../core/params';
import type { CaseInfo } from './io';
import type { CuffPayload, SerializedFrames } from './protocol';
import { massGrams } from '../core/exporters';
import { BRAND, BRAND_LOGO } from '../brand/brand';

const shapeText = (shape: number[]) =>
  shape.every((v) => v === 0) ? 'None' : shape.map((v, i) => (v ? `${i * 45}°: ${v > 0 ? '+' : ''}${v} mm` : '')).filter(Boolean).join(', ');

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function openWorkOrder(opts: {
  caseInfo: CaseInfo; params: BraceParams; material: Material; cuffs: CuffPayload[]; frames: SerializedFrames; image: string; scanName: string;
  jointAngle: number; romRange: [number, number] | null;
}) {
  const { caseInfo: c, params: p, material, cuffs, frames, image } = opts;
  const bt = BRACE_TYPES[p.braceType];
  const rows = (pairs: [string, string][]) => pairs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v || '—')}</td></tr>`).join('');
  const paramRows = PARAM_SPECS.filter((s) => !s.showIf || s.showIf(p))
    .map((s) => [s.label, s.kind === 'bool' ? (p[s.key] ? 'Yes' : 'No') : `${p[s.key]}${s.unit ? ' ' + s.unit : ''}`] as [string, string]);
  const cuffRows = cuffs.map((cf) => {
    const name = cf.id === 'proximal' ? bt.proximalSegment : bt.distalSegment;
    const vol = cf.check.volume / 1000;
    return `<tr><td>${esc(name)}</td><td>${vol.toFixed(1)} cm³</td><td>${massGrams(cf.check.volume, material.density).toFixed(0)} g</td><td>${cf.check.triangles.toLocaleString()}</td><td>${cf.check.boundaryEdges === 0 ? 'Watertight' : 'Open edges!'}</td></tr>`;
  }).join('');
  const reliefs = p.reliefs.length
    ? p.reliefs.map((r) => `<tr><td>${esc(r.label)}</td><td>${r.amount > 0 ? 'Relief' : 'Compression'}</td><td>${r.amount} mm</td><td>${r.radius} mm</td></tr>`).join('')
    : '<tr><td colspan="4">None</td></tr>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(BRAND.company)} work order ${esc(c.caseId)}</title>
<style>
body{font:12px/1.45 system-ui,sans-serif;color:#111;margin:28px;max-width:860px}
h1{font-size:20px;margin:0 0 2px}h2{font-size:13px;margin:18px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px;text-transform:uppercase;letter-spacing:.4px;color:#333}
.sub{color:#555}.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:3px 6px;border-bottom:1px solid #e3e3e3;vertical-align:top}th{color:#555;font-weight:500;width:45%}
img{width:100%;border:1px solid #ddd;border-radius:6px;background:#eef2f5}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:30px}.sign div{border-top:1px solid #444;padding-top:4px;color:#555}
.disc{margin-top:18px;font-size:11px;color:#555}
.bhead{display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid ${BRAND.palette.navy}}.bhead img{height:40px;width:auto;max-width:220px;border:0;border-radius:0;background:none}.bhead span{color:#555;font-size:11px}.bhead .mono{display:inline-grid;place-items:center;width:36px;height:36px;border-radius:8px;color:#fff;font-weight:700;font-size:14px}
@media print{body{margin:12mm}button{display:none}}
</style></head><body>
<button onclick="print()" style="float:right">Print</button>
<div class="bhead">${BRAND_LOGO ? `<img src="${new URL(BRAND_LOGO, location.href).href}" alt="${esc(BRAND.company)}">` : `<span class="mono" style="background:${BRAND.palette.navy}">${esc(BRAND.monogram)}</span>`}<div><b>${esc(BRAND.company)}</b><br><span>${esc(BRAND.website)}</span></div></div>
<h1>${esc(bt.label)} orthosis — work order</h1>
<div class="sub">Case ${esc(c.caseId)} · ${esc(c.side)} ${p.braceType === 'carpal' ? 'thoracic' : 'pelvic'} limb · generated ${new Date().toLocaleString()}</div>
<div class="cols">
<div><h2>Patient</h2><table>${rows([['Patient', c.patient], ['Species / breed', `${c.species}${c.breed ? ' · ' + c.breed : ''}`], ['Weight', c.weightKg ? c.weightKg + ' kg' : ''], ['Age', c.age], ['Owner', c.owner], ['Diagnosis / indication', c.diagnosis]])}</table></div>
<div><h2>Clinic</h2><table>${rows([['Clinic', c.clinic], ['Clinician', c.clinician], ['Scan file', opts.scanName], ['Scanned joint angle (180° = straight)', `${opts.jointAngle.toFixed(0)}°`], ['Hinge range of motion', !p.hinged ? 'Rigid (immobilised)' : opts.romRange ? `${opts.romRange[0].toFixed(0)}°–${opts.romRange[1].toFixed(0)}° (stop pins)` : 'Free'], ['Joint width (ML)', `${frames.jointWidth.toFixed(1)} mm`], ['Notes', c.notes]])}</table></div>
</div>
<h2>Design</h2><img src="${image}" alt="Brace design">
<div class="cols"><div><h2>Parameters</h2><table>${rows(paramRows)}</table></div>
<div><h2>Parts — ${esc(material.name)}</h2><table><tr><th>Part</th><th>Volume</th><th>Mass</th><th>Triangles</th><th>Mesh</th></tr>${cuffRows}</table>
<h2>Relief / compression zones</h2><table><tr><th>Zone</th><th>Type</th><th>Amount</th><th>Radius</th></tr>${reliefs}</table>
<h2>Trim line hand edits</h2><table>${rows([['Proximal cuff', shapeText(p.proxTrimShape)], ['Distal cuff', shapeText(p.distTrimShape)]])}</table>
<h2>Fabrication checklist</h2><table>
<tr><td>☐ Print parts (100% walls ≥ 4 perimeters, 30–40% infill)</td></tr>
<tr><td>☐ Deburr edges, open strap slots and vent holes</td></tr>
<tr><td>☐ Apply ${p.linerOffset} mm foam liner</td></tr>
${p.hinged ? `<tr><td>☐ Assemble hinges with ${p.hingeHole} mm rivets / Chicago screws</td></tr>` : ''}
${p.hinged && p.romStops ? `<tr><td>☐ Fit ${p.stopPinDiameter} mm stop pins through proximal pin hole into distal arc slot (both sides)</td></tr>` : ''}
<tr><td>☐ Fit straps (${p.strapWidth} mm hook-and-loop)</td></tr>
<tr><td>☐ Fit check and gait evaluation</td></tr></table></div></div>
<div class="sign"><div>Designed by</div><div>Approved by (veterinarian)</div></div>
<p class="disc">Custom veterinary orthotic device. Fit, function and skin condition must be checked by a veterinarian at delivery and at regular intervals.<br>${esc(BRAND.company)} · ${esc(BRAND.website)}</p>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) throw new Error('Pop-up blocked — allow pop-ups to open the work order.');
  w.document.write(html);
  w.document.close();
}
