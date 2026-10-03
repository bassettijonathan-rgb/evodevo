# EvoDevo: Design Document

Status: **approved and implemented (M1–M6)**. §15 lists what changed during implementation.

This document describes the model, data structures, architecture and milestone plan for
a browser-based evo-devo simulation. Organisms grow from a single cell under a gene
regulatory network (GRN) and diffusing morphogens. Selection acts only on the genome.

Places where I recommend changing or extending the original brief are marked
**⚑ DECISION** and listed together in [§12](#12-decisions-for-your-approval). Each one
gives a recommended default, and every recommended default can be turned off in config.

---

## 1. Goals and non-goals

**Goals**
- Body plans (axes, segments, symmetry, tissues, appendage-like outgrowths) come out of
  development and are never encoded directly.
- Each mechanism is grounded in a published model and checked against a known result
  (analytic where one exists, a classic experiment otherwise).
- A deterministic, seeded core that runs headless (Node/Vitest, Web Workers) without the UI.
- Code you can read and change: one mechanism per file, physical parameters gathered in a
  single config object with units and literature notes.

**Non-goals (for now)**
- 3D, cell shape beyond circles, explicit cell volume/osmotics, biochemical detail below
  the "gene product concentration" level, chromatin, and transcriptional delays.

---

## 2. Units and conventions

| Quantity | Unit | Notes |
|---|---|---|
| Length | 1 cell diameter (`ℓ`) | Morphogen grid spacing `h = 1ℓ` by default. |
| Time | 1 "developmental time unit" (`τ`) | Roughly a cell-cycle fraction. A full development is ~200–400 τ. |
| Concentration | arbitrary, O(1) | Sigmoid output is in [0,1], and steady states are `rate/decay`. |

Every parameter lives in `SimConfig` (see §8.2) with its unit and a sensible range.
Defaults sit in one file, `src/core/config.ts`.

---

## 3. The model

### 3.1 Genome

A genome is an **ordered** list of genes plus a small maternal block. Order matters only
for segmental duplication (§6). It has no effect on expression; see the note on Hox
colinearity in §6.4.

Each gene has:
- a stable **id** (an innovation number, never reused). Homology, phylogeny and the GRN
  viewer use it.
- a human **name** (`"gap1"`, `"hox3b"`). Duplicates get suffixes.
- a **product type**: `tf | morphogen | contact | adhesion | effector`. `contact` is a
  proposed addition (⚑ D6).
- a **cis-regulatory region**: a sparse list of binding sites `(regulatorGeneId, weight)`
  plus a `bias`.
- **kinetic parameters**: `rate` (max production) and `decay` (λ).
- **type-specific parameters**: diffusion coefficient (morphogen), binding strength
  (adhesion, contact), effector kind and parameters (effector).
- `asymmetry ∈ [−1, 1]`: how unequally the product splits between daughters along the
  polarity axis (⚑ D4).

### 3.2 Gene expression: the gene-circuit model

This is the "connectionist" gene-circuit model of Mjolsness, Sharp & Reinitz (1991). It
was later fitted to the *Drosophila* gap-gene system (Jaeger et al. 2004) and used in
classic studies of GRN robustness and evolvability (Wagner 1996; Siegal & Bergman 2002).
Your brief describes this model. The proposed change is to give each gene its own `rate`
and `decay` instead of one global decay.

For cell *c* and gene *i*:

$$
u_i = \sum_j W_{ij}\, y_j + b_i, \qquad
\frac{dx_i}{dt} = R_i\,\sigma(u_i) - \lambda_i x_i
$$

where `y_j` is the signal regulator *j* presents to the cell:

| Regulator type | `y_j` is… |
|---|---|
| `tf` | the intracellular concentration `x_j` |
| `morphogen` | the extracellular field `c_j` sampled at the cell (bilinear interpolation) |
| `contact` | the summed ligand `x_j` on touching neighbours, weighted by contact (excludes self) |
| `adhesion`, `effector` | **nothing**. These products do not bind DNA, so their column is inert. |

The inert columns stay in the genome. A product-type switch can turn them back on, which
gives the model **cryptic regulatory variation**.

**Integration.** I use the exponential integrator rather than forward Euler. It treats
production as constant over the step and solves the linear decay exactly:

$$
x_i(t+\Delta t) = \frac{P_i}{\lambda_i} + \Big(x_i(t) - \frac{P_i}{\lambda_i}\Big)e^{-\lambda_i \Delta t},
\qquad P_i = R_i\,\sigma(u_i)
$$

It is unconditionally stable for the decay term and exact when inputs are constant, so
the single-gene steady-state tests become exact checks. `e^{-λΔt}` is precomputed per gene.

> **Why per-gene `rate` and `decay`?** The repressilator (Elowitz & Leibler 2000), the
> segmentation clock (Hes/her oscillators) and gradient-reading cascades all depend on
> genes having *different* timescales. With a single global decay, oscillators are fragile
> and clock-and-wavefront segmentation is very hard to evolve.

**Knockout and overexpression** are clamps applied after each update: knockout sets
`x_i := 0`, overexpression sets `x_i := R_i/λ_i`. Clamps can be limited to a region or a
time window (⚑ D12).

**Expression noise** (optional, off by default) is multiplicative Gaussian noise on `P_i`
drawn from the organism's seeded RNG.

### 3.3 Cells

Every cell shares the genome. Cells differ only through history (inheritance, asymmetric
segregation) and local signals.

Per-cell state:
- `x[nGenes]`: product concentrations
- `pos (x, y)`, `radius`
- `polarity (px, py)`, a unit vector or zero (unpolarized)
- `cycleProgress`, `deathProgress`, `diffProgress`: integrate-to-threshold accumulators
  (⚑ D5)
- `postmitotic` flag (set by differentiation)
- bookkeeping: unique `id`, `parentId`, `birthTime`, `generation`, `founderId` (§9.3)

The **adhesion profile** is not stored separately. It is the slice of `x` belonging to
adhesion genes.

### 3.4 Effectors

All effectors integrate to a threshold so that behaviour is smooth in the genotype and
fully deterministic. For an effector of kind *k*, let `E_k = Σ x_i` over all genes of that
kind. Summing makes duplicated effectors additive (needed for neutral duplication, §6.2).

| Effector | Rule |
|---|---|
| **divide** | `cycleProgress += Δt · k_div · clamp(E_divide, 0, 1)`. At ≥ 1 the cell divides and both daughters reset to 0. Minimum cycle time is `1/k_div`. Blocked if `postmitotic` or at the cell cap. |
| **die** | `deathProgress += Δt · k_die · clamp(E_die − θ_die, 0, 1)`. At ≥ 1 the cell is removed (apoptosis). |
| **polarize** | Each polarize gene names a cue morphogen and a sign. Polarity relaxes toward the normalised cue gradient: `p ← normalize(p + Δt·k_pol·x_i·sign·∇c/|∇c|)`. With no expression, polarity is kept and inherited (cell memory). |
| **differentiate** | `diffProgress` accumulates. At ≥ 1 the cell becomes **postmitotic**, permanently (terminal differentiation, ⚑ D7). |

**Division geometry.** Daughters sit at `pos ± 0.25ℓ·p̂`, where `p̂` is the polarity (a
seeded random direction if the cell is unpolarized), plus a small angular jitter.
Products are split according to each gene's `asymmetry` `a`. The daughter on the `+p̂`
side receives concentration `(1+a)·x` and the other receives `(1−a)·x`, so the total
amount is conserved. When `a = 0` (the default) both daughters inherit the parent state.

Gradients for polarity use central differences on the grid, interpolated to the cell.

### 3.5 Maternal state and the first symmetry break (⚑ D4)

A single cell with a uniform genome and zero initial state has no axis. Everything
downstream is rotationally symmetric unless noise breaks the symmetry. Real embryos start
with maternal cues (Bicoid mRNA, PAR polarity, the sperm entry point). I propose:

- `genome.maternal`: initial concentrations for some genes in the zygote. These belong to
  the genome, because maternal-effect genes are the mother's genes, so they mutate and
  evolve like everything else.
- `config.zygotePolarity`: an initial polarity vector, an environmental cue (default `(1, 0)`).
- per-gene `asymmetry` (above), which lets maternal determinants segregate unequally and
  start lineage differences, as in *C. elegans* P-granules or PAR-dependent fates.

With all three off, you get a pure self-organisation mode in which only Turing-type
instabilities and noise can break symmetry. Experiments record which mode they used.

### 3.6 Morphogens: reaction-diffusion on a grid

One scalar field per morphogen gene, on an `N × N` grid (default 128², `h = 1ℓ`):

$$
\partial_t c_m = D_m \nabla^2 c_m - k_m c_m + \sum_{\text{cells}} s_m\, x_m^{(c)}\,\delta(\mathbf r - \mathbf r_c)
$$

- **Secretion.** Each cell adds `s_m · x_m · Δt / h²` to the four surrounding nodes using
  bilinear weights (the transpose of sampling, so the operation is conservative).
- **Diffusion.** Explicit FTCS on a 5-point Laplacian, with **per-morphogen sub-stepping**
  chosen automatically so that `D_m Δt_sub / h² ≤ 0.2` (the limit is 0.25). A fast
  inhibitor sub-steps more often than a slow activator.
- **Decay.** Applied exactly as `c ← c·e^{−k_m Δt_sub}`.
- **Boundary.** No-flux (Neumann) via mirrored ghost nodes, with a minimum `k_m > 0` so
  nothing builds up without limit.
- **Diffusion domain** (⚑ D9). By default fields diffuse over the whole grid, which
  includes empty space around the embryo.

The steady state from a point source has a known analytic profile, `c(r) ∝ K₀(r/L)` with
`L = √(D/k)`. Tests check the grid against it (§10).

**Turing patterns.** With an activator *A* (`W_AA > 0`, `W_HA > 0`) and an inhibitor *H*
(`W_AH < 0`, with `D_H ≫ D_A`), the gene-circuit kinetics give a Gierer–Meinhardt-like
activator-inhibitor system. I will write a small helper (`analysis/turing.ts`) that
linearises the reduced two-species system around its homogeneous steady state, checks the
four Turing conditions, and predicts the fastest-growing wavelength
`λ* = 2π/k*` from the dispersion relation. The test then compares the measured dominant
wavelength (radially averaged 2D power spectrum) with that prediction. This gives a
quantitative check alongside "it looks spotty".

Spots vs stripes: in 2D, a quadratic asymmetry in the kinetics favours hexagonal spots
and symmetric kinetics favour stripes (Ermentrout 1991). With sigmoid kinetics, placing the
steady state near the sigmoid's inflection point should give stripes, and placing it off
the inflection point should give spots. **I expect this to work, but I have not shown it
yet. If the sigmoid nonlinearity cannot reliably produce both, M2 will say so.**

### 3.7 Contact (juxtacrine) signalling (⚑ D6, an addition)

The brief has secreted morphogens but no **cell-contact signalling**. Delta–Notch lateral
inhibition is one of the most widespread patterning mechanisms: neurogenesis, bristle
spacing, salt-and-pepper fates, and coupling of the segmentation clock. A morphogen cannot
copy it because a morphogen also signals back to the cell that secretes it, and lateral
inhibition needs signals from neighbours only (Collier et al. 1996).

Proposal: a `contact` product type. A cell's input from contact gene *j* is
`y_j = Σ_{neighbours n} w_contact(c,n) · x_j^{(n)}`, where `w_contact` is the
mechanics overlap normalised to [0,1]. The neighbour list already exists for mechanics,
so this costs almost nothing.

### 3.8 Mechanics: soft discs with differential adhesion

The model uses overdamped, off-lattice, centre-based dynamics (Drasdo; Palsson; Osborne
et al. 2017 review):

$$
\gamma\,\dot{\mathbf r}_c = \sum_{n} \mathbf F_{cn} + \sqrt{2\gamma k_B T_{\text{eff}}}\;\boldsymbol\xi_c(t)
$$

For a pair with contact distance `s = r_c + r_n`, distance `d` and overlap `δ = s − d`:
- **repulsion**: `k_rep · δ` when `δ > 0`
- **adhesion**: `−A_cn · ramp(δ)`, where ramp is 1 for `δ ≥ 0` and falls linearly to 0 at
  `δ = −ℓ_adh`, so there is no force jump. The equilibrium overlap of an adhering pair is
  `A/k_rep`.
- **adhesion strength** uses homophilic, cadherin-like binding:
  `A_cn = A₀ + Σ_k J_k · min(a_k^{(c)}, a_k^{(n)})` over adhesion genes *k*, where `A₀`
  is a small non-specific baseline (ECM, glycocalyx).

`min` matches homophilic binding: bonds are limited by the cell with fewer molecules.
`min` is also homogeneous of degree 1, which keeps gene duplication exactly neutral (§6.2).

**Motility noise** `T_eff` (⚑ D8) is required. Without membrane fluctuations, soft-sphere
aggregates get stuck in local minima and sorting stalls. Cellular Potts models need a
temperature for the same reason (Graner & Glazier 1992).

**DAH physics to be aware of.** Steinberg's theory predicts complete engulfment of *A* by
*B* only when `W_AB > W_BB`. Pure homophilic `min` binding gives
`W_AB ≤ min(W_AA, W_BB)`, so the model can produce separation and the "more cohesive cells
go inside" ordering (as in Steinberg & Takeichi 1994, where cells differ in cadherin
level), but **not** strict complete engulfment. That needs heterophilic binding. I propose
homophilic-only for v1, and the sorting test checks the predictions this regime makes
(§10, M3). A heterophilic `J_kl` matrix could be added later if you want the full DAH
phase diagram.

