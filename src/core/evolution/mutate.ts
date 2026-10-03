/**
 * Mutation operators (DESIGN.md §6).
 *
 * Each reproduction draws a Poisson number of events of each kind (rates are
 * expected events per genome per reproduction). Every applied event is logged
 * in a human-readable line; the log feeds the phylogeny view.
 *
 * All randomness goes through the seeded Rng and all math through core/math,
 * so an evolutionary run is reproducible bit for bit.
 */
import { fillTypeDefaults } from '../genome/builder';
import { cloneGenome } from '../genome/serialize';
import { EFFECTOR_KINDS, PRODUCT_TYPES, isRegulatorType, type Gene, type GeneId, type Genome, type ProductType } from '../genome/types';
import { validateGenome } from '../genome/validate';
import { exp } from '../math';
import type { Rng } from '../rng';

export interface MutationRates {
  /** Gaussian change of an existing site weight. */
  weight: number;
  /** Change of a gene parameter (bias, kinetics, asymmetry, type-specific) or a maternal level. */
  parameter: number;
  siteGain: number;
  siteLoss: number;
  /** Move a site to a different regulator (cis-regulatory turnover). */
  rewire: number;
  /** Single-gene duplication. */
  duplication: number;
  /** Tandem duplication of a block of 2–4 adjacent genes. */
  segmentalDuplication: number;
  /** Whole-genome duplication (rare). */
  wholeGenomeDuplication: number;
  deletion: number;
  /** Change a gene's product type. */
  typeSwitch: number;
  /** Change an effector's kind or a polarity cue. */
  effectorChange: number;
}

export interface MutationSettings {
  rates: MutationRates;
  /** Std of weight changes. */
  weightSigma: number;
  /** Std of bias / asymmetry changes. */
  biasSigma: number;
  /** Std of log-normal changes of positive parameters (rate, decay, D, …). */
  logSigma: number;
  /** Std of the weight of a newly gained site (new sites start weak). */
  newSiteSigma: number;
  /** 'neutral': copies split dosage (phenotype unchanged); 'double': full dosage each. */
  duplicationDosage: 'neutral' | 'double';
  maxGenes: number;
  maxMorphogens: number;
  /** Genes (by id) that mutation must not touch: their parameters, inputs, type, or existence. */
  locked?: GeneId[];
}

export const DEFAULT_MUTATION: MutationSettings = {
  rates: {
    weight: 1.0,
    parameter: 0.6,
    siteGain: 0.25,
    siteLoss: 0.15,
    rewire: 0.1,
    duplication: 0.08,
    segmentalDuplication: 0.02,
    wholeGenomeDuplication: 0.002,
    deletion: 0.05,
    typeSwitch: 0.04,
    effectorChange: 0.03,
  },
  weightSigma: 1.0,
  biasSigma: 1.0,
  logSigma: 0.25,
  newSiteSigma: 1.0,
  duplicationDosage: 'neutral',
  maxGenes: 32,
  maxMorphogens: 6,
};

/** Parameter ranges kept by mutation (keep the numerics sane). */
const LIMITS = {
  weight: 30,
  bias: 30,
  rate: [0.05, 20] as const,
  decay: [0.02, 20] as const,
  diffusion: [0.01, 20] as const,
  secretion: [0.01, 10] as const,
  fieldDecay: [0.002, 2] as const,
  binding: [0, 5] as const,
  maternal: [0, 5] as const,
};

const clampTo = (v: number, [lo, hi]: readonly [number, number]) => (v < lo ? lo : v > hi ? hi : v);
const clampAbs = (v: number, m: number) => (v < -m ? -m : v > m ? m : v);

function morphogenCount(g: Genome): number {
  return g.genes.filter((x) => x.type === 'morphogen').length;
}

function nameOf(g: Genome, id: GeneId): string {
  return g.genes.find((x) => x.id === id)?.name ?? `#${id}`;
}

// ---------------------------------------------------------------- duplication

/**
 * Duplicate the genes with the given ids (DESIGN.md §6.1–6.3). Each copy is
 * inserted right after its block, gets a fresh id and a copy of the original's
 * cis-regulatory region (its INPUTS); then every site anywhere that binds an
 * original also gets a site on the copy (its OUTPUTS, since a duplicated factor
 * keeps its binding specificity).
 *
 * With 'neutral' dosage both copies' rate and maternal level are halved, so every
 * downstream sum is unchanged: the duplicate is a silent spare copy, the starting
 * point of sub- and neofunctionalisation.
 */
