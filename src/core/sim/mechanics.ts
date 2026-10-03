/**
 * Cell mechanics: overdamped soft discs with differential adhesion (DESIGN.md §3.8).
 *
 *   γ dr/dt = Σ_n F_cn + wall + √(2γ k_BT) ξ
 *
 * Pair force along the line of centres (positive = push apart), with contact
 * distance s = r_c + r_n, distance d and overlap δ = s − d:
 *
 *   F = k_rep·δ·(s/d) [δ > 0] − A_cn·ramp(δ)
 *   ramp = 1 for δ ≥ 0, falling linearly to 0 at δ = −adhesionRange
 *   A_cn = A₀ + S/(1 + S/A_max),  S = Σ_k J_k · min(a_k(c), a_k(n))   (homophilic, cadherin-like)
 *
 * The repulsion is linear for small overlaps but diverges as the centres meet:
 * cells are nearly incompressible, so strong adhesion cannot collapse them onto
 * each other. Specific adhesion saturates (finite bond sites per contact).
 * An adhering pair rests where k_rep·δ·s/(s − δ) = A, i.e. δ* = A·s/(k_rep·s + A).
 *
 * Neighbour search uses a uniform spatial hash rebuilt every sub-step, so each
 * step is O(n). Pairs are visited in a fixed order, so results are deterministic.
 */
import type { SimConfig } from '../config';
import type { CompiledGRN } from '../genome/compile';
import type { Rng } from '../rng';
import type { CellStore } from './cells';
import { log } from '../math';

/** Uniform-grid spatial hash with counting-sort buckets. */
export class SpatialHash {
  binSize = 1;
  /** Bins in x and y. */
  bx = 0;
  by = 0;
  /** Cells of bin b are items[start[b] .. start[b+1]−1]. */
  start = new Int32Array(1);
  items = new Int32Array(0);
  /** Bin of each cell. */
  binOf = new Int32Array(0);
  private fill = new Int32Array(0);

  /** Bucket all live cells. Domain is [0, width] × [0, height]; points outside are clamped. */
  build(cells: CellStore, width: number, height: number, binSize: number): void {
    this.binSize = binSize;
    this.bx = Math.max(1, Math.ceil(width / binSize) + 1);
    this.by = Math.max(1, Math.ceil(height / binSize) + 1);
    const nb = this.bx * this.by;
    if (this.start.length < nb + 1) this.start = new Int32Array(nb + 1);
    if (this.items.length < cells.capacity) {
      this.items = new Int32Array(cells.capacity);
      this.binOf = new Int32Array(cells.capacity);
    }
    const start = this.start;
    start.fill(0, 0, nb + 1);
    for (let c = 0; c < cells.n; c++) {
      const b = this.binIndex(cells.px[c], cells.py[c]);
      this.binOf[c] = b;
      start[b + 1]++;
    }
    for (let b = 0; b < nb; b++) start[b + 1] += start[b];
    if (this.fill.length < nb) this.fill = new Int32Array(nb);
    const fill = this.fill;
    fill.set(start.subarray(0, nb));
    for (let c = 0; c < cells.n; c++) this.items[fill[this.binOf[c]]++] = c;
  }

  private binIndex(x: number, y: number): number {
    let i = Math.floor(x / this.binSize);
    let j = Math.floor(y / this.binSize);
    i = i < 0 ? 0 : i >= this.bx ? this.bx - 1 : i;
    j = j < 0 ? 0 : j >= this.by ? this.by - 1 : j;
    return j * this.bx + i;
  }

  /** Candidate pairs found by the last collectPairs(): pairA[k], pairB[k] for k < pairCount. */
  pairA = new Int32Array(0);
  pairB = new Int32Array(0);
  pairCount = 0;

