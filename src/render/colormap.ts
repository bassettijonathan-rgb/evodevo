/**
 * Sequential colour map (viridis, sampled at 9 stops and linearly interpolated):
 * perceptually uniform and readable for colour-blind viewers.
 */
const STOPS: [number, number, number][] = [
  [68, 1, 84], [71, 44, 122], [59, 81, 139], [44, 113, 142], [33, 144, 141],
  [39, 173, 129], [92, 200, 99], [170, 220, 50], [253, 231, 37],
];

export function viridis(t: number): [number, number, number] {
  const v = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const x = v * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const a = STOPS[i], b = STOPS[i + 1];
  return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
}

export function viridisCss(t: number): string {
  const [r, g, b] = viridis(t);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/** A stable colour for an integer id (lineage colouring). */
export function idColor(id: number): string {
  const h = ((id * 2654435761) >>> 0) % 360;
  return `hsl(${h} 55% 55%)`;
}
