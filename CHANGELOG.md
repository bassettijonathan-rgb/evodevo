# Changelog

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
