/**
 * Founder genomes for evolution runs.
 */
import { buildGenome, type GeneSpec } from '../genome/builder';
import { EFFECTOR_KINDS, type Genome, type ProductType } from '../genome/types';
import { exp } from '../math';
import type { Rng } from '../rng';

/**
 * A random small genome that is guaranteed to grow: gene 0 is a divide effector
 * with a positive bias. The rest are a random mix of product types with sparse
 * random wiring, plus a maternal transcription factor so the zygote is not blank.
 */
export function randomFounder(rng: Rng, genes = 8): Genome {
  const types: ProductType[] = ['tf', 'tf', 'tf', 'morphogen', 'adhesion', 'contact', 'effector'];
  const specs: GeneSpec[] = [{ name: 'g0', type: 'effector', effector: 'divide', bias: rng.range(1, 4) }];
  specs.push({ name: 'g1', type: 'tf', bias: rng.range(-2, 2) });
  for (let i = 2; i < genes; i++) {
    const type = rng.pick(types);
    const spec: GeneSpec = { name: `g${i}`, type, bias: rng.range(-3, 3) };
    if (type === 'morphogen') {
      spec.diffusion = exp(rng.range(-2, 1.5));
      spec.fieldDecay = exp(rng.range(-4.5, -1.5));
      spec.secretion = exp(rng.range(-2, 0));
    }
    if (type === 'effector') spec.effector = rng.pick(EFFECTOR_KINDS.filter((k) => k !== 'die'));
    specs.push(spec);
  }
  // Sparse random wiring: each gene gets 1–3 inputs.
  for (const s of specs) {
    s.sites = {};
    const k = 1 + rng.int(3);
    for (let j = 0; j < k; j++) s.sites[rng.pick(specs).name] = 3 * rng.normal();
  }
  for (const s of specs) if (s.effector === 'polarize') {
    const morph = specs.filter((x) => x.type === 'morphogen');
    if (morph.length) s.cue = rng.pick(morph).name;
  }
  return buildGenome(specs, { g1: 1 });
}
