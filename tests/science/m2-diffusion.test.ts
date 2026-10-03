/**
 * M2: the morphogen grid against the analytic steady state of diffusion with
 * decay from a point source, c(r) = S/(2πD)·K₀(r/L), L = √(D/k).
 */
import { describe, expect, it } from 'vitest';
import { besselK0 } from '../../src/core/analysis/special';
import { MorphogenGrid } from '../../src/core/sim/morphogens';

describe('steady state from a point source', () => {
  it('matches S/(2πD)·K₀(r/L) within 5% for r = 1–5 L', () => {
    const N = 129, mid = 64, D = 1, k = 1 / 64, S = 1, dt = 0.1;
    const L = Math.sqrt(D / k); // 8 cells
    const g = new MorphogenGrid(N, N, 1, 1);
    for (let t = 0; t < 1500; t += dt) {
      g.deposit(0, mid, mid, S * dt);
      g.diffuse(0, D, k, dt, 0.2);
    }
    const f = g.field(0);
    for (const rL of [1, 2, 3, 4, 5]) {
      const r = rL * L;
      // Average the four axis directions.
      const sim = (f[mid * N + mid + r] + f[mid * N + mid - r] + f[(mid + r) * N + mid] + f[(mid - r) * N + mid]) / 4;
      const theory = (S / (2 * Math.PI * D)) * besselK0(r / L);
      expect(Math.abs(sim - theory) / theory).toBeLessThan(0.05);
    }
  });
});