  /**
   * List every unordered pair of cells closer than `reach`, each pair once:
   * for each cell, later cells in its own bin plus all cells in the four
   * "forward" neighbour bins (E, N, NE, NW) — the half-stencil. O(n), independent
   * of how many bins are empty. Call after build().
   */
  collectPairs(cells: CellStore, reach: number): void {
    const { bx, by, start, items, binOf } = this;
    const { px, py } = cells;
    const r2 = reach * reach;
    let count = 0;
    let A = this.pairA, B = this.pairB;
    for (let a = 0; a < cells.n; a++) {
      const b0 = binOf[a];
      const i = b0 % bx, j = (b0 - i) / bx;
      const ax = px[a], ay = py[a];
      for (let q = -1; q < 4; q++) {
        let bin = b0;
        if (q >= 0) {
          const ni = i + FORWARD_DI[q], nj = j + FORWARD_DJ[q];
          if (ni < 0 || ni >= bx || nj >= by) continue;
          bin = nj * bx + ni;
        }
        for (let m = start[bin]; m < start[bin + 1]; m++) {
          const b = items[m];
          if (q < 0 && b <= a) continue; // same bin: each pair once
          const dx = px[b] - ax, dy = py[b] - ay;
          if (dx * dx + dy * dy >= r2) continue;
          if (count === A.length) {
            const grow = (old: Int32Array) => { const nw = new Int32Array(Math.max(1024, old.length * 2)); nw.set(old); return nw; };
            A = this.pairA = grow(A);
            B = this.pairB = grow(B);
          }
          A[count] = a;
          B[count] = b;
          count++;
        }
      }
    }
    this.pairCount = count;
  }

  /**
   * Call fn(c, n) once for every unordered pair (c < n) in the same or adjacent bins.
   * Pairs farther apart than binSize may also be visited; callers check distance.
   */
  forEachPair(cells: CellStore, fn: (c: number, n: number) => void): void {
    const { bx, by, start, items, binOf } = this;
    for (let c = 0; c < cells.n; c++) {
      const b = binOf[c];
      const bi = b % bx, bj = (b - bi) / bx;
      for (let dj = -1; dj <= 1; dj++) {
        const j = bj + dj;
        if (j < 0 || j >= by) continue;
        for (let di = -1; di <= 1; di++) {
          const i = bi + di;
          if (i < 0 || i >= bx) continue;
          const nb = j * bx + i;
          for (let k = start[nb]; k < start[nb + 1]; k++) {
            const n = items[k];
            if (n > c) fn(c, n);
          }
        }
      }
    }
  }
}

// Half-stencil: E, NW, N, NE (with the bin itself this covers every adjacent pair once).
const FORWARD_DI = [1, -1, 0, 1];
const FORWARD_DJ = [0, 1, 1, 1];

/** Verlet-list skin [ℓ]: extra reach so the pair list stays valid while cells move < SKIN/2. */
const SKIN = 0.3;

/** Upper limit on adaptive mechanics sub-steps per developmental step. */
const MAX_SUBSTEPS = 60;

/** Interaction cutoff: largest contact distance plus the adhesion range. */
function cutoff(cells: CellStore, cfg: SimConfig): number {
  let rmax = 0;
  for (let c = 0; c < cells.n; c++) if (cells.radius[c] > rmax) rmax = cells.radius[c];
  return 2 * rmax + cfg.adhesionRange;
}

/** Contact weight in [0, 1]: 1 when touching or overlapping, fading to 0 over adhesionRange. */
function ramp(delta: number, range: number): number {
  return delta >= 0 ? 1 : delta <= -range ? 0 : 1 + delta / range;
}

/** Homophilic adhesion strength between cells c and n. */
export function adhesion(grn: CompiledGRN, cells: CellStore, cfg: SimConfig, c: number, n: number): number {
  const G = grn.G, x = cells.x, adh = grn.adhIdx;
  let S = 0;
  for (let k = 0; k < adh.length; k++) {
    const g = adh[k];
    const a = x[c * G + g], b = x[n * G + g];
    S += grn.binding[g] * (a < b ? a : b);
  }
  return cfg.adhesionBase + S / (1 + S / cfg.adhesionMax);
}

/** Repulsive force for overlap δ > 0 at centre distance d (contact distance s = d + δ). */
function repulsion(k: number, delta: number, d: number): number {
  return (k * delta * (d + delta)) / (d > 1e-6 ? d : 1e-6);
}

export class Mechanics {
  private readonly hash = new SpatialHash();
  private fx = new Float64Array(0);
  private fy = new Float64Array(0);
  private wsum = new Float64Array(0);

  constructor(
    private readonly cfg: SimConfig,
    private readonly width: number,
    private readonly height: number,
  ) {}

  /** Sub-steps used by the last step() (adaptive; for diagnostics). */
  lastSubsteps = 0;
  private stiff = new Float64Array(0);
  private refX = new Float64Array(0);
  private refY = new Float64Array(0);

