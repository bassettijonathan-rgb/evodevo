/**
 * Development: grow an organism from a genome (DESIGN.md §3.9).
 *
 * One developmental step (first-order operator splitting):
 *   1. sense      sample morphogen fields at each cell; sum contact signals from neighbours
 *   2. express    GRN update for every cell; apply perturbation clamps
 *   3. secrete    deposit morphogen production onto the grid
 *   4. diffuse    per-morphogen diffusion + decay
 *   5. effectors  polarity; cycle/death/differentiation progress; deaths; divisions
 *   6. mechanics  overdamped force integration
 *   7. record     every cfg.recordEvery steps
 *
 * `Embryo` exposes the loop step by step (for the UI); `develop()` runs it to the end.
 */
import { makeConfig, type SimConfig } from '../config';
import { compileGenome, type CompiledGRN } from '../genome/compile';
import type { GeneId, Genome } from '../genome/types';
import { Rng, type Seed } from '../rng';
import { CellStore } from './cells';
import { accumulate, applyDeaths, applyDivisions, updatePolarity, type DivisionEvent } from './effectors';
import { stepGRN } from './grn';
import { Mechanics } from './mechanics';
import { MorphogenGrid } from './morphogens';
import { applyClamps, compileClamps, type Clamp, type Perturbation } from './perturb';
import { snapshot, type Frame } from './recorder';

export interface TissueCell {
  x: number;
  y: number;
  /** Initial levels by gene id (a pre-pattern); unspecified genes start at the maternal value. */
  state?: Record<GeneId, number>;
}

export type InitialCondition =
  /** A single zygote (default: centre of the grid) with the genome's maternal state. */
  | { kind: 'zygote'; x?: number; y?: number }
  /**
   * A ready-made tissue. With `frozen`, cells neither move, divide nor die: a fixed
   * sheet for studying pattern formation alone (French flag, Turing, lateral inhibition).
   */
  | { kind: 'tissue'; cells: TissueCell[]; frozen?: boolean };

export interface DevelopOptions {
  config?: Partial<SimConfig>;
  seed?: Seed;
  perturbations?: Perturbation[];
  initial?: InitialCondition;
  /** Developmental time to run [τ]; default cfg.tDev. */
  tEnd?: number;
  /** Store morphogen fields in recorded frames (default true). */
  recordFields?: boolean;
}

export interface DevelopmentStats {
  steps: number;
  peakCells: number;
  divisions: number;
  deaths: number;
  /** Steps during which a division was postponed because of the cell cap. */
  cappedSteps: number;
}

export class Embryo {
  readonly config: SimConfig;
  readonly grn: CompiledGRN;
  readonly cells: CellStore;
  readonly grid: MorphogenGrid;
  readonly mechanics: Mechanics;
  readonly frames: Frame[] = [];
  readonly divisions: DivisionEvent[] = [];
  readonly stats: DevelopmentStats = { steps: 0, peakCells: 0, divisions: 0, deaths: 0, cappedSteps: 0 };
  readonly frozen: boolean;
  t = 0;

  private readonly clamps: Clamp[];
  private readonly rngExpression: Rng;
  private readonly rngDivision: Rng;
  private readonly rngMechanics: Rng;
  private readonly recordFields: boolean;

  constructor(readonly genome: Genome, opts: DevelopOptions = {}) {
    const cfg = (this.config = makeConfig(opts.config));
    this.grn = compileGenome(genome, cfg.dt);
    const G = this.grn.G;
    const root = new Rng(opts.seed ?? 0);
    this.rngExpression = root.fork('expression');
    this.rngDivision = root.fork('division');
    this.rngMechanics = root.fork('mechanics');
    this.recordFields = opts.recordFields ?? true;

    this.grid = new MorphogenGrid(cfg.gridNx, cfg.gridNy, cfg.gridH, this.grn.morphIdx.length);
    this.mechanics = new Mechanics(cfg, this.grid.width, this.grid.height);
    this.clamps = compileClamps(this.grn, opts.perturbations ?? []);

    const init = opts.initial ?? { kind: 'zygote' };
    this.frozen = init.kind === 'tissue' && !!init.frozen;
    if (init.kind === 'zygote') {
      this.cells = new CellStore(cfg.maxCells, G);
      const c = this.cells.add(init.x ?? this.grid.width / 2, init.y ?? this.grid.height / 2, cfg.cellRadius);
      this.cells.x.set(this.grn.maternal, c * G);
      const [px, py] = cfg.zygotePolarity;
      const len = Math.sqrt(px * px + py * py);
      if (len > 0) {
        this.cells.polX[c] = px / len;
        this.cells.polY[c] = py / len;
      }
    } else {
      this.cells = new CellStore(Math.max(cfg.maxCells, init.cells.length), G);
      for (const tc of init.cells) {
        const c = this.cells.add(tc.x, tc.y, cfg.cellRadius);
        this.cells.x.set(this.grn.maternal, c * G);
        for (const [id, v] of Object.entries(tc.state ?? {})) {
          const i = this.grn.indexOf.get(Number(id));
          if (i !== undefined) this.cells.x[c * G + i] = v;
        }
      }
    }
    applyClamps(this.clamps, this.cells, 0);
    this.stats.peakCells = this.cells.n;
    if (cfg.recordEvery > 0) this.frames.push(snapshot(0, this.cells, this.grid, this.recordFields));
  }