**Numerics.**
- Neighbour search uses a uniform spatial hash, so it is O(n).
- Euler–Maruyama with `Δt_mech ≤ 0.2 γ / (k_rep · z_max)`, sub-stepped within each
  developmental step.
- A soft circular wall at the grid edge keeps cells inside the domain.

**Cell size.** Radius is fixed, and division places overlapping daughters that push their
neighbours apart. Cleavage-style halving (no growth) could be a later option.

### 3.9 One developmental step (operator splitting)

```
for each developmental step (Δt = 0.1τ by default):
  1. sense       sample morphogen fields and gradients at each cell; sum contact signals
  2. express     GRN update for every cell (exponential integrator); apply clamps
  3. secrete     splat morphogen production onto the grid
  4. diffuse     per-morphogen diffusion + decay sub-steps
  5. effectors   polarity update; accumulate cycle/death/diff progress;
                 perform divisions and deaths (in deterministic index order)
  6. mechanics   N_mech sub-steps of overdamped force integration
  7. record      every K steps, store a snapshot frame (§9.1)
```

This is first-order Lie splitting. Splitting error is O(Δt). A convergence test (halve
Δt, compare outcomes) will verify that the default Δt is small enough for the reference
genomes.

Development runs for a fixed time `T_dev` (configurable, ~300τ), or stops early if every
cell dies or growth stalls at the cap.

