/**
 * Genome → CompiledGRN: the hot-path representation used by the simulator (DESIGN.md §4.2).
 *
 * - Gene ids are mapped to dense indices 0..G−1 (genome order).
 * - The regulatory network is stored in CSR (compressed sparse row) form:
 *   the inputs of gene i are edges rowPtr[i] .. rowPtr[i+1]−1, each with a
 *   source gene index col[e] and weight[e].
 * - Edges from products that cannot regulate (adhesion, effector) are dropped
 *   here but stay in the genome as cryptic variation.
 */
import { EFFECTOR_KINDS, isRegulatorType, type EffectorKind, type GeneId, type Genome, type ProductType } from './types';
import { exp } from '../math';

export interface CompiledGRN {
  /** Number of genes. */
  G: number;
  /** Δt the per-gene decay factors were computed for. */
  dt: number;
  ids: Int32Array;
  names: string[];
  types: ProductType[];
  indexOf: Map<GeneId, number>;

  bias: Float64Array;
  rate: Float64Array;
  decay: Float64Array;
  /** 1/λ — so the steady state for production P is P·invDecay. */
  invDecay: Float64Array;
  /** e^{−λΔt}, for the exponential integrator. */
  expDecay: Float64Array;
  /** R/λ — the maximum attainable level. */
  maxLevel: Float64Array;
  asymmetry: Float64Array;

  rowPtr: Int32Array;
  col: Int32Array;
  weight: Float64Array;

  /** 1 if the gene's regulatory signal is sensed from outside the cell (morphogen field, contact). */
  sensed: Uint8Array;

  tfIdx: Int32Array;
  morphIdx: Int32Array;
  /** Gene index → index of its field in the morphogen grid (−1 for non-morphogens). */
  fieldOf: Int32Array;
  contactIdx: Int32Array;
  adhIdx: Int32Array;
  effIdx: Record<EffectorKind, Int32Array>;

  // Type-specific parameters by gene index (0 where not applicable).
  diffusion: Float64Array;
  secretion: Float64Array;
  fieldDecay: Float64Array;
  binding: Float64Array;
  /** polarize effectors: gene index of the cue morphogen, or −1 if none / not a morphogen. */
  cueIdx: Int32Array;
  cueSign: Float64Array;

  /** Zygote initial state, length G. */
  maternal: Float64Array;
}

export function compileGenome(genome: Genome, dt: number): CompiledGRN {
  const genes = genome.genes;
  const G = genes.length;
  const indexOf = new Map<GeneId, number>();
  genes.forEach((g, i) => indexOf.set(g.id, i));

  const f = () => new Float64Array(G);
  const bias = f(), rate = f(), decay = f(), invDecay = f(), expDecay = f(), maxLevel = f(), asymmetry = f();
  const diffusion = f(), secretion = f(), fieldDecay = f(), binding = f(), cueSign = f(), maternal = f();
  const cueIdx = new Int32Array(G).fill(-1);
  const sensed = new Uint8Array(G);

  const rowPtr = new Int32Array(G + 1);
  const cols: number[] = [];
  const weights: number[] = [];

  genes.forEach((g, i) => {
    bias[i] = g.bias;
    rate[i] = g.rate;
    decay[i] = g.decay;
    invDecay[i] = 1 / g.decay;
    expDecay[i] = exp(-g.decay * dt);
    maxLevel[i] = g.rate / g.decay;
    asymmetry[i] = g.asymmetry;
    sensed[i] = g.type === 'morphogen' || g.type === 'contact' ? 1 : 0;
    if (g.type === 'morphogen') {
      diffusion[i] = g.diffusion!;
      secretion[i] = g.secretion!;
      fieldDecay[i] = g.fieldDecay!;
    }
    if (g.type === 'adhesion' || g.type === 'contact') binding[i] = g.binding!;
    if (g.type === 'effector' && g.effector === 'polarize' && g.cue !== undefined) {
      const c = indexOf.get(g.cue);
      if (c !== undefined && genes[c].type === 'morphogen') {
        cueIdx[i] = c;
        cueSign[i] = g.cueSign ?? 1;
      }
    }

    rowPtr[i] = cols.length;
    for (const s of g.sites) {
      const j = indexOf.get(s.regulator)!;
      if (!isRegulatorType(genes[j].type)) continue; // inert: adhesion/effector products don't bind DNA
      cols.push(j);
      weights.push(s.weight);
    }
  });
  rowPtr[G] = cols.length;

  for (const [id, v] of Object.entries(genome.maternal)) {
    const i = indexOf.get(Number(id));
    if (i !== undefined) maternal[i] = v;
  }

  const indicesWhere = (pred: (i: number) => boolean) => Int32Array.from(genes.map((_, i) => i).filter(pred));
  const effIdx = Object.fromEntries(
    EFFECTOR_KINDS.map((k) => [k, indicesWhere((i) => genes[i].type === 'effector' && genes[i].effector === k)]),
  ) as Record<EffectorKind, Int32Array>;

  const morphIdx = indicesWhere((i) => genes[i].type === 'morphogen');
  const fieldOf = new Int32Array(G).fill(-1);
  morphIdx.forEach((g, m) => (fieldOf[g] = m));

  return {
    G, dt,
    ids: Int32Array.from(genes.map((g) => g.id)),
    names: genes.map((g) => g.name),
    types: genes.map((g) => g.type),
    indexOf,
    bias, rate, decay, invDecay, expDecay, maxLevel, asymmetry,
    rowPtr, col: Int32Array.from(cols), weight: Float64Array.from(weights),
    sensed,
    tfIdx: indicesWhere((i) => genes[i].type === 'tf'),
    morphIdx,
    fieldOf,
    contactIdx: indicesWhere((i) => genes[i].type === 'contact'),
    adhIdx: indicesWhere((i) => genes[i].type === 'adhesion'),
    effIdx,
    diffusion, secretion, fieldDecay, binding, cueIdx, cueSign,
    maternal,
  };
}
