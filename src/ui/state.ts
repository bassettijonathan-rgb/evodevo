/**
 * Application state, as Preact signals. Components read `.value` and re-render
 * when it changes; actions below are the only places that write.
 */
import { computed, signal } from '@preact/signals';
import type { EvalResult } from '../core/evolution/evaluate';
import { Evolution, type FitnessTerm, type Individual } from '../core/evolution/population';
import { compileGenome, type CompiledGRN } from '../core/genome/compile';
import { cloneGenome } from '../core/genome/serialize';
import type { Genome } from '../core/genome/types';
import type { SimConfig } from '../core/config';
import type { InitialCondition } from '../core/sim/develop';
import type { Perturbation } from '../core/sim/perturb';
import { browserPool } from '../workers/pool';
import type { EvalPool } from '../workers/pool';
import { PRESETS, type Preset } from '../presets';

export type Page = 'breed' | 'lab' | 'phylogeny';
export const page = signal<Page>('breed');

let poolInstance: EvalPool | null = null;
export function pool(): EvalPool {
  poolInstance ??= browserPool();
  return poolInstance;
}

// ------------------------------------------------------------------ breeding

export const BREED_SIZE = 12;
export const breedPreset = signal<Preset>(PRESETS.find((p) => p.id === 'random')!);
export const evolution = signal<Evolution | null>(null);
/** Bumped whenever the evolution object changes internally (it is mutable). */
export const evoTick = signal(0);
export const population = computed<Individual[]>(() => { void evoTick.value; return evolution.value?.population ?? []; });
export const chosen = signal<number[]>([]);
export const mutationScale = signal(1);
export const busy = signal<string | null>(null);
export const fitnessHistory = signal<number[]>([]);
export const autoRunning = signal(false);

export const DEFAULT_TERMS: FitnessTerm[] = [
  { metric: 'cells', mode: 'maximize', target: 200, weight: 1 },
  { metric: 'cellTypes', mode: 'maximize', target: 6, weight: 1 },
];
export const fitnessTerms = signal<FitnessTerm[]>(DEFAULT_TERMS);

function breedSim(p: Preset): Partial<SimConfig> {
  return { ...p.config, recordEvery: 0 };
}

async function evaluatePopulation(): Promise<void> {
  const evo = evolution.value!;
  await evo.evaluate((jobs) => pool().evaluate(jobs));
  evoTick.value++;
}

export async function startBreeding(p: Preset, founder?: Genome): Promise<void> {
  breedPreset.value = p;
  const genome = founder ?? p.genome();
  evolution.value = new Evolution([genome], {
    populationSize: BREED_SIZE,
    sim: breedSim(p),
    objective: { kind: 'interactive' },
    seed: `breed-${Date.now()}`,
  });
  chosen.value = [];
  fitnessHistory.value = [];
  busy.value = 'Growing the first brood…';
  await evaluatePopulation();
  busy.value = null;
}

export function toggleChosen(id: number): void {
  const c = chosen.value;
  chosen.value = c.includes(id) ? c.filter((x) => x !== id) : [...c, id].slice(-2);
}

export async function breedNext(): Promise<void> {
  const evo = evolution.value;
  if (!evo || !chosen.value.length) return;
  const parents = evo.population.filter((i) => chosen.value.includes(i.id));
  evo.advanceFrom(parents, mutationScale.value);
  chosen.value = [];
  busy.value = 'Growing offspring…';
  evoTick.value++;
  await evaluatePopulation();
  busy.value = null;
}

/**
 * Target selection: run generations with a weighted fitness, starting from the
 * chosen individuals (or the whole current brood).
 */
export async function runTargetSelection(generations: number): Promise<void> {
  const evo = evolution.value;
  if (!evo) return;
  const seeds = (chosen.value.length ? evo.population.filter((i) => chosen.value.includes(i.id)) : evo.population).map((i) => i.genome);
  const target = new Evolution(seeds, {
    populationSize: 24,
    sim: evo.settings.sim,
    objective: { kind: 'weighted', terms: fitnessTerms.value },
    seed: `target-${Date.now()}`,
  });
  // Keep one phylogeny: merge the new run's history into the session's.
  evolution.value = target;
  autoRunning.value = true;
  fitnessHistory.value = [];
  for (let g = 0; g < generations && autoRunning.value; g++) {
    busy.value = `Target selection: generation ${g + 1}/${generations}`;
    await evaluatePopulation();
    fitnessHistory.value = [...fitnessHistory.value, target.best().fitness ?? 0];
    if (g < generations - 1 && autoRunning.value) target.advance();
  }
  // Show the best of the final population first.
  target.population.sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0));
  target.population = target.population.slice(0, BREED_SIZE);
  evoTick.value++;
  autoRunning.value = false;
  busy.value = null;
}

// ------------------------------------------------------------------ lab

export interface LabSubject {
  genome: Genome;
  config: Partial<SimConfig>;
  initial?: InitialCondition;
  tEnd?: number;
  seed: string;
  label: string;
}

export const labSubject = signal<LabSubject | null>(null);
export const labResult = signal<EvalResult | null>(null);
export const labGRN = computed<CompiledGRN | null>(() =>
  labSubject.value ? compileGenome(labSubject.value.genome, labSubject.value.config.dt ?? 0.1) : null,
);
export const frameIndex = signal(0);
export const perturbations = signal<Perturbation[]>([]);
export const perturbedResult = signal<EvalResult | null>(null);
export const selectedGene = signal<number | null>(null);

export async function openInLab(subject: LabSubject): Promise<void> {
  labSubject.value = { ...subject, genome: cloneGenome(subject.genome) };
  perturbations.value = [];
  perturbedResult.value = null;
  selectedGene.value = null;
  page.value = 'lab';
  await growLab();
}

export async function growLab(): Promise<void> {
  const s = labSubject.value;
  if (!s) return;
  busy.value = `Growing ${s.label}…`;
  const [r] = await pool().evaluate([{ genome: s.genome, config: { ...s.config, recordEvery: 10 }, seed: s.seed, initial: s.initial, tEnd: s.tEnd, keepFrames: true }]);
  labResult.value = r;
  frameIndex.value = (r.frames?.length ?? 1) - 1;
  busy.value = null;
}

/** Regrow with the current perturbations, alongside the unperturbed organism. */
export async function regrowPerturbed(): Promise<void> {
  const s = labSubject.value;
  if (!s) return;
  if (!perturbations.value.length) { perturbedResult.value = null; return; }
  busy.value = 'Regrowing with perturbations…';
  const [r] = await pool().evaluate([{ genome: s.genome, config: { ...s.config, recordEvery: 10 }, seed: s.seed, initial: s.initial, tEnd: s.tEnd, keepFrames: true, perturbations: perturbations.value }]);
  perturbedResult.value = r;
  busy.value = null;
}

export function presetSubject(p: Preset): LabSubject {
  return { genome: p.genome(), config: p.config, initial: p.initial?.(), tEnd: p.tEnd, seed: p.id, label: p.name };
}

export function individualSubject(ind: Individual, sim: Partial<SimConfig>, seed: string): LabSubject {
  return { genome: ind.genome, config: sim, seed, label: `individual #${ind.id}` };
}
