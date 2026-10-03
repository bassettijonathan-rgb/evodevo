/**
 * Tissue-level descriptors computed from cell positions: contact neighbours,
 * connected aggregates, surface cells. O(n²) neighbour search, which is fine
 * for the ≤ ~1000 cells we analyse.
 */

export interface Points {
  n: number;
  px: ArrayLike<number>;
  py: ArrayLike<number>;
}

/** Neighbour lists: cells whose centres are closer than `contact` (≈ touching). */
export function neighbours(p: Points, contact = 1.15): number[][] {
  const out: number[][] = Array.from({ length: p.n }, () => []);
  const c2 = contact * contact;
  for (let a = 0; a < p.n; a++) {
    for (let b = a + 1; b < p.n; b++) {
      const dx = p.px[a] - p.px[b], dy = p.py[a] - p.py[b];
      if (dx * dx + dy * dy < c2) {
        out[a].push(b);
        out[b].push(a);
      }
    }
  }
  return out;
}

/** Connected components of the contact graph, largest first. */
export function aggregates(nbrs: number[][]): number[][] {
  const seen = new Uint8Array(nbrs.length);
  const comps: number[][] = [];
  for (let s = 0; s < nbrs.length; s++) {
    if (seen[s]) continue;
    const comp = [s];
    seen[s] = 1;
    for (let k = 0; k < comp.length; k++) {
      for (const m of nbrs[comp[k]]) if (!seen[m]) { seen[m] = 1; comp.push(m); }
    }
    comps.push(comp);
  }
  return comps.sort((a, b) => b.length - a.length);
}

/**
 * Fraction of contacts between cells of the same class (classOf), over all contacts.
 * 0.5 for a random 50/50 mix, → 1 when the classes are fully sorted.
 */
export function homotypicFraction(nbrs: number[][], classOf: (c: number) => number): number {
  let same = 0, all = 0;
  nbrs.forEach((list, a) => {
    for (const b of list) {
      if (b <= a) continue;
      all++;
      if (classOf(a) === classOf(b)) same++;
    }
  });
  return all ? same / all : 0;
}

/**
 * Surface cells of an aggregate: fewer than `maxInterior` contacts (an interior
 * cell in a 2D packing has ~6).
 */
export function surfaceCells(nbrs: number[][], members: number[], maxInterior = 5): number[] {
  return members.filter((c) => nbrs[c].length < maxInterior);
}
