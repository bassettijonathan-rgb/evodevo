/**
 * M2: Wolpert's French flag — three fates from one gradient (Wolpert 1969).
 */
import { describe, expect, it } from 'vitest';
import type { Embryo } from '../../src/core/sim/develop';
import { develop, latticeTissue } from '../../src/core/sim/develop';
import { frenchFlag, frenchFlagEmbryo } from '../../src/presets/patterning';

type Fate = 'B' | 'W' | 'R' | '?';

/** Fate of cell c: the read-out gene (B, W, R at indices 2..4) that is clearly on, or '?'. */
function fate(e: Embryo, c: number): Fate {
  const G = e.grn.G;
  const x = e.cells.x.subarray(c * G, (c + 1) * G);
  const best = [2, 3, 4].reduce((a, b) => (x[b] > x[a] ? b : a));
  return x[best] < 0.5 ? '?' : (['B', 'W', 'R'][best - 2] as Fate);
}

function growFlagTissue(length: number, feedback?: number) {
  return develop(frenchFlag({ feedback }), {
    initial: { kind: 'tissue', frozen: true, cells: latticeTissue(length, 16, (i) => (i === 0 ? { 0: 1 } : undefined)) },
    config: { gridNx: length, gridNy: 16, recordEvery: 0 },
    tEnd: 2000,
  });
}

/** Fates along each row of a frozen lattice tissue (cells were added row by row). */
function rows(e: Embryo, length: number, height: number): Fate[][] {
  return Array.from({ length: height }, (_, j) => Array.from({ length }, (_, i) => fate(e, j * length + i)));
}

describe('French flag, version 1: fixed tissue with a source column', () => {
  const L = 64;
  const e = growFlagTissue(L);
  const flag = rows(e, L, 16);

  it('every row reads blue → white → red as three contiguous bands', () => {
    for (const row of flag) {
      const runs = row.join('').replace(/(.)\1*/g, '$1'); // collapse runs
      expect(runs).toBe('BWR');
    }
  });

  it('each band covers at least 20% of the axis', () => {
    for (const row of flag) for (const f of ['B', 'W', 'R']) expect(row.filter((x) => x === f).length).toBeGreaterThanOrEqual(0.2 * L);
  });

  /** Cells per row where no read-out gene is clearly on alone (top < 0.9 or runner-up > 0.1). */
  function mixedPerRow(emb: Embryo, j: number): number {
    const G = emb.grn.G;
    let mixed = 0;
    for (let i = 0; i < L; i++) {
      const x = Array.from(emb.cells.x.subarray((j * L + i) * G + 2, (j * L + i) * G + 5)).sort((a, b) => b - a);
      if (x[0] < 0.9 || x[1] > 0.1) mixed++;
    }
    return mixed;
  }

  it('boundaries are sharp: at most 2 cells of mixed expression per boundary', () => {
    for (let j = 0; j < 16; j++) expect(mixedPerRow(e, j)).toBeLessThanOrEqual(4); // two boundaries × 2 cells
  });

  it('contrast: a pure threshold read-out (no self-activation) gives broad, leaky boundaries', () => {
    const plain = growFlagTissue(L, 0);
    for (let j = 0; j < 16; j++) expect(mixedPerRow(plain, j)).toBeGreaterThan(20);
  });

  it('documents a known limitation: absolute thresholds do not scale with tissue size', () => {
    // Wolpert's model reads absolute concentrations, so doubling the tissue keeps
    // the blue band the same absolute width instead of a third of the axis. Real
    // embryos solve this with scaling mechanisms (e.g. expansion–repression).
    const big = rows(growFlagTissue(2 * L), 2 * L, 16)[8];
    const blueSmall = flag[8].filter((x) => x === 'B').length;
    const blueBig = big.filter((x) => x === 'B').length;
    expect(Math.abs(blueBig - blueSmall)).toBeLessThanOrEqual(2);
  });
});

describe('French flag, version 2: grown from a zygote with an asymmetric maternal determinant', () => {
  const seeds = [1, 2, 3, 4, 5];
  const embryos = seeds.map((seed) =>
    develop(frenchFlagEmbryo(), {
      seed,
      config: { gridNx: 64, gridNy: 64, maxCells: 160, recordEvery: 0, divisionJitter: 0.8 },
      tEnd: 400,
    }),
  );

  it('the determinant ends up in a single organiser cell at the +polarity pole', () => {
    for (const e of embryos) {
      const G = e.grn.G;
      const sCells = Array.from({ length: e.cells.n }, (_, c) => c).filter((c) => e.cells.x[c * G] > 0.5);
      expect(sCells.length).toBe(1);
      let meanX = 0;
      for (let c = 0; c < e.cells.n; c++) meanX += e.cells.px[c] / e.cells.n;
      expect(e.cells.px[sCells[0]] - meanX).toBeGreaterThan(4);
    }
  });

  it('fates are ordered blue < white < red by distance from the organiser, each ≥ 20%, none undecided', () => {
    for (const e of embryos) {
      const G = e.grn.G;
      let src = 0;
      for (let c = 0; c < e.cells.n; c++) if (e.cells.x[c * G] > e.cells.x[src * G]) src = c;
      const dist: Record<Fate, number[]> = { B: [], W: [], R: [], '?': [] };
      for (let c = 0; c < e.cells.n; c++) {
        dist[fate(e, c)].push(Math.hypot(e.cells.px[c] - e.cells.px[src], e.cells.py[c] - e.cells.py[src]));
      }
      const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
      expect(dist['?'].length).toBe(0);
      for (const f of ['B', 'W', 'R'] as Fate[]) expect(dist[f].length).toBeGreaterThanOrEqual(0.2 * e.cells.n);
      expect(mean(dist.B)).toBeLessThan(mean(dist.W));
      expect(mean(dist.W)).toBeLessThan(mean(dist.R));
    }
  });

  it('fates are spatially coherent: most cells share the fate of their neighbours', () => {
    for (const e of embryos) {
      let agree = 0;
      const n = e.cells.n;
      for (let c = 0; c < n; c++) {
        const counts: Record<string, number> = {};
        for (let d = 0; d < n; d++) {
          if (d === c || Math.hypot(e.cells.px[c] - e.cells.px[d], e.cells.py[c] - e.cells.py[d]) > 1.2) continue;
          counts[fate(e, d)] = (counts[fate(e, d)] ?? 0) + 1;
        }
        const major = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (major === fate(e, c)) agree++;
      }
      expect(agree / n).toBeGreaterThan(0.8);
    }
  });
});
