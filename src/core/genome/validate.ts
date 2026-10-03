/**
 * Genome invariants. Every genome that enters the simulator (hand-authored,
 * loaded from JSON, or produced by mutation) must pass these.
 */
import type { SimConfig } from '../config';
import { EFFECTOR_KINDS, PRODUCT_TYPES, type Genome } from './types';

export function validateGenome(genome: Genome, cfg?: Pick<SimConfig, 'maxGenes' | 'maxMorphogens'>): string[] {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(msg);

  if (genome.schema !== 1) err(`unknown schema ${String(genome.schema)}`);
  if (!Array.isArray(genome.genes)) return [...errors, 'genes is not an array'];

  const ids = new Set<number>();
  for (const g of genome.genes) {
    if (!Number.isInteger(g.id) || g.id < 0) err(`gene "${g.name}": bad id ${g.id}`);
    if (ids.has(g.id)) err(`duplicate gene id ${g.id}`);
    ids.add(g.id);
    if (g.id >= genome.nextGeneId) err(`gene id ${g.id} ≥ nextGeneId ${genome.nextGeneId}`);
  }

  let morphogens = 0;
  for (const g of genome.genes) {
    const where = `gene ${g.id} "${g.name}"`;
    if (!PRODUCT_TYPES.includes(g.type)) err(`${where}: unknown type ${g.type}`);
    if (!Number.isFinite(g.bias)) err(`${where}: bias not finite`);
    if (!(g.rate >= 0) || !Number.isFinite(g.rate)) err(`${where}: rate must be ≥ 0`);
    if (!(g.decay > 0) || !Number.isFinite(g.decay)) err(`${where}: decay must be > 0`);
    if (!(g.asymmetry >= -1 && g.asymmetry <= 1)) err(`${where}: asymmetry must be in [-1, 1]`);

    const seen = new Set<number>();
    for (const s of g.sites) {
      if (!ids.has(s.regulator)) err(`${where}: site references missing gene ${s.regulator}`);
      if (seen.has(s.regulator)) err(`${where}: two sites for regulator ${s.regulator}`);
      seen.add(s.regulator);
      if (!Number.isFinite(s.weight)) err(`${where}: site weight not finite`);
    }

    switch (g.type) {
      case 'morphogen':
        morphogens++;
        if (!(g.diffusion! >= 0)) err(`${where}: morphogen needs diffusion ≥ 0`);
        if (!(g.secretion! >= 0)) err(`${where}: morphogen needs secretion ≥ 0`);
        if (!(g.fieldDecay! > 0)) err(`${where}: morphogen needs fieldDecay > 0`);
        break;
      case 'adhesion':
      case 'contact':
        if (!(g.binding! >= 0)) err(`${where}: ${g.type} needs binding ≥ 0`);
        break;
      case 'effector':
        if (!g.effector || !EFFECTOR_KINDS.includes(g.effector)) err(`${where}: effector needs a valid kind`);
        if (g.effector === 'polarize') {
          if (g.cue !== undefined && !ids.has(g.cue)) err(`${where}: polarity cue references missing gene ${g.cue}`);
          if (g.cueSign !== 1 && g.cueSign !== -1) err(`${where}: cueSign must be ±1`);
        }
        break;
    }
  }

  for (const key of Object.keys(genome.maternal)) {
    const id = Number(key);
    if (!ids.has(id)) err(`maternal entry for missing gene ${key}`);
    const v = genome.maternal[id];
    if (!(v >= 0) || !Number.isFinite(v)) err(`maternal value for gene ${key} must be ≥ 0`);
  }

  if (cfg) {
    if (genome.genes.length > cfg.maxGenes) err(`${genome.genes.length} genes exceeds maxGenes ${cfg.maxGenes}`);
    if (morphogens > cfg.maxMorphogens) err(`${morphogens} morphogens exceeds maxMorphogens ${cfg.maxMorphogens}`);
  }
  return errors;
}

export function assertValidGenome(genome: Genome, cfg?: Pick<SimConfig, 'maxGenes' | 'maxMorphogens'>): void {
  const errors = validateGenome(genome, cfg);
  if (errors.length) throw new Error(`Invalid genome:\n  ${errors.join('\n  ')}`);
}
