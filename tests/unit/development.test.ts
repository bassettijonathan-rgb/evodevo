import { describe, expect, it } from 'vitest';
import { buildGenome, geneId } from '../../src/core/genome/builder';
import { principalAxes } from '../../src/core/metrics/shape';
import { develop, Embryo, latticeTissue } from '../../src/core/sim/develop';

const small = { gridNx: 64, gridNy: 64, recordEvery: 0 };
const grower = (extra: Parameters<typeof buildGenome>[0] = []) =>
  buildGenome([{ name: 'grow', type: 'effector', effector: 'divide', bias: 8, rate: 1, decay: 1 }, ...extra]);

describe('cell cycle and division', () => {
  it('a constitutive divide effector gives a fixed cycle time of 1/divideRate', () => {
    const e = develop(grower(), { config: { ...small, maxCells: 64 }, tEnd: 40 });
    const born = new Map<number, number>();
    for (const d of e.divisions) for (const id of d.daughters) born.set(id, d.t);
    const cycles = e.divisions.filter((d) => born.has(d.mother)).map((d) => d.t - born.get(d.mother)!);
    expect(cycles.length).toBeGreaterThan(10);
    for (const c of cycles) expect(Math.abs(c - 5)).toBeLessThanOrEqual(0.1 + 1e-9);
  });

  it('never exceeds the cell cap, and reports when the cap held growth back', () => {
    const e = develop(grower(), { config: { ...small, maxCells: 50 }, tEnd: 60 });
    expect(e.cells.n).toBe(50);
    expect(e.stats.peakCells).toBe(50);
    expect(e.stats.cappedSteps).toBeGreaterThan(0);
  });

  /** Mean |cos| between each new sister pair's separation and the x axis. */
  function divisionAlignment(polarity: [number, number]): number {
    const e = new Embryo(grower(), { seed: 4, config: { ...small, maxCells: 32, mechanics: false, zygotePolarity: polarity } });
    let sum = 0, count = 0, seen = 0;
    while (e.cells.n < 32) {
      e.step();
      for (; seen < e.divisions.length; seen++) {
        const [a, b] = e.divisions[seen].daughters.map((id) => e.cells.indexOfId(id));
        const dx = e.cells.px[a] - e.cells.px[b], dy = e.cells.py[a] - e.cells.py[b];
        sum += Math.abs(dx) / Math.hypot(dx, dy);
        count++;
      }
    }
    return sum / count;
  }

  it('divisions are oriented along the polarity vector (control: random when unpolarized)', () => {
    expect(divisionAlignment([1, 0])).toBeGreaterThan(0.97); // jitter 0.2 → small angular spread
    const random = divisionAlignment([0, 0]);
    expect(random).toBeGreaterThan(0.45); // E|cos θ| = 2/π ≈ 0.64 for random directions
    expect(random).toBeLessThan(0.8);
  });

  it('oriented division alone does not elongate a growing tissue: crowded chains buckle', () => {
    // Before crowding, the first few cells form a row along the polarity axis…
    const cfg = { ...small, adhesionBase: 0, motility: 0, zygotePolarity: [1, 0] as [number, number] };
    const early = develop(grower(), { config: { ...cfg, maxCells: 4 }, tEnd: 12, seed: 1 });
    expect(principalAxes(early.cells.px, early.cells.py, early.cells.n).elongation).toBeGreaterThan(2.5);
    // …but a cell inserted into a crowded chain escapes sideways more cheaply than
    // it pushes the whole chain, so by 64 cells the embryo is nearly isotropic.
    // (Real embryos elongate with posterior growth zones or convergent extension.)
    const late = develop(grower(), { config: { ...cfg, maxCells: 64 }, tEnd: 33, seed: 1 });
    expect(principalAxes(late.cells.px, late.cells.py, late.cells.n).elongation).toBeLessThan(2);
  });

  it('surface tension of a cohesive tissue rounds it up despite oriented divisions', () => {
    const e = develop(grower(), { config: { ...small, maxCells: 64, adhesionBase: 0.3, zygotePolarity: [1, 0] }, tEnd: 33, seed: 1 });
    expect(principalAxes(e.cells.px, e.cells.py, e.cells.n).elongation).toBeLessThan(1.5);
  });

  it('asymmetric segregation puts a determinant into the +polarity daughter only', () => {
    const g = grower([{ name: 'P', type: 'tf', bias: -20, decay: 0.01, asymmetry: 1 }]);
    g.maternal[geneId(g, 'P')] = 1;
    const e = new Embryo(g, { config: { ...small, mechanics: false, divisionJitter: 0 } });
    while (e.divisions.length === 0) e.step();
    const G = e.grn.G;
    const [a, b] = [0, 1].map((c) => ({ x: e.cells.px[c], P: e.cells.x[c * G + 1] }));
    const plus = a.x > b.x ? a : b, minus = a.x > b.x ? b : a;
    // The mother's level at division was e^{−λt} (pure decay); the +daughter gets twice that.
    expect(plus.P).toBeCloseTo(2 * Math.exp(-0.01 * e.t), 6);
    expect(minus.P).toBe(0);
  });

  it('founder ids label clones from the 8-cell stage', () => {
    const e = develop(grower(), { config: { ...small, maxCells: 64 }, tEnd: 33 });
    expect(new Set(Array.from(e.cells.founderId.subarray(0, e.cells.n))).size).toBe(8);
  });
});