---

## 4. Data structures

### 4.1 Genome (serialisable, editable)

```ts
type ProductType = 'tf' | 'morphogen' | 'contact' | 'adhesion' | 'effector';
type EffectorKind = 'divide' | 'die' | 'polarize' | 'differentiate';

interface Site { regulator: GeneId; weight: number }   // one cis-regulatory binding site

interface Gene {
  id: GeneId;            // innovation number, unique within a lineage
  name: string;
  type: ProductType;
  bias: number;          // b_i
  rate: number;          // R_i   (max production)
  decay: number;         // λ_i
  asymmetry: number;     // [-1,1] segregation along polarity at division
  sites: Site[];         // sparse cis-regulatory region
  // type-specific (present only where relevant; kept on type switch as cryptic params)
  diffusion?: number;    // morphogen: D_m
  secretion?: number;    // morphogen: s_m
  fieldDecay?: number;   // morphogen: k_m
  binding?: number;      // adhesion: J_k   contact: coupling strength
  effector?: EffectorKind;
  cue?: GeneId; cueSign?: 1 | -1;   // polarize
}

interface Genome {
  schema: 1;
  genes: Gene[];                         // ordered
  maternal: Record<GeneId, number>;      // zygote initial concentrations
  nextGeneId: GeneId;
}
```

Sites refer to **gene ids, not indices**, so deletions and insertions never silently rewire
the network.

### 4.2 Compiled genome (hot path)

Before development, the genome compiles to a `CompiledGRN`:
- gene ids mapped to dense indices `0..G−1`
- weights in **CSR sparse format** (`rowPtr: Int32Array`, `col: Int32Array`, `w: Float64Array`)
  with inert-column edges dropped
- per-gene `Float64Array`s: `bias`, `rate`, `expDecay = e^{−λΔt}`, `steady = R/λ`
- index lists by role: `tfIdx`, `morphIdx`, `contactIdx`, `adhIdx`, `effectorIdx[kind]`

Real GRNs are sparse (~2–5 regulators per gene), so CSR is both faithful and fast.

### 4.3 Cell store (structure of arrays)

```ts
class CellStore {            // capacity = config.maxCells (default 1000)
  n: number;                 // live cells occupy [0, n)
  id, parentId, founderId, generation: Int32Array;
  birthTime: Float64Array;
  px, py, radius, polX, polY: Float64Array;
  cycle, death, diff: Float64Array;
  postmitotic: Uint8Array;
  x: Float64Array;           // n × G, row-major: x[c*G + i]
}
```

Dead cells are removed by swap-with-last. That is deterministic, but indices are not
stable identities, so anything outside the step loop uses `id`. `Float64` is used
throughout: at ≤1000 cells memory doesn't matter, and it avoids float32 rounding surprises
in chaotic dynamics. Recordings are stored as `Float32`.

