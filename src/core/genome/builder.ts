/**
 * Hand-authoring genomes by gene NAME instead of numeric id.
 *
 *   buildGenome([
 *     { name: 'A', type: 'tf', bias: 5, sites: { C: -10 } },
 *     { name: 'B', type: 'tf', bias: 5, sites: { A: -10 } },
 *     { name: 'C', type: 'tf', bias: 5, sites: { B: -10 } },
 *   ])
 *
 * Ids are assigned in list order starting at 0.
 */
import { assertValidGenome } from './validate';
import type { EffectorKind, Gene, Genome, ProductType } from './types';

export interface GeneSpec {
  name: string;
  type: ProductType;
  bias?: number;
  rate?: number;
  decay?: number;
  asymmetry?: number;
  /** Regulator name → weight. */
  sites?: Record<string, number>;
  diffusion?: number;
  secretion?: number;
  fieldDecay?: number;
  binding?: number;
  effector?: EffectorKind;
  /** polarize: name of the cue morphogen. */
  cue?: string;
  cueSign?: 1 | -1;
}

/** Fill in type-specific parameters a gene of `type` needs, if missing. */
export function fillTypeDefaults(g: Gene): Gene {
  switch (g.type) {
    case 'morphogen':
      g.diffusion ??= 1;
      g.secretion ??= 1;
      g.fieldDecay ??= 0.1;
      break;
    case 'adhesion':
    case 'contact':
      g.binding ??= 1;
      break;
    case 'effector':
      g.effector ??= 'divide';
      if (g.effector === 'polarize') g.cueSign ??= 1;
      break;
  }
  return g;
}

export function buildGenome(specs: GeneSpec[], maternal: Record<string, number> = {}): Genome {
  const idOf = new Map<string, number>();
  specs.forEach((s, i) => {
    if (idOf.has(s.name)) throw new Error(`duplicate gene name "${s.name}"`);
    idOf.set(s.name, i);
  });
  const lookup = (name: string): number => {
    const id = idOf.get(name);
    if (id === undefined) throw new Error(`unknown gene name "${name}"`);
    return id;
  };

  const genes: Gene[] = specs.map((s, i) => {
    const g: Gene = {
      id: i,
      name: s.name,
      type: s.type,
      bias: s.bias ?? 0,
      rate: s.rate ?? 1,
      decay: s.decay ?? 1,
      asymmetry: s.asymmetry ?? 0,
      sites: Object.entries(s.sites ?? {}).map(([reg, weight]) => ({ regulator: lookup(reg), weight })),
    };
    if (s.diffusion !== undefined) g.diffusion = s.diffusion;
    if (s.secretion !== undefined) g.secretion = s.secretion;
    if (s.fieldDecay !== undefined) g.fieldDecay = s.fieldDecay;
    if (s.binding !== undefined) g.binding = s.binding;
    if (s.effector !== undefined) g.effector = s.effector;
    if (s.cue !== undefined) g.cue = lookup(s.cue);
    if (s.cueSign !== undefined) g.cueSign = s.cueSign;
    return fillTypeDefaults(g);
  });

  const genome: Genome = {
    schema: 1,
    genes,
    maternal: Object.fromEntries(Object.entries(maternal).map(([name, v]) => [lookup(name), v])),
    nextGeneId: genes.length,
  };
  assertValidGenome(genome);
  return genome;
}

/** Gene id by name (throws if absent). */
export function geneId(genome: Genome, name: string): number {
  const g = genome.genes.find((x) => x.name === name);
  if (!g) throw new Error(`no gene named "${name}"`);
  return g.id;
}
