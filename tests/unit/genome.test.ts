import { describe, expect, it } from 'vitest';
import { buildGenome, geneId } from '../../src/core/genome/builder';
import { compileGenome } from '../../src/core/genome/compile';
import { cloneGenome, genomeFromJSON, genomeHash, genomeToJSON } from '../../src/core/genome/serialize';
import { validateGenome } from '../../src/core/genome/validate';
import { exp } from '../../src/core/math';

const sample = () =>
  buildGenome(
    [
      { name: 'bcd', type: 'tf', bias: -1, rate: 2, decay: 0.5 },
      { name: 'dpp', type: 'morphogen', diffusion: 2, secretion: 0.5, fieldDecay: 0.05, sites: { bcd: 3 } },
      { name: 'cad', type: 'adhesion', binding: 1.5, sites: { dpp: 2 } },
      { name: 'grow', type: 'effector', effector: 'divide', sites: { bcd: 4, cad: 9 } },
      { name: 'pol', type: 'effector', effector: 'polarize', cue: 'dpp', cueSign: -1 },
    ],
    { bcd: 1.25 },
  );

describe('genome', () => {
  it('builder assigns ids and resolves names', () => {
    const g = sample();
    expect(g.genes.map((x) => x.id)).toEqual([0, 1, 2, 3, 4]);
    expect(geneId(g, 'dpp')).toBe(1);
    expect(g.genes[3].sites).toEqual([{ regulator: 0, weight: 4 }, { regulator: 2, weight: 9 }]);
    expect(g.maternal[0]).toBe(1.25);
    expect(g.nextGeneId).toBe(5);
    expect(validateGenome(g)).toEqual([]);
  });

  it('validation catches broken invariants', () => {
    const g = sample();
    g.genes[2].sites.push({ regulator: 99, weight: 1 });
    g.genes[0].decay = 0;
    g.genes[1].fieldDecay = undefined;
    g.maternal[42] = 1;
    const errs = validateGenome(g).join('\n');
    expect(errs).toMatch(/missing gene 99/);
    expect(errs).toMatch(/decay must be > 0/);
    expect(errs).toMatch(/fieldDecay/);
    expect(errs).toMatch(/maternal entry for missing gene 42/);
  });

  it('validation enforces config limits', () => {
    const errs = validateGenome(sample(), { maxGenes: 3, maxMorphogens: 0 });
    expect(errs.length).toBe(2);
  });

  it('JSON round-trips exactly and the hash is canonical', () => {
    const g = sample();
    const back = genomeFromJSON(genomeToJSON(g));
    expect(back).toEqual(g);
    expect(genomeHash(back)).toBe(genomeHash(g));
    // Key order of the source object must not matter.
    const reordered = JSON.parse(genomeToJSON(g));
    reordered.genes = reordered.genes.map((x: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(x).reverse()),
    );
    expect(genomeHash(genomeFromJSON(JSON.stringify(reordered)))).toBe(genomeHash(g));
    // Any change changes the hash.
    const mutated = cloneGenome(g);
    mutated.genes[3].sites[0].weight += 1e-9;
    expect(genomeHash(mutated)).not.toBe(genomeHash(g));
  });

  it('compiles to CSR, dropping edges from non-regulators', () => {
    const grn = compileGenome(sample(), 0.1);
    expect(grn.G).toBe(5);
    // Gene "grow" had sites on bcd (tf, kept) and cad (adhesion, dropped as inert).
    const row = (i: number) => Array.from(grn.col.slice(grn.rowPtr[i], grn.rowPtr[i + 1]));
    expect(row(3)).toEqual([0]);
    expect(row(2)).toEqual([1]); // dpp is a morphogen → a valid regulator
    expect(Array.from(grn.morphIdx)).toEqual([1]);
    expect(Array.from(grn.adhIdx)).toEqual([2]);
    expect(Array.from(grn.effIdx.divide)).toEqual([3]);
    expect(Array.from(grn.effIdx.polarize)).toEqual([4]);
    expect(grn.cueIdx[4]).toBe(1);
    expect(grn.cueSign[4]).toBe(-1);
    expect(grn.sensed[1]).toBe(1);
    expect(grn.sensed[0]).toBe(0);
    expect(grn.maxLevel[0]).toBe(4);
    expect(grn.expDecay[0]).toBe(exp(-0.05));
    expect(grn.maternal[0]).toBe(1.25);
  });

  it('a polarity cue pointing at a non-morphogen is inert', () => {
    const g = sample();
    g.genes[4].cue = 0; // bcd is a TF
    expect(compileGenome(g, 0.1).cueIdx[4]).toBe(-1);
  });
});
