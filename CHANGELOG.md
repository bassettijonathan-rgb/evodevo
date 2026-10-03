# Changelog

## M5: The game UI

**Built** (Preact + signals, d3-force for the GRN layout, Canvas2D)
- **Breed**: interactive selection on a 12-organism brood (one parent, or two for
  crossover), a mutation-strength slider, and *Inspect in lab*. *Target selection*
  runs automatic generations with a fitness you assemble from metric terms ("reach
  at least" or "match"), with a best-fitness sparkline.
- **Lab**: grows any organism or preset in a worker and keeps the recording.
  - Playback with play/pause and a scrubber.
  - Overlays: cell type (with a legend naming the genes that are on in each type),
    expression of any gene, lineage (8-cell founder clones), morphogen field heatmap,
    polarity arrows, and fit to cells or to the whole grid.
  - Interactive GRN: node shape = product type, fill = mean expression at the current
    frame, edge width ∝ |w|, green = activation, red = repression, dashed = inert.
  - Gene panel with parameters (including the morphogen decay length L = √(D/k)) and
    inputs.
  - Perturbations: knockout, overexpression, and ectopic expression in a clicked
    region from a chosen time. *Regrow perturbed* shows wild type and mutant side by
    side with a metrics table and a homeotic-transformation readout.
- Presets: French flag embryo, French flag tissue, Turing stripes and spots, cell
  sorting, lateral inhibition, random founder.
- Save and load genomes as JSON.
- `npm run e2e`: a Playwright smoke test that drives breeding, the lab (preset,
  overlays, knockout, regrow) and the phylogeny in headless Chromium, and fails on
  any page error.

**Checked by hand** (screenshots): the Turing labyrinth renders under the field
overlay. In the French flag embryo, knocking out the maternal organiser S turns blue
and white cells into the default red fate, and the lab reports it as a
transformation into another wild-type fate. That is the logic of the bicoid phenotype.

**Not done from DESIGN.md §9**: the mechanical-stress overlay (frames do not record
forces yet), the hover-to-play mini timelines on brood cards, and "lock a gene" in
breeding.

**Known limitation**: cell types are defined by transcription-factor and contact
genes only (D7), so the Turing presets, which are made only of morphogens, count as
one cell type. Including morphogen and adhesion genes in the signature is probably
the better definition. I'll revisit it after the M4 experiment, which uses the
current one.

## M4: Mutation, evolution loop, workers, metrics (report pending)

**Built**
- `evolution/mutate.ts`, the mutation operators: weight and parameter changes
  (log-normal for positive parameters), site gain, loss and rewiring,
  single-gene, segmental (tandem) and whole-genome duplication, deletion,
  product-type switching, and effector/cue changes. Every event is logged in
  readable form, and rates are Poisson per reproduction.
- Duplication copies a gene's inputs (cis-region) **and** its outputs (every site
  that binds the original also binds the copy). In 'neutral' dosage mode both
  copies' rates and maternal levels are halved, which leaves every downstream sum
  unchanged (D2/D3).
- `evolution/crossover.ts`: recombination aligned by gene id.
- `evolution/population.ts`: generational GA with elitism and tournament selection,
  plus novelty search, random (drift) and interactive selection. It caches
  evaluations by genome hash, records the phylogeny, and derives organism seeds
  from the experiment seed and the genome hash, so results don't depend on
  scheduling.
- `evolution/evaluate.ts`, `workers/` and `scripts/nodePool.ts`: the same
  evaluation function runs in browser Web Workers and Node worker threads.
- `metrics/`: cell types (expression signatures), type entropy, elongation, shape
  mirror symmetry, **pattern** mirror and rotational symmetry as Cohen's κ (agreement
  beyond chance, so a uniform blob scores 0), and segments (≥ 3 regular stripes that
  each span the body width). Also the homeotic-transformation detector used by the
  lab.
- Portable `sin`, `cos`, `hypot`. A test now fails if anything in the simulation,
  metrics or evolution code calls a non-portable `Math` function.
- `scripts/experiment.ts` and `scripts/report.ts` for the emergence experiment.

