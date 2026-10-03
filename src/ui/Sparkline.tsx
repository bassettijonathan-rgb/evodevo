/** Tiny inline line chart. */
export function Sparkline({ values, label, width = 180, height = 36 }: { values: number[]; label: string; width?: number; height?: number }) {
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / Math.max(values.length - 1, 1)) * (width - 4) + 2},${height - 2 - ((v - lo) / span) * (height - 4)}`).join(' ');
  return (
    <span class="spark" title={`${label}: ${values.at(-1)?.toFixed(3)}`}>
      <svg width={width} height={height} role="img" aria-label={`${label} over generations`}>
        <polyline points={pts} fill="none" stroke="var(--accent)" stroke-width="1.5" />
      </svg>
      <span class="muted num">{label} {values.at(-1)?.toFixed(3)}</span>
    </span>
  );
}
