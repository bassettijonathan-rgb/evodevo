/**
 * Simulation parameters, gathered in one place (DESIGN.md §8.2).
 *
 * Units: length in cell diameters (ℓ), time in developmental time units (τ),
 * concentrations are dimensionless and O(1).
 */
export interface SimConfig {
  // ---------------------------------------------------------------- time
  /** Developmental time step Δt [τ]. GRN, effectors and the outer loop advance by this. */
  dt: number;
  /** Total developmental time [τ]. */
  tDev: number;

  // ---------------------------------------------------------------- expression
  /**
   * Intrinsic expression noise, as the 1/√Ω factor of the chemical Langevin equation
   * (Ω = "system size", roughly molecules per unit concentration). 0 = deterministic.
   *   dx = (P − λx)dt + noise·√((P + λx)·dt)·ξ
   * Typical biological values correspond to ~0.02–0.1.
   */
  expressionNoise: number;

  // ---------------------------------------------------------------- morphogen grid
  /** Grid nodes in x and y. Node (i, j) sits at (i·h, j·h); each node is an h×h control volume. */
  gridNx: number;
  gridNy: number;
  /** Grid spacing h [ℓ]. */
  gridH: number;
  /** Explicit diffusion sub-steps are chosen so that D·Δt_sub/h² ≤ this (stability limit is 0.25). */
  diffusionCFL: number;

  // ---------------------------------------------------------------- cells and effectors
  /** Cell radius [ℓ] (diameter = 1ℓ by definition of the length unit). */
  cellRadius: number;
  /** Maximum number of live cells. Divisions beyond the cap are postponed. */
  maxCells: number;
  /**
   * Effector drive E = Σ levels of effector genes of a kind. Each accumulator grows at
   *   k · clamp((E − θ)/(1 − θ), 0, 1)
   * and fires at 1. So 1/k is the minimum time to fire (e.g. the shortest cell cycle).
   */
  divideRate: number;
  divideThreshold: number;
  dieRate: number;
  dieThreshold: number;
  differentiateRate: number;
  differentiateThreshold: number;
  /** Rate at which polarity turns toward a cue gradient [1/τ per unit effector]. */
  polarizeRate: number;
  /** Std of the Gaussian perturbation added to the unit division axis (≈ radians for small values). */
  divisionJitter: number;
  /** Daughters are placed at ±offset·axis from the mother's centre [ℓ]. */
  divisionOffset: number;
  /** Cells up to this generation are "founders" for lineage colouring (3 → 8-cell stage). */
  founderGeneration: number;
  /** Initial polarity of the zygote (environmental cue, e.g. sperm entry). [0,0] = none. */
  zygotePolarity: [number, number];

  // ---------------------------------------------------------------- mechanics
  /** Turn mechanics off entirely (static tissues). */
  mechanics: boolean;
  /** Drag coefficient γ. */
  drag: number;
  /** Repulsion stiffness k_rep [force/ℓ]. */
  repulsion: number;
  /** Non-specific adhesion A₀ (ECM, glycocalyx) [force]. */
  adhesionBase: number;
  /**
   * Saturation of specific (cadherin) adhesion: S = Σ J·min(a, b) becomes
   * S/(1 + S/adhesionMax), since a contact has a finite number of bond sites.
   */
  adhesionMax: number;
  /** Range beyond contact over which adhesion fades to zero [ℓ]. */
  adhesionRange: number;
  /** Effective temperature of active motility noise, k_B·T_eff (D8). 0 = none. */
  motility: number;
  /** Minimum mechanics sub-steps per developmental step (more are used automatically when contacts are stiff). */
  mechanicsSubsteps: number;

  // ---------------------------------------------------------------- limits and output
  maxGenes: number;
  maxMorphogens: number;
  /** Record a playback frame every this many steps (0 = no recording). */
  recordEvery: number;
}

export const DEFAULT_CONFIG: Readonly<SimConfig> = Object.freeze({
  dt: 0.1,
  tDev: 300,
  expressionNoise: 0,

  gridNx: 128,
  gridNy: 128,
  gridH: 1,
  diffusionCFL: 0.2,

  cellRadius: 0.5,
  maxCells: 1000,
  divideRate: 0.2,
  divideThreshold: 0.1,
  dieRate: 0.2,
  dieThreshold: 0.3,
  differentiateRate: 0.2,
  differentiateThreshold: 0.3,
  polarizeRate: 1,
  divisionJitter: 0.2,
  divisionOffset: 0.25,
  founderGeneration: 3,
  zygotePolarity: [1, 0] as [number, number],

  mechanics: true,
  drag: 1,
  repulsion: 10,
  adhesionBase: 0.3,
  adhesionMax: 1.5,
  adhesionRange: 0.25,
  motility: 0.002,
  mechanicsSubsteps: 5,

  maxGenes: 32,
  maxMorphogens: 6,
  recordEvery: 10,
});

/** Defaults overridden by `overrides`. */
export function makeConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return { ...DEFAULT_CONFIG, zygotePolarity: [...DEFAULT_CONFIG.zygotePolarity], ...overrides };
}
