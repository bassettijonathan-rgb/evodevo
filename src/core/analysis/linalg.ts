/**
 * Tiny dense linear algebra for linear-stability analysis of small systems
 * (a handful of genes + fields). Not optimised; clarity first.
 */

export type Matrix = number[][];

export interface Complex {
  re: number;
  im: number;
}

/**
 * Characteristic polynomial det(λI − A) by the Faddeev–LeVerrier recursion.
 * Returns coefficients c[0..n] with p(λ) = Σ c[k] λ^k and c[n] = 1.
 */
export function charPoly(A: Matrix): number[] {
  const n = A.length;
  const c = new Array<number>(n + 1).fill(0);
  c[n] = 1;
  let M: Matrix = A.map((row) => row.map(() => 0)); // M_0 = 0
  for (let k = 1; k <= n; k++) {
    // M_k = A·M_{k−1} + c_{n−k+1}·I
    const next: Matrix = A.map(() => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let l = 0; l < n; l++) s += A[i][l] * M[l][j];
        next[i][j] = s + (i === j ? c[n - k + 1] : 0);
      }
    }
    M = next;
    // c_{n−k} = −tr(A·M_k)/k
    let tr = 0;
    for (let i = 0; i < n; i++) for (let l = 0; l < n; l++) tr += A[i][l] * M[l][i];
    c[n - k] = -tr / k;
  }
  return c;
}

/** All complex roots of a monic polynomial (coefficients low → high), Durand–Kerner iteration. */
export function polyRoots(c: number[]): Complex[] {
  const n = c.length - 1;
  if (n === 0) return [];
  const evalP = (z: Complex): Complex => {
    let re = c[n], im = 0;
    for (let k = n - 1; k >= 0; k--) {
      const r2 = re * z.re - im * z.im + c[k];
      im = re * z.im + im * z.re;
      re = r2;
    }
    return { re, im };
  };
  // Initial guesses on a circle bounding all roots (Cauchy bound), slightly rotated.
  const R = 1 + Math.max(...c.slice(0, n).map(Math.abs));
  let z: Complex[] = Array.from({ length: n }, (_, k) => ({
    re: R * Math.cos((2 * Math.PI * k) / n + 0.4),
    im: R * Math.sin((2 * Math.PI * k) / n + 0.4),
  }));
  for (let iter = 0; iter < 2000; iter++) {
    let moved = 0;
    const next = z.map((zi, i) => {
      let den: Complex = { re: 1, im: 0 };
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const d = { re: zi.re - z[j].re, im: zi.im - z[j].im };
        den = { re: den.re * d.re - den.im * d.im, im: den.re * d.im + den.im * d.re };
      }
      const p = evalP(zi);
      const m = den.re * den.re + den.im * den.im || 1e-300;
      const q = { re: (p.re * den.re + p.im * den.im) / m, im: (p.im * den.re - p.re * den.im) / m };
      moved = Math.max(moved, Math.hypot(q.re, q.im));
      return { re: zi.re - q.re, im: zi.im - q.im };
    });
    z = next;
    if (moved < 1e-14 * R) break;
  }
  return z;
}

/** Eigenvalues of a small square matrix. */
export function eigenvalues(A: Matrix): Complex[] {
  return polyRoots(charPoly(A));
}

/** Solve A·x = b by Gaussian elimination with partial pivoting (A is copied). */
export function solveLinear(A: Matrix, b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let k = 0; k < n; k++) {
    let piv = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[piv][k])) piv = i;
    [M[k], M[piv]] = [M[piv], M[k]];
    if (Math.abs(M[k][k]) < 1e-300) throw new Error('singular matrix');
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}
