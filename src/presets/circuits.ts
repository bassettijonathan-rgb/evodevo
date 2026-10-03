/**
 * Classic small gene circuits, hand-authored. Used by the M1 validation tests
 * and the debug page.
 *
 * With rate = decay = 1 every gene's level lies in [0, 1]. Choosing bias = |w|/2
 * for a gene repressed with weight w puts the symmetric fixed point at x = 0.5,
 * where σ' = 1/4, so each repression edge has local gain |w|/4. That makes the
 * bifurcation points easy to compute by hand (see the tests).
 */
import { buildGenome } from '../core/genome/builder';
import type { Genome } from '../core/genome/types';

/** A gene with no regulators: x → R·σ(b)/λ. */
export function constitutive(bias = 1, rate = 2, decay = 0.5): Genome {
  return buildGenome([{ name: 'A', type: 'tf', bias, rate, decay }]);
}

/** A gene that activates itself (positive feedback → potential bistability/memory). */
export function autoActivator(w = 8, bias = -4): Genome {
  return buildGenome([{ name: 'A', type: 'tf', bias, sites: { A: w } }]);
}

/**
 * Toggle switch (Gardner, Cantor & Collins 2000): two mutually repressing genes.
 * Bistable when the loop gain (|w|/4)² exceeds 1, i.e. |w| > 4.
 */
export function toggleSwitch(w = 10): Genome {
  const r = -Math.abs(w);
  return buildGenome([
    { name: 'A', type: 'tf', bias: -r / 2, sites: { B: r } },
    { name: 'B', type: 'tf', bias: -r / 2, sites: { A: r } },
  ]);
}

/**
 * Repressilator (Elowitz & Leibler 2000): A ⊣ B ⊣ C ⊣ A.
 * For a ring of n identical first-order stages with negative feedback, the fixed
 * point loses stability (Hopf) when the per-stage gain exceeds sec(π/n): for n = 3,
 * |w|/4 > 2, i.e. |w| > 8. At onset the angular frequency is λ·tan(π/n) = √3.
 */
export function repressilator(w = 10): Genome {
  const r = -Math.abs(w);
  return buildGenome([
    { name: 'A', type: 'tf', bias: -r / 2, sites: { C: r } },
    { name: 'B', type: 'tf', bias: -r / 2, sites: { A: r } },
    { name: 'C', type: 'tf', bias: -r / 2, sites: { B: r } },
  ]);
}

/**
 * A morphogen read-out: target T is activated by the sensed morphogen M.
 * Used to check that sensed inputs reach the GRN.
 */
export function morphogenReadout(w = 6, bias = -3): Genome {
  return buildGenome([
    { name: 'M', type: 'morphogen', rate: 0 },
    { name: 'T', type: 'tf', bias, sites: { M: w } },
  ]);
}
