import { describe, expect, it } from 'vitest';
import { geneId } from '../../src/core/genome/builder';
import { compareToWildType } from '../../src/core/metrics/compare';
import { develop, latticeTissue } from '../../src/core/sim/develop';
import type { Perturbation } from '../../src/core/sim/perturb';
import { frenchFlag } from '../../src/presets/patterning';

describe('homeotic-transformation detector', () => {
  const g = frenchFlag();
  const grow = (perturbations: Perturbation[] = []) => {
    const e = develop(g, {
      initial: { kind: 'tissue', frozen: true, cells: latticeTissue(64, 4, (i) => (i === 0 ? { 0: 1 } : undefined)) },
      config: { gridNx: 64, gridNy: 4, recordEvery: 0 },
      tEnd: 1500,
      perturbations,
    });
    return { n: e.cells.n, px: e.cells.px, py: e.cells.py, x: e.cells.x, grn: e.grn };
  };
  const wt = grow();

  it('knocking out Blue turns the blue band white: a transformation into another wild-type fate', () => {
    const B = geneId(g, 'B');
    const ko = grow([{ gene: B, mode: 'knockout' }]);
    const c = compareToWildType(wt, ko, [wt.grn.indexOf.get(B)!]);
    // About a third of the tissue (the blue band) changes fate, into the WHITE wild-type state.
    expect(c.transformed).toBeGreaterThan(0.25 * wt.n);
    expect(c.novel).toBeLessThanOrEqual(0.05 * wt.n); // a few border cells in a mixed state
    expect(c.topTransformation).not.toBeNull();
  });

  it('the wild type compared with itself is unchanged', () => {
    const c = compareToWildType(wt, wt, []);
    expect(c.unchanged).toBe(wt.n);
  });
});