**Validated**: 74 unit tests
- 2000 heavy random mutations always give valid, serialisable genomes, and mutation
  is deterministic per seed.
- **Neutral duplication leaves the phenotype unchanged**: duplicating each gene of
  the French flag in turn (single, segmental, whole-genome) changes every expression
  level by < 1e-9. A growing embryo with a duplicated divide effector and maternal
  determinant develops identically (positions within 1e-6). 'Double' dosage does
  change it (control). It is not bit-identical, as DESIGN.md had hoped, because
  w·x/2 + w·x/2 is not exactly w·x in floating point.
- Selection with elitism never loses fitness, and runs are reproducible.
- The metrics give the right answer on synthetic organisms: stripes along a rod
  count as segments; concentric rings, spots, irregular bands and a single stripe do
  not. A uniform blob has shape symmetry but zero pattern symmetry. A mirror pattern
  scores κ > 0.8 and random labels < 0.15. 4-fold and 3-fold rotational patterns are
  identified with the right order.
- Knocking out Blue in the French flag is detected as a transformation of the blue
  band into the white fate.

**Mechanics fixes found while profiling (these change M3 behaviour)**
- **Collapse under strong adhesion.** With three cadherins, adhesion overwhelmed the
  linear repulsion and cells piled onto each other (overlaps up to 0.99, about 58
  neighbours per cell). Repulsion is now k·δ·s/d, which diverges as centres meet.
  Specific adhesion now saturates, S/(1 + S/A_max), with A_max = 1.5 so adhesion
  stays well below the compression stiffness. Saturation is applied after the sum,
  so neutral duplication still holds.
- **Explicit-integration instability.** The fixed 5 sub-steps were marginal
  (Δt < 2γ/λ_max), and stiff contacts made aggregates fragment depending on the
  sub-step count. The number of sub-steps is now chosen each step from a bound on
  the largest stiffness eigenvalue, and results no longer depend on it.
- After these changes the level-sorting experiment needs binding 2 and levels
  1 vs 0.2 (adhesion 1.16 vs 0.62) to show its effect, and within 1000τ the high
  expressers form several clusters under a surface layer of low expressers rather
  than one central core. The test now checks that surface layering.

## M3: Mechanics, differential adhesion, lateral inhibition

**Built**
- Faster mechanics: the pair loop is inlined, buffers are reused, and motility kicks
  are drawn once per developmental step with the full-step variance 2k_BT·Δt/γ while
  forces are still resolved every sub-step. Results were bit-identical before the
  kick change. The kick change alters the noise sequence but not its statistics.
- `metrics/tissue.ts`: contact neighbours, connected aggregates, homotypic-contact
  fraction, surface cells.
- `hexDisc` initial condition; presets `sortingPair` (different cadherins, the same
  cadherin at different levels, or identical) and `lateralInhibition` (Collier-style
  Delta–Notch).

**Validated**: 79 tests in total
- Two adhering cells relax to the analytic overlap δ* = A/k_rep (to 1e-6). Without
  noise a random packing relaxes with non-increasing energy. Contact signals average
  the neighbours and exclude the cell itself.
- **Sorting (Steinberg)**, 400 cells, 50/50 random mix, 3 seeds:
  - Different cadherins: homotypic contacts rise from 0.50 to > 0.8 (0.88 typical).
  - Same cadherin at 1.0 vs 0.4 (Steinberg & Takeichi 1994): low expressers are
    enriched at the aggregate surface by > 20 percentage points, i.e. high expressers
    sort inside.
  - Control (identical adhesion): no segregation and no layering.
- **Lateral inhibition**: linear theory gives a checkerboard-mode growth rate of
  exactly w/4 − 1 (threshold w = 4), and the uniform mode is always stable.
  Simulation agrees: at w = 3 the noise dies out (range < 0.01), at w = 5 a pattern
  grows, and at w = 12 a full 0/1 checkerboard forms with > 90% of neighbours in
  opposite fates (a few domain-wall defects remain).

