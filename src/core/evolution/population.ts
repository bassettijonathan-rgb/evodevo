/**
 * The evolutionary loop (DESIGN.md §7). Pure and engine-agnostic: evaluation is
 * injected as an async batch function, so the same loop runs with a browser
 * worker pool, Node worker threads, or in-process in tests.
 *
 * Selection modes:
 * - 'weighted': fitness = weighted mean of metric scores (target selection)
 * - 'novelty':  novelty search on a behaviour descriptor (Lehman & Stanley 2011)
 * - 'random':   no selection at all, i.e. drift (the null model for M4)
 * - 'interactive': the caller picks parents (breeding mode)
 */
import type { SimConfig } from '../config';
import { genomeHash } from '../genome/serialize';
import type { Genome } from '../genome/types';
import type { Metrics } from '../metrics';
import { Rng } from '../rng';
import { crossover } from './crossover';
import type { EvalJob, EvalResult } from './evaluate';
import { DEFAULT_MUTATION, mutate, type MutationSettings } from './mutate';

export type NumericMetric = { [K in keyof Metrics]: Metrics[K] extends number ? K : never }[keyof Metrics];

export interface FitnessTerm {
  metric: NumericMetric;
  /** 'maximize': score = min(value/target, 1). 'match': score = exp(−|value − target|/max(|target|, 1)). */
  mode: 'maximize' | 'match';
  target: number;
  weight: number;
}

export type Objective =
  | { kind: 'weighted'; terms: FitnessTerm[] }
  | { kind: 'novelty'; k: number }
  | { kind: 'random' }
  | { kind: 'interactive' };

export interface EvolutionSettings {
  populationSize: number;
  elitism: number;
  tournamentSize: number;
  /** Probability that an offspring is produced by crossover (before mutation). */
  crossoverRate: number;
  mutation: MutationSettings;
  objective: Objective;
  /** Simulation config every organism is grown with. */
  sim: Partial<SimConfig>;
  /** Experiment seed: organism seeds derive from it and the genome hash. */
  seed: string;
}

export const DEFAULT_EVOLUTION: EvolutionSettings = {
  populationSize: 32,
  elitism: 2,
  tournamentSize: 3,
  crossoverRate: 0,
  mutation: DEFAULT_MUTATION,
  objective: {
    kind: 'weighted',
    terms: [
      { metric: 'cells', mode: 'maximize', target: 200, weight: 1 },
      { metric: 'cellTypes', mode: 'maximize', target: 6, weight: 1 },
    ],
  },
  sim: { gridNx: 64, gridNy: 64, maxCells: 200, tDev: 150 },
  seed: 'evo',
};

export interface Individual {
  id: number;
  parents: number[];
  generation: number;
  genome: Genome;
  hash: string;
  /** Mutations that produced this genome from its (first) parent. */
  log: string[];
  result?: EvalResult;
  fitness?: number;
  novelty?: number;
}

/** Batch evaluator: must return results in job order. */
export type Evaluator = (jobs: EvalJob[]) => Promise<EvalResult[]>;

export function scoreTerms(m: Metrics, terms: FitnessTerm[]): number {
  let total = 0, wsum = 0;
  for (const t of terms) {
    const v = m[t.metric];
    const s = t.mode === 'maximize'
      ? Math.min(v / t.target, 1)
      : Math.max(0, 1 - Math.abs(v - t.target) / Math.max(Math.abs(t.target), 1));
    total += t.weight * s;
    wsum += t.weight;
  }
  return wsum ? total / wsum : 0;
}

/** Behaviour descriptor for novelty search: scaled metrics, all O(1). */
export function descriptor(m: Metrics, cap: number): number[] {
  return [
    m.cells / cap,
    m.cellTypes / 8,
    Math.min(m.elongation, 5) / 5,
    m.shapeBilateral,
    m.patternBilateral,
    m.patternRadial,
    Math.min(m.segments, 10) / 10,
    m.typeEntropy / 3,
  ];
}

function distance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

export class Evolution {
  readonly settings: EvolutionSettings;
  population: Individual[] = [];
  /** Every individual ever evaluated, by id (the phylogeny). */
  readonly history = new Map<number, Individual>();
  generation = 0;
  private nextId = 0;
  private readonly rng: Rng;
  private readonly cache = new Map<string, EvalResult>();
  private readonly archive: number[][] = [];

  constructor(founders: Genome[], settings: Partial<EvolutionSettings> = {}) {
    this.settings = { ...DEFAULT_EVOLUTION, ...settings };
    this.rng = new Rng(this.settings.seed).fork('evolution');
    // Fill the first generation with mutants of the founders (founders themselves first).
    const pop: Individual[] = founders.map((g) => this.newIndividual(g, [], []));
    while (pop.length < this.settings.populationSize) {
      const parent = founders[pop.length % founders.length];
      const m = mutate(parent, this.rng, this.settings.mutation);
      pop.push(this.newIndividual(m.genome, [], m.log));
    }
    this.population = pop.slice(0, this.settings.populationSize);
  }

