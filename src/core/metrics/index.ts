/**
 * Organism metrics used by selection and by the science tests (DESIGN.md §5).
 *
 * Everything is a pure function of the final state (positions + expression).
 * Design choices that keep "symmetry" and "segments" honest (DESIGN.md D10):
 * - Cell types are expression signatures (which TF/contact genes are on), never labels.
 * - Pattern symmetry is measured as agreement BEYOND CHANCE (Cohen's κ) between the
 *   cell-type map and its reflected/rotated copy. A uniform blob scores 0, not 1.
 * - A segment is a stripe of one gene's expression that spans the body width;
 *   ≥ 3 regularly spaced stripes along the main axis count as segmentation.
 *   Concentric rings (one connected annulus) and spots (narrow) do not count.
 */
import type { CompiledGRN } from '../genome/compile';
import { neighbours } from './tissue';
import { principalAxes } from './shape';
import { cos, hypot, log, sin } from '../math';

export interface OrganismState {
  n: number;
  px: ArrayLike<number>;
  py: ArrayLike<number>;
  /** n × G expression, row-major. */
  x: ArrayLike<number>;
  grn: CompiledGRN;
}

export interface Metrics {
  cells: number;
  /** Area covered, in ℓ² (from a 0.5ℓ raster). */
  area: number;
  /** Number of distinct expression signatures held by ≥ max(3, 2%) of cells. */
  cellTypes: number;
  /** Shannon entropy of the type distribution [bits]. */
  typeEntropy: number;
  /** √(λ₁/λ₂) of the cell positions. */
  elongation: number;
  /** Best mirror symmetry of the outline (IoU of shape and its reflection). */
  shapeBilateral: number;
  /** Mirror symmetry of the cell-type pattern beyond chance (κ, at the best mirror line). */
  patternBilateral: number;
  /** Best n ≥ 3 rotational symmetry of the type pattern beyond chance (κ), and its order. */
  patternRadial: number;
  radialOrder: number;
  /** Number of segments (regular stripes spanning the body), 0 if fewer than 3. */
  segments: number;
  /** Gene (name) carrying the segment pattern, if any. */
  segmentGene: string;
}

export interface TypeAssignment {
  /** Type index per cell (−1 = rare signature). */
  typeOf: Int32Array;
  /** Signature (bit string over typing genes) of each type. */
  signatures: string[];
  counts: number[];
}

/** Genes whose on/off state defines cell type: transcription factors and contact ligands. */
function typingGenes(grn: CompiledGRN): number[] {
  return grn.types.map((t, i) => (t === 'tf' || t === 'contact' ? i : -1)).filter((i) => i >= 0);
}

export function assignTypes(s: OrganismState): TypeAssignment {
  const G = s.grn.G;
  const genes = typingGenes(s.grn);
  const sig: string[] = [];
  const tally = new Map<string, number>();
  for (let c = 0; c < s.n; c++) {
    let key = '';
    for (const g of genes) key += s.x[c * G + g] > 0.5 * s.grn.maxLevel[g] ? '1' : '0';
    sig.push(key);
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  const minCount = Math.max(3, Math.ceil(0.02 * s.n));
  const signatures = [...tally.entries()]
    .filter(([, k]) => k >= minCount)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([k]) => k);
  const index = new Map(signatures.map((k, i) => [k, i]));
  const typeOf = Int32Array.from(sig, (k) => index.get(k) ?? -1);
  return { typeOf, signatures, counts: signatures.map((k) => tally.get(k)!) };
}

// ------------------------------------------------------------------ raster + symmetry

interface Raster {
  w: number;
  h: number;
  ox: number;
  oy: number;
  px: number;
  /** Type label per pixel; −2 = empty, −1 = rare type. */
  label: Int32Array;
}