**Findings worth knowing**
- **Sorting needs active motility, and the window is narrow.** At k_BT = 0.01 a
  different-cadherin mix stays jammed (homotypic fraction 0.51 after 600τ); at 0.03 it
  sorts. Sorting by cadherin *level* has smaller energy differences and needs about
  0.05. At 0.06 and above, the weakly cohesive cells start to "evaporate" from the
  aggregate. The default motility (0.002) is therefore too cold to sort within a
  normal development time. Whether evolution should be able to tune motility (for
  example a "motile" effector) is a question for M4/M5.
- As DESIGN.md §3.8 predicted, homophilic `min` binding gives W_AB ≤ min(W_AA, W_BB).
  The level experiment therefore gives inside/outside layering, not the full
  engulfment phase of the DAH phase diagram.

## M2: Morphogens, multicellular growth, French flag, Turing

**Built**
- `sim/morphogens.ts`: finite-volume grid. Explicit 5-point diffusion with automatic
  per-morphogen sub-stepping (D·Δt/h² ≤ 0.2), exact decay, zero-flux boundaries,
  bilinear sampling and gradients, and deposit as the exact transpose of sampling.
- `sim/effectors.ts`: integrate-to-threshold cell cycle, apoptosis and terminal
  differentiation; polarity that turns toward or away from a cue gradient;
  divisions oriented along polarity (no trig, so they stay portable); asymmetric
  segregation; founder ids for clonal fate maps.
- `sim/develop.ts`: the full step loop (sense → express → secrete → diffuse →
  effectors → mechanics → record). `Embryo` steps it for the UI and `develop()` runs
  it to the end. Starts from a zygote or a ready-made (optionally frozen) tissue.
- `sim/mechanics.ts`, brought forward from M3 because growth needs it: spatial hash,
  repulsion, homophilic `min` adhesion, motility noise, soft walls, and the
  juxtacrine (contact) signal sums.
- `sim/recorder.ts`: Float32 playback frames.
- `analysis/`: K₀ Bessel function, Faddeev–LeVerrier + Durand–Kerner eigenvalues,
  Turing linear stability (homogeneous steady state with Newton polishing, J(q) on
  the lattice including the gene stage, dispersion scan), 2D FFT radial spectrum,
  blob morphology (spots vs stripes).
- `presets/patterning.ts`: the Turing pair, French flag v1 (fixed tissue) and v2
  (grown from a zygote).

**Validated**: 70 tests in total
- Diffusion: mass conserved to 1e-12. A point source's ⟨r²⟩ = 4Dt to 1e-9, which is
  exact for FTCS. Exact uniform decay. Stable at D = 50. The point-source steady
  state matches S/(2πD)·K₀(r/L) within 5% for r = 1–5 L.
- Division: cycle time exactly 1/divideRate (±1 step). The cell cap is respected
  and reported. Division axes follow polarity (mean |cos| > 0.97, against ≈ 0.64 for
  unpolarized). Asymmetric segregation is exact. There are 8 founder clones.
  Death, differentiation and polarization toward a source all behave as specified.
  Development is deterministic per seed.
- **Turing.** The activator–inhibitor pair is built so that the linearised system is
  identical at every sigmoid operating point p; only the nonlinearity changes.
  - Predicted fastest-growing mode: λ = 11.0 cells, growth rate 0.0320/τ.
  - Measured: growth rate 0.0343/τ (+7%), and λ = 11.4 at T = 400 (+3.5%), coarsening
    to 12.7 by T = 800.
  - The pattern depends on p as Ermentrout (1991) predicts: p = 0.5 (inflection point)
    gives a stripe labyrinth, p = 0.35 gives spots of high activator, and p = 0.65
    gives the opposite phase (spots of low activator).
  - Controls: D_H = D_A gives no instability, both in theory and in simulation.
  - Far from onset (p = 0.25) the pattern goes through a secondary instability and
    coarsens to roughly 2× the wavelength. Not tested, but worth knowing.
- **French flag v1** (fixed 64×16 tissue, source column): every row reads
  blue→white→red, the bands are 21/19/24 cells, and boundaries have ≤ 1–2 mixed
  cells.
