/**
 * Organism → standalone SVG string (for reports and exports). Pure, no DOM.
 */
import type { FinalSnapshot } from '../core/evolution/evaluate';
import { typeColor } from './palette';

export function organismSVG(f: FinalSnapshot, size = 240, title = ''): string {
  if (f.n === 0) return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><text x="8" y="20" font-size="12">no cells</text></svg>`;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let c = 0; c < f.n; c++) {
    x0 = Math.min(x0, f.px[c]); x1 = Math.max(x1, f.px[c]);
    y0 = Math.min(y0, f.py[c]); y1 = Math.max(y1, f.py[c]);
  }
  const span = Math.max(x1 - x0, y1 - y0) + 2;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const s = size / span;
  const circles: string[] = [];
  for (let c = 0; c < f.n; c++) {
    const x = (f.px[c] - cx) * s + size / 2, y = size / 2 - (f.py[c] - cy) * s;
    circles.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.5 * s).toFixed(1)}" fill="${typeColor(f.typeOf[c])}"/>`);
  }
  const label = title ? `<text x="6" y="${size - 6}" font-family="sans-serif" font-size="11" fill="#555">${title}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#fbfbfa"/>${circles.join('')}${label}</svg>`;
}
