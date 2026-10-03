/** Rough cost of evaluating organisms at evolution settings. */
import { evaluate } from '../src/core/evolution/evaluate';
import { randomFounder } from '../src/core/evolution/founders';
import { Evolution } from '../src/core/evolution/population';
import { Rng } from '../src/core/rng';
import { nodePool } from './nodePool';

const sim = { gridNx: 64, gridNy: 64, maxCells: 200, tDev: 150 };
const rng = new Rng('bench');
let total = 0, cells = 0;
for (let k = 0; k < 8; k++) {
  const r = evaluate({ genome: randomFounder(rng), config: sim, seed: k });
  total += r.elapsedMs; cells += r.metrics.cells;
  console.log(`founder ${k}: ${r.metrics.cells} cells, ${r.elapsedMs.toFixed(0)} ms, types ${r.metrics.cellTypes}`);
}
console.log(`mean ${(total / 8).toFixed(0)} ms, mean cells ${(cells / 8).toFixed(0)}`);

const pool = nodePool();
const evo = new Evolution([randomFounder(new Rng(1)), randomFounder(new Rng(2))], { sim, seed: 'bench', populationSize: 32 });
const t0 = performance.now();
for (let g = 0; g < 5; g++) {
  const tg = performance.now();
  await evo.evaluate((jobs) => pool.evaluate(jobs));
  const pop = evo.population;
  const meanMs = pop.reduce((a, i) => a + i.result!.elapsedMs, 0) / pop.length;
  console.log(`gen ${g}: best ${evo.best().fitness!.toFixed(3)} cells ${evo.best().result!.metrics.cells} types ${evo.best().result!.metrics.cellTypes}; wall ${(performance.now() - tg).toFixed(0)} ms; mean eval ${meanMs.toFixed(0)} ms`);
  evo.advance();
}
console.log(`total ${(performance.now() - t0).toFixed(0)} ms`);
pool.terminate();
