/**
 * In-silico perturbations (DESIGN.md §9.5, D12): knockout, overexpression and
 * ectopic expression restricted in time and/or space.
 *
 * A perturbation clamps a gene's product level after every GRN update.
 * Knockout clamps to 0; overexpression clamps to the gene's maximum R/λ.
 */
import type { CompiledGRN } from '../genome/compile';
import type { GeneId } from '../genome/types';
import type { CellStore } from './cells';

export type ClampMode = 'knockout' | 'overexpress' | { level: number };

export interface Perturbation {
  gene: GeneId;
  mode: ClampMode;
  /** Active for from ≤ t < until (defaults: always). */
  from?: number;
  until?: number;
  /** Only cells whose centre lies inside this disc (default: every cell). */
  region?: { x: number; y: number; r: number };
}

/** Perturbation resolved against a compiled genome. */
export interface Clamp {
  index: number;
  level: number;
  from: number;
  until: number;
  region: { x: number; y: number; r2: number } | null;
}

export function compileClamps(grn: CompiledGRN, perturbations: readonly Perturbation[]): Clamp[] {
  const clamps: Clamp[] = [];
  for (const p of perturbations) {
    const index = grn.indexOf.get(p.gene);
    if (index === undefined) continue; // gene not in this genome (e.g. deleted by mutation)
    const level =
      p.mode === 'knockout' ? 0 : p.mode === 'overexpress' ? grn.maxLevel[index] : p.mode.level;
    clamps.push({
      index,
      level,
      from: p.from ?? -Infinity,
      until: p.until ?? Infinity,
      region: p.region ? { x: p.region.x, y: p.region.y, r2: p.region.r * p.region.r } : null,
    });
  }
  return clamps;
}

export function applyClamps(clamps: readonly Clamp[], cells: CellStore, t: number): void {
  const G = cells.G;
  for (const k of clamps) {
    if (t < k.from || t >= k.until) continue;
    for (let c = 0; c < cells.n; c++) {
      if (k.region) {
        const dx = cells.px[c] - k.region.x;
        const dy = cells.py[c] - k.region.y;
        if (dx * dx + dy * dy > k.region.r2) continue;
      }
      cells.x[c * G + k.index] = k.level;
    }
  }
}
