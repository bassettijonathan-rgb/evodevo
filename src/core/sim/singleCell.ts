/**
 * Single-cell dynamics: run one cell's GRN in isolation with fixed external
 * signals. Used by the M1 tests and the debug page; multicellular development
 * (develop.ts) reuses the same stepGRN.
 */
import { makeConfig, type SimConfig } from '../config';
import { compileGenome, type CompiledGRN } from '../genome/compile';
import type { GeneId, Genome } from '../genome/types';
import { Rng, type Seed } from '../rng';
import { CellStore } from './cells';
import { stepGRN } from './grn';
import { applyClamps, compileClamps, type Perturbation } from './perturb';

export interface SingleCellOptions {
  config?: Partial<SimConfig>;
  /** Simulated time [τ]. */
  tEnd: number;
  /** Record every k-th step (default 1). */
  recordEvery?: number;
  /** Initial levels by gene id; defaults to the genome's maternal state. */
  initial?: Record<GeneId, number>;
  /** Constant external signal for morphogen/contact genes, by gene id (what the cell "senses"). */
  inputs?: Record<GeneId, number>;
  perturbations?: Perturbation[];
  seed?: Seed;
}

export class TimeSeries {
  constructor(
    readonly grn: CompiledGRN,
    /** Sample times. */
    readonly t: Float64Array,
    /** Row-major samples: x[k*G + i] is gene i at time t[k]. */
    readonly x: Float64Array,
  ) {}

  get length(): number {
    return this.t.length;
  }

  /** Trajectory of one gene, by name or dense index. */
  gene(which: string | number): Float64Array {
    const i = typeof which === 'number' ? which : this.grn.names.indexOf(which);
    if (i < 0 || i >= this.grn.G) throw new Error(`no gene ${which}`);
    const out = new Float64Array(this.length);
    for (let k = 0; k < this.length; k++) out[k] = this.x[k * this.grn.G + i];
    return out;
  }

  /** Final state, length G. */
  final(): Float64Array {
    const G = this.grn.G;
    return this.x.slice((this.length - 1) * G, this.length * G);
  }
}

export function simulateSingleCell(genome: Genome, opts: SingleCellOptions): TimeSeries {
  const cfg = makeConfig(opts.config);
  const grn = compileGenome(genome, cfg.dt);
  const G = grn.G;
  const cells = new CellStore(1, G);
  cells.add(0, 0, 0.5);

  if (opts.initial) {
    for (const [id, v] of Object.entries(opts.initial)) cells.x[grn.indexOf.get(Number(id))!] = v;
  } else {
    cells.x.set(grn.maternal);
  }
  for (const [id, v] of Object.entries(opts.inputs ?? {})) {
    const i = grn.indexOf.get(Number(id))!;
    if (!grn.sensed[i]) throw new Error(`gene ${id} is not a sensed (morphogen/contact) gene`);
    cells.input[i] = v;
  }

  const clamps = compileClamps(grn, opts.perturbations ?? []);
  const rng = new Rng(opts.seed ?? 0).fork('expression');
  const steps = Math.round(opts.tEnd / cfg.dt);
  const every = opts.recordEvery ?? 1;
  const nRec = Math.floor(steps / every) + 1;
  const tOut = new Float64Array(nRec);
  const xOut = new Float64Array(nRec * G);

  applyClamps(clamps, cells, 0);
  xOut.set(cells.x.subarray(0, G), 0);
  let rec = 1;
  for (let s = 1; s <= steps; s++) {
    const t = s * cfg.dt;
    stepGRN(grn, cells, cfg.expressionNoise, rng);
    applyClamps(clamps, cells, t);
    if (s % every === 0) {
      tOut[rec] = t;
      xOut.set(cells.x.subarray(0, G), rec * G);
      rec++;
    }
  }
  return new TimeSeries(grn, tOut, xOut);
}