export function duplicateGenes(genome: Genome, ids: GeneId[], dosage: 'neutral' | 'double'): Genome {
  const g = cloneGenome(genome);
  const copyOf = new Map<GeneId, GeneId>();
  for (const id of ids) copyOf.set(id, g.nextGeneId++);

  // Insert copies after the last gene of the (contiguous or not) set, preserving order.
  const lastIndex = Math.max(...ids.map((id) => g.genes.findIndex((x) => x.id === id)));
  const copies: Gene[] = ids.map((id) => {
    const orig = g.genes.find((x) => x.id === id)!;
    const copy: Gene = { ...orig, id: copyOf.get(id)!, sites: orig.sites.map((s) => ({ ...s })) };
    copy.name = `${orig.name}'`;
    if (dosage === 'neutral') {
      orig.rate /= 2;
      copy.rate /= 2;
    }
    return copy;
  });
  g.genes.splice(lastIndex + 1, 0, ...copies);

  // Output copy: every site on an original gains a twin site on its copy, placed
  // right after it (so the summation order stays as close as possible).
  for (const gene of g.genes) {
    const sites = [];
    for (const s of gene.sites) {
      sites.push(s);
      const c = copyOf.get(s.regulator);
      if (c !== undefined) sites.push({ regulator: c, weight: s.weight });
    }
    gene.sites = sites;
  }
  for (const [orig, copy] of copyOf) {
    const m = g.maternal[orig];
    if (m === undefined) continue;
    if (dosage === 'neutral') g.maternal[orig] = m / 2;
    g.maternal[copy] = g.maternal[orig];
  }
  return g;
}

/** Remove a gene and everything that refers to it. */
export function deleteGene(genome: Genome, id: GeneId): Genome {
  const g = cloneGenome(genome);
  g.genes = g.genes.filter((x) => x.id !== id);
  for (const gene of g.genes) {
    gene.sites = gene.sites.filter((s) => s.regulator !== id);
    if (gene.cue === id) delete gene.cue;
  }
  delete g.maternal[id];
  return g;
}

// ---------------------------------------------------------------- individual operators

type Operator = (g: Genome, rng: Rng, s: MutationSettings) => { genome: Genome; log: string } | null;

/** Genes that mutation may modify (everything except locked genes). */
const mutable = (g: Genome, s: MutationSettings) => (s.locked?.length ? g.genes.filter((x) => !s.locked!.includes(x.id)) : g.genes);
const pickGene = (g: Genome, rng: Rng, s: MutationSettings) => { const m = mutable(g, s); return m.length ? rng.pick(m) : null; };

const mutateWeight: Operator = (genome, rng, s) => {
  const g = cloneGenome(genome);
  const withSites = mutable(g, s).filter((x) => x.sites.length);
  if (!withSites.length) return null;
  const gene = rng.pick(withSites);
  const site = rng.pick(gene.sites);
  const old = site.weight;
  site.weight = clampAbs(old + s.weightSigma * rng.normal(), LIMITS.weight);
  return { genome: g, log: `w[${gene.name}←${nameOf(g, site.regulator)}] ${old.toFixed(2)}→${site.weight.toFixed(2)}` };
};

const mutateParameter: Operator = (genome, rng, s) => {
  const g = cloneGenome(genome);
  const gene = pickGene(g, rng, s);
  if (!gene) return null;
  const options: string[] = ['bias', 'rate', 'decay', 'asymmetry', 'maternal'];
  if (gene.type === 'morphogen') options.push('diffusion', 'secretion', 'fieldDecay');
  if (gene.type === 'adhesion' || gene.type === 'contact') options.push('binding');
  const which = rng.pick(options);
  const logn = (v: number) => v * exp(s.logSigma * rng.normal());
  let before: number, after: number;
  switch (which) {
    case 'bias':
      before = gene.bias; after = gene.bias = clampAbs(gene.bias + s.biasSigma * rng.normal(), LIMITS.bias); break;
    case 'asymmetry':
      before = gene.asymmetry; after = gene.asymmetry = Math.max(-1, Math.min(1, gene.asymmetry + 0.3 * s.biasSigma * rng.normal())); break;
    case 'maternal': {
      before = g.maternal[gene.id] ?? 0;
      after = clampTo(before + 0.3 * rng.normal(), LIMITS.maternal);
      if (after > 0) g.maternal[gene.id] = after; else delete g.maternal[gene.id];
      break;
    }
    case 'binding':
      before = gene.binding!; after = gene.binding = clampTo(gene.binding! + 0.3 * rng.normal(), LIMITS.binding); break;
    default: {
      const key = which as 'rate' | 'decay' | 'diffusion' | 'secretion' | 'fieldDecay';
      before = gene[key]!;
      after = gene[key] = clampTo(logn(before), LIMITS[key]);
    }
  }
  return { genome: g, log: `${which}[${gene.name}] ${before.toFixed(3)}→${after.toFixed(3)}` };
};

