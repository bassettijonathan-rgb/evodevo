/**
 * Phylogeny of the breeding session (DESIGN.md §9.6). By default only lineages
 * leading to the current brood are drawn (extinct branches pruned); x is the
 * generation. Duplication events are marked, since duplicate-then-diverge is the
 * route to novelty this model is meant to show.
 */
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { FinalSnapshot } from '../core/evolution/evaluate';
import { ancestry, layoutTree } from '../core/evolution/phylogeny';
import { genomeToJSON } from '../core/genome/serialize';
import { viridisCss } from '../render/colormap';
import { offerText } from './files';
import { lineageOf, phylo, sessionMeta, type SessionNode } from './session';
import { breedFrom, openInLab, pool } from './state';
import { Thumb } from './Thumb';

const showExtinct = signal(false);
const picked = signal<number | null>(null);
const pickedSnap = signal<FinalSnapshot | null>(null);

const isDuplication = (log: string[]) => log.some((l) => /^(dup|segdup|WGD)/.test(l));

export function Phylogeny() {
  const nodes = phylo.value;
  const meta = sessionMeta.value;
  if (!nodes.size || !meta) return <div class="panel"><h2>Phylogeny</h2><p class="muted">Breed a few generations first; every organism you see is recorded here.</p></div>;

  const keep = showExtinct.value ? new Set(nodes.keys()) : ancestry(nodes, meta.current);
  const tree = layoutTree(nodes, keep);
  const gens = [...keep].map((id) => nodes.get(id)!.generation);
  const g0 = Math.min(...gens), g1 = Math.max(...gens);
  const dx = Math.max(14, Math.min(60, 900 / Math.max(1, g1 - g0))), dy = 16, padL = 30, padT = 24;
  const W = padL * 2 + (g1 - g0) * dx, H = padT * 2 + Math.max(1, tree.rows - 1) * dy;
  const X = (g: number) => padL + (g - g0) * dx;
  const Y = (r: number) => padT + r * dy;
  const maxTypes = Math.max(1, ...[...keep].map((id) => nodes.get(id)!.metrics?.cellTypes ?? 0));
  const sel = picked.value !== null ? nodes.get(picked.value) : undefined;

  return (
    <div class="phylo">
      <section class="panel">
        <div class="row">
          <h2>Phylogeny</h2>
          <span class="muted">{nodes.size} organisms · generations {g0}–{g1}</span>
          <label><input type="checkbox" checked={showExtinct.value} onChange={(e) => { showExtinct.value = (e.target as HTMLInputElement).checked; }} /> show extinct lineages</label>
          <span class="muted small">colour = number of cell types · ◆ = gene duplication · dashed = second parent (crossover)</span>
        </div>
        <div class="tree-scroll">
          <svg width={W} height={H} role="img" aria-label="phylogenetic tree">
            {tree.edges.map((e) => {
              const a = tree.pos.get(e.from)!, b = tree.pos.get(e.to)!;
              return <path d={`M${X(a.x)},${Y(a.y)} H${X(b.x) - dx / 2} V${Y(b.y)} H${X(b.x)}`} fill="none" stroke="var(--muted)" stroke-width="1.2" stroke-dasharray={e.secondary ? '3 3' : undefined} opacity="0.7" />;
            })}
            {[...tree.pos].map(([id, p]) => {
              const n = nodes.get(id)!;
              const fill = viridisCss((n.metrics?.cellTypes ?? 0) / maxTypes);
              const current = meta.current.includes(id);
              const dup = isDuplication(n.log);
              const cx = X(p.x), cy = Y(p.y);
              return (
                <g class="pnode" onClick={() => pick(n)} role="button" aria-label={`organism ${id}`}>
                  {dup ? <path d={`M${cx},${cy - 7} L${cx + 7},${cy} L${cx},${cy + 7} L${cx - 7},${cy} Z`} fill={fill} stroke="var(--fg)" />
                    : <circle cx={cx} cy={cy} r={current ? 6 : 4.5} fill={fill} stroke={picked.value === id ? 'var(--fg)' : current ? 'var(--chosen)' : 'none'} stroke-width="2" />}
                  <title>{`#${id}, generation ${n.generation}${n.metrics ? ` — ${n.metrics.cells} cells, ${n.metrics.cellTypes} types` : ''}\n${n.log.join('\n') || '(no mutations)'}`}</title>
                </g>
              );
            })}
          </svg>
        </div>
      </section>
      {sel && <NodeDetail node={sel} />}
    </div>
  );
}

function pick(n: SessionNode) {
  picked.value = n.id;
  pickedSnap.value = null;
  // Regrow for the thumbnail: development is deterministic, so this is the same organism.
  void pool().evaluate([{ genome: n.genome, config: n.sim, seed: n.seed }]).then(([r]) => {
    if (picked.value === n.id) pickedSnap.value = r.final;
  });
}

function NodeDetail({ node }: { node: SessionNode }) {
  useEffect(() => { if (!pickedSnap.value) pick(node); }, [node.id]);
  const m = node.metrics;
  const lineage = lineageOf(node.id);
  const dups = lineage.flatMap((n) => n.log.filter((l) => /^(dup|segdup|WGD)/.test(l)).map((l) => `gen ${n.generation}: ${l}`));
  return (
    <section class="panel detail">
      <div class="row">
        {pickedSnap.value ? <Thumb snap={pickedSnap.value} size={180} /> : <div class="placeholder" />}
        <div>
          <h3>Organism #{node.id} <span class="muted">generation {node.generation}</span></h3>
          {m && <p class="small num">{m.cells} cells · {m.cellTypes} types · {m.segments} segments · mirror κ {m.patternBilateral.toFixed(2)} · {node.genome.genes.length} genes</p>}
          <p class="small">Mutations from its parent: {node.log.length ? node.log.join('; ') : 'none (founder or copy)'}</p>
          <p class="small">Duplications along its lineage ({lineage.length} ancestors): {dups.length ? dups.join('; ') : 'none'}</p>
          <div class="row">
            <button class="primary" onClick={() => openInLab({ genome: node.genome, config: node.sim, seed: node.seed, label: `organism #${node.id}` })}>Inspect in lab</button>
            <button onClick={() => breedFrom(node)}>Breed from here</button>
            <button onClick={() => offerText(`organism-${node.id}.genome.json`, JSON.stringify({ genome: JSON.parse(genomeToJSON(node.genome)), config: node.sim }, null, 2))}>Save genome</button>
            <button onClick={() => offerText(`lineage-${node.id}.json`, JSON.stringify(lineage.map((n) => ({ id: n.id, generation: n.generation, parents: n.parents, mutations: n.log, metrics: n.metrics, genome: JSON.parse(genomeToJSON(n.genome)) })), null, 2))}>Export lineage</button>
          </div>
        </div>
      </div>
    </section>
  );
}
