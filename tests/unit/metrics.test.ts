/**
 * Metrics against synthetic organisms whose answer is known.
 */
import { describe, expect, it } from 'vitest';
import { buildGenome } from '../../src/core/genome/builder';
import { compileGenome } from '../../src/core/genome/compile';
import { computeMetrics, type OrganismState } from '../../src/core/metrics';
import { Rng } from '../../src/core/rng';
import { hexDisc } from '../../src/core/sim/develop';
import { readFileSync } from 'node:fs';
import { evaluate } from '../../src/core/evolution/evaluate';
import { genomeFromJSON, genomeHash } from '../../src/core/genome/serialize';

const grn = compileGenome(buildGenome([{ name: 'a', type: 'tf' }, { name: 'b', type: 'tf' }]), 0.1);

/** Build a state from points and a function giving (a, b) on/off levels per point. */
function organism(points: { x: number; y: number }[], f: (x: number, y: number) => [number, number]): OrganismState {
  const n = points.length;
  const x = new Float64Array(n * 2);
  points.forEach((p, c) => { const [a, b] = f(p.x, p.y); x[c * 2] = a; x[c * 2 + 1] = b; });
  return { n, px: points.map((p) => p.x), py: points.map((p) => p.y), x, grn };
}

/** A rod 40 cells long and 6 wide (hex packing). */
const rod = (() => {
  const pts: { x: number; y: number }[] = [];
  for (let j = 0; j < 6; j++) for (let i = 0; i < 40; i++) pts.push({ x: 10 + i * 0.95 + (j % 2) * 0.475, y: 30 + j * 0.82 });
  return pts;
})();
const disc = hexDisc(400, 32, 32);

describe('segments', () => {
  it('counts regular stripes across a rod', () => {
    const m = computeMetrics(organism(rod, (x) => [Math.floor((x - 10) / 4) % 2 === 0 ? 1 : 0, 0]));
    expect(m.segments).toBeGreaterThanOrEqual(5);
    expect(m.segmentGene).toBe('a');
    expect(m.elongation).toBeGreaterThan(4);
  });

  it('does not count concentric rings, spots, irregular bands, or a single stripe', () => {
    const r = (x: number, y: number) => Math.hypot(x - 32, y - 32);
    expect(computeMetrics(organism(disc, (x, y) => [Math.floor(r(x, y) / 3) % 2 ? 1 : 0, 0])).segments).toBe(0);
    const spot = (x: number, y: number) => ((Math.round(x / 4) + Math.round(y / 4)) % 2 === 0 && Math.hypot(x % 4 - 2, y % 4 - 2) < 1.2 ? 1 : 0);
    expect(computeMetrics(organism(disc, (x, y) => [spot(x, y), 0])).segments).toBe(0);
    const irregular = [2, 3, 12, 13, 16, 17, 34, 35]; // bands at very uneven spacing
    expect(computeMetrics(organism(rod, (x) => [irregular.includes(Math.floor(x - 10)) ? 1 : 0, 0])).segments).toBe(0);
    expect(computeMetrics(organism(rod, (x) => [x > 20 && x < 24 ? 1 : 0, 0])).segments).toBe(0);
  });

  it('regression: an evolved organism whose broken outer rim fooled the first detector has 0 segments', () => {
    // From the M4 experiment (selected run 4, individual 2773). One of its genes is on
    // in the outer rim, which breaks into three arcs; the original detector counted 3 segments.
    const genome = genomeFromJSON(readFileSync(new URL('../fixtures/rim-false-positive.genome.json', import.meta.url), 'utf8'));
    const r = evaluate({ genome, config: { gridNx: 64, gridNy: 64, maxCells: 200, tDev: 150 }, seed: `selected-4/${genomeHash(genome)}` });
    expect(r.metrics.cells).toBe(200);
    expect(r.metrics.segments).toBe(0);
  });
});

