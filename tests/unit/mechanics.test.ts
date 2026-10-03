import { describe, expect, it } from 'vitest';
import { buildGenome } from '../../src/core/genome/builder';
import { compileGenome } from '../../src/core/genome/compile';
import { makeConfig } from '../../src/core/config';
import { Rng } from '../../src/core/rng';
import { CellStore } from '../../src/core/sim/cells';
import { develop, hexDisc } from '../../src/core/sim/develop';
import { Mechanics } from '../../src/core/sim/mechanics';

const cadherin = (level: number) =>
  buildGenome([{ name: 'cad', type: 'adhesion', binding: 1.5, bias: Math.log(level / (1 - level)) }]);

describe('mechanics', () => {
  it('two adhering cells relax to the analytic overlap δ* = A/k_rep', () => {
    for (const level of [0.2, 0.8]) {
      const e = develop(cadherin(level), {
        initial: { kind: 'tissue', cells: [{ x: 30, y: 30, state: { 0: level } }, { x: 31.1, y: 30, state: { 0: level } }] },
        config: { gridNx: 64, gridNy: 64, recordEvery: 0, motility: 0 },
        tEnd: 30,
      });
      const d = Math.hypot(e.cells.px[1] - e.cells.px[0], e.cells.py[1] - e.cells.py[0]);
      const A = e.config.adhesionBase + 1.5 * level;
      expect(1 - d).toBeCloseTo(A / e.config.repulsion, 6);
    }
  });

  it('without noise, a random packing relaxes with non-increasing energy', () => {
    const cfg = makeConfig({ motility: 0 });
    const grn = compileGenome(cadherin(0.5), cfg.dt);
    const cells = new CellStore(200, 1);
    const rng = new Rng(9);
    for (let k = 0; k < 150; k++) {
      const c = cells.add(20 + rng.range(0, 10), 20 + rng.range(0, 10), 0.5);
      cells.x[c] = 0.5;
    }
    const mech = new Mechanics(cfg, 63, 63);
    let prev = mech.energy(grn, cells);
    const start = prev;
    for (let s = 0; s < 300; s++) {
      mech.step(grn, cells, rng);
      const E = mech.energy(grn, cells);
      expect(E).toBeLessThanOrEqual(prev + 1e-9 * Math.abs(prev));
      prev = E;
    }
    expect(prev).toBeLessThan(start);
  });

  it('contact signals average the neighbours and exclude the cell itself', () => {
    const g = buildGenome([{ name: 'Dl', type: 'contact', binding: 2 }]);
    const cfg = makeConfig();
    const grn = compileGenome(g, cfg.dt);
    const cells = new CellStore(4, 1);
    // A row: 0 – 1 – 2 touching, 3 far away.
    [[10, 10, 1], [11, 10, 3], [12, 10, 5], [30, 30, 7]].forEach(([x, y, v]) => { cells.x[cells.add(x, y, 0.5)] = v; });
    new Mechanics(cfg, 63, 63).contactInputs(grn, cells);
    expect(Array.from(cells.input)).toEqual([2 * 3, 2 * (1 + 5) / 2, 2 * 3, 0]);
  });

  it('hexDisc packs n cells around a centre', () => {
    const cells = hexDisc(100, 32, 32);
    expect(cells.length).toBe(100);
    const r = Math.max(...cells.map((c) => Math.hypot(c.x - 32, c.y - 32)));
    expect(r).toBeLessThan(6);
  });
});