  /**
   * Explicit (forward Euler) integration of a stiff gradient flow is stable only
   * if Δt_sub < 2γ/λ_max, where λ_max is the largest eigenvalue of the contact
   * stiffness matrix. We bound λ_max by 1.5 × the largest per-cell sum of contact
   * stiffnesses (exact for a hexagonal lattice) and choose the number of sub-steps
   * accordingly, never fewer than cfg.mechanicsSubsteps.
   */
  private substepsNeeded(cells: CellStore): number {
    const cfg = this.cfg;
    const { pairA, pairB, pairCount } = this.hash;
    const { px, py, radius } = cells;
    if (this.stiff.length < cells.capacity) this.stiff = new Float64Array(cells.capacity);
    const stiff = this.stiff;
    stiff.fill(0, 0, cells.n);
    for (let k = 0; k < pairCount; k++) {
      const a = pairA[k], b = pairB[k];
      const dx = px[b] - px[a], dy = py[b] - py[a];
      const d = Math.sqrt(dx * dx + dy * dy);
      const sd = radius[a] + radius[b];
      if (d >= sd) continue;
      // |dF/dd| of the repulsion k·s·(s/d − 1) is k·s²/d².
      const dm = d > 0.05 ? d : 0.05;
      const kk = (cfg.repulsion * sd * sd) / (dm * dm);
      stiff[a] += kk;
      stiff[b] += kk;
    }
    let maxRow = 0;
    for (let c = 0; c < cells.n; c++) if (stiff[c] > maxRow) maxRow = stiff[c];
    const lambda = 1.5 * maxRow;
    const n = Math.ceil((cfg.dt * lambda) / (1.6 * cfg.drag));
    return Math.min(MAX_SUBSTEPS, Math.max(cfg.mechanicsSubsteps, n));
  }

