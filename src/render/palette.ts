/**
 * Colours for cell types: a fixed categorical palette (distinguishable in light
 * and dark themes), with grey for rare/unclassified cells.
 */
export const TYPE_COLORS = [
  '#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1',
  '#76b7b2', '#edc948', '#ff9da7', '#9c755f', '#86bc86',
  '#d37295', '#a0cbe8', '#ffbe7d', '#8cd17d', '#f1ce63',
];
export const RARE_COLOR = '#9a9a94';

export function typeColor(t: number): string {
  return t < 0 ? RARE_COLOR : TYPE_COLORS[t % TYPE_COLORS.length];
}
