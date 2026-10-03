/**
 * M3: differential adhesion (Steinberg 1963) and lateral inhibition (Collier et al. 1996).
 */
import { describe, expect, it } from 'vitest';
import { eigenvalues } from '../../src/core/analysis/linalg';
import { homogeneousSteadyState, jacobian } from '../../src/core/analysis/turing';
import { compileGenome } from '../../src/core/genome/compile';
import type { Genome } from '../../src/core/genome/types';
import { aggregates, homotypicFraction, neighbours, surfaceCells } from '../../src/core/metrics/tissue';
import { Rng } from '../../src/core/rng';
import { develop, hexDisc, latticeTissue, type Embryo } from '../../src/core/sim/develop';
import { lateralInhibition, sortingPair } from '../../src/presets/patterning';

/** A 400-cell aggregate with cell types assigned at random (50/50), then left to move. */
function mixAndWait(genome: Genome, seed: number, motility: number, tEnd: number): Embryo {
  const rng = new Rng(`mix-${seed}`);
  return develop(genome, {
    seed,
    initial: { kind: 'tissue', cells: hexDisc(400, 32, 32, () => ({ 0: rng.float() < 0.5 ? 1 : 0 })) },
    config: { gridNx: 64, gridNy: 64, recordEvery: 0, motility },
    tEnd,
  });
}

function sortingStats(e: Embryo) {
  const G = e.grn.G;
  const isT = (c: number) => (e.cells.x[c * G] > 0.5 ? 1 : 0);
  const nbrs = neighbours(e.cells);
  const main = aggregates(nbrs)[0];
  const surface = surfaceCells(nbrs, main);
  const fracNonT = (list: number[]) => list.filter((c) => !isT(c)).length / list.length;
  return {
    homotypic: homotypicFraction(nbrs, isT),
    /** Share of non-T (low-adhesion) cells on the aggregate surface minus their share in the aggregate. */
    surfaceEnrichment: fracNonT(surface) - fracNonT(main),
  };
}

describe('differential adhesion: cell sorting from a random mix', () => {
  const seeds = [1, 2, 3];

  it('different cadherins: the mix segregates (homotypic contacts 0.5 → > 0.8)', () => {
    for (const seed of seeds) {
      const start = sortingStats(mixAndWait(sortingPair(), seed, 0.03, 0.1));
      const end = sortingStats(mixAndWait(sortingPair(), seed, 0.03, 600));
      expect(start.homotypic).toBeLessThan(0.55);
      expect(end.homotypic).toBeGreaterThan(0.8);
    }
  });

  it('same cadherin, different amounts: low expressers coat the surface (Steinberg & Takeichi 1994)', () => {
    // Levels 1 vs 0.2, binding 2: saturated adhesion ≈ 1.16 (high–high) vs 0.62 (low–low and high–low).
    // Within 1000τ the high expressers cluster and the low expressers take the surface;
    // coarsening into a single central core is slower than that.
    for (const seed of seeds) {
      const s = sortingStats(mixAndWait(sortingPair({ sameCadherin: true, lowLevel: 0.2, binding: 2 }), seed, 0.05, 1000));
      expect(s.homotypic).toBeGreaterThan(0.65);
      expect(s.surfaceEnrichment).toBeGreaterThan(0.15);
    }
  });

  it('control: identical adhesion does not sort and does not layer', () => {
    for (const seed of seeds) {
      const s = sortingStats(mixAndWait(sortingPair({ identical: true, binding: 2 }), seed, 0.05, 1000));
      expect(s.homotypic).toBeLessThan(0.55);
      expect(Math.abs(s.surfaceEnrichment)).toBeLessThan(0.1);
    }
  });
});

describe('lateral inhibition (Delta–Notch)', () => {
  const N = 24;
  function sheet(w: number) {
    const rng = new Rng(`li-${w}`);
    const e = develop(lateralInhibition({ w }), {
      initial: { kind: 'tissue', frozen: true, cells: latticeTissue(N, N, () => ({ 0: 0.5 + 0.02 * rng.normal(), 1: 0.5 })) },
      config: { gridNx: 32, gridNy: 32, recordEvery: 0 },
      tEnd: 200,
    });
    const G = e.grn.G;
    const dl = (i: number, j: number) => e.cells.x[(j * N + i) * G];
    let opposite = 0, pairs = 0, lo = Infinity, hi = -Infinity;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        lo = Math.min(lo, dl(i, j)); hi = Math.max(hi, dl(i, j));
        for (const [a, b] of [[i + 1, j], [i, j + 1]]) {
          if (a >= N || b >= N) continue;
          pairs++;
          if (dl(i, j) > 0.5 !== dl(a, b) > 0.5) opposite++;
        }
      }
    }
    return { opposite: opposite / pairs, range: hi - lo };
  }

  /** Growth rate of the uniform (κ = 1) and checkerboard (κ = −1) modes on the square lattice. */
  function modeRates(w: number) {
    const grn = compileGenome(lateralInhibition({ w }), 0.1);
    const s = homogeneousSteadyState(grn, 1, [0.5, 0.5]);
    const rate = (kappa: number) => Math.max(...eigenvalues(jacobian(grn, s, 0, kappa)).map((e) => e.re));
    return { uniform: rate(1), checker: rate(-1) };
  }

  it('linear theory: the checkerboard mode destabilises at w = 4 (rate = w/4 − 1); the uniform mode never does', () => {
    for (const w of [3, 5, 12]) {
      const r = modeRates(w);
      expect(r.uniform).toBeLessThan(0);
      expect(r.checker).toBeCloseTo(w / 4 - 1, 9);
    }
  });

  it('below threshold (w = 3) the noise dies out; above it a salt-and-pepper pattern forms', () => {
    expect(sheet(3).range).toBeLessThan(0.01);
    expect(sheet(5).range).toBeGreaterThan(0.5);
    const strong = sheet(12);
    expect(strong.range).toBeGreaterThan(0.95);
    expect(strong.opposite).toBeGreaterThan(0.9); // neighbours in opposite fates (checkerboard with a few defects)
  });
});