  /** Advance positions by one developmental step (adaptive number of sub-steps). */
  step(grn: CompiledGRN, cells: CellStore, rng: Rng): void {
    const cfg = this.cfg;
    if (this.fx.length < cells.capacity) {
      this.fx = new Float64Array(cells.capacity);
      this.fy = new Float64Array(cells.capacity);
    }
    const { fx, fy, hash } = this;
    const { px, py, radius, x } = cells;
    const kRep = cfg.repulsion, range = cfg.adhesionRange, A0 = cfg.adhesionBase, Amax = cfg.adhesionMax;
    const G = grn.G, adh = grn.adhIdx, nAdh = adh.length, J = grn.binding;
    const cut = cutoff(cells, cfg);
    const W = this.width, H = this.height;

    // Verlet neighbour list: pairs within cut + skin, rebuilt only when some cell
    // has moved more than skin/2 since the last build (then no pair within `cut`
    // can be missing).
    const reachList = cut + SKIN;
    const rebuild = () => {
      hash.build(cells, W, H, reachList);
      hash.collectPairs(cells, reachList);
      if (this.refX.length < cells.capacity) { this.refX = new Float64Array(cells.capacity); this.refY = new Float64Array(cells.capacity); }
      this.refX.set(px.subarray(0, cells.n));
      this.refY.set(py.subarray(0, cells.n));
    };
    rebuild();
    const substeps = (this.lastSubsteps = this.substepsNeeded(cells));
    const dt = cfg.dt / substeps;
    const mob = dt / cfg.drag;
    // Brownian (motility) kicks are drawn once per developmental step with the
    // full-step variance 2·k_BT·Δt/γ, then the force sub-steps relax any overlaps
    // they create. Same statistics as kicking every sub-step, far fewer draws.
    const kick = Math.sqrt((2 * cfg.motility * cfg.dt) / cfg.drag);

    for (let s = 0; s < substeps; s++) {
      const n = cells.n;
      fx.fill(0, 0, n);
      fy.fill(0, 0, n);
      if (s > 0) {
        let moved = 0;
        for (let c = 0; c < n; c++) {
          const dx = px[c] - this.refX[c], dy = py[c] - this.refY[c];
          const d2 = dx * dx + dy * dy;
          if (d2 > moved) moved = d2;
        }
        if (moved > (SKIN / 2) * (SKIN / 2)) rebuild();
      }
      const { pairA, pairB, pairCount } = hash;
      for (let k = 0; k < pairCount; k++) {
        const a = pairA[k], b = pairB[k];
        let dx = px[b] - px[a], dy = py[b] - py[a];
        const sd = radius[a] + radius[b];
        const d2 = dx * dx + dy * dy;
        const reach = sd + range;
        if (d2 >= reach * reach) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-9) { dx = 1; dy = 0; d = 1e-9; } // coincident centres: separate along x
        else { dx /= d; dy /= d; }
        const delta = sd - d;
        // Homophilic adhesion: S = Σ_k J_k·min(a_k, b_k), saturating.
        let S = 0;
        for (let q = 0; q < nAdh; q++) {
          const g = adh[q];
          const va = x[a * G + g], vb = x[b * G + g];
          S += J[g] * (va < vb ? va : vb);
        }
        const A = A0 + S / (1 + S / Amax);
        const F = (delta > 0 ? repulsion(kRep, delta, d) : 0) - A * ramp(delta, range);
        // F > 0 pushes a and b apart.
        fx[a] -= F * dx; fy[a] -= F * dy;
        fx[b] += F * dx; fy[b] += F * dy;
      }
      for (let c = 0; c < n; c++) {
        // Soft walls keep cells inside the morphogen grid.
        const r = radius[c];
        if (px[c] < r) fx[c] += kRep * (r - px[c]);
        if (px[c] > W - r) fx[c] -= kRep * (px[c] - (W - r));
        if (py[c] < r) fy[c] += kRep * (r - py[c]);
        if (py[c] > H - r) fy[c] -= kRep * (py[c] - (H - r));
        px[c] += mob * fx[c];
        py[c] += mob * fy[c];
        if (kick > 0 && s === 0) {
          px[c] += kick * rng.normal();
          py[c] += kick * rng.normal();
        }
      }
    }
  }

  /**
   * Juxtacrine signalling (DESIGN.md §3.7): for each contact gene j, the input a
   * cell sees is binding_j × the contact-weighted MEAN of its neighbours' x_j.
   * The cell's own level is never included (that is what makes lateral inhibition work).
   */
  contactInputs(grn: CompiledGRN, cells: CellStore): void {
    const idx = grn.contactIdx;
    if (idx.length === 0) return;
    const G = grn.G, n = cells.n, { x, input, px, py, radius } = cells;
    const range = this.cfg.adhesionRange;
    if (this.wsum.length < cells.capacity) this.wsum = new Float64Array(cells.capacity);
    const wsum = this.wsum;
    wsum.fill(0, 0, n);
    for (let c = 0; c < n; c++) for (let k = 0; k < idx.length; k++) input[c * G + idx[k]] = 0;
    const cut = cutoff(cells, this.cfg);
    this.hash.build(cells, this.width, this.height, cut);
    this.hash.collectPairs(cells, cut);
    const { pairA, pairB, pairCount } = this.hash;
    for (let p = 0; p < pairCount; p++) {
      const a = pairA[p], b = pairB[p];
      const dx = px[b] - px[a], dy = py[b] - py[a];
      const w = ramp(radius[a] + radius[b] - Math.sqrt(dx * dx + dy * dy), range);
      if (w === 0) continue;
      wsum[a] += w;
      wsum[b] += w;
      for (let k = 0; k < idx.length; k++) {
        const j = idx[k];
        input[a * G + j] += w * x[b * G + j];
        input[b * G + j] += w * x[a * G + j];
      }
    }
    for (let c = 0; c < n; c++) {
      if (wsum[c] === 0) continue;
      for (let k = 0; k < idx.length; k++) {
        const j = idx[k];
        input[c * G + j] *= grn.binding[j] / wsum[c];
      }
    }
  }

  /** Total mechanical energy (repulsion springs minus adhesion), for relaxation tests. */
  energy(grn: CompiledGRN, cells: CellStore): number {
    const cfg = this.cfg, range = cfg.adhesionRange;
    let E = 0;
    this.hash.build(cells, this.width, this.height, cutoff(cells, cfg));
    this.hash.forEachPair(cells, (a, b) => {
      const dx = cells.px[b] - cells.px[a], dy = cells.py[b] - cells.py[a];
      const delta = cells.radius[a] + cells.radius[b] - Math.sqrt(dx * dx + dy * dy);
      if (delta <= -range) return;
      const A = adhesion(grn, cells, cfg, a, b);
      // Potential U(d) with −dU/dd = F. Repulsion: U = k·s·(s·ln(s/d) − (s − d)) for d < s.
      const s = cells.radius[a] + cells.radius[b], d = s - delta;
      if (delta >= 0) E += cfg.repulsion * s * (s * log(s / d) - delta) - A * (delta + range / 2);
      else E += -A * ((delta + range) * (delta + range)) / (2 * range);
    });
    return E;
  }
}
