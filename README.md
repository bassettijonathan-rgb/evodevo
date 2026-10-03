# evodevo

A browser-based evo-devo simulation: organisms grow from a single cell under a gene
regulatory network and diffusing morphogens, and evolution acts only on the genome.
See [DESIGN.md](DESIGN.md) for the model and plan, and [CHANGELOG.md](CHANGELOG.md)
for what each milestone delivered and found.

```sh
npm install
npm run dev            # debug page at http://localhost:5173
npm test               # fast unit tests
npm run test:science   # validation milestones (slower)
npm run typecheck
```

Layout: `src/core` is the deterministic simulation (no DOM, runs in Node and
workers), `src/presets` holds hand-authored genomes, `tests/unit` and
`tests/science` hold the tests.
