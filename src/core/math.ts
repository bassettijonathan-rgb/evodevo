/**
 * Portable math (DESIGN.md D13).
 *
 * IEEE-754 guarantees correctly rounded +, −, ×, ÷ and sqrt, but NOT Math.exp,
 * Math.log, Math.cos… Different JS engines may differ in the last bit, and
 * development is chaotic enough to amplify that. Everything in the simulation
 * that needs exp/log goes through these functions, which use only the basic
 * operations, so a (genome, config, seed) regrows identically in any browser.
 *
 * Accuracy: a few ulp across the range we use (checked against Math.exp in tests).
 */

// Bit-level access to a float64, used to build 2^k and to split x into mantissa/exponent.
// (Typed arrays use platform endianness; every browser/Node target is little-endian.)
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/** Exactly 2^k for integer k in [-1022, 1023]. */
function pow2(k: number): number {
  u32[0] = 0;
  u32[1] = (k + 1023) << 20;
  return f64[0];
}

// ln 2 split into a high part with trailing zero bits (so k·LN2_HI is exact) and a low part.
// Cody & Waite (1980) range reduction.
const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700;

/** Reference e^x: degree-13 Taylor polynomial after reduction to |r| ≤ ln2/2. Slow but simple. */
function expReference(x: number): number {
  const k = x >= 0 ? Math.floor(x * INV_LN2 + 0.5) : -Math.floor(-x * INV_LN2 + 0.5);
  const r = x - k * LN2_HI - k * LN2_LO;
  let p = 1 / 6227020800; // 1/13!
  for (const c of [479001600, 39916800, 3628800, 362880, 40320, 5040, 720, 120, 24, 6, 2, 1, 1]) p = p * r + 1 / c;
  return p * pow2(k);
}

// Table-driven exp (the method of Tang 1989, as used by fdlibm/musl):
// x = (64m + j)·ln2/64 + r, |r| ≤ ln2/128, so e^x = 2^m · 2^{j/64} · e^r and a
// degree-6 polynomial gives e^r to < 1e-17. Tables are built at load time from
// exactly-rounded operations only, so they are identical in every engine.
const EXP_TABLE_BITS = 6;
const EXP_N = 1 << EXP_TABLE_BITS; // 64
const TWO_POW_J_N = new Float64Array(EXP_N);
for (let j = 0; j < EXP_N; j++) TWO_POW_J_N[j] = expReference((j * (LN2_HI + LN2_LO)) / EXP_N);
const POW2_MIN = -1023;
const POW2 = new Float64Array(2048 + 2);
for (let m = POW2_MIN; m <= 1024; m++) POW2[m - POW2_MIN] = m >= -1022 && m <= 1023 ? pow2(m) : m < 0 ? pow2(-1022) / 2 : Infinity;
const N_INV_LN2 = EXP_N * INV_LN2;
const ROUND_SHIFT = 6755399441055744; // 1.5·2^52
const LN2_HI_N = LN2_HI / EXP_N; // still exact for |k| < 2^21
const LN2_LO_N = LN2_LO / EXP_N;

/** e^x, accurate to a few ulp, bit-identical across engines. */
export function exp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709.7) return Infinity;
  if (x < -708.3) return 0;
  // Round to nearest integer with the 1.5·2^52 trick (exact IEEE arithmetic, branch-free).
  const k = x * N_INV_LN2 + ROUND_SHIFT - ROUND_SHIFT;
  const r = x - k * LN2_HI_N - k * LN2_LO_N;
  const j = k & (EXP_N - 1); // k mod 64, also for negative k (two's complement)
  const m = (k - j) / EXP_N; // exact integer
  // e^r ≈ 1 + r + r²/2 + … + r⁶/720
  const p = 1 + r * (1 + r * (0.5 + r * (1 / 6 + r * (1 / 24 + r * (1 / 120 + r * (1 / 720))))));
  return POW2[m - POW2_MIN] * TWO_POW_J_N[j] * p;
}

const SQRT1_2 = 0.70710678118654752440;
const LN2 = 0.69314718055994530942;

/**
 * Natural log for x > 0. Split x = m·2^e with m in [√½, √2), then
 * ln m = 2·atanh(s), s = (m−1)/(m+1), |s| ≤ 0.1716, summed as an odd series.
 */
export function log(x: number): number {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  if (x === Infinity) return Infinity;
  f64[0] = x;
  let e = ((u32[1] >>> 20) & 0x7ff) - 1023;
  if (e === -1023) {
    // Subnormal: renormalise.
    f64[0] = x * 18014398509481984; // 2^54
    e = ((u32[1] >>> 20) & 0x7ff) - 1023 - 54;
  }
  // Force the exponent field to 0 → m in [1, 2).
  u32[1] = (u32[1] & 0x800fffff) | 0x3ff00000;
  let m = f64[0];
  if (m > 2 * SQRT1_2) {
    m *= 0.5;
    e += 1;
  }
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  // 2·(s + s³/3 + s⁵/5 + … + s²¹/21)
  let p = 1 / 21;
  p = p * s2 + 1 / 19;
  p = p * s2 + 1 / 17;
  p = p * s2 + 1 / 15;
  p = p * s2 + 1 / 13;
  p = p * s2 + 1 / 11;
  p = p * s2 + 1 / 9;
  p = p * s2 + 1 / 7;
  p = p * s2 + 1 / 5;
  p = p * s2 + 1 / 3;
  p = p * s2 + 1;
  return e * LN2 + 2 * s * p;
}

/** Logistic sigmoid σ(u) = 1 / (1 + e^{−u}). */
export function sigmoid(u: number): number {
  return 1 / (1 + exp(-u));
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

const TWO_PI = 6.283185307179586;
const PI = 3.141592653589793;

/**
 * sin and cos by range reduction to [−π, π] and a Taylor series to degree 27
 * (truncation error < 1e-16 on that interval). Only used off the hot path
 * (metrics), where reproducibility matters more than speed.
 */
export function sin(x: number): number {
  let r = x - TWO_PI * Math.floor((x + PI) / TWO_PI);
  if (r > PI) r -= TWO_PI;
  const r2 = r * r;
  let term = r, sum = r;
  for (let k = 1; k <= 13; k++) {
    term *= -r2 / ((2 * k) * (2 * k + 1));
    sum += term;
  }
  return sum;
}

export function cos(x: number): number {
  return sin(x + PI / 2);
}

/** √(x² + y²) using only correctly rounded operations (Math.hypot is not guaranteed to be). */
export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}