const gainSite: Operator = (genome, rng, s) => {
  const g = cloneGenome(genome);
  const target = pickGene(g, rng, s);
  if (!target) return null;
  // Mostly pick real regulators; occasionally a cryptic (non-regulator) site.
  const regs = g.genes.filter((x) => isRegulatorType(x.type));
  const pool = regs.length && rng.float() < 0.85 ? regs : g.genes;
  const free = pool.filter((x) => !target.sites.some((q) => q.regulator === x.id));
  if (!free.length) return null;
  const reg = rng.pick(free);
  const weight = s.newSiteSigma * rng.normal();
  target.sites.push({ regulator: reg.id, weight });
  return { genome: g, log: `+site[${target.name}←${reg.name}] ${weight.toFixed(2)}` };
};

const loseSite: Operator = (genome, rng, s) => {
  const g = cloneGenome(genome);
  const withSites = mutable(g, s).filter((x) => x.sites.length);
  if (!withSites.length) return null;
  const gene = rng.pick(withSites);
  const k = rng.int(gene.sites.length);
  const [site] = gene.sites.splice(k, 1);
  return { genome: g, log: `−site[${gene.name}←${nameOf(g, site.regulator)}]` };
};

const rewire: Operator = (genome, rng, s) => {
  const g = cloneGenome(genome);
  const withSites = mutable(g, s).filter((x) => x.sites.length);
  if (!withSites.length) return null;
  const gene = rng.pick(withSites);
  const site = rng.pick(gene.sites);
  const free = g.genes.filter((x) => !gene.sites.some((q) => q.regulator === x.id));
  if (!free.length) return null;
  const to = rng.pick(free);
  const from = site.regulator;
  site.regulator = to.id;
  return { genome: g, log: `rewire[${gene.name}] ${nameOf(g, from)}→${to.name}` };
};

const duplicateOne: Operator = (genome, rng, s) => {
  if (genome.genes.length >= s.maxGenes) return null;
  const gene = pickGene(genome, rng, s);
  if (!gene) return null;
  if (gene.type === 'morphogen' && morphogenCount(genome) >= s.maxMorphogens) return null;
  return { genome: duplicateGenes(genome, [gene.id], s.duplicationDosage), log: `dup[${gene.name}]` };
};

const duplicateSegment: Operator = (genome, rng, s) => {
  const n = genome.genes.length;
  const len = 2 + rng.int(3);
  if (n < len || n + len > s.maxGenes) return null;
  const start = rng.int(n - len + 1);
  const block = genome.genes.slice(start, start + len);
  if (block.some((x) => s.locked?.includes(x.id))) return null;
  if (morphogenCount(genome) + block.filter((x) => x.type === 'morphogen').length > s.maxMorphogens) return null;
  return {
    genome: duplicateGenes(genome, block.map((x) => x.id), s.duplicationDosage),
    log: `segdup[${block.map((x) => x.name).join(',')}]`,
  };
};

const duplicateGenome: Operator = (genome, _rng, s) => {
  if (s.locked?.length) return null; // would halve the dosage of locked genes
  if (genome.genes.length * 2 > s.maxGenes || morphogenCount(genome) * 2 > s.maxMorphogens) return null;
  return { genome: duplicateGenes(genome, genome.genes.map((x) => x.id), s.duplicationDosage), log: 'WGD' };
};

const deletion: Operator = (genome, rng, s) => {
  if (genome.genes.length <= 1) return null;
  const gene = pickGene(genome, rng, s);
  if (!gene) return null;
  return { genome: deleteGene(genome, gene.id), log: `del[${gene.name}]` };
};

