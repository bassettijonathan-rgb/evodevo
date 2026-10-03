import { describe, expect, it } from 'vitest';
import { MorphogenGrid } from '../../src/core/sim/morphogens';
import { Rng } from '../../src/core/rng';

describe('morphogen grid', () => {
  it('conserves mass exactly with zero-flux boundaries and no decay', () => {
    const g = new MorphogenGrid(40, 30, 1, 1);
    const r = new Rng(3);
    for (let k = 0; k < 50; k++) g.deposit(0, r.range(0, 39), r.range(0, 29), r.range(0, 2));
    const m0 = g.total(0);
    for (let s = 0; s < 500; s++) g.diffuse(0, 2.5, 0, 0.1, 0.2);
    expect(Math.abs(g.total(0) - m0) / m0).toBeLessThan(1e-12);
  });

  it('spreads a point source with variance ⟨r²⟩ = 4Dt (exact for the FTCS scheme)', () => {
    const g = new MorphogenGrid(101, 101, 1, 1);
    g.deposit(0, 50, 50, 1);
    const D = 0.7, dt = 0.1, steps = 400;
    for (let s = 0; s < steps; s++) g.diffuse(0, D, 0, dt, 0.2);
    const f = g.field(0);
    let m = 0, r2 = 0;
    for (let j = 0; j < 101; j++) for (let i = 0; i < 101; i++) {
      m += f[j * 101 + i];
      r2 += f[j * 101 + i] * ((i - 50) ** 2 + (j - 50) ** 2);
    }
    expect(Math.abs(r2 / m - 4 * D * dt * steps) / (4 * D * dt * steps)).toBeLessThan(1e-9);
  });

  it('decays exactly as e^{−kt} for a uniform field', () => {
    const g = new MorphogenGrid(8, 8, 1, 1);
    g.field(0).fill(2);
    for (let s = 0; s < 100; s++) g.diffuse(0, 1, 0.05, 0.1, 0.2);
    expect(g.field(0)[27]).toBeCloseTo(2 * Math.exp(-0.05 * 10), 12);
  });

  it('sub-steps keep large diffusion coefficients stable', () => {
    const g = new MorphogenGrid(32, 32, 1, 1);
    g.deposit(0, 16, 16, 100);
    expect(g.substepsFor(50, 0.1, 0.2)).toBe(25);
    for (let s = 0; s < 100; s++) g.diffuse(0, 50, 0.01, 0.1, 0.2);
    const f = g.field(0);
    expect(Math.min(...f)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...f)).toBeLessThan(0.2); // smoothed out, no checkerboard blow-up
  });

  it('deposit is the transpose of sampling; gradient is exact on a linear field', () => {
    const g = new MorphogenGrid(10, 10, 0.5, 2);
    g.deposit(0, 1.3, 2.1, 0.75);
    expect(g.total(0)).toBeCloseTo(0.75, 14);
    const f = g.field(1);
    for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) f[j * 10 + i] = 3 * i * 0.5 - 2 * j * 0.5 + 1;
    expect(g.sample(1, 1.7, 3.3)).toBeCloseTo(3 * 1.7 - 2 * 3.3 + 1, 12);
    const grad = [0, 0];
    g.gradient(1, 2.2, 1.1, grad);
    expect(grad[0]).toBeCloseTo(3, 12);
    expect(grad[1]).toBeCloseTo(-2, 12);
  });
});
