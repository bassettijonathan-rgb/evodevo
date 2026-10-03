import { describe, expect, it } from 'vitest';
import { buildGenome, geneId } from '../../src/core/genome/builder';
import { compileGenome } from '../../src/core/genome/compile';
import { exp, sigmoid } from '../../src/core/math';
import { CellStore } from '../../src/core/sim/cells';
import { stepGRN } from '../../src/core/sim/grn';
import { applyClamps, compileClamps } from '../../src/core/sim/perturb';
import { simulateSingleCell } from '../../src/core/sim/singleCell';
import { autoActivator, constitutive, morphogenReadout, toggleSwitch } from '../../src/presets/circuits';

describe('GRN: single gene', () => {
  it('follows x(t) = x*(1 − e^{−λt}) exactly, with x* = R·σ(b)/λ', () => {
    const [b, R, lam] = [1, 2, 0.5];
    const ts = simulateSingleCell(constitutive(b, R, lam), { tEnd: 40 });
    const xStar = (R * sigmoid(b)) / lam;
    const A = ts.gene('A');
    let worst = 0;
    for (let k = 0; k < ts.length; k++) worst = Math.max(worst, Math.abs(A[k] - xStar * (1 - exp(-lam * ts.t[k]))));
    expect(worst).toBeLessThan(1e-12);
    expect(A[A.length - 1]).toBeCloseTo(xStar, 6);
  });

  it('is exact for any Δt (exponential integrator), not only small ones', () => {
    for (const dt of [0.01, 0.5, 2]) {
      const ts = simulateSingleCell(constitutive(0.3, 1, 1.5), { tEnd: 10, config: { dt } });
      const xStar = sigmoid(0.3) / 1.5;
      const last = ts.length - 1;
      expect(Math.abs(ts.gene('A')[last] - xStar * (1 - exp(-1.5 * ts.t[last])))).toBeLessThan(1e-12);
    }
  });

  it('converges at first order in Δt when inputs change (feedback)', () => {
    const g = autoActivator(8, -4);
    const at = (dt: number) => simulateSingleCell(g, { tEnd: 5, initial: { 0: 0.6 }, config: { dt } }).final()[0];
    const ref = at(1e-4);
    const e1 = Math.abs(at(0.1) - ref);
    const e2 = Math.abs(at(0.05) - ref);
    const e3 = Math.abs(at(0.025) - ref);
    expect(e1 / e2).toBeGreaterThan(1.8);
    expect(e1 / e2).toBeLessThan(2.2);
    expect(e2 / e3).toBeGreaterThan(1.8);
    expect(e2 / e3).toBeLessThan(2.2);
  });
});

describe('GRN: inputs and update order', () => {
  it('sensed morphogen levels drive their targets', () => {
    const g = morphogenReadout(6, -3);
    const M = geneId(g, 'M');
    for (const level of [0, 0.5, 1]) {
      const ts = simulateSingleCell(g, { tEnd: 30, inputs: { [M]: level } });
      expect(ts.gene('T').at(-1)).toBeCloseTo(sigmoid(-3 + 6 * level), 8);
    }
  });

  it('updates synchronously: a target sees its regulator from the previous step', () => {
    const g = buildGenome([
      { name: 'A', type: 'tf', bias: 10 },
      { name: 'B', type: 'tf', bias: -5, sites: { A: 20 } },
    ]);
    const grn = compileGenome(g, 0.1);
    const cells = new CellStore(1, 2);
    cells.add(0, 0, 0.5);
    stepGRN(grn, cells);
    // A was 0 at the start of the step, so B's production used σ(−5), not σ(−5 + 20·A_new).
    const expected = sigmoid(-5) * (1 - exp(-0.1));
    expect(cells.x[1]).toBeCloseTo(expected, 15);
  });

  it('maternal state initialises the zygote', () => {
    const g = toggleSwitch(10);
    g.maternal[0] = 1;
    const ts = simulateSingleCell(g, { tEnd: 0.1 });
    expect(ts.gene('A')[0]).toBe(1);
  });
});