describe('death and differentiation', () => {
  it('apoptosis removes cells after 1/dieRate of full drive', () => {
    const g = buildGenome([{ name: 'die', type: 'effector', effector: 'die', bias: 10, rate: 50, decay: 50 }]);
    const e = develop(g, { config: small, tEnd: 4.5 });
    expect(e.cells.n).toBe(1);
    e.runUntil(5.5);
    expect(e.cells.n).toBe(0);
    expect(e.stats.deaths).toBe(1);
  });

  it('terminal differentiation stops division for good', () => {
    const g = grower([{ name: 'diff', type: 'effector', effector: 'differentiate', bias: 10, rate: 50, decay: 50 }]);
    const e = develop(g, { config: { ...small, divideRate: 0.1, differentiateRate: 0.15 }, tEnd: 60 });
    // Differentiation (≈6.7τ) wins the race against the first division (10τ).
    expect(e.cells.n).toBe(1);
    expect(e.cells.postmitotic[0]).toBe(1);
  });
});

describe('polarity', () => {
  it('cells polarize up the gradient of a cue morphogen secreted by a source cell', () => {
    const g = buildGenome([
      { name: 'S', type: 'tf', bias: -4, sites: { S: 8 } },
      { name: 'M', type: 'morphogen', bias: -6, sites: { S: 12 }, diffusion: 1, fieldDecay: 0.05, secretion: 1 },
      { name: 'pol', type: 'effector', effector: 'polarize', bias: 6, cue: 'M', cueSign: 1 },
    ]);
    const e = develop(g, {
      initial: { kind: 'tissue', cells: latticeTissue(16, 5, (i) => (i === 0 ? { 0: 1 } : undefined), 10, 30) },
      config: { ...small, mechanics: false, zygotePolarity: [0, 0] },
      tEnd: 60,
    });
    // Toward the source column at x = 10. (The field spreads in 2D around the
    // 5-cell-wide strip, so edge rows also get a y component.)
    let meanPx = 0;
    for (let c = 0; c < e.cells.n; c++) {
      if (e.cells.px[c] <= 11) continue;
      expect(e.cells.polX[c]).toBeLessThan(-0.5);
      meanPx += e.cells.polX[c];
    }
    expect(meanPx / (e.cells.n - 5)).toBeLessThan(-0.85);
  });
});

describe('determinism and recording', () => {
  const g = grower([{ name: 'M', type: 'morphogen', bias: 0, diffusion: 1, fieldDecay: 0.1 }]);
  it('same seed → identical embryo; different seed → different embryo', () => {
    const run = (seed: number) => develop(g, { seed, config: { ...small, maxCells: 40 }, tEnd: 30 });
    const a = run(1), b = run(1), c = run(2);
    expect(Array.from(a.cells.px.subarray(0, a.cells.n))).toEqual(Array.from(b.cells.px.subarray(0, b.cells.n)));
    expect(Array.from(a.grid.c)).toEqual(Array.from(b.grid.c));
    expect(Array.from(a.cells.px.subarray(0, 8))).not.toEqual(Array.from(c.cells.px.subarray(0, 8)));
  });

  it('records frames at the configured interval', () => {
    const e = develop(g, { config: { ...small, maxCells: 40, recordEvery: 10 }, tEnd: 20 });
    expect(e.frames.length).toBe(21);
    const last = e.frames.at(-1)!;
    expect(last.t).toBeCloseTo(20, 9);
    expect(last.n).toBe(e.cells.n);
    expect(last.x.length).toBe(e.cells.n * e.grn.G);
    expect(last.fields.length).toBe(64 * 64);
  });
});
