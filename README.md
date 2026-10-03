# evodevo

A browser-based evo-devo simulation. Organisms grow from a single cell, driven by a
gene regulatory network (GRN), diffusing morphogens, contact signals and cell
mechanics. Evolution acts only on the genome; body plans have to come out of
development.

- [DESIGN.md](DESIGN.md): the model, its equations and the design decisions (D1–D13).
- [CHANGELOG.md](CHANGELOG.md): what each milestone built, what was validated, and what
  was found along the way, including what didn't work.
- [reports/M4-emergence.md](reports/M4-emergence.md): the emergence experiment.

## Running it

```sh
npm install
npm run dev            # the game at http://localhost:5173 (debug page: /debug.html)
npm run build          # production build in dist/
```

**Breed.** Start from a random founder or the French-flag embryo. Click one organism
(or two, for crossover) and press *Breed*. *Target selection* runs generations
automatically with a fitness you build from shape metrics: cells, cell types,
segments, pattern symmetry, elongation and so on.

**Lab.** Grow any organism or preset and scrub through its development. Colour cells
by type, by any gene's expression, or by lineage (8-cell founder clones). Show a
morphogen field underneath and polarity arrows. Click genes in the GRN to see their
parameters and inputs. Knock out, overexpress, or ectopically express a gene in a
region from a chosen time, then *Regrow perturbed* for a side-by-side with the wild
type and a homeotic-transformation readout.

**Phylogeny.** Every organism you have seen, as a tree (extinct lineages hidden by
default). Duplication events are marked. Click a node to inspect it, breed from it,
or export its genome or its whole lineage. Sessions are saved in IndexedDB and can be
resumed.

## Tests

```sh
npm test               # unit tests (~15 s)
npm run test:science   # validation milestones: French flag, Turing, sorting, … (~1 min)
npm run typecheck
npm run build && PLAYWRIGHT_CHROMIUM=/path/to/chromium npm run e2e   # UI smoke test
```

The science tests compare the simulation with theory wherever theory exists: analytic
ODE solutions, bifurcation points (toggle switch, repressilator, lateral inhibition),
the K₀ steady state of diffusion, and the Turing growth rate and wavelength from
linear stability analysis.

## Experiments (headless, multi-core)

```sh
npm run experiment -- --runs 10 --drift 6 --gens 120 --pop 32 --out reports/m4-data
npm run report -- reports/m4-data reports
```

## Code map

```
src/core/            deterministic simulation; no DOM; runs in Node, workers and tests
  config.ts          every physical/numerical parameter, with units — start here to tweak
  math.ts, rng.ts    portable exp/log/sin/cos (bit-identical across browsers), seeded PRNG
  genome/            data model, name-based builder, validation, JSON, compilation to CSR
  sim/               cells, gene expression, morphogens, mechanics, effectors, the step loop
  metrics/           cell types, symmetry (κ), segments, tissue statistics, WT-vs-mutant
  evolution/         mutation operators, crossover, the GA, evaluation, phylogeny
  analysis/          theory for the tests: linear stability, FFT, Bessel K₀, pattern shape
src/presets/         hand-authored genomes (circuits, French flag, Turing, sorting, Notch)
src/render/          Canvas2D and SVG drawing
src/ui/              the Preact app
src/workers/         Web Worker pool
scripts/             Node experiment runner, report generator, profiling
tests/unit, tests/science, tests/e2e
```

Rules the tests enforce: `src/core` imports nothing outside itself, and nothing in
the simulation, metrics or evolution code uses a non-portable `Math` function.

## Tweaking the model

- **Physical constants** (diffusion CFL, cell-cycle rate, adhesion, motility, cell
  cap, grid size, …) are in `src/core/config.ts`. Each has a comment with its units.
- **Gene expression** is in `src/core/sim/grn.ts`, about 40 lines. The integration
  scheme is described at the top of the file.
- **Morphogen transport** is `src/core/sim/morphogens.ts`.
- **Cell behaviours** (division, death, differentiation, polarity, asymmetric
  segregation) are in `src/core/sim/effectors.ts`.
- **Forces** (repulsion, cadherin adhesion, motility noise) are in
  `src/core/sim/mechanics.ts`.
- **Mutation rates and operators** are in `src/core/evolution/mutate.ts`
  (`DEFAULT_MUTATION`).
- **New preset organisms**: write a genome with `buildGenome` (by gene name; see
  `src/presets/patterning.ts`) and add it to `src/presets/index.ts`.
