/**
 * Small time-series utilities: peak detection and oscillation statistics.
 */

/** Indices of strict local maxima that rise above `threshold`. */
export function findPeaks(y: ArrayLike<number>, threshold = -Infinity): number[] {
  const peaks: number[] = [];
  for (let k = 1; k < y.length - 1; k++) {
    if (y[k] > threshold && y[k] > y[k - 1] && y[k] >= y[k + 1]) peaks.push(k);
  }
  return peaks;
}

export interface OscillationStats {
  /** Number of peaks found. */
  peaks: number;
  /** Mean peak-to-peak period (same units as t). */
  period: number;
  /** Coefficient of variation of the periods. */
  periodCV: number;
  /** Mean peak-to-trough amplitude over the analysed window. */
  amplitude: number;
}

/**
 * Oscillation statistics of y(t), ignoring samples before tStart (transient).
 * Peaks must exceed the window's midrange so that noise wiggles are not counted.
 */
export function oscillationStats(t: ArrayLike<number>, y: ArrayLike<number>, tStart = 0): OscillationStats {
  let k0 = 0;
  while (k0 < t.length && t[k0] < tStart) k0++;
  const ys = Array.from(y).slice(k0);
  const ts = Array.from(t).slice(k0);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const peaks = findPeaks(ys, (lo + hi) / 2);
  const periods = peaks.slice(1).map((p, k) => ts[p] - ts[peaks[k]]);
  const mean = periods.reduce((a, b) => a + b, 0) / Math.max(periods.length, 1);
  const sd = Math.sqrt(periods.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(periods.length, 1));
  return {
    peaks: peaks.length,
    period: periods.length ? mean : NaN,
    periodCV: periods.length ? sd / mean : NaN,
    amplitude: hi - lo,
  };
}
