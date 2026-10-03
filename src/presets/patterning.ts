/**
 * Hand-authored patterning genomes for the M2 validation tests.
 */
import { buildGenome } from '../core/genome/builder';
import type { Genome } from '../core/genome/types';

const logit = (p: number) => Math.log(p / (1 - p));

export interface TuringParams {
  /**
   * Where on its sigmoid the activator sits at the homogeneous steady state, σ(u_A*).
   * 0.5 = inflection point: quadratic nonlinearity vanishes → stripes expected.
   * Away from 0.5 the quadratic term is non-zero → hexagonal spots expected (Ermentrout 1991).
   */
  operatingPoint: number;
  /** Activator and inhibitor diffusion coefficients [ℓ²/τ]. */
  dA: number;
  dH: number;
  /** Field decay rates [1/τ]. */
  kA: number;
  kH: number;
  /**
   * Rate = decay of the two genes' intracellular stage. Fast (≫ k) makes the gene
   * level track its input almost instantly, so the system reduces to the classic
   * two-species reaction–diffusion model; slow adds a delay that pushes the
   * uniform mode toward an oscillatory (Hopf) instability.
   */
  geneRate: number;
}

export const TURING_DEFAULTS: TuringParams = { operatingPoint: 0.5, dA: 0.1, dH: 8, kA: 0.1, kH: 0.25, geneRate: 5 };

/**
 * Activator–inhibitor pair in the gene-circuit model (Gierer–Meinhardt-like):
 * morphogen A activates itself and H; morphogen H represses A; D_H ≫ D_A.
 *
 * Parameters are chosen so that the homogeneous state is a* = h* = 1 (field
 * concentrations), with the activator at σ = operatingPoint and the inhibitor at
 * its inflection point. Weights are rescaled by 1/(1 − p) so the LINEARISED system
 * is identical for every operating point: same instability, same predicted
 * wavelength. Only the nonlinearity changes, which is what decides spots vs stripes.
 *
 * Reduced (fast-gene) Jacobian at the steady state, for any p:
 *   f_a = k_A,  f_h = −2k_A,  g_a = 2k_H,  g_h = −k_H
 * so trace = k_A − k_H < 0 and det = 3k_A·k_H > 0 (uniform state stable), and the
 * Turing condition D_H·f_a + D_A·g_h > 2√(D_A·D_H·det) holds for D_H/D_A ≳ 28
 * at the default k's.
 */
/** The designed homogeneous steady state (gene levels x, field levels c) for a given operating point. */
export function turingSteadyGuess(params: Partial<TuringParams> = {}): { x: number[]; c: number[] } {
  const p = params.operatingPoint ?? TURING_DEFAULTS.operatingPoint;
  return { x: [p, 0.5], c: [1, 1] };
}

export function turingPair(params: Partial<TuringParams> = {}): Genome {
  const { operatingPoint: p, dA, dH, kA, kH, geneRate: r } = { ...TURING_DEFAULTS, ...params };
  const scale = 0.5 / (1 - p);
  const wAA = 4 * scale, wAH = -4 * scale;
  const wHA = 4;
  return buildGenome([
    {
      name: 'A', type: 'morphogen', rate: r, decay: r,
      bias: logit(p) - wAA - wAH, sites: { A: wAA, H: wAH },
      diffusion: dA, secretion: kA / p, fieldDecay: kA,
    },
    {
      name: 'H', type: 'morphogen', rate: r, decay: r,
      bias: -wHA, sites: { A: wHA },
      diffusion: dH, secretion: kH / 0.5, fieldDecay: kH,
    },
  ]);
}

/**
 * Wolpert's French flag, version 1: a fixed 64×16 tissue whose left column carries
 * a maternal determinant S. S keeps itself on (bistable auto-activation, so the
 * pre-pattern is remembered) and drives secretion of morphogen M. Three target
 * genes read the gradient with thresholds, and cross-repression makes each cell
 * pick exactly one fate:
 *
 *   B (blue)  on above θ_B
 *   W (white) on above θ_W, repressed by B
 *   R (red)   on by default, repressed by B and W
 *
 * Gradient: D = 1, k = 1/400 → decay length L = √(D/k) = 20 cells. The
 * thresholds are the steady-state concentrations at x ≈ 21 and x ≈ 42, so each
 * colour gets about a third of the 64-cell axis.
 *
 * `feedback` is the strength of each read-out gene's self-activation. With 0
 * (a pure threshold read-out) the boundaries of a smooth exponential gradient are
 * 6–10 cells wide and W leaks into the blue band; with feedback the read-outs
 * become bistable switches and the boundaries sharpen to 1–2 cells, the role
 * cross-regulation plays among the Drosophila gap genes.
 */
