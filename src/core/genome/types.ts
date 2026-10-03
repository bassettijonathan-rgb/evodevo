/**
 * Genome data model (DESIGN.md §3.1, §4.1).
 *
 * The genome is plain JSON-serialisable data. Simulation never reads it directly;
 * it is first compiled into a CompiledGRN (compile.ts) with dense indices and
 * typed arrays.
 */

export type GeneId = number;

export type ProductType =
  | 'tf' // transcription factor: acts inside the cell that makes it
  | 'morphogen' // secreted, diffuses on the grid; cells respond to the local field
  | 'contact' // juxtacrine ligand (Delta-like): cells respond to their NEIGHBOURS' levels
  | 'adhesion' // homophilic adhesion molecule (cadherin-like)
  | 'effector'; // drives a cell behaviour

export type EffectorKind = 'divide' | 'die' | 'polarize' | 'differentiate';

export const PRODUCT_TYPES: readonly ProductType[] = ['tf', 'morphogen', 'contact', 'adhesion', 'effector'];
export const EFFECTOR_KINDS: readonly EffectorKind[] = ['divide', 'die', 'polarize', 'differentiate'];

/** Product types that bind DNA / signal into the GRN, i.e. can act as regulators. */
export function isRegulatorType(t: ProductType): boolean {
  return t === 'tf' || t === 'morphogen' || t === 'contact';
}

/** One cis-regulatory binding site: the regulator it binds and how strongly (sign = activate/repress). */
export interface Site {
  regulator: GeneId;
  weight: number;
}

export interface Gene {
  /** Innovation number: unique, never reused within a lineage. */
  id: GeneId;
  name: string;
  type: ProductType;

  /** b_i: basal activity of the promoter. */
  bias: number;
  /** R_i: maximum production rate [conc/τ]. */
  rate: number;
  /** λ_i: first-order decay rate [1/τ]. Steady-state maximum is R/λ. */
  decay: number;
  /** In [−1, 1]: unequal partition between daughters along the polarity axis at division. */
  asymmetry: number;
  /** Sparse cis-regulatory region. At most one site per regulator. */
  sites: Site[];

  // ---- Type-specific parameters. Kept when the type changes (cryptic variation). ----
  /** morphogen: diffusion coefficient D [ℓ²/τ]. */
  diffusion?: number;
  /** morphogen: secretion rate per unit intracellular level [conc·ℓ²/τ]. */
  secretion?: number;
  /** morphogen: decay of the extracellular field k [1/τ]. */
  fieldDecay?: number;
  /** adhesion: bond strength J_k. contact: coupling strength. */
  binding?: number;
  /** effector: which behaviour it drives. */
  effector?: EffectorKind;
  /** polarize effector: the morphogen whose gradient sets polarity, and direction (+1 up, −1 down). */
  cue?: GeneId;
  cueSign?: 1 | -1;
}

export interface Genome {
  schema: 1;
  genes: Gene[];
  /** Zygote's initial product concentrations (maternal-effect genes). */
  maternal: Record<GeneId, number>;
  /** Next unused innovation number. */
  nextGeneId: GeneId;
}
