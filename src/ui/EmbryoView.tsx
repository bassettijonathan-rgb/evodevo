/**
 * The main embryo canvas: draws one recorded frame with the chosen overlays.
 * Clicking (when a brush handler is given) reports world coordinates, used to
 * place ectopic-expression regions.
 */
import { useEffect, useRef } from 'preact/hooks';
import type { CompiledGRN } from '../core/genome/compile';
import { assignTypes } from '../core/metrics';
import type { Frame } from '../core/sim/recorder';
import { drawFrame, toWorld, type CellColouring, type ViewTransform } from '../render/canvas';

export interface Overlay {
  colour: 'type' | 'gene' | 'lineage' | 'pressure';
  gene: number;
  field: number | null;
  polarity: boolean;
  fit: 'cells' | 'grid';
}

interface Props {
  frame: Frame;
  grn: CompiledGRN;
  grid: { nx: number; ny: number; h: number };
  overlay: Overlay;
  size: number;
  region?: { x: number; y: number; r: number } | null;
  onPick?: (x: number, y: number) => void;
  /** Precomputed cell types for this frame (computed here if absent). */
  typeOf?: Int32Array;
}

export function EmbryoView({ frame, grn, grid, overlay, size, region, onPick, typeOf }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const view = useRef<ViewTransform | null>(null);
  useEffect(() => {
    const cv = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size * dpr;
    cv.height = size * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let colouring: CellColouring;
    if (overlay.colour === 'gene') colouring = { kind: 'gene', gene: overlay.gene, max: grn.maxLevel[overlay.gene] };
    else if (overlay.colour === 'lineage') colouring = { kind: 'lineage' };
    else if (overlay.colour === 'pressure') {
      let max = 0;
      for (let c = 0; c < frame.n; c++) max = Math.max(max, frame.pressure?.[c] ?? 0);
      colouring = { kind: 'pressure', max };
    }
    else colouring = { kind: 'type', typeOf: typeOf ?? assignTypes({ n: frame.n, px: frame.px, py: frame.py, x: frame.x, grn }).typeOf };
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || '#fff';
    view.current = drawFrame(ctx, frame, grn.G, {
      width: size, height: size, colouring, field: overlay.field, grid, showPolarity: overlay.polarity,
      fit: overlay.fit, region, background: bg,
    });
  }, [frame, grn, overlay, size, region, typeOf]);
  return (
    <canvas
      ref={ref}
      class={onPick ? 'pickable' : ''}
      style={{ width: `${size}px`, height: `${size}px` }}
      aria-label={`embryo at t = ${frame.t.toFixed(1)}, ${frame.n} cells`}
      onClick={(e) => {
        if (!onPick || !view.current) return;
        const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const [x, y] = toWorld(view.current, e.clientX - r.left, e.clientY - r.top);
        onPick(x, y);
      }}
    />
  );
}
