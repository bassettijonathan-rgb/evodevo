/**
 * Morphogen fields: reaction–diffusion on a regular grid (DESIGN.md §3.6).
 *
 *   ∂c/∂t = D ∇²c − k c + (secretion from cells)
 *
 * Discretisation (finite volumes):
 * - Node (i, j) is the centre of an h×h control volume at world position (i·h, j·h).
 * - Diffusion: explicit 5-point Laplacian (FTCS). Zero-flux boundaries: a boundary
 *   node simply has fewer neighbours, so Σc is conserved exactly when k = 0.
 * - Sub-stepping per morphogen so that D·Δt_sub/h² ≤ cfl (< ¼, the stability limit).
 * - Decay is applied exactly: c ← c·e^{−kΔt_sub}.
 * - Cells deposit and sample with bilinear weights. Deposit is the transpose of
 *   sampling, so what a cell secretes is exactly what appears in the grid.
 */
import { exp } from '../math';

export class MorphogenGrid {
  readonly nx: number;
  readonly ny: number;
  readonly h: number;
  /** Number of fields. */
  readonly M: number;
  /** All fields, one contiguous nx·ny block per morphogen: c[m*nx*ny + j*nx + i]. */
  readonly c: Float64Array;
  private readonly scratch: Float64Array;

  constructor(nx: number, ny: number, h: number, M: number) {
    this.nx = nx;
    this.ny = ny;
    this.h = h;
    this.M = M;
    this.c = new Float64Array(M * nx * ny);
    this.scratch = new Float64Array(nx * ny);
  }

  get size(): number {
    return this.nx * this.ny;
  }

  /** View of field m. */
  field(m: number): Float64Array {
    return this.c.subarray(m * this.size, (m + 1) * this.size);
  }

  /** Domain extent in world units: nodes span [0, (n−1)·h]. */
  get width(): number {
    return (this.nx - 1) * this.h;
  }
  get height(): number {
    return (this.ny - 1) * this.h;
  }

  /**
   * Bilinear stencil for world point (x, y): lower-left node (i, j) and fractions (fx, fy).
   * Points outside the grid are clamped to its edge.
   */
  private locate(x: number, y: number, out: Stencil): void {
    let gx = x / this.h;
    let gy = y / this.h;
    const maxX = this.nx - 1, maxY = this.ny - 1;
    gx = gx < 0 ? 0 : gx > maxX ? maxX : gx;
    gy = gy < 0 ? 0 : gy > maxY ? maxY : gy;
    let i = Math.floor(gx), j = Math.floor(gy);
    if (i >= maxX) i = maxX - 1;
    if (j >= maxY) j = maxY - 1;
    out.i = i;
    out.j = j;
    out.fx = gx - i;
    out.fy = gy - j;
  }

  /** Concentration of field m at (x, y), bilinearly interpolated. */
  sample(m: number, x: number, y: number): number {
    const s = STENCIL;
    this.locate(x, y, s);
    const f = this.c, o = m * this.size + s.j * this.nx + s.i, nx = this.nx;
    return (
      (1 - s.fy) * ((1 - s.fx) * f[o] + s.fx * f[o + 1]) +
      s.fy * ((1 - s.fx) * f[o + nx] + s.fx * f[o + nx + 1])
    );
  }

  /** Gradient of the bilinear interpolant of field m at (x, y); written to out[0], out[1]. */
  gradient(m: number, x: number, y: number, out: Float64Array | number[]): void {
    const s = STENCIL;
    this.locate(x, y, s);
    const f = this.c, o = m * this.size + s.j * this.nx + s.i, nx = this.nx;
    const c00 = f[o], c10 = f[o + 1], c01 = f[o + nx], c11 = f[o + nx + 1];
    out[0] = ((1 - s.fy) * (c10 - c00) + s.fy * (c11 - c01)) / this.h;
    out[1] = ((1 - s.fx) * (c01 - c00) + s.fx * (c11 - c10)) / this.h;
  }

  /**
   * Add `amount` (a quantity, not a concentration) of morphogen m at (x, y),
   * spread over the four surrounding control volumes with bilinear weights.
   */
  deposit(m: number, x: number, y: number, amount: number): void {
    const s = STENCIL;
    this.locate(x, y, s);
    const f = this.c, o = m * this.size + s.j * this.nx + s.i, nx = this.nx;
    const a = amount / (this.h * this.h); // quantity → concentration in an h×h volume
    f[o] += a * (1 - s.fx) * (1 - s.fy);
    f[o + 1] += a * s.fx * (1 - s.fy);
    f[o + nx] += a * (1 - s.fx) * s.fy;
    f[o + nx + 1] += a * s.fx * s.fy;
  }

  /** Number of explicit sub-steps needed to advance diffusion coefficient D by dt. */
  substepsFor(D: number, dt: number, cfl: number): number {
    return Math.max(1, Math.ceil((D * dt) / (cfl * this.h * this.h)));
  }

  /** Advance field m by dt: diffusion with coefficient D and first-order decay k. */
  diffuse(m: number, D: number, k: number, dt: number, cfl: number): void {
    const n = this.substepsFor(D, dt, cfl);
    const dts = dt / n;
    const alpha = (D * dts) / (this.h * this.h);
    const decay = exp(-k * dts);
    const { nx, ny } = this;
    let a = this.field(m);
    let b = this.scratch;
    for (let s = 0; s < n; s++) {
      for (let j = 0; j < ny; j++) {
        const row = j * nx;
        for (let i = 0; i < nx; i++) {
          const p = row + i;
          const cp = a[p];
          // Sum of (neighbour − centre) over existing neighbours = zero-flux boundary.
          let lap = 0;
          if (i > 0) lap += a[p - 1] - cp;
          if (i < nx - 1) lap += a[p + 1] - cp;
          if (j > 0) lap += a[p - nx] - cp;
          if (j < ny - 1) lap += a[p + nx] - cp;
          b[p] = (cp + alpha * lap) * decay;
        }
      }
      const t = a; a = b; b = t;
    }
    // After an odd number of swaps the result is in scratch: copy it back.
    if (a === this.scratch) this.field(m).set(a);
  }

  /** Total quantity of field m (Σ c·h²). */
  total(m: number): number {
    const f = this.field(m);
    let s = 0;
    for (let p = 0; p < f.length; p++) s += f[p];
    return s * this.h * this.h;
  }
}

interface Stencil {
  i: number;
  j: number;
  fx: number;
  fy: number;
}
const STENCIL: Stencil = { i: 0, j: 0, fx: 0, fy: 0 };
