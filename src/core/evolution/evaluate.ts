/**
 * Evaluate one genome: grow it and measure it. This is the unit of work that the
 * worker pool parallelises; it is a pure function of the job, so results do not
 * depend on which worker ran it or when.
 */
import type { SimConfig } from '../config';
import { assignTypes, computeMetrics, type Metrics } from '../metrics';
import type { Genome } from '../genome/types';
import type { Seed } from '../rng';
import { develop, type InitialCondition } from '../sim/develop';
import type { Perturbation } from '../sim/perturb';
import type { Frame } from '../sim/recorder';

export interface EvalJob {
  genome: Genome;
  config: Partial<SimConfig>;
  seed: Seed;
  perturbations?: Perturbation[];
  /** Default: a zygote. */
  initial?: InitialCondition;
  /** Default: config.tDev. */
  tEnd?: number;
  /** Keep the playback frames (big; only for organisms the user will inspect). */
  keepFrames?: boolean;
}

/** Compact final state, enough to draw a thumbnail. */
export interface FinalSnapshot {
  n: number;
  G: number;
  px: Float32Array;
  py: Float32Array;
  /** Cell-type index per cell (−1 = rare). */
  typeOf: Int32Array;
  x: Float32Array;
  /** Grid size, for drawing in world coordinates. */
  width: number;
  height: number;
}

export interface EvalResult {
  metrics: Metrics;
  final: FinalSnapshot;
  frames?: Frame[];
  /** Developmental bookkeeping. */
  divisions: number;
  deaths: number;
  cappedSteps: number;
  elapsedMs: number;
}

export function evaluate(job: EvalJob): EvalResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const e = develop(job.genome, {
    config: { ...job.config, recordEvery: job.keepFrames ? (job.config.recordEvery || 10) : 0 },
    seed: job.seed,
    perturbations: job.perturbations,
    initial: job.initial,
    tEnd: job.tEnd,
  });
  const { cells, grn } = e;
  const n = cells.n;
  const state = { n, px: cells.px, py: cells.py, x: cells.x, grn };
  const metrics = computeMetrics(state);
  const final: FinalSnapshot = {
    n,
    G: grn.G,
    px: Float32Array.from(cells.px.subarray(0, n)),
    py: Float32Array.from(cells.py.subarray(0, n)),
    typeOf: assignTypes(state).typeOf,
    x: Float32Array.from(cells.x.subarray(0, n * grn.G)),
    width: e.grid.width,
    height: e.grid.height,
  };
  return {
    metrics,
    final,
    frames: job.keepFrames ? e.frames : undefined,
    divisions: e.stats.divisions,
    deaths: e.stats.deaths,
    cappedSteps: e.stats.cappedSteps,
    elapsedMs: (typeof performance !== 'undefined' ? performance.now() : 0) - t0,
  };
}
