/**
 * Wild type vs perturbed: detect homeotic-like transformations (DESIGN.md §9.5).
 *
 * Each perturbed cell is matched to the nearest wild-type cell (after aligning
 * centroids), then classified by its expression signature over the typing genes,
 * excluding the genes that were perturbed (their state is forced):
 *   - unchanged:   same signature as its wild-type counterpart
 *   - transformed: a DIFFERENT signature that is itself a wild-type cell type
 *                  (one normal fate replaced by another normal fate, as in homeosis)
 *   - novel:       a signature that no wild-type type has
 */
import type { CompiledGRN } from '../genome/compile';
import type { OrganismState } from './index';

export type CellChange = 0 | 1 | 2; // unchanged, transformed, novel

export interface Comparison {
  change: Uint8Array;
  unchanged: number;
  transformed: number;
  novel: number;
  /** Most frequent transformation, e.g. "1010 → 0110" with its count. */
  topTransformation: { from: string; to: string; count: number } | null;
}

function signatures(s: OrganismState, genes: number[]): string[] {
  const G = s.grn.G;
  const out: string[] = [];
  for (let c = 0; c < s.n; c++) {
    let k = '';
    for (const g of genes) k += s.x[c * G + g] > 0.5 * s.grn.maxLevel[g] ? '1' : '0';
    out.push(k);
  }
  return out;
}

export function compareToWildType(wt: OrganismState, mut: OrganismState, perturbedGenes: number[]): Comparison {
  const grn: CompiledGRN = wt.grn;
  const genes = grn.types.map((t, i) => ((t === 'tf' || t === 'contact') && !perturbedGenes.includes(i) ? i : -1)).filter((i) => i >= 0);
  const sw = signatures(wt, genes), sm = signatures(mut, genes);
  const minCount = Math.max(3, Math.ceil(0.02 * wt.n));
  const tally = new Map<string, number>();
  for (const k of sw) tally.set(k, (tally.get(k) ?? 0) + 1);
  const wtTypes = new Set([...tally].filter(([, n]) => n >= minCount).map(([k]) => k));

  const centroid = (s: OrganismState) => {
    let x = 0, y = 0;
    for (let c = 0; c < s.n; c++) { x += s.px[c]; y += s.py[c]; }
    return [x / Math.max(s.n, 1), y / Math.max(s.n, 1)];
  };
  const [wx, wy] = centroid(wt), [mx, my] = centroid(mut);
  const change = new Uint8Array(mut.n);
  const counts = [0, 0, 0];
  const transforms = new Map<string, number>();
  for (let c = 0; c < mut.n; c++) {
    const x = mut.px[c] - mx + wx, y = mut.py[c] - my + wy;
    let best = -1, bd = Infinity;
    for (let d = 0; d < wt.n; d++) {
      const dd = (wt.px[d] - x) ** 2 + (wt.py[d] - y) ** 2;
      if (dd < bd) { bd = dd; best = d; }
    }
    let k: CellChange = 0;
    if (best >= 0 && sm[c] !== sw[best]) {
      k = wtTypes.has(sm[c]) ? 1 : 2;
      if (k === 1) {
        const key = `${sw[best]} → ${sm[c]}`;
        transforms.set(key, (transforms.get(key) ?? 0) + 1);
      }
    }
    change[c] = k;
    counts[k]++;
  }
  const top = [...transforms].sort((a, b) => b[1] - a[1])[0];
  return {
    change,
    unchanged: counts[0],
    transformed: counts[1],
    novel: counts[2],
    topTransformation: top ? { from: top[0].split(' → ')[0], to: top[0].split(' → ')[1], count: top[1] } : null,
  };
}