### 4.4 Morphogen grid

`fields: Float64Array(M × N × N)` with a scratch buffer for the stencil. One contiguous
block per morphogen, so the stencil loop is cache-friendly.

### 4.5 Determinism

- PRNG: `sfc32` (small, fast, good statistical quality), seeded by a 128-bit hash.
  **Streams are split by purpose** (mechanics noise, division jitter, expression noise,
  mutation) so that, for example, enabling expression noise does not shift the mechanics
  noise sequence.
- Organism seed = `hash(genomeHash, experimentSeed, replicate)`. It does not depend on
  which worker ran the evaluation or in what order.
- Iteration order is always index order and never depends on Map/Set iteration over
  unordered keys.
- **Cross-browser caveat (⚑ D13).** `Math.exp` is not guaranteed bit-identical across JS
  engines, and chaotic development will amplify last-bit differences. I propose a
  `math.ts` with a portable `exp` (range reduction + fixed polynomial) used by `sigmoid`,
  so a saved genome + seed regrows identically in any browser.

---

## 5. Measurement: metrics used by selection and tests

All metrics are pure functions of a final `OrganismState`, in `src/core/metrics/`.

| Metric | Definition |
|---|---|
| **size** | live cell count; also convex-hull area |
| **cell types** | Binarise each TF/contact gene at half its steady maximum (`x > 0.5·R/λ`) to get a signature per cell. Types are the distinct signatures held by ≥ max(3, 2%) of cells. This follows how scRNA-seq defines types: by expression state, not by a label (⚑ D7). |
| **body axis** | PCA of cell positions. Elongation = √(λ₁/λ₂). |
| **bilateral symmetry** | Reflect across the best mirror line (search angles around the PCA axes). Score = IoU of rasterised occupancy, multiplied by agreement of cell-type maps. |
| **radial symmetry** | Polar raster about the centroid. Score = power in angular Fourier modes `n ≥ 2` of the type map, reporting the dominant `n`. |
| **segment count** | Project cells onto the main axis and build a 1D expression profile per gene. A gene is "segmental" if its profile has ≥ 3 regularly spaced peaks (power-spectrum peak above a noise threshold, plus a peak-spacing CV < 0.3). Segments = max peaks over genes. |
| **pattern complexity** | Shannon entropy of the type distribution, and number of type boundaries |

I'll check these metrics against hand-made synthetic organisms (a perfect stripe pattern,
a mirror-symmetric shape, a random blob) before any selection uses them.

---

## 6. Mutation operators

Each reproduction applies a Poisson-distributed number of each operator, with per-genome
rates in `EvolutionConfig`. Every applied mutation is logged in a readable form, e.g.
`dup[g4→g11]` or `w[g2←g7] 0.80→1.13`. The log feeds the phylogeny view.

| Operator | Effect |
|---|---|
| **point (weight)** | Gaussian perturbation of an existing site weight |
| **point (bias / kinetic)** | Log-normal perturbation of `rate`, `decay`, `diffusion`, `binding`, etc. (positive quantities); Gaussian on `bias`, `asymmetry`, maternal values |
| **site gain** | Add a weak site from a random regulator. New edges start small, so most are near-neutral. |
| **site loss** | Remove a site |
| **rewiring** | Move a site to a different regulator, keeping its weight (cis-regulatory turnover) |
| **duplication (single)** | §6.2 |
| **duplication (segmental)** | §6.3 (⚑ D3) |
| **deletion** | Remove a gene and every site referencing it |
| **type switch** | Change product type. Inert/cryptic parameters are kept, and new required parameters are drawn from priors. |
| **effector re-kind / cue change** | Change effector kind or polarity cue |

Hard limits: `maxGenes` (default 32) and `maxMorphogens` (default 6, the main cost driver).
Mutations that would exceed them are rejected and redrawn.

### 6.1 Why duplication needs care

When a TF duplicates, the copy has the **same DNA-binding domain**, so it binds every site
the original bound, and it carries the **same cis-regulatory region**, so it has the same
inputs. A correct duplication therefore copies both the gene's row (its inputs) **and** its
column (its outputs). If only the gene is copied, the duplicate is born with no targets,
and the Hox-style "duplicate, then diverge" route is missing from the model.

### 6.2 Dosage-neutral duplication (⚑ D2)

Duplicating gene *g* into *g′*:
1. Insert *g′* right after *g*, with a new id, a copy of *g*'s parameters and sites, and
   name `g + 'b'` (*g* is renamed `g + 'a'` if needed).
2. **Column copy:** for every gene with a site on *g* (including *g* and *g′*), add a site
   on *g′* with the same weight.
3. **Dosage:** two modes.
   - `'neutral'` (recommended default): halve `rate` of both copies. Every downstream sum
     `Σ W·y`, every effector sum, every morphogen field, and every adhesion `min` term is
     then **exactly** unchanged, because each of them is linear or degree-1 homogeneous in
     the copies. The duplicate is a phenotypically silent spare copy, which is the starting
     assumption of the DDC/subfunctionalisation model (Force et al. 1999) and Ohno's
     neofunctionalisation. Divergence then comes from later mutations.
   - `'double'`: keep full rates, so dosage doubles. This is more realistic for some genes
     (haploinsufficiency, aneuploidy effects), but most duplications become deleterious
     and are purged.

A unit test will check that a neutral duplication regrows a **bit-identical** phenotype
(same seed). This check also catches many indexing bugs.

### 6.3 Segmental (tandem) duplication (⚑ D3, an addition)

Copy a **contiguous block** of genes as a unit. Edges inside the block map onto the copies,
and step 2 above applies to every gene in the block. A whole regulatory module (a
gradient-reading cascade, an oscillator, an outgrowth program) can then be copied and
repurposed. This is how Hox clusters expanded by tandem duplication, and it echoes the 2R
whole-genome duplications in early vertebrates. A rare **whole-genome duplication**
operator is the limiting case and costs almost nothing extra.

### 6.4 Honest note on Hox colinearity