const typeSwitch: Operator = (genome, rng, s) => {
  const g = cloneGenome(genome);
  const gene = pickGene(g, rng, s);
  if (!gene) return null;
  const choices = PRODUCT_TYPES.filter(
    (t) => t !== gene.type && !(t === 'morphogen' && morphogenCount(g) >= s.maxMorphogens),
  );
  const to: ProductType = rng.pick(choices);
  const from = gene.type;
  gene.type = to;
  // Fill in parameters the new type needs that this gene never had, drawn from priors.
  if (to === 'morphogen') {
    gene.diffusion ??= clampTo(exp(rng.range(-2, 2)), LIMITS.diffusion);
    gene.secretion ??= clampTo(exp(rng.range(-2, 1)), LIMITS.secretion);
    gene.fieldDecay ??= clampTo(exp(rng.range(-5, -1)), LIMITS.fieldDecay);
  }
  if ((to === 'adhesion' || to === 'contact') && gene.binding === undefined) gene.binding = rng.range(0.2, 2);
  if (to === 'effector') {
    gene.effector ??= rng.pick(EFFECTOR_KINDS);
    if (gene.effector === 'polarize') gene.cueSign ??= rng.float() < 0.5 ? 1 : -1;
  }
  fillTypeDefaults(gene);
  return { genome: g, log: `type[${gene.name}] ${from}→${to}` };
};

const effectorChange: Operator = (genome, rng, s) => {
  const g = cloneGenome(genome);
  const effs = mutable(g, s).filter((x) => x.type === 'effector');
  if (!effs.length) return null;
  const gene = rng.pick(effs);
  const morphs = g.genes.filter((x) => x.type === 'morphogen');
  if (gene.effector === 'polarize' && morphs.length && rng.float() < 0.5) {
    const cue = rng.pick(morphs);
    gene.cue = cue.id;
    gene.cueSign = rng.float() < 0.5 ? 1 : -1;
    return { genome: g, log: `cue[${gene.name}]→${gene.cueSign > 0 ? '+' : '−'}${cue.name}` };
  }
  const from = gene.effector;
  gene.effector = rng.pick(EFFECTOR_KINDS.filter((k) => k !== from));
  if (gene.effector === 'polarize') {
    gene.cueSign ??= 1;
    if (gene.cue === undefined && morphs.length) gene.cue = rng.pick(morphs).id;
  }
  return { genome: g, log: `effector[${gene.name}] ${from}→${gene.effector}` };
};

const OPERATORS: [keyof MutationRates, Operator][] = [
  ['weight', mutateWeight],
  ['parameter', mutateParameter],
  ['siteGain', gainSite],
  ['siteLoss', loseSite],
  ['rewire', rewire],
  ['duplication', duplicateOne],
  ['segmentalDuplication', duplicateSegment],
  ['wholeGenomeDuplication', duplicateGenome],
  ['deletion', deletion],
  ['typeSwitch', typeSwitch],
  ['effectorChange', effectorChange],
];

export interface MutationResult {
  genome: Genome;
  log: string[];
}

/**
 * Apply a random set of mutations. Event counts are Poisson with the configured
 * means; the events are applied in a random order. Events that cannot apply
 * (e.g. duplication at the gene limit) are skipped. `scale` multiplies every
 * rate (the UI's mutation-strength slider).
 */
export function mutate(genome: Genome, rng: Rng, settings: MutationSettings = DEFAULT_MUTATION, scale = 1): MutationResult {
  const events: Operator[] = [];
  for (const [key, op] of OPERATORS) {
    const k = rng.poisson(settings.rates[key] * scale);
    for (let i = 0; i < k; i++) events.push(op);
  }
  // Fisher–Yates shuffle so the order of event kinds is random.
  for (let i = events.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [events[i], events[j]] = [events[j], events[i]];
  }
  let g = genome;
  const log: string[] = [];
  for (const op of events) {
    const r = op(g, rng, settings);
    if (!r) continue;
    const errors = validateGenome(r.genome, settings);
    if (errors.length) throw new Error(`mutation "${r.log}" produced an invalid genome: ${errors.join('; ')}`);
    g = r.genome;
    log.push(r.log);
  }
  return { genome: g === genome ? cloneGenome(genome) : g, log };
}
