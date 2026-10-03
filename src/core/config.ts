/**
 * Simulation parameters, gathered in one place (DESIGN.md §8.2).
 *
 * Units: length in cell diameters (ℓ), time in developmental time units (τ),
 * concentrations are dimensionless and O(1).
 *
 * Fields are added milestone by milestone as the mechanisms that use them land.
 */
export interface SimConfig {
  /** Developmental time step Δt [τ]. GRN, effectors and the outer loop advance by this. */
  dt: number;

  /**
   * Intrinsic expression noise, as the 1/√Ω factor of the chemical Langevin equation
   * (Ω = "system size", roughly molecules per unit concentration). 0 = deterministic.
   *   dx = (P − λx)dt + noise·√((P + λx)·dt)·ξ
   * Typical biological values correspond to ~0.02–0.1.
   */
  expressionNoise: number;

  /** Maximum number of live cells. Divisions beyond the cap are blocked. */
  maxCells: number;

  /** Genome size limits (enforced by validation and the mutation operators). */
  maxGenes: number;
  maxMorphogens: number;
}

export const DEFAULT_CONFIG: Readonly<SimConfig> = Object.freeze({
  dt: 0.1,
  expressionNoise: 0,
  maxCells: 1000,
  maxGenes: 32,
  maxMorphogens: 6,
});

/** Defaults overridden by `overrides`. */
export function makeConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
