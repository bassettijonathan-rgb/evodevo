/**
 * 2D power spectrum of a field, for measuring the dominant wavelength of a pattern.
 */

/** In-place iterative radix-2 complex FFT. n must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/**
 * Radially averaged power spectrum of an n×n field (n a power of two), mean removed.
 * Returns power[k] for integer radial wavenumber k = 0 .. n/2 (k cycles per n·h).
 */
export function radialPowerSpectrum(field: ArrayLike<number>, n: number): Float64Array {
  let mean = 0;
  for (let p = 0; p < n * n; p++) mean += field[p];
  mean /= n * n;
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let p = 0; p < n * n; p++) re[p] = field[p] - mean;
  // Rows then columns.
  const rr = new Float64Array(n), ri = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    rr.set(re.subarray(j * n, (j + 1) * n)); ri.fill(0);
    fft(rr, ri);
    re.set(rr, j * n); im.set(ri, j * n);
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) { rr[j] = re[j * n + i]; ri[j] = im[j * n + i]; }
    fft(rr, ri);
    for (let j = 0; j < n; j++) { re[j * n + i] = rr[j]; im[j * n + i] = ri[j]; }
  }
  const power = new Float64Array(n / 2 + 1);
  const count = new Float64Array(n / 2 + 1);
  for (let j = 0; j < n; j++) {
    const ky = j <= n / 2 ? j : j - n;
    for (let i = 0; i < n; i++) {
      const kx = i <= n / 2 ? i : i - n;
      const k = Math.round(Math.sqrt(kx * kx + ky * ky));
      if (k > n / 2) continue;
      power[k] += re[j * n + i] ** 2 + im[j * n + i] ** 2;
      count[k]++;
    }
  }
  for (let k = 0; k <= n / 2; k++) if (count[k]) power[k] /= count[k];
  return power;
}

/**
 * Dominant wavelength (in grid spacings) of an n×n field: the power-weighted mean
 * wavenumber over the peak ±2 bins, which is less noisy than the arg-max alone.
 */
export function dominantWavelength(field: ArrayLike<number>, n: number): number {
  const p = radialPowerSpectrum(field, n);
  let kPeak = 1;
  for (let k = 1; k < p.length; k++) if (p[k] > p[kPeak]) kPeak = k;
  let num = 0, den = 0;
  for (let k = Math.max(1, kPeak - 2); k <= Math.min(p.length - 1, kPeak + 2); k++) {
    num += k * p[k];
    den += p[k];
  }
  return n / (num / den);
}
