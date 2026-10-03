/**
 * Turn the raw M4 experiment output into reports/M4-emergence.md (+ SVGs and genomes).
 *
 *   npx tsx scripts/report.ts reports/m4-data reports
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { evaluate } from '../src/core/evolution/evaluate';
import { genomeFromJSON, genomeToJSON } from '../src/core/genome/serialize';
import type { Genome } from '../src/core/genome/types';
import type { Metrics } from '../src/core/metrics';
import { organismSVG } from '../src/render/svg';
import { Rng } from '../src/core/rng';

const [dataDir = 'reports/m4-data', outDir = 'reports'] = process.argv.slice(2);
const assetDir = `${outDir}/m4`;
mkdirSync(`${assetDir}/genomes`, { recursive: true });

interface Rec { id: number; generation: number; fitness: number; metrics: Metrics; log: string[] }
interface Run {
  kind: 'selected' | 'drift' | 'sizeonly'; index: number; gens: number; pop: number;
  sim: Record<string, number>;
  perGen: { gen: number; bestFitness: number; meanCells: number; meanTypes: number; maxSegments: number }[];
  history: Rec[]; genomes: Record<string, unknown>; finalIds: number[];
}

const runs: Run[] = readdirSync(dataDir).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(`${dataDir}/${f}`, 'utf8')));
const selected = runs.filter((r) => r.kind === 'selected');
const drift = runs.filter((r) => r.kind === 'drift');
const sizeOnly = runs.filter((r) => r.kind === 'sizeonly');
const genomeOf = (run: Run, id: number): Genome => genomeFromJSON(JSON.stringify(run.genomes[id]));

// ---------------------------------------------------------------- null distribution
// Organisms not selected for pattern: drift runs, size-only runs, and generation 0 of selected runs.
const nullRecs = [
  ...drift.flatMap((r) => r.history),
  ...sizeOnly.flatMap((r) => r.history),
  ...selected.flatMap((r) => r.history.filter((h) => h.generation === 0)),
];
const quantile = (v: number[], q: number) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };
const big = (m: Metrics) => m.cells >= 150;
const nullBig = nullRecs.filter((h) => big(h.metrics));
const null3 = nullBig.filter((h) => h.metrics.cellTypes >= 3);
const thr = {
  bilateral: quantile(null3.map((h) => h.metrics.patternBilateral), 0.99),
  radial: quantile(null3.map((h) => h.metrics.patternRadial), 0.99),
};

// ---------------------------------------------------------------- hits
const isSeg = (m: Metrics) => m.segments >= 3;

// Symmetry. The pre-specified criterion (κ above the null's 99th percentile) needs
// unselected organisms with ≥ 3 types and ≥ 150 cells; if there are too few, we fall
// back to absolute thresholds (stated in the report). Either way a hit must also be
// NON-ISOTROPIC: concentric patterns are mirror- and rotation-symmetric for free.
const KAPPA_ABS = 0.5;
const SAMPLE = 60;
const ISOTROPY_MAX = 0.3;
const nullUsable = null3.length >= 100;
const kappaThrBi = nullUsable ? thr.bilateral : KAPPA_ABS;
const kappaThrRad = nullUsable ? thr.radial : KAPPA_ABS;
const symCandidate = (m: Metrics) => m.cellTypes >= 3 && big(m) && (m.patternBilateral > kappaThrBi || m.patternRadial > kappaThrRad);

/** Regrow symmetry candidates (unique genomes, top 30 by κ per run) to measure isotropy. */
const fresh = new Map<string, Metrics>(); // key: run/id
const symHits = new Map<Run, Rec[]>();
const candidatesSeen = new Map<Run, { candidates: number; isotropic: number }>();
for (const run of runs) {
  const byHash = new Map<string, Rec>();
  for (const h of run.history) {
    if (!symCandidate(h.metrics)) continue;
    const hash = hashOf(genomeOf(run, h.id));
    if (!byHash.has(hash)) byHash.set(hash, h);
  }
  // A seeded random sample (not the top by κ: those are dominated by concentric
  // patterns, which would hide rarer non-isotropic ones).
  const pool = [...byHash.values()];
  const rng = new Rng(`report-${run.kind}-${run.index}`);
  for (let i = pool.length - 1; i > 0; i--) { const j = rng.int(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const cands = pool.slice(0, SAMPLE);
  const hits: Rec[] = [];
  let isotropic = 0;
  for (const h of cands) {
    const g = genomeOf(run, h.id);
    const m = evaluate({ genome: g, config: run.sim, seed: `${run.kind}-${run.index}/${hashOf(g)}` }).metrics;
    fresh.set(`${run.kind}-${run.index}/${h.id}`, m);
    if (m.patternIsotropy > ISOTROPY_MAX) { isotropic++; continue; }
    if (symCandidate(m)) hits.push({ ...h, metrics: m });
  }
  symHits.set(run, hits);
  candidatesSeen.set(run, { candidates: byHash.size, isotropic });
}
const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const pct = (k: number, n: number) => (n ? `${k}/${n} (${((100 * k) / n).toFixed(1)}%)` : '0/0');

interface Hit { run: Run; rec: Rec; why: string }
function hitsIn(run: Run): { seg: Rec[]; sym: Rec[] } {
  return { seg: run.history.filter((h) => isSeg(h.metrics)), sym: symHits.get(run) ?? [] };
}

/** Regrow an organism and knock out each gene: which genes does the pattern need? */
function mechanism(g: Genome, sim: Record<string, number>, seed: string, key: 'segments' | 'patternBilateral' | 'patternRadial') {
  const base = evaluate({ genome: g, config: sim, seed });
  const effects = g.genes.map((gene) => {
    const r = evaluate({ genome: g, config: sim, seed, perturbations: [{ gene: gene.id, mode: 'knockout' }] });
    return { gene: gene.name, type: gene.type + (gene.effector ? `/${gene.effector}` : ''), before: base.metrics[key], after: r.metrics[key], cells: r.metrics.cells, types: r.metrics.cellTypes };
  });
  return { base, effects };
}

const lines: string[] = [];
const out = (s = '') => lines.push(s);
out('# M4: does segmentation or symmetry emerge without being selected for?');
out();
out(`_Generated by \`scripts/report.ts\` from ${runs.length} runs in \`${dataDir}\`._`);
out();
out('## Setup');
out();
const s0 = runs[0];
out(`- ${selected.length} **selected** runs: fitness = mean of min(cells/200, 1) and min(cellTypes/6, 1). Nothing else is rewarded.`);
out(`- ${drift.length} **drift** runs: identical except parents are chosen at random (no selection), as the null model.`);
if (sizeOnly.length) out(`- ${sizeOnly.length} **size-only** runs: selected for body size alone, a second null with viable organisms but no pressure on pattern.`);
out(`- Each run: one random 8-gene founder (different per run index, same founder for selected-k and drift-k), population ${s0?.pop}, ${s0?.gens} generations, elitism 2, tournament 3, default mutation rates (neutral duplication on).`);
out(`- Development: ${JSON.stringify(s0?.sim)}; zygote polarity (1,0); default mechanics and noise.`);
out('- Criteria fixed before looking at the results (DESIGN.md D10):');
out('  - **segmentation**: ≥ 3 regularly spaced stripes of one gene, each spanning ≥ 50% of the body width;');
out(`  - **non-trivial symmetry**: ≥ 3 cell types, ≥ 150 cells, and pattern symmetry (Cohen's κ, beyond chance) above the 99th percentile of unselected organisms with ≥ 3 types.`);
out();
out('**Two changes to the symmetry criterion, made after the experiment was launched (stated here so they can be judged):**');
out();
out(`1. **Null too small.** Only ${null3.length} unselected organisms (drift runs plus generation 0 of selected runs) had ≥ 3 types and ≥ 150 cells. Without selection, growth itself degrades under drift, so a 99th percentile of that set is ${nullUsable ? 'usable' : '**not meaningful**'}. ${nullUsable ? `Thresholds used: mirror κ > ${fmt(thr.bilateral)}, rotational κ > ${fmt(thr.radial)}.` : `Fallback: absolute thresholds κ > ${KAPPA_ABS} (mirror or rotational).`}`);
out(`2. **Isotropy exclusion.** Chance-corrected κ does not exclude the trivial case DESIGN.md D10 warns about: concentric rings of cell types around the centre of a blob (an organism reading its own radial gradient) are mirror-symmetric about every axis and rotation-symmetric at every order. So a hit must also have *pattern isotropy* (κ under a 37° rotation) ≤ ${ISOTROPY_MAX}. The isotropy rule was added after seeing that segmentation never occurred and that the null was empty, but before looking at any κ values. Candidates were regrown with the current metric code to compute it. The *sampling* of candidates was then changed once: a trial on partial data checked the top 30 by κ, found them all isotropic, and that ranking would hide rarer non-isotropic patterns. So the final rule is a seeded random sample of up to ${SAMPLE} unique genomes per run.`);
out();

out('## Results');
out();
out('| run | final best fitness | final best cells / types | max types ever | individuals with segments ≥ 3 | symmetric candidates (unique genomes) | of those isotropic (trivial) | non-trivially symmetric |');
out('|---|---|---|---|---|---|---|---|');
const allHits: Hit[] = [];
for (const run of [...selected, ...drift, ...sizeOnly]) {
  const finals = run.history.filter((h) => run.finalIds.includes(h.id));
  const best = [...finals].sort((a, b) => (b.fitness || 0) - (a.fitness || 0))[0];
  const h = hitsIn(run);
  const cs = candidatesSeen.get(run)!;
  out(`| ${run.kind} ${run.index} | ${run.kind !== 'drift' ? fmt(best.fitness, 3) : '—'} | ${best.metrics.cells} / ${best.metrics.cellTypes} | ${Math.max(...run.history.map((x) => x.metrics.cellTypes))} | ${pct(h.seg.length, run.history.length)} | ${cs.candidates} | ${Math.min(cs.isotropic, cs.candidates)}${cs.candidates > SAMPLE ? ` (of ${SAMPLE} sampled)` : ''} | ${h.sym.length} |`);
  for (const r of h.seg) allHits.push({ run, rec: r, why: 'segments' });
  for (const r of h.sym) allHits.push({ run, rec: r, why: 'symmetry' });
}
out();
const runsWith = (rs: Run[], f: (r: Run) => boolean) => rs.filter(f).length;
const segRunsSel = runsWith(selected, (r) => hitsIn(r).seg.length > 0);
const symRunsSel = runsWith(selected, (r) => hitsIn(r).sym.length > 0);
const segRunsDrift = runsWith(drift, (r) => hitsIn(r).seg.length > 0);
const symRunsDrift = runsWith(drift, (r) => hitsIn(r).sym.length > 0);
out(`**Runs in which segmentation appeared at least once:** selected ${segRunsSel}/${selected.length}, drift ${segRunsDrift}/${drift.length}${sizeOnly.length ? `, size-only ${runsWith(sizeOnly, (r) => hitsIn(r).seg.length > 0)}/${sizeOnly.length}` : ''}.`);
out();
out(`**Runs in which non-trivial symmetry appeared at least once:** selected ${symRunsSel}/${selected.length}, drift ${symRunsDrift}/${drift.length}${sizeOnly.length ? `, size-only ${runsWith(sizeOnly, (r) => hitsIn(r).sym.length > 0)}/${sizeOnly.length}` : ''}.`);
out();
const selAll = selected.flatMap((r) => r.history);
out(`Across all evaluated organisms: selected ${pct(selAll.filter((h) => isSeg(h.metrics)).length, selAll.length)} segmented; unselected ${pct(nullRecs.filter((h) => isSeg(h.metrics)).length, nullRecs.length)} segmented.`);
out();
// κ distribution among multi-type organisms in selected runs (recorded metrics).
const multi = selAll.filter((h) => h.metrics.cellTypes >= 3 && big(h.metrics));
out(`Among the ${multi.length} selected-run organisms with ≥ 3 types and ≥ 150 cells: mirror κ median ${fmt(quantile(multi.map((h) => h.metrics.patternBilateral), 0.5))}, 90th percentile ${fmt(quantile(multi.map((h) => h.metrics.patternBilateral), 0.9))}; rotational κ median ${fmt(quantile(multi.map((h) => h.metrics.patternRadial), 0.5))}, 90th percentile ${fmt(quantile(multi.map((h) => h.metrics.patternRadial), 0.9))}.`);
out();

// Cell-type evolution summary
out('### Did selection work on what it targeted?');
out();
out('| run | gen 0 mean types | final mean types | gen 0 mean cells | final mean cells |');
out('|---|---|---|---|---|');
for (const run of selected) {
  const a = run.perGen[0], b = run.perGen.at(-1)!;
  out(`| ${run.index} | ${fmt(a.meanTypes)} | ${fmt(b.meanTypes)} | ${fmt(a.meanCells, 0)} | ${fmt(b.meanCells, 0)} |`);
}
out();

// ---------------------------------------------------------------- examples + mechanisms
out('## Examples and mechanisms');
out();
const examples: Hit[] = [];
for (const why of ['segments', 'symmetry'] as const) {
  // One example per run: the hit with the most segments / highest symmetry, selected runs first.
  const byRun = new Map<string, Hit>();
  for (const h of allHits.filter((x) => x.why === why)) {
    const key = `${h.run.kind}-${h.run.index}`;
    const score = why === 'segments' ? h.rec.metrics.segments : Math.max(h.rec.metrics.patternBilateral, h.rec.metrics.patternRadial);
    const prev = byRun.get(key);
    const prevScore = prev ? (why === 'segments' ? prev.rec.metrics.segments : Math.max(prev.rec.metrics.patternBilateral, prev.rec.metrics.patternRadial)) : -1;
    if (score > prevScore) byRun.set(key, h);
  }
  examples.push(...[...byRun.values()].sort((a, b) => (a.run.kind === b.run.kind ? 0 : a.run.kind === 'selected' ? -1 : 1)).slice(0, 4));
}
if (!examples.length) out('No organism met either criterion, so there are no examples to dissect.');
// Always also show the final best organism of each selected run (what selection actually produced).
for (const h of examples) {
  const { run, rec, why } = h;
  const g = genomeOf(run, rec.id);
  const seed = `${run.kind}-${run.index}/${require_hash(g)}`;
  const key = why === 'segments' ? 'segments' : rec.metrics.patternBilateral >= rec.metrics.patternRadial ? 'patternBilateral' : 'patternRadial';
  const mech = mechanism(g, run.sim, seed, key);
  const name = `${run.kind}-${run.index}-id${rec.id}`;
  writeFileSync(`${assetDir}/${name}.svg`, organismSVG(mech.base.final, 260));
  writeFileSync(`${assetDir}/genomes/${name}.json`, genomeToJSON(g));
  out(`### ${run.kind} run ${run.index}, individual ${rec.id} (generation ${rec.generation}): ${why}`);
  out();
  out(`![${name}](m4/${name}.svg)`);
  out();
  const m = mech.base.metrics;
  out(`cells ${m.cells}, types ${m.cellTypes}, segments ${m.segments}${m.segmentGene ? ` (gene ${m.segmentGene})` : ''}, pattern mirror κ ${fmt(m.patternBilateral)}, rotational κ ${fmt(m.patternRadial)} (order ${m.radialOrder}), isotropy ${fmt(m.patternIsotropy)}, elongation ${fmt(m.elongation)}. Genome: ${g.genes.length} genes ([JSON](m4/genomes/${name}.json)).`);
  out();
  const needed = mech.effects.filter((e) => e.after < 0.5 * e.before || (key === 'segments' && e.after < 3));
  out(`Knockout analysis (${key}): ${needed.length ? `the pattern needs ${needed.map((e) => `\`${e.gene}\` (${e.type})`).join(', ')}` : 'no single knockout abolishes it'}.`);
  out();
  out('| knockout | type | ' + key + ' | cells | types |');
  out('|---|---|---|---|---|');
  for (const e of mech.effects) out(`| ${e.gene} | ${e.type} | ${fmt(e.before)} → ${fmt(e.after)} | ${e.cells} | ${e.types} |`);
  out();
}

out('## Final organisms of the selected runs');
out();
for (const run of selected) {
  const finals = run.history.filter((h) => run.finalIds.includes(h.id));
  const best = [...finals].sort((a, b) => (b.fitness || 0) - (a.fitness || 0))[0];
  const g = genomeOf(run, best.id);
  const r = evaluate({ genome: g, config: run.sim, seed: `${run.kind}-${run.index}/${require_hash(g)}` });
  const name = `final-selected-${run.index}`;
  writeFileSync(`${assetDir}/${name}.svg`, organismSVG(r.final, 160));
  writeFileSync(`${assetDir}/genomes/${name}.json`, genomeToJSON(g));
  out(`![run ${run.index}](m4/${name}.svg) `);
}
out();
writeFileSync(`${outDir}/M4-emergence.md`, lines.join('\n'));
console.log(`wrote ${outDir}/M4-emergence.md (${examples.length} examples)`);

function require_hash(g: Genome): string {
  // Same organism seed the evolution used: `${experimentSeed}/${genomeHash}`.
  return hashOf(g);
}
import { genomeHash as hashOf } from '../src/core/genome/serialize';
