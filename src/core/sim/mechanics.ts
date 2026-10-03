/**
 * Cell mechanics: overdamped soft discs with differential adhesion (DESIGN.md §3.8).
 *
 *   γ dr/dt = Σ_n F_cn + wall + √(2γ k_BT) ξ
 *
 * Pair force along the line of centres (positive = push apart), with contact
 * distance s = r_c + r_n, distance d and overlap δ = s − d:
 *
 *   F = k_rep·max(δ, 0) − A_cn·ramp(δ)
 *   ramp = 1 for δ ≥ 0, falling linearly to 0 at δ = −adhesionRange
 *   A_cn = A₀ + Σ_k J_k · min(a_k(c), a_k(n))      (homophilic, cadherin-like)
 *
 * An adhering pair rests at overlap δ* = A/k_rep.
 *
 * Neighbour search uses a uniform spatial hash rebuilt every sub-step, so each
 * step is O(n). Pairs are visited in a fixed order, so results are deterministic.
 */
import type { SimConfig } from '../config';
import type { CompiledGRN } from '../genome/compile';
import type { Rng } from '../rng';
import type { CellStore } from './cells';

/** Uniform-grid spatial hash with counting-sort buckets. */
export class SpatialHash {
  private binSize = 1;
  private bx = 0;
  private by = 0;
  private start = new Int32Array(1);
  private items = new Int32Array(0);
  private binOf = new Int32Array(0);

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
    const fill = start.slice(0, nb);
    for (let c = 0; c < cells.n; c++) this.items[fill[this.binOf[c]]++] = c;
  }

  private binIndex(x: number, y: number): number {
    let i = Math.floor(x / this.binSize);
    let j = Math.floor(y / this.binSize);
    i = i < 0 ? 0 : i >= this.bx ? this.bx - 1 : i;
    j = j < 0 ? 0 : j >= this.by ? this.by - 1 : j;
    return j * this.bx + i;
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
  let A = cfg.adhesionBase;
  for (let k = 0; k < adh.length; k++) {
    const g = adh[k];
    const a = x[c * G + g], b = x[n * G + g];
    A += grn.binding[g] * (a < b ? a : b);
  }
  return A;
}

export class Mechanics {
  private hash = new SpatialHash();
  private fx = new Float64Array(0);
  private fy = new Float64Array(0);

  constructor(
    private readonly cfg: SimConfig,
    private readonly width: number,
    private readonly height: number,
  ) {}

  /** Advance positions by one developmental step (cfg.mechanicsSubsteps sub-steps). */
  step(grn: CompiledGRN, cells: CellStore, rng: Rng): void {
    const cfg = this.cfg;
    if (this.fx.length < cells.capacity) {
      this.fx = new Float64Array(cells.capacity);
      this.fy = new Float64Array(cells.capacity);
    }
    const dt = cfg.dt / cfg.mechanicsSubsteps;
    const mob = dt / cfg.drag;
    const kick = Math.sqrt((2 * cfg.motility * dt) / cfg.drag);
    const { fx, fy } = this;
    const { px, py, radius } = cells;
    const kRep = cfg.repulsion, range = cfg.adhesionRange;

    for (let s = 0; s < cfg.mechanicsSubsteps; s++) {
      const n = cells.n;
      fx.fill(0, 0, n);
      fy.fill(0, 0, n);
      this.hash.build(cells, this.width, this.height, cutoff(cells, cfg));
      this.hash.forEachPair(cells, (a, b) => {
        let dx = px[b] - px[a];
        let dy = py[b] - py[a];
        let d = Math.sqrt(dx * dx + dy * dy);
        const sd = radius[a] + radius[b];
        if (d >= sd + range) return;
        if (d < 1e-9) {
          // Coincident centres: separate along x (deterministic).
          dx = 1; dy = 0; d = 1e-9;
        } else {
          dx /= d; dy /= d;
        }
        const delta = sd - d;
        const F = (delta > 0 ? kRep * delta : 0) - adhesion(grn, cells, cfg, a, b) * ramp(delta, range);
        // F > 0 pushes a away from b (−direction for a, +direction for b).
        fx[a] -= F * dx; fy[a] -= F * dy;
        fx[b] += F * dx; fy[b] += F * dy;
      });
      for (let c = 0; c < n; c++) {
        // Soft walls keep cells inside the morphogen grid.
        const r = radius[c];
        if (px[c] < r) fx[c] += kRep * (r - px[c]);
        if (px[c] > this.width - r) fx[c] -= kRep * (px[c] - (this.width - r));
        if (py[c] < r) fy[c] += kRep * (r - py[c]);
        if (py[c] > this.height - r) fy[c] -= kRep * (py[c] - (this.height - r));
        px[c] += mob * fx[c];
        py[c] += mob * fy[c];
        if (kick > 0) {
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
    const wsum = new Float64Array(n);
    for (let c = 0; c < n; c++) for (let k = 0; k < idx.length; k++) input[c * G + idx[k]] = 0;
    this.hash.build(cells, this.width, this.height, cutoff(cells, this.cfg));
    this.hash.forEachPair(cells, (a, b) => {
      const dx = px[b] - px[a], dy = py[b] - py[a];
      const w = ramp(radius[a] + radius[b] - Math.sqrt(dx * dx + dy * dy), range);
      if (w === 0) return;
      wsum[a] += w;
      wsum[b] += w;
      for (let k = 0; k < idx.length; k++) {
        const j = idx[k];
        input[a * G + j] += w * x[b * G + j];
        input[b * G + j] += w * x[a * G + j];
      }
    });
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
      // Potential whose negative derivative w.r.t. d is the force above.
      if (delta >= 0) E += 0.5 * cfg.repulsion * delta * delta - A * (delta + range / 2);
      else E += -A * ((delta + range) * (delta + range)) / (2 * range);
    });
    return E;
  }
}