describe('perturbations', () => {
  it('knockout and overexpression clamp the gene and propagate downstream', () => {
    const g = buildGenome([
      { name: 'A', type: 'tf', bias: 0, rate: 3, decay: 1.5 },
      { name: 'B', type: 'tf', bias: -4, sites: { A: 8 } },
    ]);
    const A = geneId(g, 'A');
    const wt = simulateSingleCell(g, { tEnd: 30 }).final();
    const ko = simulateSingleCell(g, { tEnd: 30, perturbations: [{ gene: A, mode: 'knockout' }] }).final();
    const oe = simulateSingleCell(g, { tEnd: 30, perturbations: [{ gene: A, mode: 'overexpress' }] }).final();
    expect(wt[0]).toBeCloseTo(1, 8); // R·σ(0)/λ = 3·0.5/1.5
    expect(ko[0]).toBe(0);
    expect(oe[0]).toBe(2); // R/λ
    expect(ko[1]).toBeCloseTo(sigmoid(-4), 8);
    expect(oe[1]).toBeCloseTo(sigmoid(-4 + 16), 8);
  });

  it('time windows: a transient pulse of B flips a toggle switch permanently (cell memory)', () => {
    const g = toggleSwitch(10);
    const B = geneId(g, 'B');
    const ts = simulateSingleCell(g, {
      tEnd: 120,
      initial: { 0: 1, 1: 0 },
      perturbations: [{ gene: B, mode: 'overexpress', from: 40, until: 50 }],
    });
    const at = (t: number) => Math.round(t / 0.1);
    expect(ts.gene('A')[at(39)]).toBeGreaterThan(0.9);
    expect(ts.gene('A')[at(120)]).toBeLessThan(0.1);
    expect(ts.gene('B')[at(120)]).toBeGreaterThan(0.9);
  });

  it('region-restricted clamps only affect cells inside the disc', () => {
    const g = constitutive(0, 1, 1);
    const grn = compileGenome(g, 0.1);
    const cells = new CellStore(3, 1);
    cells.add(0, 0, 0.5);
    cells.add(5, 0, 0.5);
    cells.add(10, 0, 0.5);
    const clamps = compileClamps(grn, [{ gene: 0, mode: { level: 7 }, region: { x: 5, y: 0, r: 1 } }]);
    applyClamps(clamps, cells, 0);
    expect(Array.from(cells.x)).toEqual([0, 7, 0]);
  });

  it('perturbing a gene absent from the genome is a no-op', () => {
    const grn = compileGenome(constitutive(), 0.1);
    expect(compileClamps(grn, [{ gene: 99, mode: 'knockout' }])).toEqual([]);
  });
});

describe('determinism and noise', () => {
  const g = toggleSwitch(6);
  const run = (seed: number, noise: number) =>
    simulateSingleCell(g, { tEnd: 50, seed, config: { expressionNoise: noise }, initial: { 0: 0.5, 1: 0.5 } }).x;

  it('same seed → identical trajectory', () => {
    expect(run(1, 0.05)).toEqual(run(1, 0.05));
  });
  it('different seed → different trajectory when noise is on', () => {
    expect(run(1, 0.05)).not.toEqual(run(2, 0.05));
  });
  it('noise off → seed is irrelevant', () => {
    expect(run(1, 0)).toEqual(run(2, 0));
  });
  it('noise breaks the symmetric state of a toggle switch into one of the two fates', () => {
    let aWins = 0;
    for (let s = 0; s < 40; s++) {
      const x = simulateSingleCell(g, { tEnd: 80, seed: s, config: { expressionNoise: 0.05 }, initial: { 0: 0.5, 1: 0.5 } }).final();
      expect(Math.abs(x[0] - x[1])).toBeGreaterThan(0.5);
      if (x[0] > x[1]) aWins++;
    }
    // Symmetric circuit: both fates occur.
    expect(aWins).toBeGreaterThan(5);
    expect(aWins).toBeLessThan(35);
  });
});
