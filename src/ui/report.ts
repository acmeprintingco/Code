/** Printable work order / fabrication sheet for a brace case. */
import { BRACE_TYPES, LANDMARK_LABELS, PARAM_SPECS, type BraceParams, type Material } from '../core/params';
import type { CaseInfo } from './io';
import type { CuffPayload, SerializedFrames } from './protocol';
import { massGrams } from '../core/exporters';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function openWorkOrder(opts: {
  caseInfo: CaseInfo; params: BraceParams; material: Material; cuffs: CuffPayload[]; frames: SerializedFrames; image: string; scanName: string;
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
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Work order ${esc(c.caseId)}</title>
<style>
body{font:12px/1.45 system-ui,sans-serif;color:#111;margin:28px;max-width:860px}
h1{font-size:20px;margin:0 0 2px}h2{font-size:13px;margin:18px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px;text-transform:uppercase;letter-spacing:.4px;color:#333}
.sub{color:#555}.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:3px 6px;border-bottom:1px solid #e3e3e3;vertical-align:top}th{color:#555;font-weight:500;width:45%}
img{width:100%;border:1px solid #ddd;border-radius:6px;background:#eef2f5}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:30px}.sign div{border-top:1px solid #444;padding-top:4px;color:#555}
.disc{margin-top:18px;font-size:11px;color:#555}
@media print{body{margin:12mm}button{display:none}}
</style></head><body>
<button onclick="print()" style="float:right">Print</button>
<h1>${esc(bt.label)} orthosis — work order</h1>
<div class="sub">Case ${esc(c.caseId)} · ${esc(c.side)} ${p.braceType === 'carpal' ? 'thoracic' : 'pelvic'} limb · generated ${new Date().toLocaleString()}</div>
<div class="cols">
<div><h2>Patient</h2><table>${rows([['Patient', c.patient], ['Species / breed', `${c.species}${c.breed ? ' · ' + c.breed : ''}`], ['Weight', c.weightKg ? c.weightKg + ' kg' : ''], ['Age', c.age], ['Owner', c.owner], ['Diagnosis / indication', c.diagnosis]])}</table></div>
<div><h2>Clinic</h2><table>${rows([['Clinic', c.clinic], ['Clinician', c.clinician], ['Scan file', opts.scanName], ['Joint angle (deviation from straight)', `${frames.bendAngle.toFixed(0)}°`], ['Joint width (ML)', `${frames.jointWidth.toFixed(1)} mm`], ['Notes', c.notes]])}</table></div>
</div>
<h2>Design</h2><img src="${image}" alt="Brace design">
<div class="cols"><div><h2>Parameters</h2><table>${rows(paramRows)}</table></div>
<div><h2>Parts — ${esc(material.name)}</h2><table><tr><th>Part</th><th>Volume</th><th>Mass</th><th>Triangles</th><th>Mesh</th></tr>${cuffRows}</table>
<h2>Relief / compression zones</h2><table><tr><th>Zone</th><th>Type</th><th>Amount</th><th>Radius</th></tr>${reliefs}</table>
<h2>Landmarks</h2><table>${rows(Object.entries(LANDMARK_LABELS).map(([, l]) => [l, 'Placed'] as [string, string]))}</table>
<h2>Fabrication checklist</h2><table>
<tr><td>☐ Print parts (100% walls ≥ 4 perimeters, 30–40% infill)</td></tr>
<tr><td>☐ Deburr edges, open strap slots and vent holes</td></tr>
<tr><td>☐ Apply ${p.linerOffset} mm foam liner</td></tr>
${p.hinged ? `<tr><td>☐ Assemble hinges with ${p.hingeHole} mm rivets / Chicago screws</td></tr>` : ''}
<tr><td>☐ Fit straps (${p.strapWidth} mm hook-and-loop)</td></tr>
<tr><td>☐ Fit check and gait evaluation</td></tr></table></div></div>
<div class="sign"><div>Designed by</div><div>Approved by (veterinarian)</div></div>
<p class="disc">Custom veterinary orthotic device. Fit, function and skin condition must be checked by a veterinarian at delivery and at regular intervals.</p>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) throw new Error('Pop-up blocked — allow pop-ups to open the work order.');
  w.document.write(html);
  w.document.close();
}