export function frenchFlag(opts: { thetaB?: number; thetaW?: number; w?: number; feedback?: number; repression?: number } = {}): Genome {
  const { thetaB = 2.0, thetaW = 1.17, w = 8, feedback = 6, repression = 30 } = opts;
  return buildGenome([
    { name: 'S', type: 'tf', bias: -4, sites: { S: 8 } },
    { name: 'M', type: 'morphogen', bias: -5, sites: { S: 10 }, diffusion: 1, fieldDecay: 1 / 400, secretion: 0.2 },
    // Bias −w·θ − feedback/2 centres each bistable switch on its threshold θ.
    { name: 'B', type: 'tf', bias: -w * thetaB - feedback / 2, sites: { M: w, B: feedback } },
    { name: 'W', type: 'tf', bias: -w * thetaW - feedback / 2, sites: { M: w, W: feedback, B: -repression } },
    { name: 'R', type: 'tf', bias: 6, sites: { W: -repression, B: -repression } },
  ]);
}

/**
 * French flag, version 2: grown from one zygote. The maternal determinant S is
 * fully asymmetric (asymmetry = 1): at every division of an S cell, the daughter
 * on the +polarity side inherits all of it. With polarity inherited from the
 * zygote's cue, the S lineage stays a single cell at the +x pole, an organiser
 * that secretes M as the embryo grows around it (cf. the posterior signalling
 * centres of real embryos). All cells divide constitutively up to the cell cap.
 */
export function frenchFlagEmbryo(opts: { thetaB?: number; thetaW?: number; w?: number; feedback?: number } = {}): Genome {
  const { thetaB = 0.45, thetaW = 0.35, w = 60, feedback = 6 } = opts;
  return buildGenome(
    [
      { name: 'S', type: 'tf', bias: -4, sites: { S: 8 }, asymmetry: 1 },
      { name: 'M', type: 'morphogen', bias: -5, sites: { S: 10 }, diffusion: 1, fieldDecay: 1 / 36, secretion: 2 },
      // Self-activation makes each read-out a bistable switch: boundaries sharpen and
      // fates are remembered, as with the cross-regulating gap genes of Drosophila.
      { name: 'B', type: 'tf', bias: -w * thetaB, sites: { M: w, B: feedback } },
      { name: 'W', type: 'tf', bias: -w * thetaW, sites: { M: w, W: feedback, B: -20 } },
      { name: 'R', type: 'tf', bias: 6, sites: { W: -20, B: -20 } },
      { name: 'grow', type: 'effector', effector: 'divide', bias: 4 },
    ],
    { S: 1 },
  );
}

/**
 * Two cell types that differ only in adhesion, for Steinberg's sorting experiments.
 * T is a bistable fate switch (set by the initial state, then remembered). T cells
 * express cadherin cadA; non-T cells express cadB, unless `sameCadherin`, in which
 * case both types express cadA, T cells at level 1 and others at `lowLevel`
 * (Steinberg & Takeichi 1994: cells sort by cadherin AMOUNT alone).
 */
export function sortingPair(opts: { sameCadherin?: boolean; lowLevel?: number; identical?: boolean; binding?: number } = {}): Genome {
  const { sameCadherin = false, lowLevel = 0.4, identical = false, binding = 1 } = opts;
  const genes: Parameters<typeof buildGenome>[0] = [
    { name: 'T', type: 'tf', bias: -4, sites: { T: 8 } },
  ];
  if (identical) {
    genes.push({ name: 'cadA', type: 'adhesion', binding, bias: 8 });
  } else if (sameCadherin) {
    // Level = σ(bias + w·T): ≈1 in T cells, ≈lowLevel in the others.
    genes.push({ name: 'cadA', type: 'adhesion', binding, bias: logit(lowLevel), sites: { T: 10 - logit(lowLevel) } });
  } else {
    genes.push({ name: 'cadA', type: 'adhesion', binding, bias: -8, sites: { T: 16 } });
    genes.push({ name: 'cadB', type: 'adhesion', binding, bias: 8, sites: { T: -16 } });
  }
  return buildGenome(genes);
}

/**
 * Lateral inhibition (Collier et al. 1996): Delta is a contact ligand; Notch
 * activity N rises with the neighbours' Delta; N represses the cell's own Delta.
 * Neighbours therefore push each other into opposite states: salt-and-pepper fates.
 */
export function lateralInhibition(opts: { w?: number } = {}): Genome {
  const { w = 12 } = opts;
  return buildGenome([
    { name: 'Dl', type: 'contact', binding: 1, bias: w / 2, sites: { N: -w } },
    { name: 'N', type: 'tf', bias: -w / 2, sites: { Dl: w } },
  ]);
}