- **French flag v2** (grown from a zygote, 160 cells, 5 seeds): a fully asymmetric
  maternal determinant ends up in one organiser cell at the +polarity pole. Fates are
  ordered by distance from it, each covers ≥ 20% of cells, none are undecided, and
  > 80% of cells match their neighbours' fate.

**Findings worth knowing**
- **A pure threshold read-out makes a poor flag.** Reading a smooth exponential
  gradient with three sigmoid thresholds and no feedback gives boundaries 6–10 cells
  wide, plus leaky co-expression (white inside the blue band). Self-activation
  (bistable switches) with strong cross-repression sharpens them to 1–2 cells. This
  is the role cross-regulation plays among the Drosophila gap genes, and a test keeps
  the contrast. Two things are needed to keep the bands where intended: the bias has
  to be shifted by −feedback/2 so each switch is centred on its threshold, and the
  switches remember the gradient as it builds up (hysteresis).
- **The flag does not scale.** Doubling the tissue keeps the blue band the same
  absolute width, as expected for absolute thresholds. A test documents this.
- **Oriented division alone does not elongate a growing tissue.** The first few cells
  line up along the polarity axis, but a cell inserted into a crowded chain escapes
  sideways more cheaply than it pushes the chain, so the chain buckles. Cohesive
  tissues also round up under surface tension. Real embryos elongate with posterior
  growth zones or convergent extension, so evolved elongation will need one of those
  routes.

## M1: GRN and single-cell dynamics

**Built**
- Vite + TypeScript + Vitest scaffold. `src/core` is DOM-free; a test enforces that it
  imports nothing outside itself. I used a test here instead of the ESLint rule the
  design mentioned, which saves a dependency.
- `core/math.ts`: portable `exp`/`log`/`sigmoid` built from IEEE basic operations only
  (D13). `exp` is table-driven (Tang 1989), < 2 ulp from `Math.exp` and about 2× its
  cost (~23 ns vs ~12 ns per call in Node 22).
- `core/rng.ts`: sfc32 PRNG, cyrb128 seeding, labelled independent streams (`fork`),
  normal (Marsaglia polar) and Poisson samplers.
- `core/genome/`: types, name-based builder for hand-authoring, validation,
  canonical JSON plus a 128-bit content hash, and compilation to a CSR sparse network.
  Edges from adhesion/effector products are dropped at compile time but kept in the
  genome as cryptic variation.
- `core/sim/`: `CellStore` (structure of arrays), the gene-circuit update with the
  exponential integrator and optional chemical-Langevin noise, and perturbation clamps
  (knockout, overexpression, fixed level, limited to a time window and/or a disc).
- `presets/circuits.ts`: constitutive gene, auto-activator, toggle switch,
  repressilator, morphogen read-out.
- Debug page (`npm run dev`): single-cell time series with live weight and noise sliders.

**Validated** (tests/unit, tests/science/m1-circuits): 36 tests
- A single gene follows `x*(1 − e^{−λt})` to < 1e-12 for any Δt. With feedback, the
  integrator converges at first order (error ratio ≈ 2 when Δt halves).
- Toggle switch: bistable for strong repression. The pitchfork sits where theory puts it
  (|w| = 4): monostable at 3.6, bistable at 4.4. A transient pulse flips the fate
  permanently (cell memory). Expression noise breaks the symmetric state into both fates.
- Repressilator: sustained oscillation with period CV < 1%. The Hopf bifurcation sits at
  the predicted |w| = 8 (per-stage gain sec(π/3) = 2): it damps at 7.5 and oscillates
  at 8.5.
  Near onset (|w| = 8.2) the measured period is 3.70τ vs the predicted 2π/√3 = 3.63τ
  (+1.9%). Knocking out one gene stops the clock.
- Determinism: same seed gives bit-identical trajectories; with noise off, the seed has
  no effect.

**Measured**
- GRN step: ~0.7–1 ms for 1000 cells × 24 genes × ~4 inputs/gene. That is about 2–3 s
  per organism if it sat at the 1000-cell cap for all 3000 steps. The real average cell
  count is much lower, but this is the first thing to watch in the M4 performance
  budget.
