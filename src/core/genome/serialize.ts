/**
 * JSON save/load and a stable content hash.
 *
 * The canonical form lists gene fields in a fixed order, so the same genome always
 * serialises to the same string (and therefore the same hash), regardless of how
 * the object was constructed.
 */
import { hashHex } from '../rng';
import { assertValidGenome } from './validate';
import type { Gene, Genome } from './types';

const GENE_KEYS: (keyof Gene)[] = [
  'id', 'name', 'type', 'bias', 'rate', 'decay', 'asymmetry', 'sites',
  'diffusion', 'secretion', 'fieldDecay', 'binding', 'effector', 'cue', 'cueSign',
];

function canonicalGene(g: Gene): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of GENE_KEYS) {
    if (g[k] === undefined) continue;
    out[k] = k === 'sites' ? g.sites.map((s) => ({ regulator: s.regulator, weight: s.weight })) : g[k];
  }
  return out;
}

function canonical(genome: Genome): Record<string, unknown> {
  const maternalIds = Object.keys(genome.maternal).map(Number).sort((a, b) => a - b);
  return {
    schema: genome.schema,
    nextGeneId: genome.nextGeneId,
    genes: genome.genes.map(canonicalGene),
    maternal: Object.fromEntries(maternalIds.map((id) => [id, genome.maternal[id]])),
  };
}

export function genomeToJSON(genome: Genome, pretty = true): string {
  return JSON.stringify(canonical(genome), null, pretty ? 2 : undefined);
}

export function genomeFromJSON(json: string): Genome {
  const raw = JSON.parse(json) as Genome;
  const genome: Genome = {
    schema: raw.schema,
    nextGeneId: raw.nextGeneId,
    genes: raw.genes,
    // JSON object keys are strings; normalise back to numeric ids.
    maternal: Object.fromEntries(Object.entries(raw.maternal ?? {}).map(([k, v]) => [Number(k), v])),
  };
  assertValidGenome(genome);
  return genome;
}

/** Deep copy. */
export function cloneGenome(genome: Genome): Genome {
  return genomeFromJSON(genomeToJSON(genome, false));
}

/** Stable 128-bit content hash (hex). Equal genomes ⇔ equal hashes (up to collisions). */
export function genomeHash(genome: Genome): string {
  return hashHex(genomeToJSON(genome, false));
}
