/**
 * M1 science validation: classic circuit dynamics, checked against analytic
 * bifurcation theory (see src/presets/circuits.ts for the derivations).
 */
import { describe, expect, it } from 'vitest';
import { oscillationStats } from '../../src/core/analysis/timeseries';
import { geneId } from '../../src/core/genome/builder';
import { simulateSingleCell } from '../../src/core/sim/singleCell';
import { repressilator, toggleSwitch } from '../../src/presets/circuits';

describe('toggle switch (Gardner et al. 2000)', () => {
  const settle = (w: number, a0: number, b0: number) =>
    simulateSingleCell(toggleSwitch(w), { tEnd: 300, initial: { 0: a0, 1: b0 }, config: { dt: 0.05 } }).final();

  it('strong mutual repression is bistable: the initial condition picks the fate', () => {
    const left = settle(10, 0.6, 0.4);
    const right = settle(10, 0.4, 0.6);
    expect(left[0]).toBeGreaterThan(0.95);
    expect(left[1]).toBeLessThan(0.05);
    expect(right[0]).toBeLessThan(0.05);
    expect(right[1]).toBeGreaterThan(0.95);
  });

  it('bistability appears where theory says: loop gain (|w|/4)² = 1 at |w| = 4', () => {
    // Just below the pitchfork: both initial conditions converge to the symmetric state.
    const a = settle(3.6, 0.9, 0.1);
    const b = settle(3.6, 0.1, 0.9);
    expect(Math.abs(a[0] - 0.5)).toBeLessThan(1e-3);
    expect(Math.abs(b[0] - 0.5)).toBeLessThan(1e-3);
    // Just above: two distinct asymmetric states.
    const c = settle(4.4, 0.6, 0.4);
    const d = settle(4.4, 0.4, 0.6);
    expect(c[0] - c[1]).toBeGreaterThan(0.2);
    expect(d[1] - d[0]).toBeGreaterThan(0.2);
  });
});

describe('repressilator (Elowitz & Leibler 2000)', () => {
  const run = (w: number, tEnd: number, extra: Parameters<typeof simulateSingleCell>[1] = { tEnd }) =>
    simulateSingleCell(repressilator(w), {
      ...extra,
      tEnd,
      initial: { 0: 0.6, 1: 0.5, 2: 0.4 },
      config: { dt: 0.01 },
      recordEvery: 5,
    });

  it('sustains oscillation with a stable period above the Hopf point', () => {
    const ts = run(10, 200);
    const s = oscillationStats(ts.t, ts.gene('A'), 100);
    expect(s.peaks).toBeGreaterThanOrEqual(10);
    expect(s.periodCV).toBeLessThan(0.02);
    expect(s.amplitude).toBeGreaterThan(0.3);
    // Amplitude does not decay: last 50τ vs the 50τ before.
    const late = oscillationStats(ts.t, ts.gene('A'), 150).amplitude;
    expect(late / s.amplitude).toBeGreaterThan(0.98);
  });

  it('the Hopf bifurcation sits at |w| = 8 as predicted (per-stage gain = sec(π/3) = 2)', () => {
    const below = run(7.5, 400);
    expect(oscillationStats(below.t, below.gene('A'), 350).amplitude).toBeLessThan(1e-4);
    const above = run(8.5, 400);
    expect(oscillationStats(above.t, above.gene('A'), 350).amplitude).toBeGreaterThan(0.05);
  });

  it('near onset the period approaches 2π/(λ·tan(π/3)) = 2π/√3 ≈ 3.63', () => {
    const ts = run(8.2, 600);
    const s = oscillationStats(ts.t, ts.gene('A'), 450);
    const predicted = (2 * Math.PI) / Math.sqrt(3);
    expect(Math.abs(s.period - predicted) / predicted).toBeLessThan(0.05);
  });

  it('knocking out one gene breaks the loop and stops the clock (control)', () => {
    const g = repressilator(10);
    const ts = run(10, 200, { tEnd: 200, perturbations: [{ gene: geneId(g, 'C'), mode: 'knockout' }] });
    expect(oscillationStats(ts.t, ts.gene('A'), 100).amplitude).toBeLessThan(1e-6);
  });
});
