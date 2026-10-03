/**
 * Gene expression: the gene-circuit model (DESIGN.md §3.2).
 *
 *   u_i   = Σ_j W_ij · y_j + b_i
 *   dx_i/dt = R_i · σ(u_i) − λ_i · x_i
 *
 * integrated with the exponential integrator: production P_i = R_i σ(u_i) is held
 * constant over the step, and the linear decay is solved exactly,
 *
 *   x_i(t+Δt) = P_i/λ_i + (x_i(t) − P_i/λ_i) · e^{−λ_i Δt}.
 *
 * All cells are updated synchronously: every u_i is computed from the state at
 * time t before any x_i is overwritten.
 */
import type { CompiledGRN } from '../genome/compile';
import { sigmoid } from '../math';
import type { Rng } from '../rng';
import type { CellStore } from './cells';

/**
 * Fill y for transcription factors (their own intracellular level).
 * Morphogen and contact columns are written by the sensing step and left alone here.
 */
export function gatherInternalInputs(grn: CompiledGRN, cells: CellStore): void {
  const G = grn.G;
  const { x, input } = cells;
  const tf = grn.tfIdx;
  for (let c = 0; c < cells.n; c++) {
    const base = c * G;
    for (let k = 0; k < tf.length; k++) input[base + tf[k]] = x[base + tf[k]];
  }
}

/**
 * Advance every cell's expression state by one step of grn.dt.
 *
 * @param noise   1/√Ω of the chemical Langevin equation (0 = deterministic)
 * @param rng     required when noise > 0
 */
export function stepGRN(grn: CompiledGRN, cells: CellStore, noise = 0, rng: Rng | null = null): void {
  gatherInternalInputs(grn, cells);

  const G = grn.G;
  const { bias, rate, invDecay, expDecay, decay, rowPtr, col, weight } = grn;
  const { x, input } = cells;
  const dt = grn.dt;

  for (let c = 0; c < cells.n; c++) {
    const base = c * G;
    for (let i = 0; i < G; i++) {
      let u = bias[i];
      for (let e = rowPtr[i]; e < rowPtr[i + 1]; e++) u += weight[e] * input[base + col[e]];
      const P = rate[i] * sigmoid(u);
      const target = P * invDecay[i];
      let xi = target + (x[base + i] - target) * expDecay[i];
      if (noise > 0) {
        // Chemical Langevin noise: variance ∝ (production + degradation) flux.
        xi += noise * Math.sqrt((P + decay[i] * x[base + i]) * dt) * rng!.normal();
        if (xi < 0) xi = 0;
      }
      x[base + i] = xi;
    }
  }
}