  /** Advance one developmental step. */
  step(): void {
    const { config: cfg, grn, cells, grid } = this;
    const G = grn.G;
    const t = this.t + cfg.dt;

    // 1. sense
    const morph = grn.morphIdx;
    for (let m = 0; m < morph.length; m++) {
      const g = morph[m];
      for (let c = 0; c < cells.n; c++) cells.input[c * G + g] = grid.sample(m, cells.px[c], cells.py[c]);
    }
    this.mechanics.contactInputs(grn, cells);

    // 2. express
    stepGRN(grn, cells, cfg.expressionNoise, this.rngExpression);
    applyClamps(this.clamps, cells, t);

    // 3–4. secrete and diffuse
    for (let m = 0; m < morph.length; m++) {
      const g = morph[m];
      const s = grn.secretion[g] * cfg.dt;
      if (s > 0) for (let c = 0; c < cells.n; c++) grid.deposit(m, cells.px[c], cells.py[c], s * cells.x[c * G + g]);
      grid.diffuse(m, grn.diffusion[g], grn.fieldDecay[g], cfg.dt, cfg.diffusionCFL);
    }

    // 5. effectors
    if (!this.frozen) {
      updatePolarity(grn, cells, grid, cfg);
      accumulate(grn, cells, cfg);
      this.stats.deaths += applyDeaths(cells);
      this.stats.divisions += applyDivisions(grn, cells, cfg, this.rngDivision, t, this.divisions);
      if (cells.full) {
        for (let c = 0; c < cells.n; c++) {
          if (cells.cycle[c] >= 1 && !cells.postmitotic[c]) {
            this.stats.cappedSteps++;
            break;
          }
        }
      }
    }

    // 6. mechanics
    if (!this.frozen && cfg.mechanics && cells.n > 0) this.mechanics.step(grn, cells, this.rngMechanics);

    this.t = t;
    this.stats.steps++;
    if (cells.n > this.stats.peakCells) this.stats.peakCells = cells.n;

    // 7. record
    if (cfg.recordEvery > 0 && this.stats.steps % cfg.recordEvery === 0) {
      this.frames.push(snapshot(t, cells, grid, this.recordFields));
    }
  }

  /** Run until time tEnd (or until every cell has died). */
  runUntil(tEnd: number): this {
    const steps = Math.round((tEnd - this.t) / this.config.dt);
    for (let s = 0; s < steps && this.cells.n > 0; s++) this.step();
    return this;
  }
}

/** Grow an organism from a genome. Deterministic for a given (genome, options, seed). */
export function develop(genome: Genome, opts: DevelopOptions = {}): Embryo {
  const embryo = new Embryo(genome, opts);
  return embryo.runUntil(opts.tEnd ?? embryo.config.tDev);
}

/** Cells on a rectangular lattice filling [x0, x0+nx) × [y0, y0+ny) with spacing 1ℓ. */
export function latticeTissue(
  nx: number,
  ny: number,
  state?: (i: number, j: number) => Record<GeneId, number> | undefined,
  x0 = 0,
  y0 = 0,
): TissueCell[] {
  const out: TissueCell[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push({ x: x0 + i, y: y0 + j, state: state?.(i, j) });
  return out;
}

/**
 * The n lattice sites of a hexagonal packing (spacing `a`) closest to (cx, cy):
 * a roughly circular, densely packed aggregate.
 */
export function hexDisc(
  n: number,
  cx: number,
  cy: number,
  state?: (k: number) => Record<GeneId, number> | undefined,
  a = 0.95,
): TissueCell[] {
  const half = Math.ceil(Math.sqrt(n)) + 2;
  const pts: [number, number][] = [];
  for (let j = -half; j <= half; j++) {
    for (let i = -half; i <= half; i++) pts.push([(i + (Math.abs(j) % 2) * 0.5) * a, (j * a * Math.sqrt(3)) / 2]);
  }
  pts.sort((p, q) => p[0] ** 2 + p[1] ** 2 - (q[0] ** 2 + q[1] ** 2) || p[1] - q[1] || p[0] - q[0]);
  return pts.slice(0, n).map(([x, y], k) => ({ x: cx + x, y: cy + y, state: state?.(k) }));
}
