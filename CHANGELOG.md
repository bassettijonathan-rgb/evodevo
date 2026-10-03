# Changelog

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
