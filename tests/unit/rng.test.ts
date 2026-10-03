import { describe, expect, it } from 'vitest';
import { Rng, hashHex } from '../../src/core/rng';

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(42), b = new Rng(42), c = new Rng(43);
    const sa = Array.from({ length: 20 }, () => a.nextU32());
    const sb = Array.from({ length: 20 }, () => b.nextU32());
    const sc = Array.from({ length: 20 }, () => c.nextU32());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it('has the right first and second moments', () => {
    const r = new Rng('moments');
    const N = 200_000;
    let su = 0, su2 = 0, sn = 0, sn2 = 0;
    for (let i = 0; i < N; i++) {
      const u = r.float();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      su += u; su2 += u * u;
      const z = r.normal();
      sn += z; sn2 += z * z;
    }
    expect(su / N).toBeCloseTo(0.5, 2);
    expect(su2 / N - (su / N) ** 2).toBeCloseTo(1 / 12, 2);
    expect(sn / N).toBeCloseTo(0, 2);
    expect(sn2 / N).toBeCloseTo(1, 2);
  });

  it('poisson has mean ≈ variance ≈ λ', () => {
    const r = new Rng('poisson');
    const N = 50_000, lam = 2.5;
    let s = 0, s2 = 0;
    for (let i = 0; i < N; i++) { const k = r.poisson(lam); s += k; s2 += k * k; }
    expect(s / N).toBeCloseTo(lam, 1);
    expect(s2 / N - (s / N) ** 2).toBeCloseTo(lam, 1);
  });

  it('fork gives independent streams without advancing the parent', () => {
    const p1 = new Rng(7), p2 = new Rng(7);
    const child = p1.fork('mechanics');
    child.nextU32(); child.nextU32();
    expect(p1.nextU32()).toBe(p2.nextU32());
    expect(new Rng(7).fork('a').nextU32()).not.toBe(new Rng(7).fork('b').nextU32());
    expect(new Rng(7).fork('a').nextU32()).toBe(new Rng(7).fork('a').nextU32());
  });

  it('hashHex is stable', () => {
    expect(hashHex('evodevo')).toBe(hashHex('evodevo'));
    expect(hashHex('evodevo')).not.toBe(hashHex('evodevO'));
    expect(hashHex('x')).toMatch(/^[0-9a-f]{32}$/);
  });
});
