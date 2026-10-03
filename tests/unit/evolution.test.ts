import { describe, expect, it } from 'vitest';
import { crossover } from '../../src/core/evolution/crossover';
import { evaluate } from '../../src/core/evolution/evaluate';
import { randomFounder } from '../../src/core/evolution/founders';
import { DEFAULT_MUTATION, deleteGene, duplicateGenes, mutate } from '../../src/core/evolution/mutate';
import { Evolution, type Evaluator } from '../../src/core/evolution/population';
import { geneId } from '../../src/core/genome/builder';
import { genomeFromJSON, genomeHash, genomeToJSON } from '../../src/core/genome/serialize';
import type { Genome } from '../../src/core/genome/types';
import { validateGenome } from '../../src/core/genome/validate';
import { Rng } from '../../src/core/rng';
import { develop, latticeTissue } from '../../src/core/sim/develop';
import { frenchFlag, frenchFlagEmbryo } from '../../src/presets/patterning';

describe('mutation operators', () => {
  it('thousands of random mutations always yield valid, serialisable genomes', () => {
    const rng = new Rng('fuzz');
    let g = randomFounder(rng);
    const heavy = { ...DEFAULT_MUTATION, rates: Object.fromEntries(Object.entries(DEFAULT_MUTATION.rates).map(([k, v]) => [k, v * 3])) as unknown as typeof DEFAULT_MUTATION.rates };
    for (let i = 0; i < 2000; i++) {
      g = mutate(g, rng, heavy).genome;
      expect(validateGenome(g, heavy)).toEqual([]);
      if (i % 100 === 0) expect(genomeHash(genomeFromJSON(genomeToJSON(g)))).toBe(genomeHash(g));
    }
  });

  it('is deterministic for a given seed and logs every event', () => {
    const g = randomFounder(new Rng(1));
    const a = mutate(g, new Rng('m'), DEFAULT_MUTATION, 5);
    const b = mutate(g, new Rng('m'), DEFAULT_MUTATION, 5);
    expect(genomeHash(a.genome)).toBe(genomeHash(b.genome));
    expect(a.log).toEqual(b.log);
    expect(a.log.length).toBeGreaterThan(0);
  });

  it('deletion leaves no dangling references', () => {
    const g = frenchFlagEmbryo();
    const d = deleteGene(g, geneId(g, 'S'));
    expect(validateGenome(d)).toEqual([]);
    expect(d.genes.some((x) => x.sites.some((s) => s.regulator === geneId(g, 'S')))).toBe(false);
    expect(d.maternal[geneId(g, 'S')]).toBeUndefined();
  });

  it('duplication copies inputs AND outputs', () => {
    const g = frenchFlag();
    const M = geneId(g, 'M');
    const d = duplicateGenes(g, [M], 'double');
    const copy = d.genes.find((x) => x.name === 'M.2')!;
    expect(copy.sites).toEqual(g.genes.find((x) => x.id === M)!.sites); // same cis-region
    for (const name of ['B', 'W']) {
      const sites = d.genes.find((x) => x.name === name)!.sites;
      expect(sites.find((s) => s.regulator === copy.id)?.weight).toBe(sites.find((s) => s.regulator === M)!.weight);
    }
  });
});

describe('dosage-neutral duplication leaves the phenotype unchanged', () => {
  /** French flag v1 on a static tissue: per-cell summed level of each original gene's family. */
  function flagLevels(genome: Genome): number[] {
    const e = develop(genome, {
      initial: { kind: 'tissue', frozen: true, cells: latticeTissue(32, 4, (i) => (i === 0 ? { 0: 1 } : undefined)) },
      config: { gridNx: 32, gridNy: 4, recordEvery: 0 },
      tEnd: 300,
    });
    const G = e.grn.G;
    const out: number[] = [];
    for (let c = 0; c < e.cells.n; c++) {
      for (const base of ['S', 'M', 'B', 'W', 'R']) {
        let sum = 0;
        e.grn.names.forEach((nm, i) => { if (nm.replace(/\.\d+$/, '') === base) sum += e.cells.x[c * G + i]; });
        out.push(sum);
      }
    }
    return out;
  }

  const wt = flagLevels(frenchFlag());
  const close = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

  it('single-gene duplication of each gene in turn (TF, morphogen, read-outs)', () => {
    const g = frenchFlag();
    for (const gene of g.genes) {
      expect(close(flagLevels(duplicateGenes(g, [gene.id], 'neutral')), wt)).toBeLessThan(1e-9);
    }
  });

  it('segmental and whole-genome duplication', () => {
    const g = frenchFlag();
    expect(close(flagLevels(duplicateGenes(g, [2, 3, 4], 'neutral')), wt)).toBeLessThan(1e-9);
    expect(close(flagLevels(duplicateGenes(g, g.genes.map((x) => x.id), 'neutral')), wt)).toBeLessThan(1e-9);
  });

  it("control: 'double' dosage does change the phenotype", () => {
    const g = frenchFlag();
    expect(close(flagLevels(duplicateGenes(g, [geneId(g, 'M')], 'double')), wt)).toBeGreaterThan(0.1);
  });

  it('a growing embryo with a duplicated divide effector and maternal determinant develops the same', () => {
    const g = frenchFlagEmbryo();
    const cfg = { gridNx: 48, gridNy: 48, maxCells: 64, recordEvery: 0 };
    const a = develop(g, { config: cfg, tEnd: 60, seed: 3 });
    const dup = duplicateGenes(g, [geneId(g, 'grow'), geneId(g, 'S')], 'neutral');
    const b = develop(dup, { config: cfg, tEnd: 60, seed: 3 });
    expect(b.cells.n).toBe(a.cells.n);
    let worst = 0;
    for (let c = 0; c < a.cells.n; c++) worst = Math.max(worst, Math.abs(a.cells.px[c] - b.cells.px[c]), Math.abs(a.cells.py[c] - b.cells.py[c]));
    expect(worst).toBeLessThan(1e-6);
  });
});

