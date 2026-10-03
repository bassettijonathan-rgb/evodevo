/**
 * M2: Turing patterns from an activator–inhibitor gene pair, checked against
 * linear stability theory (src/core/analysis/turing.ts) and Ermentrout's
 * spots-vs-stripes criterion.
 */
import { describe, expect, it } from 'vitest';
import { classifyPattern } from '../../src/core/analysis/patterns';
import { dominantWavelength } from '../../src/core/analysis/spectrum';
import { homogeneousSteadyState, predictTuring } from '../../src/core/analysis/turing';
import { compileGenome } from '../../src/core/genome/compile';
import { Rng } from '../../src/core/rng';
import { Embryo, latticeTissue } from '../../src/core/sim/develop';
import { turingPair, turingSteadyGuess, type TuringParams } from '../../src/presets/patterning';

const N = 64;

function analyse(params: Partial<TuringParams>) {
  const grn = compileGenome(turingPair(params), 0.1);
  const guess = turingSteadyGuess(params);
  const state = homogeneousSteadyState(grn, 1, guess.x, guess.c);
  return { state, prediction: predictTuring(grn, state) };
}

/** A frozen N×N tissue at the homogeneous steady state plus 2% noise in the activator gene. */
function tissue(params: Partial<TuringParams>, seed = 1): Embryo {
  const { state } = analyse(params);
  const rng = new Rng(`turing-${seed}`);
  const e = new Embryo(turingPair(params), {
    initial: {
      kind: 'tissue', frozen: true,
      cells: latticeTissue(N, N, () => ({ 0: state.x[0] * (1 + 0.02 * rng.normal()), 1: state.x[1] })),
    },
    config: { gridNx: N, gridNy: N, recordEvery: 0 },
  });
  e.grid.field(0).fill(state.c[0]);
  e.grid.field(1).fill(state.c[1]);
  return e;
}

function variance(f: Float64Array): number {
  let m = 0;
  for (const v of f) m += v;
  m /= f.length;
  let s = 0;
  for (const v of f) s += (v - m) ** 2;
  return s / f.length;
}

describe('linear stability analysis', () => {
  it('the designed genome has its homogeneous steady state where intended and is Turing-unstable', () => {
    for (const p of [0.35, 0.5, 0.65]) {
      const { state, prediction } = analyse({ operatingPoint: p });
      expect(state.residual).toBeLessThan(1e-12);
      expect(state.x[0]).toBeCloseTo(p, 10);
      expect(state.c[0]).toBeCloseTo(1, 10);
      expect(prediction.turingUnstable).toBe(true);
      expect(prediction.uniformRate).toBeLessThan(-0.03);
    }
  });

  it('control: equal diffusion coefficients give no instability (Turing needs D_H ≫ D_A)', () => {
    expect(analyse({ dA: 1, dH: 1 }).prediction.turingUnstable).toBe(false);
  });
});

describe('simulated patterns', () => {
  const stripes = tissue({ operatingPoint: 0.5 });
  const spots = tissue({ operatingPoint: 0.35 });
  const holes = tissue({ operatingPoint: 0.65 });
  const predicted = analyse({ operatingPoint: 0.5 }).prediction;

  it('perturbations grow at the predicted rate in the linear regime', () => {
    stripes.runUntil(100);
    const v100 = variance(stripes.grid.field(0));
    stripes.runUntil(200);
    const v200 = variance(stripes.grid.field(0));
    const measured = Math.log(v200 / v100) / (2 * 100); // variance ∝ amplitude²
    expect(Math.abs(measured - predicted.maxRate) / predicted.maxRate).toBeLessThan(0.25);
  });

  it('the dominant wavelength matches linear theory (within 15% once patterned)', () => {
    stripes.runUntil(400);
    const lambda = dominantWavelength(stripes.grid.field(0), N);
    expect(Math.abs(lambda - predicted.wavelength) / predicted.wavelength).toBeLessThan(0.15);
  });

  it('activator at the sigmoid inflection point (no quadratic term) → stripes', () => {
    stripes.runUntil(800);
    const s = classifyPattern(stripes.grid.field(0), N, N);
    expect(s.kind).toBe('stripes');
    expect(s.contrast).toBeGreaterThan(1);
  });

  it('activator below the inflection point → spots of high activator', () => {
    spots.runUntil(800);
    expect(classifyPattern(spots.grid.field(0), N, N).kind).toBe('spots');
  });

  it('activator above the inflection point → the opposite phase: spots of LOW activator', () => {
    holes.runUntil(800);
    const f = holes.grid.field(0);
    expect(classifyPattern(f.map((v) => -v), N, N).kind).toBe('spots');
    expect(classifyPattern(f, N, N).kind).not.toBe('spots');
  });

  it('control: equal diffusion coefficients stay homogeneous in simulation too', () => {
    const flat = tissue({ operatingPoint: 0.5, dA: 1, dH: 1 });
    flat.runUntil(400);
    expect(classifyPattern(flat.grid.field(0), N, N).kind).toBe('none');
  });
});
