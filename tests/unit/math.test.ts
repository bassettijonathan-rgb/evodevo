import { describe, expect, it } from 'vitest';
import { exp, log, sigmoid } from '../../src/core/math';

const relErr = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('portable math', () => {
  it('exp matches Math.exp to a few ulp across the working range', () => {
    let worst = 0;
    for (let x = -700; x <= 700; x += 0.137) worst = Math.max(worst, relErr(exp(x), Math.exp(x)));
    for (let x = -5; x <= 5; x += 0.000731) worst = Math.max(worst, relErr(exp(x), Math.exp(x)));
    expect(worst).toBeLessThan(1e-15);
  });

  it('exp edge cases', () => {
    expect(exp(0)).toBe(1);
    expect(exp(1)).toBeCloseTo(Math.E, 15);
    expect(exp(-1000)).toBe(0);
    expect(exp(1000)).toBe(Infinity);
    expect(exp(NaN)).toBeNaN();
  });

  it('log matches Math.log and inverts exp', () => {
    let worst = 0;
    for (let x = 1e-300; x < 1e300; x *= 1.37) worst = Math.max(worst, Math.abs(log(x) - Math.log(x)) / Math.max(1, Math.abs(Math.log(x))));
    for (let x = 0.01; x < 3; x += 0.00113) worst = Math.max(worst, Math.abs(log(x) - Math.log(x)));
    expect(worst).toBeLessThan(1e-15);
    expect(log(1)).toBe(0);
    expect(log(5e-324)).toBeCloseTo(Math.log(5e-324), 10); // subnormal
    for (const x of [-3, 0.5, 7.25]) expect(log(exp(x))).toBeCloseTo(x, 14);
  });

  it('sigmoid is a logistic with σ(0)=½ and σ(−u)=1−σ(u)', () => {
    expect(sigmoid(0)).toBe(0.5);
    for (const u of [-30, -3, -0.2, 0.7, 4, 25]) {
      expect(sigmoid(-u)).toBeCloseTo(1 - sigmoid(u), 15);
      expect(sigmoid(u)).toBeCloseTo(1 / (1 + Math.exp(-u)), 15);
    }
    expect(sigmoid(-1e6)).toBe(0);
    expect(sigmoid(1e6)).toBe(1);
  });
});