/** Label each 0.5ℓ pixel with the type of the nearest cell within 0.6ℓ (else empty). */
function rasterise(s: OrganismState, typeOf: Int32Array, cx: number, cy: number): Raster {
  const px = 0.5;
  let rmax = 0;
  for (let c = 0; c < s.n; c++) rmax = Math.max(rmax, hypot(s.px[c] - cx, s.py[c] - cy));
  const half = Math.ceil((rmax + 1) / px);
  const w = 2 * half + 1, h = w;
  const ox = cx - half * px, oy = cy - half * px;
  const label = new Int32Array(w * h).fill(-2);
  const best = new Float64Array(w * h).fill(0.36); // (0.6ℓ)²
  const reach = Math.ceil(0.6 / px);
  for (let c = 0; c < s.n; c++) {
    const ci = Math.round((s.px[c] - ox) / px), cj = Math.round((s.py[c] - oy) / px);
    for (let j = cj - reach; j <= cj + reach; j++) {
      if (j < 0 || j >= h) continue;
      for (let i = ci - reach; i <= ci + reach; i++) {
        if (i < 0 || i >= w) continue;
        const d2 = (ox + i * px - s.px[c]) ** 2 + (oy + j * px - s.py[c]) ** 2;
        if (d2 < best[j * w + i]) { best[j * w + i] = d2; label[j * w + i] = typeOf[c]; }
      }
    }
  }
  return { w, h, ox, oy, px, label };
}

interface Agreement {
  /** IoU of the occupied set and its transform. */
  shape: number;
  /** Cohen's κ of type labels between pixels and their transformed partners. */
  kappa: number;
}

/** Compare the raster with its image under the linear map (a b; c d) about the centre. */
function agreement(r: Raster, a: number, b: number, c: number, d: number): Agreement {
  const { w, h, label } = r;
  const cxp = (w - 1) / 2, cyp = (h - 1) / 2;
  let occ = 0, matched = 0, same = 0;
  const pairs: [number, number][] = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const l = label[j * w + i];
      if (l === -2) continue;
      occ++;
      const u = i - cxp, v = j - cyp;
      const ti = Math.round(cxp + a * u + b * v), tj = Math.round(cyp + c * u + d * v);
      if (ti < 0 || tj < 0 || ti >= w || tj >= h) continue;
      const m = label[tj * w + ti];
      if (m === -2) continue;
      matched++;
      if (l === m) same++;
      pairs.push([l, m]);
    }
  }
  const shape = occ ? matched / (2 * occ - matched) : 0;
  if (!matched) return { shape, kappa: 0 };
  // Chance agreement from the marginal label frequencies.
  const fa = new Map<number, number>(), fb = new Map<number, number>();
  for (const [l, m] of pairs) { fa.set(l, (fa.get(l) ?? 0) + 1); fb.set(m, (fb.get(m) ?? 0) + 1); }
  let pe = 0;
  for (const [k, v] of fa) pe += (v / matched) * ((fb.get(k) ?? 0) / matched);
  const po = same / matched;
  return { shape, kappa: pe >= 1 - 1e-12 ? 0 : (po - pe) / (1 - pe) };
}

function bilateral(r: Raster): { shape: number; kappa: number } {
  let bestShape = 0, bestKappa = 0;
  for (let deg = 0; deg < 180; deg += 3) {
    // Reflection across a line at angle θ: (cos2θ  sin2θ; sin2θ −cos2θ).
    const t = (2 * deg * Math.PI) / 180;
    const ag = agreement(r, cos(t), sin(t), sin(t), -cos(t));
    if (ag.shape > bestShape) bestShape = ag.shape;
    if (ag.kappa > bestKappa) bestKappa = ag.kappa;
  }
  return { shape: bestShape, kappa: bestKappa };
}

function rotational(r: Raster): { kappa: number; order: number } {
  let best = 0, order = 0;
  for (let n = 3; n <= 8; n++) {
    let k = Infinity;
    // n-fold symmetry must hold for every rotation by a multiple of 2π/n; take the worst.
    for (let m = 1; m < n; m++) {
      const t = (2 * Math.PI * m) / n;
      k = Math.min(k, agreement(r, cos(t), -sin(t), sin(t), cos(t)).kappa);
    }
    if (k > best + 0.02) { best = k; order = n; }
  }
  return { kappa: best, order };
}

// ------------------------------------------------------------------ segments

