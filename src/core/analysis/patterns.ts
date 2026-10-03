/**
 * Morphology of a thresholded 2D pattern: connected "high" regions and their shapes.
 * Used to tell Turing spots from stripes.
 */

export interface Blob {
  area: number;
  perimeter: number;
  /** Isoperimetric quotient 4π·area/perimeter²: ~0.7–0.9 for a pixelated disc, small for a long stripe. */
  compactness: number;
  /** √(λ₁/λ₂) of the second-moment matrix. */
  aspect: number;
  touchesEdge: boolean;
}

/** 4-connected components of field > threshold on an nx×ny grid. */
export function findBlobs(field: ArrayLike<number>, nx: number, ny: number, threshold: number): Blob[] {
  const label = new Int32Array(nx * ny).fill(-1);
  const blobs: Blob[] = [];
  const stack: number[] = [];
  const high = (p: number) => field[p] > threshold;
  for (let start = 0; start < nx * ny; start++) {
    if (!high(start) || label[start] >= 0) continue;
    const id = blobs.length;
    let area = 0, perim = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, edge = false;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const i = p % nx, j = (p - i) / nx;
      area++; sx += i; sy += j; sxx += i * i; syy += j * j; sxy += i * j;
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) edge = true;
      const nbrs: [number, number][] = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
      for (const [a, b] of nbrs) {
        if (a < 0 || b < 0 || a >= nx || b >= ny) { perim++; continue; }
        const q = b * nx + a;
        if (!high(q)) { perim++; continue; }
        if (label[q] < 0) { label[q] = id; stack.push(q); }
      }
    }
    const mx = sx / area, my = sy / area;
    const cxx = sxx / area - mx * mx + 1 / 12, cyy = syy / area - my * my + 1 / 12, cxy = sxy / area - mx * my;
    const tr = cxx + cyy, det = cxx * cyy - cxy * cxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(tr / 2 - disc, 1e-12);
    blobs.push({
      area,
      perimeter: perim,
      compactness: (4 * Math.PI * area) / (perim * perim),
      aspect: Math.sqrt(l1 / l2),
      touchesEdge: edge,
    });
  }
  return blobs;
}

export type PatternKind = 'spots' | 'stripes' | 'mixed' | 'none';

export interface PatternSummary {
  kind: PatternKind;
  blobs: number;
  /** Fraction of the domain above threshold. */
  coverage: number;
  /** Median compactness of interior blobs (spots ≈ 0.6–0.9). */
  medianCompactness: number;
  /** Area-weighted mean compactness of all blobs (stripes ≪ 0.3). */
  weightedCompactness: number;
  /** Relative contrast (max − min)/mean of the field. */
  contrast: number;
}

/**
 * Classify a pattern by thresholding at the midrange and looking at the shapes of
 * the high regions. Spots: many compact islands. Stripes: few long, thin regions.
 */
export function classifyPattern(field: ArrayLike<number>, nx: number, ny: number): PatternSummary {
  let lo = Infinity, hi = -Infinity, mean = 0;
  for (let p = 0; p < nx * ny; p++) {
    lo = Math.min(lo, field[p]); hi = Math.max(hi, field[p]); mean += field[p];
  }
  mean /= nx * ny;
  const contrast = (hi - lo) / Math.max(Math.abs(mean), 1e-12);
  const blobs = findBlobs(field, nx, ny, (lo + hi) / 2).filter((b) => b.area >= 3);
  const covered = blobs.reduce((s, b) => s + b.area, 0);
  const interior = blobs.filter((b) => !b.touchesEdge).map((b) => b.compactness).sort((a, b) => a - b);
  const medianCompactness = interior.length ? interior[Math.floor(interior.length / 2)] : 0;
  const weightedCompactness = covered ? blobs.reduce((s, b) => s + b.area * b.compactness, 0) / covered : 0;
  let kind: PatternKind = 'mixed';
  if (contrast < 0.05 || blobs.length === 0) kind = 'none';
  else if (blobs.length >= 8 && medianCompactness > 0.5 && weightedCompactness > 0.45) kind = 'spots';
  else if (weightedCompactness < 0.3) kind = 'stripes';
  return {
    kind,
    blobs: blobs.length,
    coverage: covered / (nx * ny),
    medianCompactness,
    weightedCompactness,
    contrast,
  };
}
