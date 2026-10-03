/**
 * Recombination by gene identity (DESIGN.md §7.1), like NEAT's innovation numbers:
 * genes are aligned by id, not by position. Shared genes come from either parent
 * at random; genes present in only one parent are inherited from the dominant
 * parent (the first one). Sites pointing at genes the child lacks are dropped.
 */
import { cloneGenome } from '../genome/serialize';
import type { Genome } from '../genome/types';
import type { Rng } from '../rng';

export function crossover(dominant: Genome, other: Genome, rng: Rng): Genome {
  const a = cloneGenome(dominant);
  const b = cloneGenome(other);
  const fromB = new Map(b.genes.map((g) => [g.id, g]));
  const genes = a.genes.map((g) => (fromB.has(g.id) && rng.float() < 0.5 ? fromB.get(g.id)! : g));
  const ids = new Set(genes.map((g) => g.id));
  for (const g of genes) {
    g.sites = g.sites.filter((s) => ids.has(s.regulator));
    if (g.cue !== undefined && !ids.has(g.cue)) delete g.cue;
  }
  const maternal: Record<number, number> = {};
  for (const id of ids) {
    const pick = rng.float() < 0.5 ? a.maternal[id] ?? b.maternal[id] : b.maternal[id] ?? a.maternal[id];
    if (pick !== undefined) maternal[id] = pick;
  }
  return { schema: 1, genes, maternal, nextGeneId: Math.max(a.nextGeneId, b.nextGeneId) };
}
