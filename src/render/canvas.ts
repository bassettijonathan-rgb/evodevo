/**
 * Canvas2D rendering of a recorded frame (DESIGN.md §9.2 overlays).
 */
import type { Frame } from '../core/sim/recorder';
import { idColor, viridis, viridisCss } from './colormap';
import { typeColor } from './palette';

export type CellColouring =
  | { kind: 'type'; typeOf: Int32Array }
  | { kind: 'gene'; gene: number; max: number }
  | { kind: 'lineage' }
  | { kind: 'pressure'; max: number };

export interface DrawOptions {
  /** Width and height of the canvas in CSS pixels. */
  width: number;
  height: number;
  colouring: CellColouring;
  /** Morphogen field to draw underneath (index into the frame's fields), or null. */
  field: number | null;
  grid: { nx: number; ny: number; h: number };
  showPolarity: boolean;
  /** Fit the view to the cells or to the whole grid. */
  fit: 'cells' | 'grid';
  /** Optional highlighted region (ectopic-expression brush), world coordinates. */
  region?: { x: number; y: number; r: number } | null;
  background: string;
}

export interface ViewTransform {
  scale: number;
  ox: number;
  oy: number;
}

/** World → screen transform that fits the requested content with a margin. */
export function fitView(frame: Frame, o: DrawOptions): ViewTransform {
  let x0: number, x1: number, y0: number, y1: number;
  if (o.fit === 'grid' || frame.n === 0) {
    x0 = 0; y0 = 0; x1 = (o.grid.nx - 1) * o.grid.h; y1 = (o.grid.ny - 1) * o.grid.h;
  } else {
    x0 = Infinity; x1 = -Infinity; y0 = Infinity; y1 = -Infinity;
    for (let c = 0; c < frame.n; c++) {
      x0 = Math.min(x0, frame.px[c]); x1 = Math.max(x1, frame.px[c]);
      y0 = Math.min(y0, frame.py[c]); y1 = Math.max(y1, frame.py[c]);
    }
    const pad = 2;
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    // Keep a minimum zoom so a single zygote is not enormous.
    const minSpan = 12;
    if (x1 - x0 < minSpan) { const c = (x0 + x1) / 2; x0 = c - minSpan / 2; x1 = c + minSpan / 2; }
    if (y1 - y0 < minSpan) { const c = (y0 + y1) / 2; y0 = c - minSpan / 2; y1 = c + minSpan / 2; }
  }
  const scale = Math.min(o.width / (x1 - x0), o.height / (y1 - y0));
  // Centre; y axis points up on screen.
  const ox = o.width / 2 - ((x0 + x1) / 2) * scale;
  const oy = o.height / 2 + ((y0 + y1) / 2) * scale;
  return { scale, ox, oy };
}

export const toScreen = (v: ViewTransform, x: number, y: number): [number, number] => [v.ox + x * v.scale, v.oy - y * v.scale];
export const toWorld = (v: ViewTransform, sx: number, sy: number): [number, number] => [(sx - v.ox) / v.scale, (v.oy - sy) / v.scale];

const fieldCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : null;

function drawField(ctx: CanvasRenderingContext2D, frame: Frame, m: number, o: DrawOptions, v: ViewTransform): void {
  const { nx, ny, h } = o.grid;
  const size = nx * ny;
  if (!fieldCanvas || frame.fields.length < (m + 1) * size) return;
  const f = frame.fields.subarray(m * size, (m + 1) * size);
  let lo = Infinity, hi = -Infinity;
  for (let p = 0; p < size; p++) { lo = Math.min(lo, f[p]); hi = Math.max(hi, f[p]); }
  const span = hi - lo || 1;
  fieldCanvas.width = nx;
  fieldCanvas.height = ny;
  const fctx = fieldCanvas.getContext('2d')!;
  const img = fctx.createImageData(nx, ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      // Image rows go downward; world y goes upward.
      const [r, g, b] = viridis((f[j * nx + i] - lo) / span);
      const q = ((ny - 1 - j) * nx + i) * 4;
      img.data[q] = r; img.data[q + 1] = g; img.data[q + 2] = b; img.data[q + 3] = 255;
    }
  }
  fctx.putImageData(img, 0, 0);
  // Node (i, j) is the centre of an h×h control volume.
  const [sx, sy] = toScreen(v, -h / 2, (ny - 0.5) * h);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(fieldCanvas, sx, sy, nx * h * v.scale, ny * h * v.scale);
}

export function drawFrame(ctx: CanvasRenderingContext2D, frame: Frame, G: number, o: DrawOptions): ViewTransform {
  const v = fitView(frame, o);
  ctx.fillStyle = o.background;
  ctx.fillRect(0, 0, o.width, o.height);
  if (o.field !== null) drawField(ctx, frame, o.field, o, v);

  const r = 0.5 * v.scale;
  const fieldUnder = o.field !== null;
  for (let c = 0; c < frame.n; c++) {
    let fill: string;
    switch (o.colouring.kind) {
      case 'type': fill = typeColor(o.colouring.typeOf[c] ?? -1); break;
      case 'gene': fill = viridisCss(frame.x[c * G + o.colouring.gene] / (o.colouring.max || 1)); break;
      case 'lineage': fill = idColor(frame.founderId[c]); break;
      case 'pressure': fill = viridisCss((frame.pressure?.[c] ?? 0) / (o.colouring.max || 1)); break;
    }
    const [x, y] = toScreen(v, frame.px[c], frame.py[c]);
    ctx.beginPath();
    ctx.arc(x, y, r * (fieldUnder ? 0.55 : 0.95), 0, 2 * Math.PI);
    ctx.fillStyle = fill;
    ctx.fill();
    if (frame.postmitotic[c] && r > 3) {
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  if (o.showPolarity && r > 2.5) {
    ctx.strokeStyle = 'rgba(20,20,20,0.75)';
    ctx.lineWidth = Math.max(1, r / 6);
    ctx.beginPath();
    for (let c = 0; c < frame.n; c++) {
      if (frame.polX[c] === 0 && frame.polY[c] === 0) continue;
      const [x, y] = toScreen(v, frame.px[c], frame.py[c]);
      ctx.moveTo(x, y);
      ctx.lineTo(x + frame.polX[c] * r * 0.9, y - frame.polY[c] * r * 0.9);
    }
    ctx.stroke();
  }
  if (o.region) {
    const [x, y] = toScreen(v, o.region.x, o.region.y);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#d6532a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, o.region.r * v.scale, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  return v;
}
