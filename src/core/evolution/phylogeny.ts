/**
 * Phylogeny (DESIGN.md §9.6): who descends from whom, and a tree layout.
 * Nodes form a DAG (crossover gives two parents); the layout follows the first
 * parent, so it draws a tree with occasional extra edges for recombination.
 */
export interface PhyloNode {
  id: number;
  parents: number[];
  generation: number;
  /** Mutations relative to the first parent. */
  log: string[];
}

/** All ancestors of `leaves`, including the leaves themselves. */
export function ancestry(nodes: Map<number, PhyloNode>, leaves: number[]): Set<number> {
  const seen = new Set<number>();
  const stack = [...leaves];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id) || !nodes.has(id)) continue;
    seen.add(id);
    stack.push(...nodes.get(id)!.parents);
  }
  return seen;
}

export interface TreeLayout {
  /** Position per node: x = generation, y = row (0 … rows−1). */
  pos: Map<number, { x: number; y: number }>;
  rows: number;
  /** Edges parent → child; `secondary` for the second parent of a crossover. */
  edges: { from: number; to: number; secondary: boolean }[];
}

/**
 * Lay out the sub-tree induced by `keep`: leaves get consecutive rows in depth-
 * first order, internal nodes sit at the mean row of their children.
 * Chains of single-child nodes are kept, so every generation is visible.
 */
export function layoutTree(nodes: Map<number, PhyloNode>, keep: Set<number>): TreeLayout {
  const children = new Map<number, number[]>();
  const roots: number[] = [];
  const edges: TreeLayout['edges'] = [];
  for (const id of [...keep].sort((a, b) => a - b)) {
    const n = nodes.get(id)!;
    const primary = n.parents.find((p) => keep.has(p));
    if (primary === undefined) roots.push(id);
    else {
      if (!children.has(primary)) children.set(primary, []);
      children.get(primary)!.push(id);
    }
    for (const p of n.parents) if (keep.has(p)) edges.push({ from: p, to: id, secondary: p !== primary });
  }
  const pos = new Map<number, { x: number; y: number }>();
  let row = 0;
  const place = (id: number): number => {
    const kids = children.get(id) ?? [];
    const y = kids.length ? kids.map(place).reduce((a, b) => a + b, 0) / kids.length : row++;
    pos.set(id, { x: nodes.get(id)!.generation, y });
    return y;
  };
  for (const r of roots) place(r);
  return { pos, rows: row, edges };
}
