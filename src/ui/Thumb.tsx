/** Small canvas drawing of an organism's final state, coloured by cell type. */
import { useEffect, useRef } from 'preact/hooks';
import type { FinalSnapshot } from '../core/evolution/evaluate';
import { typeColor } from '../render/palette';

export function Thumb({ snap, size = 150 }: { snap: FinalSnapshot; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size * dpr;
    cv.height = size * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    if (!snap.n) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let c = 0; c < snap.n; c++) {
      x0 = Math.min(x0, snap.px[c]); x1 = Math.max(x1, snap.px[c]);
      y0 = Math.min(y0, snap.py[c]); y1 = Math.max(y1, snap.py[c]);
    }
    const span = Math.max(x1 - x0, y1 - y0, 8) + 2;
    const s = size / span, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (let c = 0; c < snap.n; c++) {
      ctx.beginPath();
      ctx.arc((snap.px[c] - cx) * s + size / 2, size / 2 - (snap.py[c] - cy) * s, 0.47 * s, 0, 2 * Math.PI);
      ctx.fillStyle = typeColor(snap.typeOf[c]);
      ctx.fill();
    }
  }, [snap, size]);
  return <canvas ref={ref} style={{ width: `${size}px`, height: `${size}px` }} aria-label={`organism with ${snap.n} cells`} />;
}
