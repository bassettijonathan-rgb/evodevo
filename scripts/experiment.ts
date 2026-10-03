/**
 * M4 emergence experiment (DESIGN.md §10, D10).
 *
 * Selected runs: fitness = body size + number of cell types ONLY.
 * Drift runs:    no selection (random fitness) — the null model.
 * Every evaluated individual's metrics are kept, so "did segmentation or
 * symmetry ever appear" can be asked of the whole history, not just the end.
 *
 *   npx tsx scripts/experiment.ts --runs 10 --drift 6 --gens 120 --pop 32 --out reports/m4
 *
 * Results are written incrementally (one JSON per run), so partial results
 * survive an interrupted experiment. scripts/report.ts turns them into a report.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { randomFounder } from '../src/core/evolution/founders';
import { Evolution, type EvolutionSettings, type Individual } from '../src/core/evolution/population';
import { genomeToJSON } from '../src/core/genome/serialize';
import { Rng } from '../src/core/rng';
import { nodePool } from './nodePool';

const args = Object.fromEntries(
  process.argv.slice(2).reduce<[string, string][]>((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const RUNS = Number(args.runs ?? 10);
const DRIFT = Number(args.drift ?? 6);
const GENS = Number(args.gens ?? 120);
const POP = Number(args.pop ?? 32);
const OUT = args.out ?? 'reports/m4';
mkdirSync(OUT, { recursive: true });

const SIM = { gridNx: 64, gridNy: 64, maxCells: 200, tDev: 150 };
const SELECTED: EvolutionSettings['objective'] = {
  kind: 'weighted',
  terms: [
    { metric: 'cells', mode: 'maximize', target: 200, weight: 1 },
    { metric: 'cellTypes', mode: 'maximize', target: 6, weight: 1 },
  ],
};

interface Record {
  id: number;
  generation: number;
  parents: number[];
  fitness: number;
  metrics: Individual['result'] extends infer R ? (R extends { metrics: infer M } ? M : never) : never;
  log: string[];
}

const pool = nodePool();
const started = Date.now();

async function runOne(kind: 'selected' | 'drift', index: number): Promise<void> {
  const file = `${OUT}/${kind}-${index}.json`;
  if (existsSync(file)) { console.log(`skip ${file} (exists)`); return; }
  const founder = randomFounder(new Rng(`founder-${index}`), 8);
  const evo = new Evolution([founder], {
    populationSize: POP,
    sim: SIM,
    objective: kind === 'selected' ? SELECTED : { kind: 'random' },
    seed: `${kind}-${index}`,
  });
  const perGen: { gen: number; bestFitness: number; meanCells: number; meanTypes: number; maxSegments: number; maxPatternBilateral: number; maxPatternRadial: number }[] = [];
  for (let gen = 0; gen < GENS; gen++) {
    await evo.evaluate((jobs) => pool.evaluate(jobs));
    const pop = evo.population;
    const m = pop.map((i) => i.result!.metrics);
    perGen.push({
      gen,
      bestFitness: kind === 'selected' ? evo.best().fitness! : NaN,
      meanCells: m.reduce((a, x) => a + x.cells, 0) / m.length,
      meanTypes: m.reduce((a, x) => a + x.cellTypes, 0) / m.length,
      maxSegments: Math.max(...m.map((x) => x.segments)),
      maxPatternBilateral: Math.max(...m.map((x) => x.patternBilateral)),
      maxPatternRadial: Math.max(...m.map((x) => x.patternRadial)),
    });
    if (gen % 10 === 0 || gen === GENS - 1) {
      const b = evo.best();
      console.log(`[${((Date.now() - started) / 60000).toFixed(1)} min] ${kind} ${index} gen ${gen}: best f=${(b.fitness ?? 0).toFixed(3)} cells=${b.result!.metrics.cells} types=${b.result!.metrics.cellTypes} genes=${b.genome.genes.length} | pop maxSeg=${perGen.at(-1)!.maxSegments}`);
    }
    if (gen < GENS - 1) evo.advance();
  }
  // Keep every evaluated individual's metrics (the whole history), and the final genomes.
  const history: Record[] = [...evo.history.values()]
    .filter((i) => i.result)
    .map((i) => ({ id: i.id, generation: i.generation, parents: i.parents, fitness: i.fitness ?? NaN, metrics: i.result!.metrics, log: i.log }));
  const genomes = Object.fromEntries([...evo.history.values()].filter((i) => i.result).map((i) => [i.id, JSON.parse(genomeToJSON(i.genome, false))]));
  writeFileSync(file, JSON.stringify({ kind, index, founder: JSON.parse(genomeToJSON(founder, false)), sim: SIM, gens: GENS, pop: POP, perGen, history, genomes, finalIds: evo.population.map((i) => i.id) }));
  console.log(`wrote ${file}`);
}

// Interleave selected and drift runs so a partial experiment still has both.
for (let k = 0; k < Math.max(RUNS, DRIFT); k++) {
  if (k < RUNS) await runOne('selected', k);
  if (k < DRIFT) await runOne('drift', k);
}
pool.terminate();
console.log(`done in ${((Date.now() - started) / 60000).toFixed(1)} min`);
