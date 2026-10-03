## Interpretation (written by hand after reading the results)

**Did segmentation or non-trivial symmetry arise without being selected for? Mostly, no.**

- **Segmentation: 0 of 8 selected runs and 0 of 8 control runs**, across ~59,000
  organisms. The only candidates were detector artefacts: broken outer rims
  (section (c) above). A segmentation clock (an oscillator plus a wavefront) or a
  Turing instability *along an elongating axis* would be needed, and selection for
  "more cell types" in a round 200-cell body never pushed in that direction within
  120 generations.
- **Symmetry is almost always the trivial kind.** Selection for cell types worked
  (7 of 8 runs reached the 6-type target). It did so by building **concentric
  zonation**: core, middle ring and rim, from each organism reading a gradient of a
  morphogen its own cells secrete. Of the symmetric candidates sampled in selected runs, 468 of 480 were isotropic;
  of the remaining 12, five (all from run 0) passed every criterion when regrown.
  In the controls, symmetric candidates were rare (87 unique genomes) and 76 of them
  were isotropic; none passed. The high pattern-symmetry scores (median mirror κ 0.70) are the
  free symmetry of a round body that DESIGN.md D10 warned about. The isotropy
  exclusion was needed to see this.
- **The one non-isotropic case (selected run 0) is the interesting result, but it is
  about shape, not pattern.** In five related genomes the organism elongates
  (elongation ≈ 3; 2.5–3.1 across noise seeds), and its type zones follow the
  elongated outline: mirror-symmetric about both axes, i.e. concentric zonation in a
  stretched body. It was never selected for shape. Knockouts give the mechanism:
  - elongation needs the **zygote polarity cue** (1.24 without it), so divisions
    follow the inherited maternal axis;
  - it needs morphogen **g7** (1.12 when knocked out). g7 is secreted by every cell and
    represses both divide effectors, so cells deep inside the tissue, where g7
    accumulates, divide more slowly. **Proliferation concentrates at the periphery
    and the tips, a growth zone produced by density sensing**;
  - it does not need the evolved asymmetric segregation of g4 (2.95 without).

  (Reproduce with `npx tsx scripts/ko-elongation.ts reports/m4/genomes/selected-0-id2624.json selected-0`.)

  M2 found that oriented division alone cannot elongate a growing tissue, because
  crowded chains buckle and cohesive tissue rounds up. Evolution found a route
  around this, combining oriented divisions with a growth zone, which is how real
  axes elongate. The genome also shows duplicate-then-diverge in action: g4 exists
  as three paralogs from two duplications, and its regulator g5 is the morphogen
  the type pattern depends on.

**What this says about the model, honestly**
- Within this budget (8 × 120 generations × 32 organisms, a 200-cell cap, selection
  only for size and type number), the model's evolutionary default is a radially
  zoned blob. Segmentation did not emerge.
- Drift alone destroys development: without selection, growth is lost within
  ~100 generations in every drift run. Selection for size alone rarely produces more
  than one cell type. Both controls had essentially no patterns at all.

**What would make emergence more likely (suggestions, not yet tested)**
1. Longer runs and larger populations. Run 0 needed ~100 generations just to leave a
   single cell type.
2. Selecting for something that rewards an axis (elongation, or type count *per
   unit body length*), so that segmentation becomes the cheapest way to add types.
3. Seeding runs with an oscillator (a repressilator module) or an elongating founder
   like run 0's, so a clock and a wavefront can meet.
4. Novelty search, which is implemented but was not used in this experiment.
5. Defining cell types over morphogen and adhesion genes as well (DESIGN.md §15
   open issue), which would let morphogen-only patterns count as types.