/**
 * Segments carried by gene g: connected patches of cells expressing g, which
 * (i) number ≥ 3, (ii) are spaced regularly along the main body axis (CV < 0.35),
 * and (iii) each span ≥ 50% of the local body width (stripes, not spots).
 */
function segmentsOfGene(s: OrganismState, g: number, nbrs: number[][], axis: ReturnType<typeof principalAxes>): number {
  const G = s.grn.G;
  const on = (c: number) => s.x[c * G + g] > 0.5 * s.grn.maxLevel[g];
  const onCells: number[] = [];
  for (let c = 0; c < s.n; c++) if (on(c)) onCells.push(c);
  if (onCells.length < 9 || onCells.length > 0.75 * s.n) return 0;
  // Connected components of the on-cells.
  const comp = new Int32Array(s.n).fill(-1);
  const comps: number[][] = [];
  for (const c0 of onCells) {
    if (comp[c0] >= 0) continue;
    const list = [c0];
    comp[c0] = comps.length;
    for (let k = 0; k < list.length; k++) for (const m of nbrs[list[k]]) if (on(m) && comp[m] < 0) { comp[m] = comps.length; list.push(m); }
    comps.push(list);
  }
  const big = comps.filter((l) => l.length >= 3);
  if (big.length < 3) return 0;
  const along = (c: number) => (s.px[c] - axis.cx) * axis.ax + (s.py[c] - axis.cy) * axis.ay;
  const across = (c: number) => -(s.px[c] - axis.cx) * axis.ay + (s.py[c] - axis.cy) * axis.ax;
  // Body width at axial position u: extent across the axis of all cells within ±1ℓ.
  const width = (u: number) => {
    let lo = Infinity, hi = -Infinity;
    for (let c = 0; c < s.n; c++) if (Math.abs(along(c) - u) <= 1) { const v = across(c); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    return hi - lo + 1;
  };
  const stripes = big
    .map((l) => {
      const u = l.reduce((a, c) => a + along(c), 0) / l.length;
      const vs = l.map(across);
      return { u, span: Math.max(...vs) - Math.min(...vs) + 1 };
    })
    .filter((st) => st.span >= 0.5 * width(st.u))
    .sort((a, b) => a.u - b.u);
  if (stripes.length < 3) return 0;
  const gaps = stripes.slice(1).map((st, k) => st.u - stripes[k].u);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
  return mean > 0 && sd / mean < 0.35 ? stripes.length : 0;
}

// ------------------------------------------------------------------ all metrics

export function computeMetrics(s: OrganismState): Metrics {
  const empty: Metrics = {
    cells: s.n, area: 0, cellTypes: 0, typeEntropy: 0, elongation: 1,
    shapeBilateral: 0, patternBilateral: 0, patternRadial: 0, radialOrder: 0, segments: 0, segmentGene: '',
  };
  if (s.n < 3) return { ...empty, cellTypes: s.n > 0 ? 1 : 0 };

  const types = assignTypes(s);
  const counted = types.counts.reduce((a, b) => a + b, 0);
  const typeEntropy = -types.counts.reduce((h, k) => h + (k / counted) * (log(k / counted) / log(2)), 0);
  const axis = principalAxes(s.px, s.py, s.n);
  const raster = rasterise(s, types.typeOf, axis.cx, axis.cy);
  let occupied = 0;
  for (const l of raster.label) if (l !== -2) occupied++;
  const bi = bilateral(raster);
  const rot = types.signatures.length >= 2 ? rotational(raster) : { kappa: 0, order: 0 };

  const nbrs = neighbours(s);
  let segments = 0, segmentGene = '';
  for (const g of typingGenes(s.grn)) {
    const k = segmentsOfGene(s, g, nbrs, axis);
    if (k > segments) { segments = k; segmentGene = s.grn.names[g]; }
  }

  return {
    cells: s.n,
    area: occupied * raster.px * raster.px,
    cellTypes: types.signatures.length,
    typeEntropy,
    elongation: axis.elongation,
    shapeBilateral: bi.shape,
    patternBilateral: types.signatures.length >= 2 ? bi.kappa : 0,
    patternRadial: rot.kappa,
    radialOrder: rot.order,
    segments,
    segmentGene,
  };
}