  private newIndividual(genome: Genome, parents: number[], log: string[]): Individual {
    const ind: Individual = { id: this.nextId++, parents, generation: this.generation, genome, hash: genomeHash(genome), log };
    this.history.set(ind.id, ind);
    return ind;
  }

  /** Organism seed: depends only on the experiment seed and the genome. */
  seedFor(ind: Individual): string {
    return `${this.settings.seed}/${ind.hash}`;
  }

  /** Grow and measure everyone not yet evaluated (identical genomes are evaluated once). */
  async evaluate(evaluator: Evaluator): Promise<void> {
    const todo = this.population.filter((ind) => !ind.result && !this.cache.has(ind.hash));
    const unique = [...new Map(todo.map((ind) => [ind.hash, ind])).values()];
    if (unique.length) {
      const results = await evaluator(unique.map((ind) => ({ genome: ind.genome, config: this.settings.sim, seed: this.seedFor(ind) })));
      unique.forEach((ind, k) => this.cache.set(ind.hash, results[k]));
    }
    for (const ind of this.population) ind.result ??= this.cache.get(ind.hash);
    this.assignFitness();
  }

  private assignFitness(): void {
    const obj = this.settings.objective;
    const pop = this.population;
    if (obj.kind === 'weighted') {
      for (const ind of pop) ind.fitness = scoreTerms(ind.result!.metrics, obj.terms);
    } else if (obj.kind === 'random') {
      for (const ind of pop) ind.fitness = this.rng.float();
    } else if (obj.kind === 'novelty') {
      const cap = this.settings.sim.maxCells ?? 1000;
      const descs = pop.map((ind) => descriptor(ind.result!.metrics, cap));
      const pool = [...descs, ...this.archive];
      descs.forEach((d, i) => {
        const ds = pool.map((e) => distance(d, e)).sort((a, b) => a - b);
        const k = Math.min(obj.k, ds.length - 1);
        pop[i].novelty = ds.slice(1, k + 1).reduce((a, b) => a + b, 0) / Math.max(k, 1);
        pop[i].fitness = pop[i].novelty;
      });
      // Archive the most novel individual of each generation.
      let best = 0;
      for (let i = 1; i < pop.length; i++) if (pop[i].novelty! > pop[best].novelty!) best = i;
      this.archive.push(descs[best]);
    }
  }

  private tournament(): Individual {
    let best: Individual | null = null;
    for (let k = 0; k < this.settings.tournamentSize; k++) {
      const c = this.population[this.rng.int(this.population.length)];
      if (!best || (c.fitness ?? 0) > (best.fitness ?? 0)) best = c;
    }
    return best!;
  }

  /** Make a child of the given parent(s): optional crossover, then mutation. */
  breed(parents: Individual[], mutationScale = 1): Individual {
    let genome = parents[0].genome;
    if (parents.length > 1) genome = crossover(parents[0].genome, parents[1].genome, this.rng);
    const m = mutate(genome, this.rng, this.settings.mutation, mutationScale);
    return this.newIndividual(m.genome, parents.map((p) => p.id), m.log);
  }

  /** Replace the population with the next generation (call after evaluate()). */
  advance(): void {
    const s = this.settings;
    const ranked = [...this.population].sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0) || a.id - b.id);
    this.generation++;
    const next: Individual[] = s.objective.kind === 'random' ? [] : ranked.slice(0, s.elitism);
    while (next.length < s.populationSize) {
      const p1 = this.tournament();
      const parents = s.crossoverRate > 0 && this.rng.float() < s.crossoverRate ? [p1, this.tournament()] : [p1];
      next.push(this.breed(parents));
    }
    this.population = next;
  }

  /** Interactive breeding: the next generation is offspring of the chosen parents only. */
  advanceFrom(chosen: Individual[], mutationScale = 1): void {
    if (!chosen.length) throw new Error('choose at least one parent');
    this.generation++;
    const next: Individual[] = [];
    for (let k = 0; k < this.settings.populationSize; k++) {
      const p1 = chosen[k % chosen.length];
      const parents = chosen.length > 1 && this.rng.float() < 0.5 ? [p1, chosen[(k + 1) % chosen.length]] : [p1];
      next.push(this.breed(parents, mutationScale));
    }
    this.population = next;
  }

  best(): Individual {
    return [...this.population].sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0) || a.id - b.id)[0];
  }
}
