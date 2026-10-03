/**
 * Effectors: how gene products change cell behaviour (DESIGN.md §3.4).
 *
 * Every behaviour integrates to a threshold (D5). For kind k with drive
 * E = Σ (levels of all effector genes of that kind):
 *
 *   progress += Δt · rate_k · clamp((E − θ_k) / (1 − θ_k), 0, 1)
 *
 * and the behaviour fires when progress reaches 1. Summing over genes of a kind
 * makes duplicated effectors additive, which is what keeps duplication neutral.
 */
import type { SimConfig } from '../config';
import type { CompiledGRN } from '../genome/compile';
import type { Rng } from '../rng';
import type { CellStore } from './cells';
import type { MorphogenGrid } from './morphogens';

/** A division, for lineage records: mother id → two daughter ids at time t. */
export interface DivisionEvent {
  t: number;
  mother: number;
  daughters: [number, number];
}

function drive(grn: CompiledGRN, cells: CellStore, c: number, idx: Int32Array): number {
  let E = 0;
  const base = c * grn.G;
  for (let k = 0; k < idx.length; k++) E += cells.x[base + idx[k]];
  return E;
}

function activation(E: number, threshold: number): number {
  const a = (E - threshold) / (1 - threshold);
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

/**
 * Polarity: each polarize gene turns the polarity vector toward (cueSign = +1)
 * or away from (−1) the gradient of its cue morphogen, at a rate proportional to
 * its expression. With no polarize activity the polarity is kept (cell memory).
 */
export function updatePolarity(grn: CompiledGRN, cells: CellStore, grid: MorphogenGrid | null, cfg: SimConfig): void {
  const pol = grn.effIdx.polarize;
  if (pol.length === 0 || !grid) return;
  const grad = [0, 0];
  for (let c = 0; c < cells.n; c++) {
    let vx = cells.polX[c], vy = cells.polY[c];
    let changed = false;
    for (let k = 0; k < pol.length; k++) {
      const g = pol[k];
      const cue = grn.cueIdx[g];
      if (cue < 0) continue;
      const level = cells.x[c * grn.G + g];
      if (level <= 0) continue;
      grid.gradient(grn.fieldOf[cue], cells.px[c], cells.py[c], grad);
      const norm = Math.sqrt(grad[0] * grad[0] + grad[1] * grad[1]);
      if (norm < 1e-12) continue;
      const step = (cfg.dt * cfg.polarizeRate * level * grn.cueSign[g]) / norm;
      vx += step * grad[0];
      vy += step * grad[1];
      changed = true;
    }
    if (!changed) continue;
    const len = Math.sqrt(vx * vx + vy * vy);
    if (len > 1e-12) {
      cells.polX[c] = vx / len;
      cells.polY[c] = vy / len;
    }
  }
}

/** Accumulate cycle, death and differentiation progress. */
export function accumulate(grn: CompiledGRN, cells: CellStore, cfg: SimConfig): void {
  const dt = cfg.dt;
  for (let c = 0; c < cells.n; c++) {
    if (!cells.postmitotic[c]) {
      cells.cycle[c] += dt * cfg.divideRate * activation(drive(grn, cells, c, grn.effIdx.divide), cfg.divideThreshold);
    }
    cells.death[c] += dt * cfg.dieRate * activation(drive(grn, cells, c, grn.effIdx.die), cfg.dieThreshold);
    cells.diff[c] +=
      dt * cfg.differentiateRate * activation(drive(grn, cells, c, grn.effIdx.differentiate), cfg.differentiateThreshold);
    if (cells.diff[c] >= 1) cells.postmitotic[c] = 1;
  }
}

/**
 * Remove cells whose death progress reached 1 (apoptosis).
 * Iterates downward so swap-removal never skips a cell.
 */
export function applyDeaths(cells: CellStore): number {
  let died = 0;
  for (let c = cells.n - 1; c >= 0; c--) {
    if (cells.death[c] >= 1) {
      cells.remove(c);
      died++;
    }
  }
  return died;
}

/**
 * Divide every cell whose cycle progress reached 1, in index order, while below the cap.
 *
 * Geometry: daughters at mother ± offset·axis. The axis is the polarity vector
 * plus Gaussian jitter (renormalised; no trig, so it stays portable), or a random
 * direction for unpolarized cells.
 *
 * Inheritance: gene product i splits by its asymmetry a_i. The daughter on the
 * +axis side gets concentration (1 + a)·x, the other (1 − a)·x, so the total
 * amount (two half-volume daughters) is conserved.
 */
export function applyDivisions(
  grn: CompiledGRN,
  cells: CellStore,
  cfg: SimConfig,
  rng: Rng,
  t: number,
  events: DivisionEvent[] | null,
): number {
  const G = grn.G;
  const n0 = cells.n; // daughters appended this step do not divide again this step
  let divided = 0;
  for (let c = 0; c < n0; c++) {
    if (cells.cycle[c] < 1 || cells.postmitotic[c]) continue;
    if (cells.full) break;

    let ax = cells.polX[c], ay = cells.polY[c];
    if (ax === 0 && ay === 0) {
      ax = rng.normal();
      ay = rng.normal();
    } else {
      ax += cfg.divisionJitter * rng.normal();
      ay += cfg.divisionJitter * rng.normal();
    }
    const len = Math.sqrt(ax * ax + ay * ay) || 1;
    ax /= len;
    ay /= len;

    const motherId = cells.id[c];
    const motherFounder = cells.founderId[c];
    const mx = cells.px[c], my = cells.py[c];
    const off = cfg.divisionOffset;
    // Daughter B (−axis side) is appended; daughter A (+axis side) reuses the mother's slot.
    const b = cells.add(mx - off * ax, my - off * ay, cells.radius[c], motherId, t);
    cells.px[c] = mx + off * ax;
    cells.py[c] = my + off * ay;
    cells.id[c] = cells.newId();
    cells.parentId[c] = motherId;
    cells.birthTime[c] = t;

    const gen = cells.generation[c] + 1;
    cells.generation[c] = gen;
    cells.generation[b] = gen;
    cells.founderId[c] = gen <= cfg.founderGeneration ? cells.id[c] : motherFounder;
    cells.founderId[b] = gen <= cfg.founderGeneration ? cells.id[b] : motherFounder;
    cells.polX[b] = cells.polX[c];
    cells.polY[b] = cells.polY[c];
    cells.cycle[c] = 0;
    cells.cycle[b] = 0;
    cells.death[b] = cells.death[c];
    cells.diff[b] = cells.diff[c];
    cells.postmitotic[b] = cells.postmitotic[c];
    for (let i = 0; i < G; i++) {
      const v = cells.x[c * G + i];
      const a = grn.asymmetry[i];
      cells.x[c * G + i] = (1 + a) * v;
      cells.x[b * G + i] = (1 - a) * v;
      cells.input[b * G + i] = cells.input[c * G + i];
    }
    events?.push({ t, mother: motherId, daughters: [cells.id[c], cells.id[b]] });
    divided++;
  }
  return divided;
}
