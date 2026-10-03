/** Knock out each gene of a saved genome and report elongation (and size) of the result. */
import { readFileSync } from 'node:fs';
import { evaluate } from '../src/core/evolution/evaluate';
import { genomeFromJSON, genomeHash } from '../src/core/genome/serialize';
const [file, runKey] = process.argv.slice(2);
const g = genomeFromJSON(readFileSync(file, 'utf8'));
const sim = { gridNx: 64, gridNy: 64, maxCells: 200, tDev: 150 };
const seed = `${runKey}/${genomeHash(g)}`;
const wt = evaluate({ genome: g, config: sim, seed }).metrics;
console.log(`wild type: elongation ${wt.elongation.toFixed(2)}, ${wt.cells} cells, ${wt.cellTypes} types`);
for (const gene of g.genes) {
  const m = evaluate({ genome: g, config: sim, seed, perturbations: [{ gene: gene.id, mode: 'knockout' }] }).metrics;
  console.log(`KO ${gene.name.padEnd(5)} ${gene.type.padEnd(9)} elongation ${m.elongation.toFixed(2)}  cells ${m.cells}  types ${m.cellTypes}`);
}
// Also: zero all asymmetries, and remove the zygote polarity cue.
const sym = genomeFromJSON(readFileSync(file, 'utf8'));
for (const gene of sym.genes) gene.asymmetry = 0;
console.log(`no asymmetric segregation: elongation ${evaluate({ genome: sym, config: sim, seed }).metrics.elongation.toFixed(2)}`);
console.log(`no zygote polarity cue:    elongation ${evaluate({ genome: g, config: { ...sim, zygotePolarity: [0, 0] }, seed }).metrics.elongation.toFixed(2)}`);
for (const s of ['x', 'y', 'z']) console.log(`other noise seed ${s}:        elongation ${evaluate({ genome: g, config: sim, seed: seed + s }).metrics.elongation.toFixed(2)}`);
