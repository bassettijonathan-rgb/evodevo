/**
 * Linear stability of a homogeneous tissue (DESIGN.md §3.6): does a uniform
 * state become patterned, and at which wavelength?
 *
 * State per lattice site: gene levels x (G) and morphogen fields c (M), with one
 * cell per h×h site (density ρ = 1/h²). For a perturbation ∝ e^{iq·r} the
 * linearised dynamics are δẋ = J(q)·δx with
 *
 *   ∂ẋ_i/∂x_j = R_i σ'(u_i) W_ij · (1 for a TF, binding_j·κ(q) for a contact ligand)
 *   ∂ẋ_i/∂c_m = R_i σ'(u_i) W_i,m
 *   ∂ẋ_i/∂x_i −= λ_i
 *   ∂ċ_m/∂x_m = s_m ρ,    ∂ċ_m/∂c_m = −k_m − D_m q²
 *
 * where q² is the discrete-Laplacian eigenvalue 4 sin²(qh/2)/h² for a mode along x,
 * and κ(q) = (cos(qh) + 1)/2 is the neighbour average of the mode on a square lattice.
 *
 * A Turing instability: the q = 0 mode is stable but some q > 0 grows.
 */
import type { CompiledGRN } from '../genome/compile';
import { sigmoid } from '../math';
import { eigenvalues, solveLinear, type Matrix } from './linalg';

export interface HomogeneousState {
  x: Float64Array;
  c: Float64Array;
  /** Max |rate of change| at the returned state; ~0 if a steady state was found. */
  residual: number;
}

function regulatoryInputs(grn: CompiledGRN, x: Float64Array, c: Float64Array, i: number): number {
  let u = grn.bias[i];
  for (let e = grn.rowPtr[i]; e < grn.rowPtr[i + 1]; e++) {
    const j = grn.col[e];
    const t = grn.types[j];
    const y = t === 'morphogen' ? c[grn.fieldOf[j]] : t === 'contact' ? grn.binding[j] * x[j] : x[j];
    u += grn.weight[e] * y;
  }
  return u;
}

/** Right-hand side (ẋ, ċ) of the well-mixed tissue equations. */
function wellMixedRates(grn: CompiledGRN, x: Float64Array, c: Float64Array, rho: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < grn.G; i++) out.push(grn.rate[i] * sigmoid(regulatoryInputs(grn, x, c, i)) - grn.decay[i] * x[i]);
  for (let m = 0; m < grn.morphIdx.length; m++) {
    const g = grn.morphIdx[m];
    out.push(grn.secretion[g] * rho * x[g] - grn.fieldDecay[g] * c[m]);
  }
  return out;
}

/**
 * Homogeneous steady state of a uniform tissue. Integrates the well-mixed
 * equations from (x0, c0) for a while to land in a basin, then polishes with
 * Newton's method using the analytic Jacobian. Which steady state you get
 * depends on the start when several exist.
 */
export function homogeneousSteadyState(
  grn: CompiledGRN,
  h = 1,
  x0?: ArrayLike<number>,
  c0?: ArrayLike<number>,
  { dt = 0.05, relaxTime = 50 } = {},
): HomogeneousState {
  const G = grn.G, M = grn.morphIdx.length, rho = 1 / (h * h);
  const x = Float64Array.from(x0 ?? grn.maternal);
  const c = c0 ? Float64Array.from(c0) : new Float64Array(M);
  for (let t = 0; t < relaxTime; t += dt) {
    const r = wellMixedRates(grn, x, c, rho);
    for (let i = 0; i < G; i++) x[i] += dt * r[i];
    for (let m = 0; m < M; m++) c[m] += dt * r[G + m];
  }
  let residual = Infinity;
  for (let iter = 0; iter < 50; iter++) {
    const F = wellMixedRates(grn, x, c, rho);
    residual = Math.max(...F.map(Math.abs));
    if (residual < 1e-14) break;
    const dz = solveLinear(jacobian(grn, { x, c, residual }, 0, 1, h), F.map((v) => -v));
    for (let i = 0; i < G; i++) x[i] += dz[i];
    for (let m = 0; m < M; m++) c[m] += dz[G + m];
  }
  return { x, c, residual };
}

/** Jacobian J(q) of the linearised tissue dynamics (see module comment). */
export function jacobian(grn: CompiledGRN, s: HomogeneousState, q2: number, kappa: number, h = 1): Matrix {
  const G = grn.G, M = grn.morphIdx.length, n = G + M, rho = 1 / (h * h);
  const J: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < G; i++) {
    const sg = sigmoid(regulatoryInputs(grn, s.x, s.c, i));
    const gain = grn.rate[i] * sg * (1 - sg);
    for (let e = grn.rowPtr[i]; e < grn.rowPtr[i + 1]; e++) {
      const j = grn.col[e];
      const t = grn.types[j];
      if (t === 'morphogen') J[i][G + grn.fieldOf[j]] += gain * grn.weight[e];
      else if (t === 'contact') J[i][j] += gain * grn.weight[e] * grn.binding[j] * kappa;
      else J[i][j] += gain * grn.weight[e];
    }
    J[i][i] -= grn.decay[i];
  }
  for (let m = 0; m < M; m++) {
    const g = grn.morphIdx[m];
    J[G + m][g] = grn.secretion[g] * rho;
    J[G + m][G + m] = -grn.fieldDecay[g] - grn.diffusion[g] * q2;
  }
  return J;
}

/** Largest real part of the eigenvalues of J at lattice wavenumber q (mode along x). */
export function growthRate(grn: CompiledGRN, s: HomogeneousState, q: number, h = 1): number {
  const q2 = (4 * Math.sin((q * h) / 2) ** 2) / (h * h);
  const kappa = (Math.cos(q * h) + 1) / 2;
  return Math.max(...eigenvalues(jacobian(grn, s, q2, kappa, h)).map((e) => e.re));
}

export interface TuringPrediction {
  /** Growth rate of the uniform (q = 0) mode; must be < 0 for a Turing (not Hopf/runaway) instability. */
  uniformRate: number;
  /** Fastest-growing wavenumber and its growth rate. */
  qMax: number;
  maxRate: number;
  /** 2π/qMax, in units of h. */
  wavelength: number;
  /** True if the uniform state is stable but some finite wavelength grows. */
  turingUnstable: boolean;
}

/** Scan the dispersion relation for the fastest-growing mode. */
export function predictTuring(grn: CompiledGRN, s: HomogeneousState, h = 1, samples = 600): TuringPrediction {
  const uniformRate = growthRate(grn, s, 0, h);
  let qMax = 0, maxRate = -Infinity;
  for (let k = 1; k <= samples; k++) {
    const q = (Math.PI / h) * (k / samples);
    const r = growthRate(grn, s, q, h);
    if (r > maxRate) {
      maxRate = r;
      qMax = q;
    }
  }
  return {
    uniformRate,
    qMax,
    maxRate,
    wavelength: (2 * Math.PI) / qMax,
    turingUnstable: uniformRate < 0 && maxRate > 0,
  };
}