In this model gene order has no effect on expression, so colinearity (cluster order
matching body-axis order) cannot arise *for mechanistic reasons*. It could only appear by
chance through segmental duplication. Modelling it would need chromatin-opening dynamics,
which are out of scope. I'm noting it so we don't over-read any apparent colinearity.

---

## 7. Selection and evolution

### 7.1 Interactive breeding (Dawkins/Picbreeder)

- A grid of 12–16 grown organisms (final frame plus a hover-to-play mini timeline).
- Pick 1 parent (asexual offspring) or 2 (crossover, see below). Workers regrow the next
  grid.
- A mutation-strength slider, and "lock a gene" so mutations skip it.
- Every organism goes into the phylogeny automatically.

**Crossover.** Genes are aligned **by id**, as in NEAT's innovation numbers. Shared ids
pick a parent's version at random, and genes present in only one parent come from the
chosen dominant parent. This is optional, and asexual reproduction is the default.

### 7.2 Target selection

- Generational GA with tournament selection (size 3), elitism 2, population 48–96.
- Fitness = weighted sum of metric scores (§5), each normalised against a target value.
  You set weights in the UI.
- Option: **novelty search** on a behaviour descriptor (shape + type-map embedding)
  (Lehman & Stanley 2011). GRN-development models tend to get stuck in "blob" attractors,
  and novelty pressure is the standard fix. It's also a useful control for the M4
  experiment.
- Several replicate seeds per genome (default 1, configurable) to penalise fragile
  development. This is canalization in Waddington's sense.

### 7.3 Ecological mode (later, sketch only)

Organisms in a shared 2D world, where morphology maps to traits: size → resource intake
and predation resistance, effector-driven "motile cells" → movement, adhesion strength →
mechanical integrity under fluid shear. Fitness is survival and reproduction. I'll design
this in detail once M1–M6 are done and we know which morphologies evolve easily.

---

## 8. Architecture

### 8.1 Layout

```
src/
  core/                    # pure TS, no DOM, deterministic; runs in Node, workers, main
    config.ts              # SimConfig + EvolutionConfig with units, ranges, defaults
    rng.ts                 # sfc32, seeding, stream splitting
    math.ts                # portable exp, sigmoid, small vector helpers
    genome/
      types.ts             # Gene, Genome, Site
      compile.ts           # Genome → CompiledGRN (CSR)
      validate.ts          # invariants (no dangling sites, limits)
      serialize.ts         # JSON (schema-versioned) + stable genome hash
    sim/
      cells.ts             # CellStore (SoA)
      grn.ts               # expression step
      morphogens.ts        # grid, secretion, diffusion
      mechanics.ts         # forces, spatial hash, integrator
      effectors.ts         # division, death, polarity, differentiation
      contact.ts           # juxtacrine signal sums
      develop.ts           # the step loop (§3.9); entry point `develop(genome, cfg, seed, opts)`
      perturb.ts           # knockouts / overexpression / ectopic clamps
      recorder.ts          # snapshot frames
    metrics/               # §5
    evolution/
      mutate.ts            # operators + mutation log
      crossover.ts
      select.ts            # tournament, elitism, novelty archive
      population.ts        # generation loop (pure; takes an `evaluate` function)
    analysis/
      turing.ts            # linear stability / dispersion relation
      spectrum.ts          # 2D FFT, radial power spectrum
  workers/
    eval.worker.ts         # develop + metrics + thumbnail data
    pool.ts                # promise-based worker pool, transferable buffers
  render/                  # Canvas2D: organism, overlays, fields
  ui/                      # app shell, panels (breeding, GRN viewer, playback, phylogeny)
  presets/                 # hand-authored genomes as JSON: frenchFlag, turingSpots, …
tests/
  unit/                    # fast (< 10 s total)
  science/                 # validation milestones; slower, run with `npm run test:science`
```

Dependency rule: `core` imports nothing outside `core`. `workers` and `ui` import `core`,
and `core` never imports them. An ESLint rule (`import/no-restricted-paths`) enforces this.

### 8.2 Config

`SimConfig` holds every physical and numerical parameter (Δt, grid size, `k_rep`, `γ`,
`T_eff`, `A₀`, `k_div`, `maxCells`, `T_dev`, recording interval, …). Each field has a doc
comment with its unit, valid range, and a note where a value comes from the literature. A
genome JSON file **embeds the config it was evolved under**, so organisms are reproducible
artefacts: `(genome, config, seed) → organism`.

### 8.3 Workers

- Pool size = `hardwareConcurrency − 1`.
- A request carries the genome JSON, config, seed and options (record frames? perturbations?).
- A response carries the metrics, a final-state snapshot as transferable `Float32Array`s
  (for thumbnails), and optionally the full recording.
- Evolution is driven from the main thread. Each generation, the pool evaluates the
  population in parallel. Results are keyed by organism id, so arrival order doesn't
  matter.
- Tests use the same `evaluate` function in-process. The worker is a thin wrapper.

### 8.4 UI framework (⚑ D11)

The game needs several stateful panels (breeding grid, playback scrubber, overlays, GRN
graph, knockout toggles, phylogeny). Vanilla DOM code gets hard to follow at that size. I
recommend **Preact + @preact/signals** (≈4 kB, React-like, readable). The simulation core
stays framework-free either way. The GRN graph uses **d3-force** for layout only, with SVG
rendering written by hand.

---

## 9. Player tools

### 9.1 Playback with scrubbing
A frame is recorded every `K` steps (default every 1τ): ids, positions, polarity, type
signature, `x` (Float32), and fields (Float32). Rough memory: 1000 cells × 24 genes × 4 B
≈ 96 kB per frame, plus 4 fields × 64 kB. For 300 frames that is about 100 MB at the
very worst, and much less in practice because cell counts grow over time. If memory
becomes a problem: store keyframes and **re-simulate** forward from the nearest one,
which works because the run is deterministic.

### 9.2 Overlays
Morphogen field (heatmap under the cells), expression of a chosen gene, cell type, lineage
(below), polarity arrows, cell-cycle phase, and a **mechanical stress** overlay
(per-cell summed repulsion) that shows where tissue is compressed.

