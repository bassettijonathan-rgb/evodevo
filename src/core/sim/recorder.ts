/**
 * Playback recording (DESIGN.md §9.1): snapshots of the embryo every few steps,
 * stored as Float32 to halve memory. Frames are self-contained, so the UI can
 * scrub to any one without replaying.
 */
import type { CellStore } from './cells';
import type { MorphogenGrid } from './morphogens';

export interface Frame {
  t: number;
  n: number;
  id: Int32Array;
  parentId: Int32Array;
  founderId: Int32Array;
  px: Float32Array;
  py: Float32Array;
  polX: Float32Array;
  polY: Float32Array;
  radius: Float32Array;
  postmitotic: Uint8Array;
  /** Summed compressive contact force per cell (mechanical pressure). */
  pressure: Float32Array;
  /** n × G expression levels, row-major. */
  x: Float32Array;
  /** M × nx × ny morphogen fields (empty if fields were not recorded). */
  fields: Float32Array;
}

export function snapshot(t: number, cells: CellStore, grid: MorphogenGrid | null, withFields = true): Frame {
  const n = cells.n;
  const f32 = (a: Float64Array) => Float32Array.from(a.subarray(0, n));
  return {
    t,
    n,
    id: cells.id.slice(0, n),
    parentId: cells.parentId.slice(0, n),
    founderId: cells.founderId.slice(0, n),
    px: f32(cells.px),
    py: f32(cells.py),
    polX: f32(cells.polX),
    polY: f32(cells.polY),
    radius: f32(cells.radius),
    postmitotic: cells.postmitotic.slice(0, n),
    pressure: f32(cells.pressure),
    x: Float32Array.from(cells.x.subarray(0, n * cells.G)),
    fields: grid && withFields ? Float32Array.from(grid.c) : new Float32Array(0),
  };
}
