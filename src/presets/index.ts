/**
 * Preset organisms for the UI: a genome plus the conditions it is meant to be
 * grown under.
 */
import type { SimConfig } from '../core/config';
import { randomFounder } from '../core/evolution/founders';
import type { Genome } from '../core/genome/types';
import { Rng } from '../core/rng';
import { hexDisc, latticeTissue, type InitialCondition } from '../core/sim/develop';
import { lateralInhibition, frenchFlag, frenchFlagEmbryo, sortingPair, turingPair } from './patterning';

export interface Preset {
  id: string;
  name: string;
  description: string;
  genome: () => Genome;
  config: Partial<SimConfig>;
  initial?: () => InitialCondition;
  tEnd?: number;
}

export const PRESETS: Preset[] = [
  {
    id: 'flag-embryo',
    name: 'French flag embryo',
    description: 'Grows from one zygote. A maternal determinant segregates into one organiser cell, whose morphogen gradient is read into three fates.',
    genome: frenchFlagEmbryo,
    config: { gridNx: 64, gridNy: 64, maxCells: 160, divisionJitter: 0.8, tDev: 300 },
  },
  {
    id: 'flag-tissue',
    name: 'French flag (fixed tissue)',
    description: "Wolpert's flag on a 64×16 sheet: a source column, one gradient, three bistable read-out genes.",
    genome: frenchFlag,
    config: { gridNx: 64, gridNy: 16, tDev: 1500 },
    initial: () => ({ kind: 'tissue', frozen: true, cells: latticeTissue(64, 16, (i) => (i === 0 ? { 0: 1 } : undefined)) }),
  },
  {
    id: 'turing-stripes',
    name: 'Turing stripes',
    description: 'Activator–inhibitor pair with the activator at its sigmoid inflection point: a labyrinth of stripes.',
    genome: () => turingPair({ operatingPoint: 0.5 }),
    config: { gridNx: 64, gridNy: 64, tDev: 800 },
    initial: () => turingTissue(0.5),
  },
  {
    id: 'turing-spots',
    name: 'Turing spots',
    description: 'Same linearised system, activator below its inflection point: spots.',
    genome: () => turingPair({ operatingPoint: 0.35 }),
    config: { gridNx: 64, gridNy: 64, tDev: 800 },
    initial: () => turingTissue(0.35),
  },
  {
    id: 'sorting',
    name: 'Cell sorting',
    description: 'A random mix of two cell types with different cadherins sorts itself out (Steinberg).',
    genome: () => sortingPair(),
    config: { gridNx: 64, gridNy: 64, motility: 0.03, tDev: 600 },
    initial: () => {
      const rng = new Rng('mix');
      return { kind: 'tissue', cells: hexDisc(400, 32, 32, () => ({ 0: rng.float() < 0.5 ? 1 : 0 })) };
    },
  },
  {
    id: 'lateral',
    name: 'Lateral inhibition',
    description: 'Delta–Notch: neighbours push each other into opposite fates (salt and pepper).',
    genome: () => lateralInhibition({ w: 12 }),
    config: { gridNx: 32, gridNy: 32, tDev: 200 },
    initial: () => {
      const rng = new Rng('li');
      return { kind: 'tissue', frozen: true, cells: latticeTissue(24, 24, () => ({ 0: 0.5 + 0.02 * rng.normal(), 1: 0.5 }), 4, 4) };
    },
  },
  {
    id: 'random',
    name: 'Random founder',
    description: 'A random 8-gene genome that grows. A starting point for breeding.',
    genome: () => randomFounder(new Rng(`founder-${Math.floor(Math.random() * 1e9)}`), 8),
    config: { gridNx: 64, gridNy: 64, maxCells: 200, tDev: 150 },
  },
];

function turingTissue(p: number): InitialCondition {
  const rng = new Rng(`turing-${p}`);
  // Start at the designed homogeneous state (x_A = p, x_H = 0.5) plus 2% noise.
  return { kind: 'tissue', frozen: true, cells: latticeTissue(64, 64, () => ({ 0: p * (1 + 0.02 * rng.normal()), 1: 0.5 })) };
}