### 9.3 Lineage and fate maps
Each cell stores the id of its ancestor at a chosen stage ("founder at the 8-cell stage").
Colouring by founder gives a **clonal fate map**, the digital version of classic
lineage-tracing injections.

### 9.4 GRN viewer
Nodes are genes, with shape by product type and fill = expression in the selected cell or
the tissue mean at the current frame. Edges are sites: width ∝ |w|, green activating, red
repressing. Clicking a node shows its parameters, highlights cells expressing it, and
offers knockout/overexpress. Duplicate pairs are linked visually (via the shared name
root) so you can follow divergence.

### 9.5 In-silico perturbations (⚑ D12)
- **Knockout** (clamp 0) and **overexpression** (clamp max), applied to the whole embryo.
- **Ectopic expression**: clamp a gene only in cells inside a brushed region, or only
  after time *t*. This mirrors the heat-shock and GAL4/UAS experiments behind the classic
  homeotic findings (ectopic *Antennapedia*).
- **Side-by-side comparison**: wild type vs perturbed, with a cell-type difference map. A
  "transformation detector" flags regions where one wild-type type was replaced by another
  wild-type type (homeosis-like) rather than lost.

### 9.6 Phylogeny and save/load
- Each organism record holds `{id, parentIds, generation, mutationLog, genomeHash,
  metrics, thumbnail}`. History is persisted in IndexedDB, and a tree view supports
  click-to-regrow.
- Save/load a genome (with config) as JSON. Export a whole lineage as JSON.

---

## 10. Science validation plan

Each milestone's validation tests must pass before I move on. Tests assert **quantitative**
criteria and include **negative controls**, so that a pass means something.

**M1: GRN and single-cell dynamics**
- A single gene with no inputs converges to `R·σ(b)/λ`, and its approach rate matches
  `e^{−λt}` (exact, to 1e-12).
- **Toggle switch** (two mutual repressors): bistable. Different initial conditions reach
  different steady states, as in Gardner et al. 2000.
- **Repressilator** (3-gene ring): sustained oscillation, with period stable to < 2% over
  10 cycles. A one-gene-knockout control stops the oscillation.
- Knockout and overexpression clamps behave as specified.
- Determinism: same seed gives identical state; a different seed gives different noise
  only where noise is on.

**M2: Diffusion, growth, French flag, Turing**
- Diffusion: mass is conserved (`k = 0`, no-flux) to 1e-10. A point source's variance
  grows as `4Dt` within 2%. The steady state from a point source matches `K₀(r/L)` within
  5% over 1–5 L.
- Sub-stepping stays stable for `D` up to the configured maximum.
- **French flag (Wolpert 1969)**, two versions:
  1. A static 64×16 tissue with a maternally specified source column secreting one
     morphogen, and a hand-written 3-gene readout using mutual repression for sharp
     boundaries. Pass: exactly three contiguous bands in blue→white→red order, each ≥ 20%
     of the length, boundary widths ≤ 2 cells.
  2. Grown from a zygote with a maternal determinant segregated at the first division,
     giving the same three-band order along the polarity axis.
- **Turing**: a static confluent tissue, an activator–inhibitor genome, and a small
  random initial perturbation.
  - Spots and stripes each classified by component statistics: spots are many compact
    components with aspect ratio < 1.5; stripes are elongated with aspect ratio > 3.
  - The measured dominant wavelength is within 20% of the linear-theory prediction.
  - Control: setting `D_H = D_A` gives no pattern.
- Growth: oriented division produces elongation along polarity, and unpolarized division
  gives elongation ≈ 1 (control).

**M3: Mechanics and sorting**
- Two cells relax to the analytic equilibrium overlap `A/k_rep`. A random packing relaxes
  with monotonically non-increasing energy (with `T_eff = 0`).
- **Sorting** (Steinberg 1963; Foty & Steinberg 2005), starting from a random 50/50 mix of
  ~400 cells:
  1. Different cadherins: the homotypic neighbour fraction rises from ~0.5 to > 0.8.
  2. Same cadherin at different levels: the higher-expressing population ends up central
     (mean radial distance significantly lower, p < 0.01 across seeds).
  3. Control with identical adhesion: the homotypic fraction stays ≈ 0.5.
- Delta–Notch lateral inhibition on a static sheet gives a salt-and-pepper pattern
  (alternating fates, high fraction of high/low neighbour pairs), if D6 is approved.

**M4: Evolution**
- Operator unit tests: neutral duplication is bit-identical; deletion leaves no dangling
  sites; JSON round-trips; the mutation log is accurate.
- Sanity: selection for size improves fitness monotonically (elitism) on average.
- **The emergence experiment.** Run a batch (e.g. 20 runs × 300 generations), selecting
  only for **size + number of cell types**, never for segmentation or symmetry. Compare
  the final metrics with a **null distribution from random and unselected-drift genomes
  of matched size**.
  - Report the number of runs whose segment count and symmetry scores exceed the null's
    99th percentile, with pictures, the GRN, and the mechanism found (by knockout
    analysis).
  - **Important caveat (⚑ D10).** Some symmetries come almost for free: a growing blob
    with no cue is radially symmetric, and an embryo with a single axial cue and isotropic
    dynamics is mirror-symmetric about that axis. Counting those as "symmetry arising"
    would overstate the result. I propose the success criteria be (a) **segmentation**,
    meaning ≥ 3 repeated expression stripes along an axis, and/or (b) **non-trivial
    symmetry**, meaning bilateral or n-fold (n ≥ 3) symmetry of the *cell-type pattern*
    with ≥ 3 types, not just the outline.
  - Reported honestly: if 0/20 runs produce it, the report will say so and suggest what
    to change (longer runs, novelty search, seeding with an oscillator).

The M4 report is written to `reports/M4-emergence.md` with figures, so it can be read later.

---

## 11. Milestones

