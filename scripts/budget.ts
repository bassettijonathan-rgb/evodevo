/**
 * Performance budget check (DESIGN.md §11): a 1000-cell organism with ~24 genes,
 * ~4 inputs per gene, 4 morphogens on a 128² grid, developing for 300τ.
 */
import { buildGenome, type GeneSpec } from '../src/core/genome/builder';
import { Rng } from '../src/core/rng';
import { Embryo } from '../src/core/sim/develop';

const rng = new Rng('budget');
const specs: GeneSpec[] = [{ name: 'grow', type: 'effector', effector: 'divide', bias: 6 }];
const D = [0.5, 2, 5, 10];
D.forEach((d, k) => specs.push({ name: `m${k}`, type: 'morphogen', bias: 0, diffusion: d, fieldDecay: 0.05, secretion: 0.5 }));
for (let k = 0; k < 15; k++) specs.push({ name: `t${k}`, type: 'tf', bias: rng.range(-2, 2) });
specs.push({ name: 'cad1', type: 'adhesion', bias: 1 }, { name: 'cad2', type: 'adhesion', bias: -1 });
specs.push({ name: 'dl', type: 'contact', bias: 0 });
specs.push({ name: 'pol', type: 'effector', effector: 'polarize', cue: 'm1', bias: 2 });
const names = specs.map((s) => s.name);
for (const s of specs) { s.sites = {}; for (let k = 0; k < 4; k++) s.sites[rng.pick(names)] = 3 * rng.normal(); }
const genome = buildGenome(specs);

const N = Number(process.argv[2] ?? 128);
const e = new Embryo(genome, { config: { gridNx: N, gridNy: N, maxCells: 1000, tDev: 300, recordEvery: 0 }, seed: 1 });
const t0 = performance.now();
let tFull = 0, stepsFull = 0;
const steps = Math.round(300 / e.config.dt);
for (let s = 0; s < steps; s++) {
  const ts = performance.now();
  e.step();
  if (e.cells.n >= 1000) { tFull += performance.now() - ts; stepsFull++; }
}
const total = performance.now() - t0;
console.log(`genes ${genome.genes.length}, morphogens 4 on ${N}², reached ${e.cells.n} cells at t = ${e.t.toFixed(0)}`);
console.log(`total ${total.toFixed(0)} ms for 300τ (${steps} steps); at the 1000-cell cap: ${(tFull / Math.max(stepsFull, 1)).toFixed(2)} ms/step over ${stepsFull} steps`);