describe('symmetry', () => {
  it('a uniform blob has perfect shape symmetry but zero PATTERN symmetry (no trivial positives)', () => {
    const m = computeMetrics(organism(disc, () => [1, 0]));
    expect(m.cellTypes).toBe(1);
    expect(m.shapeBilateral).toBeGreaterThan(0.9);
    expect(m.patternBilateral).toBe(0);
    expect(m.patternRadial).toBe(0);
  });

  it('a mirror-symmetric type pattern scores high bilateral κ; random labels score ≈ 0', () => {
    // Types depend on |y − 32| and x: mirror-symmetric about y = 32 only.
    const sym = computeMetrics(organism(disc, (x, y) => [Math.abs(y - 32) > 4 ? 1 : 0, x > 34 ? 1 : 0]));
    expect(sym.cellTypes).toBeGreaterThanOrEqual(3);
    expect(sym.patternBilateral).toBeGreaterThan(0.8);
    const rng = new Rng(1);
    const rand = computeMetrics(organism(disc, () => [rng.float() < 0.5 ? 1 : 0, rng.float() < 0.5 ? 1 : 0]));
    expect(rand.patternBilateral).toBeLessThan(0.15);
    expect(rand.patternRadial).toBeLessThan(0.15);
  });

  it('a 4-fold rotationally symmetric pattern is detected with its order', () => {
    // Four arms along the axes.
    const m = computeMetrics(organism(disc, (x, y) => [Math.min(Math.abs(x - 32), Math.abs(y - 32)) < 1.5 ? 1 : 0, Math.hypot(x - 32, y - 32) < 4 ? 1 : 0]));
    expect(m.radialOrder).toBe(4);
    expect(m.patternRadial).toBeGreaterThan(0.6);
  });

  it('isotropy separates concentric (trivial) patterns from discrete symmetries', () => {
    const r = (x: number, y: number) => Math.hypot(x - 32, y - 32);
    const rings = computeMetrics(organism(disc, (x, y) => [r(x, y) < 4 ? 1 : 0, r(x, y) > 8 ? 1 : 0]));
    expect(rings.patternBilateral).toBeGreaterThan(0.8); // mirror-symmetric about every axis…
    expect(rings.patternIsotropy).toBeGreaterThan(0.7); // …because it is isotropic
    const arms = computeMetrics(organism(disc, (x, y) => [Math.min(Math.abs(x - 32), Math.abs(y - 32)) < 1.5 ? 1 : 0, r(x, y) < 4 ? 1 : 0]));
    expect(arms.patternIsotropy).toBeLessThan(0.35);
    const mirror = computeMetrics(organism(disc, (x, y) => [Math.abs(y - 32) > 4 ? 1 : 0, x > 34 ? 1 : 0]));
    expect(mirror.patternIsotropy).toBeLessThan(0.35);
  });

  it('a dominant type with a sprinkling of others has no pattern symmetry (kappa paradox guard)', () => {
    const rng = new Rng(4);
    const m = computeMetrics(organism(disc, () => [rng.float() < 0.04 ? 1 : 0, rng.float() < 0.04 ? 1 : 0]));
    expect(m.patternBilateral).toBe(0);
    expect(m.patternRadial).toBe(0);
  });

  it('a 3-fold pattern is detected as order 3, not 6', () => {
    const m = computeMetrics(organism(disc, (x, y) => {
      const a = Math.atan2(y - 32, x - 32);
      return [Math.cos(3 * a) > 0.3 ? 1 : 0, 0];
    }));
    expect(m.radialOrder).toBe(3);
    expect(m.patternRadial).toBeGreaterThan(0.6);
  });
});

describe('cell types', () => {
  it('counts expression signatures and ignores rare ones', () => {
    const m = computeMetrics(organism(disc, (x, y) => (x === disc[0].x && y === disc[0].y ? [1, 1] : x > 32 ? [1, 0] : [0, 1])));
    expect(m.cellTypes).toBe(2); // the single [1,1] cell is below the 2% / 3-cell floor
    expect(m.typeEntropy).toBeCloseTo(1, 1);
  });
});