Each milestone ends with: all its tests green, lint/typecheck clean, a short entry in
`CHANGELOG.md` describing what was built and what was found, and **a commit**.

| | Scope | Validation |
|---|---|---|
| **M1** | Vite + TS + Vitest + ESLint scaffold; config, rng, math; genome types/validate/serialize/compile; CellStore; GRN step; perturbation clamps; a minimal debug page plotting single-cell time series | §10 M1 |
| **M2** | Morphogen grid; sensing/secretion; effectors (divide, die, polarize, differentiate); asymmetric segregation; maternal state; `develop()` loop (initially with a stub "jiggle" mechanics); recorder; Turing analysis helper; presets | §10 M2 |
| **M3** | Spatial hash; forces; differential adhesion; motility noise; contact signalling; replace stub mechanics | §10 M3 |
| **M4** | Mutation operators + log; crossover; selection (GA + novelty); worker pool; metrics module; headless experiment runner (`npm run experiment`) | §10 M4 + emergence report |
| **M5** | Preact UI: breeding grid, playback scrubber, overlays, GRN viewer, knockout/overexpress/ectopic tools, comparison view | manual checklist + render smoke tests |
| **M6** | Phylogeny view + IndexedDB history; save/load; profiling pass (WebGL or WASM only if measurements require it); docs | perf budget below |

**Performance budget (target, to check in M4/M6).** An organism with ≤1000 cells,
~24 genes, sparse GRN (~4 inputs/gene), 4 morphogens on 128², and T_dev = 300τ should
develop in < 0.5 s on one core. Back-of-envelope: GRN ≈ 1000·24·4 MAC × 3000 steps ≈ 3e8;
diffusion ≈ 4 · 16k nodes · ~3 sub-steps × 3000 ≈ 6e8 simple ops; mechanics ≈ 1000 · 12
pairs · 5 sub-steps × 3000 ≈ 2e8. That's around 1 s of JS at worst. Cell counts grow
exponentially, so the average is far below the cap, which makes 0.3–0.5 s realistic. A
population of 64 on 8 workers then takes ~3–4 s per generation. If that's too slow, the
first levers are a coarser grid for fast-diffusing species and a larger developmental Δt
with the GRN on a multirate step.

---

## 12. Decisions for your approval

| # | Decision | Recommendation | Alternative |
|---|---|---|---|
| **D1** | Expression kinetics | Gene-circuit model with **per-gene `rate` and `decay`**, exponential integrator | One global decay, forward Euler (as briefed; less stable, fewer timescales) |
| **D2** | Duplication semantics | Copy **row and column**; **dosage-neutral** by default (`'double'` available) | Copy gene only (duplicate born with no targets, so no duplicate-then-diverge) |
| **D3** | Duplication granularity | Single-gene **plus segmental/tandem** and rare whole-genome duplication | Single-gene only |
| **D4** | Initial symmetry breaking | Genome-encoded **maternal state**, zygote polarity cue, per-gene **asymmetric segregation** (all switchable off) | Pure self-organisation from noise only |
| **D5** | Effector triggering | **Integrate-to-threshold** accumulators (min cycle time, smooth genotype→phenotype) | Instant threshold crossing (jumpy, fires every step) |
| **D6** | Contact signalling | Add a **`contact` (juxtacrine) product type** for Notch-like lateral inhibition | Morphogens only (no true lateral inhibition) |
| **D7** | "Differentiate" and cell types | Differentiate = **terminal exit from the cell cycle**; cell types defined by **expression signatures**, never labels | A differentiation effector that assigns a type label |
| **D8** | Mechanics noise | Small **active-motility noise** (`T_eff`) | Deterministic forces only (sorting tends to stall) |
| **D9** | Diffusion domain | Whole grid (simple, has analytic checks) | Diffusion only inside tissue (more realistic boundaries, gives size-scaling effects); could be a later option |
| **D10** | M4 success criterion | Segmentation, or symmetry of the **type pattern** with ≥ 3 types, versus a **null distribution** | Any symmetry score increase (risks trivial positives) |
| **D11** | UI framework | **Preact + signals**, d3-force for GRN layout | Vanilla TS + DOM |
| **D12** | Perturbation tools | Knockout/overexpression **plus region- and time-restricted ectopic expression** | Global toggles only |
| **D13** | Cross-browser determinism | Portable `exp` in `math.ts` | Rely on `Math.exp` (deterministic within one engine only) |

**Considered but not recommended for v1:**
- **Affinity-based binding** (products have a specificity vector, sites have a motif,
  and weight = strength × similarity, as in Banzhaf's ARN). Duplicates are redundant by
  construction, and specificity mutations rewire many targets at once, which is realistic
  pleiotropy. I'm not recommending it because the network is less legible (effective
  weights are derived, not stored) and hand-authoring the validation genomes would be
  awkward. It could be added later behind the same `CompiledGRN` interface without
  touching the simulator.
- **Cellular Potts Model** in place of centre-based mechanics. It is the gold standard for
  DAH and cell shape, but it is lattice-based, much slower per cell, and harder to combine
  with division and polarity. Soft discs suit evolution at scale.
- **Implicit/ADI diffusion.** Unnecessary at 128² with sub-stepping. I'll revisit if
  profiling disagrees.
- **Receptor-mediated morphogen uptake** (it shapes the Dpp/Wg gradients) and
  **mechanosensing inputs** (pressure as a GRN input, contact inhibition of growth). Both
  are good later additions that fit the existing interfaces.

## 13. Risks

- **Evolvability.** GRN-development models often converge on featureless blobs. Mitigations:
  neutral duplication, novelty search, seeding runs from validated presets, and the
  "lock gene" tool.
- **Turing parameter space is narrow** under sigmoid kinetics. Mitigation: the linear
  stability helper lets me find valid regions analytically instead of by trial and error.
- **Performance** at the 1000-cell cap with many morphogens. Mitigation: the budget in §11
  is measured in M4, and the levers are listed there.
- **Over-interpreting emergence.** Mitigation: null distributions and the D10 criteria.

