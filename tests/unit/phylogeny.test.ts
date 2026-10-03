import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/core/evolution/evaluate';
import { randomFounder } from '../../src/core/evolution/founders';
import { ancestry, layoutTree, type PhyloNode } from '../../src/core/evolution/phylogeny';
import { Evolution } from '../../src/core/evolution/population';
import { Rng } from '../../src/core/rng';

const node = (id: number, parents: number[], generation: number): PhyloNode => ({ id, parents, generation, log: [] });

describe('phylogeny', () => {
  //      0
  //     / \
  //    1   2        (3 is an extinct sibling of 1)
  //   / \   \
  //  4   5   6 ← crossover child of 2 and 4
  const nodes = new Map<number, PhyloNode>([
    [0, node(0, [], 0)], [1, node(1, [0], 1)], [2, node(2, [0], 1)], [3, node(3, [0], 1)],
    [4, node(4, [1], 2)], [5, node(5, [1], 2)], [6, node(6, [2, 4], 2)],
  ]);

  it('ancestry keeps only lineages that lead to the given leaves', () => {
    expect([...ancestry(nodes, [5, 6])].sort()).toEqual([0, 1, 2, 4, 5, 6]);
    expect(ancestry(nodes, [5, 6]).has(3)).toBe(false);
  });

  it('layout: x = generation, leaves on distinct rows, parents between their children', () => {
    const t = layoutTree(nodes, ancestry(nodes, [4, 5, 6]));
    expect(t.rows).toBe(3);
    for (const [id, p] of t.pos) expect(p.x).toBe(nodes.get(id)!.generation);
    const ys = [4, 5, 6].map((id) => t.pos.get(id)!.y).sort();
    expect(ys).toEqual([0, 1, 2]);
    expect(t.pos.get(1)!.y).toBe((t.pos.get(4)!.y + t.pos.get(5)!.y) / 2);
    expect(t.edges.filter((e) => e.secondary)).toEqual([{ from: 4, to: 6, secondary: true }]);
  });

  it('a second evolution run can continue the lineage of the first', async () => {
    const run = async (evo: Evolution) => { await evo.evaluate(async (jobs) => jobs.map(evaluate)); };
    const sim = { gridNx: 32, gridNy: 32, maxCells: 20, tDev: 20 };
    const first = new Evolution([randomFounder(new Rng(1))], { populationSize: 4, sim, seed: 'a' });
    await run(first);
    const chosen = first.population[1];
    const second = new Evolution([chosen.genome], { populationSize: 4, sim, seed: 'b' }, {
      startId: first.nextIndividualId, founderParents: [[chosen.id]], startGeneration: first.generation + 1,
    });
    for (const ind of second.population) {
      expect(ind.id).toBeGreaterThanOrEqual(first.nextIndividualId);
      expect(ind.parents).toEqual([chosen.id]);
      expect(ind.generation).toBe(1);
    }
  });
});