describe('paralog naming', () => {
  it('numbers copies uniquely by root name', () => {
    let g = frenchFlag();
    const M = geneId(g, 'M');
    g = duplicateGenes(g, [M], 'neutral');
    g = duplicateGenes(g, [M], 'neutral');
    g = duplicateGenes(g, [geneId(g, 'M.2')], 'neutral');
    expect(g.genes.map((x) => x.name).filter((n) => n.startsWith('M')).sort()).toEqual(['M', 'M.2', 'M.3', 'M.4']);
    expect(new Set(g.genes.map((x) => x.name)).size).toBe(g.genes.length);
  });
});

describe('crossover', () => {
  it('aligns genes by id and produces valid children', () => {
    const rng = new Rng('x');
    const base = randomFounder(rng);
    const a = mutate(base, rng, DEFAULT_MUTATION, 4).genome;
    const b = mutate(base, rng, DEFAULT_MUTATION, 4).genome;
    for (let k = 0; k < 50; k++) expect(validateGenome(crossover(a, b, rng))).toEqual([]);
    expect(genomeHash(crossover(a, a, rng))).toBe(genomeHash(a));
  });
});

describe('evolution loop', () => {
  const inProcess: Evaluator = async (jobs) => jobs.map(evaluate);
  const settings = {
    populationSize: 8,
    sim: { gridNx: 40, gridNy: 40, maxCells: 60, tDev: 40 },
    objective: { kind: 'weighted' as const, terms: [{ metric: 'cells' as const, mode: 'maximize' as const, target: 60, weight: 1 }] },
  };

  it('with elitism the best fitness never decreases, and selection for size works', async () => {
    const founder = randomFounder(new Rng(5));
    const evo = new Evolution([founder], { ...settings, seed: 'size' });
    const best: number[] = [];
    for (let gen = 0; gen < 6; gen++) {
      await evo.evaluate(inProcess);
      best.push(evo.best().fitness!);
      evo.advance();
    }
    for (let k = 1; k < best.length; k++) expect(best[k]).toBeGreaterThanOrEqual(best[k - 1]);
  });

  it('is reproducible: same settings and seed → same lineage', async () => {
    const run = async () => {
      const evo = new Evolution([randomFounder(new Rng(5))], { ...settings, seed: 'repro' });
      for (let gen = 0; gen < 3; gen++) { await evo.evaluate(inProcess); evo.advance(); }
      return evo.population.map((i) => i.hash);
    };
    expect(await run()).toEqual(await run());
  });

  it('records a phylogeny with parents and mutation logs', async () => {
    const evo = new Evolution([randomFounder(new Rng(5))], { ...settings, seed: 'phylo' });
    await evo.evaluate(inProcess);
    evo.advance();
    for (const ind of evo.population.slice(settings.populationSize > 2 ? 2 : 0)) {
      expect(ind.parents.length).toBeGreaterThan(0);
      for (const p of ind.parents) expect(evo.history.has(p)).toBe(true);
    }
  });
});

describe('locked genes', () => {
  it('mutation never touches a locked gene', () => {
    const g = frenchFlag();
    const lockedNames = ['S', 'M', 'B']; // their inputs come only from locked genes
    const locked = lockedNames.map((n) => geneId(g, n));
    const settings = { ...DEFAULT_MUTATION, locked, rates: Object.fromEntries(Object.entries(DEFAULT_MUTATION.rates).map(([k, v]) => [k, v * 4])) as unknown as typeof DEFAULT_MUTATION.rates };
    const rng = new Rng('lock');
    let cur = g;
    for (let i = 0; i < 400; i++) cur = mutate(cur, rng, settings).genome;
    for (const id of locked) expect(cur.genes.find((x) => x.id === id)).toEqual(g.genes.find((x) => x.id === id));
  });
});
