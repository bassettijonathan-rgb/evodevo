/** Render an organism coloured by one gene's on/off state (for checking segment hits). */
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluate } from '../src/core/evolution/evaluate';
import { compileGenome } from '../src/core/genome/compile';
import { genomeFromJSON, genomeHash } from '../src/core/genome/serialize';
import { principalAxes } from '../src/core/metrics/shape';

const [file, runKey, geneName, out] = process.argv.slice(2);
const g = genomeFromJSON(readFileSync(file, 'utf8'));
const sim = { gridNx: 64, gridNy: 64, maxCells: 200, tDev: 150 };
const r = evaluate({ genome: g, config: sim, seed: `${runKey}/${genomeHash(g)}` });
const grn = compileGenome(g, 0.1);
const gi = grn.names.indexOf(geneName);
const f = r.final, G = f.G;
const ax = principalAxes(f.px, f.py, f.n);
const size = 260, cx = ax.cx, cy = ax.cy;
let span = 0; for (let c = 0; c < f.n; c++) span = Math.max(span, Math.abs(f.px[c] - cx), Math.abs(f.py[c] - cy));
const s = size / (2 * span + 3);
let body = '';
for (let c = 0; c < f.n; c++) {
  const on = f.x[c * G + gi] > 0.5 * grn.maxLevel[gi];
  body += `<circle cx="${((f.px[c] - cx) * s + size / 2).toFixed(1)}" cy="${(size / 2 - (f.py[c] - cy) * s).toFixed(1)}" r="${(0.48 * s).toFixed(1)}" fill="${on ? '#d6532a' : '#c9c9c4'}"/>`;
}
const L = span * s;
body += `<line x1="${size / 2 - ax.ax * L}" y1="${size / 2 + ax.ay * L}" x2="${size / 2 + ax.ax * L}" y2="${size / 2 - ax.ay * L}" stroke="#2a6fd6" stroke-width="1.5" stroke-dasharray="4 3"/>`;
writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#fbfbfa"/>${body}<text x="6" y="${size - 6}" font-size="11" font-family="sans-serif" fill="#555">${geneName} on (orange); main axis dashed; ${r.metrics.segments} seg</text></svg>`);
console.log(JSON.stringify(r.metrics));