## 14. References (key)
- Wolpert L. (1969) Positional information and the spatial pattern of cellular differentiation. *J Theor Biol* 25:1–47.
- Turing A.M. (1952) The chemical basis of morphogenesis. *Phil Trans R Soc B* 237:37–72.
- Gierer A., Meinhardt H. (1972) A theory of biological pattern formation. *Kybernetik* 12:30–39.
- Mjolsness E., Sharp D.H., Reinitz J. (1991) A connectionist model of development. *J Theor Biol* 152:429–453.
- Jaeger J. et al. (2004) Dynamic control of positional information in the early *Drosophila* embryo. *Nature* 430:368–371.
- Wagner A. (1996) Does evolutionary plasticity evolve? *Evolution* 50:1008–1023.
- Siegal M.L., Bergman A. (2002) Waddington's canalization revisited. *PNAS* 99:10528–10532.
- Steinberg M.S. (1963) Reconstruction of tissues by dissociated cells. *Science* 141:401–408.
- Steinberg M.S., Takeichi M. (1994) Experimental specification of cell sorting, tissue spreading, and specific spatial patterning by quantitative differences in cadherin expression. *PNAS* 91:206–209.
- Foty R.A., Steinberg M.S. (2005) The differential adhesion hypothesis: a direct evaluation. *Dev Biol* 278:255–263.
- Graner F., Glazier J.A. (1992) Simulation of biological cell sorting using a two-dimensional extended Potts model. *PRL* 69:2013.
- Collier J.R. et al. (1996) Pattern formation by lateral inhibition with feedback. *J Theor Biol* 183:429–446.
- Elowitz M.B., Leibler S. (2000) A synthetic oscillatory network of transcriptional regulators. *Nature* 403:335–338.
- Gardner T.S., Cantor C.R., Collins J.J. (2000) Construction of a genetic toggle switch in *E. coli*. *Nature* 403:339–342.
- Force A. et al. (1999) Preservation of duplicate genes by complementary, degenerative mutations. *Genetics* 151:1531–1545.
- Ohno S. (1970) *Evolution by Gene Duplication*. Springer.
- Ermentrout B. (1991) Stripes or spots? Nonlinear effects in bifurcation of reaction–diffusion equations on the square. *Proc R Soc A* 434:413–417.
- Osborne J.M. et al. (2017) Comparing individual-based approaches to modelling the self-organization of multicellular tissues. *PLoS Comput Biol* 13:e1005387.
- Lehman J., Stanley K.O. (2011) Abandoning objectives: evolution through the search for novelty alone. *Evol Comput* 19:189–223.
- Dawkins R. (1986) *The Blind Watchmaker* (biomorphs); Secretan J. et al. (2011) Picbreeder. *Evol Comput* 19:373–403.


---

## 15. Changes made during implementation

The model above was implemented as written, except for the changes below. Each one
was forced by a test or a measurement, and the CHANGELOG has the details.

| Area | Design said | Implemented | Why |
|---|---|---|---|
| Repulsion | linear spring k·δ | **k·δ·s/d**: linear for small overlaps, diverging as centres meet | Strong adhesion collapsed cells onto each other (overlaps up to 0.99). Cells are nearly incompressible. |
| Adhesion | A₀ + Σ J·min(a,b) | A₀ + S/(1 + S/A_max), with **A_max = 1.5** | Bonds per contact are finite. Without the cap, second-shell neighbours entered the adhesion range and aggregates over-compacted. Saturation acts on the sum, so neutral duplication still holds. |
| Mechanics time step | fixed sub-steps | **adaptive sub-steps** from a bound on the largest stiffness eigenvalue, plus Verlet neighbour lists | Explicit Euler was marginally unstable: aggregates fragmented differently at 5 and 10 sub-steps. |
| Motility noise | a kick every sub-step | one kick per developmental step with the full-step variance | Same statistics, ~5× fewer random draws (it was the top profile entry). |
| Duplication neutrality | bit-identical phenotype | identical to < 1e-9 (expression) / 1e-6 (positions) | w·x/2 + w·x/2 ≠ w·x exactly in floating point. |
| Portable math | exp in the simulation | exp, log, sin, cos, hypot everywhere outside `analysis/`, enforced by a test | Metrics feed fitness, so they must be reproducible across engines too. |
| Cell sorting | default motility | sorting needs k_BT ≈ 0.03–0.05; default 0.002 is "cold" | At low noise aggregates jam. Above ~0.06 weakly adhesive cells evaporate. |
| French flag read-out | three thresholds + cross-repression | thresholds **plus self-activation** (bistable switches), bias shifted by −feedback/2 | A pure threshold read-out of a smooth gradient gives 6–10-cell-wide, leaky boundaries. |
| Lint rule for `core` boundaries | ESLint | a Vitest test | Saves a dependency; same guarantee. |
| Segment detector | ≥ 3 regular stripes spanning the body width | additionally: each stripe crosses the main axis and is mostly interior | A broken outer rim passed the original test (found in the M4 experiment). |
| Pattern symmetry | Cohen's κ | κ, only when the second type has ≥ 10% of cells, plus a separate *isotropy* score | The κ paradox for skewed type frequencies, and concentric patterns scoring high for free. |
| Paralog names | `name'` | `root.n` (lowest free n) | Repeated duplication produced colliding names. |

Open issues, recorded honestly:
- **Oriented division does not elongate tissue on its own** (crowded chains buckle,
  and cohesive tissue rounds up). Elongation needs a growth zone or convergent
  extension, and neither is an explicit mechanism yet.
- **Cell types use TF and contact genes only** (D7), so morphogen-only patterns
  (Turing presets) count as one type. Including morphogen and adhesion genes is
  probably better.
- **Segmentation did not emerge** in the M4 experiment (0/8 selected runs). Selection for cell
  types produced concentric zonation. One run evolved axis elongation through a density-sensing
  growth zone. See reports/M4-emergence.md for suggestions.
- **Level-based sorting coarsens slowly**: within 1000τ it gives surface layering of
  the low expressers, not a single central core.
