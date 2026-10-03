/**
 * Seeded pseudo-random numbers.
 *
 * Generator: sfc32 (Chris Doty-Humphrey's "small fast chaotic" PRNG, from PractRand).
 * 128-bit state, passes PractRand to multiple TB, uses only 32-bit integer ops, so
 * it is bit-identical in every JS engine.
 *
 * Streams: `rng.fork('mechanics')` derives an independent generator from the
 * parent's seed and a label, WITHOUT consuming parent draws. Each subsystem gets
 * its own stream, so switching on (say) expression noise does not shift the
 * random sequence used for division jitter.
 */
import { exp, log } from './math';

/** cyrb128: hash a string to four 32-bit words (used for seeding). */
export function hash128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** Hex string of hash128, handy as a stable content hash. */
export function hashHex(str: string): string {
  return hash128(str).map((h) => h.toString(16).padStart(8, '0')).join('');
}

export type Seed = number | string;

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  /** Canonical seed string; fork() derives children from it. */
  readonly seed: string;
  private spareNormal: number | null = null;

  constructor(seed: Seed) {
    this.seed = String(seed);
    [this.a, this.b, this.c, this.d] = hash128(this.seed);
    // Discard the first outputs to mix the state (recommended for sfc32).
    for (let i = 0; i < 15; i++) this.nextU32();
  }

  /** Independent child stream; does not advance this generator. */
  fork(label: string): Rng {
    return new Rng(`${this.seed}/${label}`);
  }

  /** Uniform 32-bit unsigned integer. */
  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1) with 53 bits of randomness. */
  float(): number {
    const hi = this.nextU32() >>> 5; // 27 bits
    const lo = this.nextU32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.float();
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  /** Standard normal N(0,1), Marsaglia polar method (needs only log and sqrt). */
  normal(): number {
    if (this.spareNormal !== null) {
      const s = this.spareNormal;
      this.spareNormal = null;
      return s;
    }
    let u: number, v: number, s: number;
    do {
      u = 2 * this.float() - 1;
      v = 2 * this.float() - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const f = Math.sqrt((-2 * log(s)) / s);
    this.spareNormal = v * f;
    return u * f;
  }

  /** Poisson-distributed integer (Knuth's method; fine for small means). */
  poisson(mean: number): number {
    if (mean <= 0) return 0;
    let k = 0;
    let p = 1;
    const limit = exp(-mean);
    do {
      k++;
      p *= this.float();
    } while (p > limit);
    return k - 1;
  }

  /** Pick a random element. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }
}
