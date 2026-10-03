/**
 * Interactive gene regulatory network (DESIGN.md §9.4).
 * Nodes: genes (shape = product type, fill = mean expression at the current frame).
 * Edges: cis-regulatory sites, regulator → target; width ∝ |w|, green activates,
 * red represses. Layout by d3-force, computed once per genome.
 */
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from 'd3-force';
import { useMemo } from 'preact/hooks';
import type { Genome } from '../core/genome/types';
import { viridisCss } from '../render/colormap';

interface Node extends SimulationNodeDatum { id: number; name: string; type: string; index: number }
interface Link { source: Node; target: Node; weight: number; inert: boolean }

const SHAPES: Record<string, string> = { tf: 'circle', morphogen: 'diamond', contact: 'square', adhesion: 'hex', effector: 'triangle' };

function layout(genome: Genome, W: number, H: number): { nodes: Node[]; links: Link[] } {
  const nodes: Node[] = genome.genes.map((g, index) => ({ id: g.id, name: g.name, type: g.type, index, x: W / 2 + 60 * Math.cos(index), y: H / 2 + 60 * Math.sin(index) }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links: Link[] = [];
  for (const g of genome.genes) {
    for (const s of g.sites) {
      const src = genome.genes.find((x) => x.id === s.regulator)!;
      links.push({ source: byId.get(s.regulator)!, target: byId.get(g.id)!, weight: s.weight, inert: !(src.type === 'tf' || src.type === 'morphogen' || src.type === 'contact') });
    }
  }
  const sim = forceSimulation(nodes)
    .force('charge', forceManyBody().strength(-260))
    .force('link', forceLink<Node, Link>(links.filter((l) => l.source !== l.target)).distance(70).strength(0.4))
    .force('center', forceCenter(W / 2, H / 2))
    .force('collide', forceCollide(26))
    .stop();
  for (let i = 0; i < 300; i++) sim.tick();
  for (const n of nodes) { n.x = Math.max(24, Math.min(W - 24, n.x!)); n.y = Math.max(24, Math.min(H - 24, n.y!)); }
  return { nodes, links };
}

function shapePath(kind: string, r: number): string {
  switch (SHAPES[kind]) {
    case 'diamond': return `M0,${-r * 1.2} L${r * 1.2},0 L0,${r * 1.2} L${-r * 1.2},0 Z`;
    case 'square': return `M${-r},${-r} H${r} V${r} H${-r} Z`;
    case 'triangle': return `M0,${-r * 1.2} L${r * 1.1},${r * 0.8} L${-r * 1.1},${r * 0.8} Z`;
    case 'hex': return Array.from({ length: 6 }, (_, k) => `${k ? 'L' : 'M'}${(r * 1.1 * Math.cos((k * Math.PI) / 3)).toFixed(1)},${(r * 1.1 * Math.sin((k * Math.PI) / 3)).toFixed(1)}`).join(' ') + ' Z';
    default: return `M${-r},0 A${r},${r} 0 1,0 ${r},0 A${r},${r} 0 1,0 ${-r},0`;
  }
}

interface Props {
  genome: Genome;
  /** Mean expression per gene (index order), normalised to [0, 1]. */
  levels: number[];
  selected: number | null;
  perturbed: Map<number, string>;
  onSelect: (index: number) => void;
  width?: number;
  height?: number;
}

export function GrnView({ genome, levels, selected, perturbed, onSelect, width = 420, height = 340 }: Props) {
  const { nodes, links } = useMemo(() => layout(genome, width, height), [genome, width, height]);
  const maxW = Math.max(1, ...links.map((l) => Math.abs(l.weight)));
  const r = 15;
  return (
    <svg class="grn" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="gene regulatory network">
      <defs>
        <marker id="arr-act" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--act)" /></marker>
        <marker id="arr-rep" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M4,0 H6 V10 H4 z" fill="var(--rep)" /></marker>
      </defs>
      {links.map((l) => {
        const { source: a, target: b } = l;
        const stroke = l.inert ? 'var(--muted)' : l.weight >= 0 ? 'var(--act)' : 'var(--rep)';
        const w = 0.8 + (4 * Math.abs(l.weight)) / maxW;
        if (a === b) {
          return <path d={`M${a.x! - 6},${a.y! - r} C${a.x! - 30},${a.y! - 50} ${a.x! + 30},${a.y! - 50} ${a.x! + 6},${a.y! - r}`} fill="none" stroke={stroke} stroke-width={w} stroke-dasharray={l.inert ? '3 3' : undefined} opacity="0.8">
            <title>{`${a.name} → itself: ${l.weight.toFixed(2)}`}</title></path>;
        }
        const dx = b.x! - a.x!, dy = b.y! - a.y!, d = Math.hypot(dx, dy) || 1;
        const x1 = a.x! + (dx / d) * r, y1 = a.y! + (dy / d) * r, x2 = b.x! - (dx / d) * (r + 3), y2 = b.y! - (dy / d) * (r + 3);
        // Slight curve so reciprocal edges do not overlap.
        const mx = (x1 + x2) / 2 - (dy / d) * 10, my = (y1 + y2) / 2 + (dx / d) * 10;
        return (
          <path d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`} fill="none" stroke={stroke} stroke-width={w} opacity="0.8"
            stroke-dasharray={l.inert ? '3 3' : undefined}
            marker-end={l.inert ? undefined : l.weight >= 0 ? 'url(#arr-act)' : 'url(#arr-rep)'}>
            <title>{`${a.name} → ${b.name}: ${l.weight.toFixed(2)}${l.inert ? ' (inert: product does not bind DNA)' : ''}`}</title>
          </path>
        );
      })}
      {nodes.map((n) => {
        const pert = perturbed.get(n.id);
        return (
          <g transform={`translate(${n.x},${n.y})`} class="node" onClick={() => onSelect(n.index)} role="button" aria-label={`gene ${n.name}`}>
            <path d={shapePath(n.type, r)} fill={viridisCss(levels[n.index] ?? 0)} stroke={selected === n.index ? 'var(--fg)' : 'var(--border)'} stroke-width={selected === n.index ? 3 : 1.5} />
            {pert && <text y={-r - 6} text-anchor="middle" class="pert">{pert}</text>}
            <text y={r + 13} text-anchor="middle" class="label">{n.name}</text>
            <title>{`${n.name} (${n.type}) — mean level ${(levels[n.index] ?? 0).toFixed(2)} of max`}</title>
          </g>
        );
      })}
    </svg>
  );
}
