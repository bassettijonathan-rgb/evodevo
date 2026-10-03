/**
 * Basic shape descriptors of a set of cell positions.
 */

export interface PrincipalAxes {
  cx: number;
  cy: number;
  /** Eigenvalues of the position covariance, λ₁ ≥ λ₂. */
  l1: number;
  l2: number;
  /** Unit vector along the major axis. */
  ax: number;
  ay: number;
  /** √(λ₁/λ₂): 1 for an isotropic blob, large for a rod. */
  elongation: number;
}

/** PCA of points (xs[k], ys[k]) for k < n. */
export function principalAxes(xs: ArrayLike<number>, ys: ArrayLike<number>, n = xs.length): PrincipalAxes {
  let cx = 0, cy = 0;
  for (let k = 0; k < n; k++) { cx += xs[k]; cy += ys[k]; }
  cx /= n; cy /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let k = 0; k < n; k++) {
    const dx = xs[k] - cx, dy = ys[k] - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  sxx /= n; syy /= n; sxy /= n;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc);
  // Eigenvector for l1.
  let ax = sxy, ay = l1 - sxx;
  if (Math.abs(ax) + Math.abs(ay) < 1e-12) { ax = sxx >= syy ? 1 : 0; ay = sxx >= syy ? 0 : 1; }
  const len = Math.sqrt(ax * ax + ay * ay);
  return { cx, cy, l1, l2, ax: ax / len, ay: ay / len, elongation: Math.sqrt(l1 / Math.max(l2, 1e-12)) };
}
