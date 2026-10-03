/**
 * The breeding session's phylogeny: every individual that was shown or selected,
 * with its genome, metrics, parents and mutation log. Persisted to IndexedDB after
 * every generation so a session survives a reload. Organisms are not stored;
 * they regrow deterministically from (genome, sim config, seed).
 */
import { signal } from '@preact/signals';
import type { SimConfig } from '../core/config';
import type { PhyloNode } from '../core/evolution/phylogeny';
import type { Evolution } from '../core/evolution/population';
import type { Genome } from '../core/genome/types';
import type { Metrics } from '../core/metrics';
import { idb } from './idb';

export interface SessionNode extends PhyloNode {
  genome: Genome;
  metrics?: Metrics;
  fitness?: number;
  sim: Partial<SimConfig>;
  seed: string;
}

export interface SessionMeta {
  presetId: string;
  savedAt: number;
  /** Ids of the population currently on screen (the tips of the tree). */
  current: number[];
  nextId: number;
  generation: number;
  /** Evolution seed and simulation config of the current run (to resume it). */
  seed: string;
  sim: Partial<SimConfig>;
}

export const phylo = signal<Map<number, SessionNode>>(new Map());
export const sessionMeta = signal<SessionMeta | null>(null);

/** Add the evaluated members of the current population to the phylogeny. */
export function recordPopulation(evo: Evolution, presetId: string): void {
  const map = new Map(phylo.value);
  const fresh: [number, SessionNode][] = [];
  for (const ind of evo.population) {
    if (map.has(ind.id) || !ind.result) continue;
    const node: SessionNode = {
      id: ind.id, parents: ind.parents, generation: ind.generation, log: ind.log,
      genome: ind.genome, metrics: ind.result.metrics, fitness: ind.fitness,
      sim: evo.settings.sim, seed: evo.seedFor(ind),
    };
    map.set(ind.id, node);
    fresh.push([ind.id, node]);
  }
  phylo.value = map;
  const meta: SessionMeta = {
    presetId, savedAt: Date.now(), current: evo.population.map((i) => i.id),
    nextId: evo.nextIndividualId, generation: evo.generation,
    seed: evo.settings.seed, sim: evo.settings.sim,
  };
  sessionMeta.value = meta;
  void idb.putMany('nodes', fresh);
  void idb.put('meta', 'session', meta);
}

export async function clearSession(): Promise<void> {
  phylo.value = new Map();
  sessionMeta.value = null;
  await idb.clear('nodes');
  await idb.clear('meta');
}

/** Load the previous session from IndexedDB (null if none). */
export async function loadSavedSession(): Promise<{ meta: SessionMeta; nodes: SessionNode[] } | null> {
  const meta = await idb.get<SessionMeta>('meta', 'session');
  if (!meta) return null;
  const nodes = (await idb.getAll<SessionNode>('nodes')) ?? [];
  return nodes.length ? { meta, nodes } : null;
}

/** The lineage from the root to `id` (genomes and mutation logs), for export. */
export function lineageOf(id: number): SessionNode[] {
  const out: SessionNode[] = [];
  let cur = phylo.value.get(id);
  while (cur) {
    out.push(cur);
    cur = cur.parents.length ? phylo.value.get(cur.parents[0]) : undefined;
  }
  return out.reverse();
}
