/**
 * Lab page: grow one organism, scrub through its development, look at it through
 * overlays and its GRN, and perturb genes to look for homeotic-like transformations.
 */
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { compareToWildType } from '../core/metrics/compare';
import { assignTypes } from '../core/metrics';
import { typeColor } from '../render/palette';
import type { Frame } from '../core/sim/recorder';
import type { Perturbation } from '../core/sim/perturb';
import { genomeFromJSON, genomeToJSON } from '../core/genome/serialize';
import { PRESETS } from '../presets';
import { EmbryoView, type Overlay } from './EmbryoView';
import { GrnView } from './GrnView';
import {
  busy, frameIndex, growLab, labGRN, labResult, labSubject, lockedGenes, openInLab, perturbations, perturbedResult,
  presetSubject, regrowPerturbed, selectedGene,
} from './state';
import { offerText, pickTextFile } from './files';

const pasteOpen = signal(false);
const pasteText = signal('');
const loadError = signal<string | null>(null);

/** Load a genome from JSON text (either a bare genome or { genome, config }). */
async function loadGenomeText(text: string): Promise<void> {
  const subject = labSubject.value!;
  try {
    const parsed = JSON.parse(text);
    const genome = genomeFromJSON(JSON.stringify(parsed.genome ?? parsed));
    loadError.value = null;
    pasteOpen.value = false;
    await openInLab({ ...subject, genome, config: parsed.config ?? subject.config, label: 'loaded genome', initial: undefined });
  } catch (e) {
    loadError.value = (e as Error).message;
  }
}

const overlay = signal<Overlay>({ colour: 'type', gene: 0, field: null, polarity: false, fit: 'cells' });
const playing = signal(false);
const brush = signal<{ armed: boolean; r: number; from: number; until: number; region: { x: number; y: number; r: number } | null }>({ armed: false, r: 4, from: 0, until: Infinity, region: null });

export function Lab() {
  const subject = labSubject.value;
  const result = labResult.value;
  const grn = labGRN.value;

  // Playback timer.
  useEffect(() => {
    if (!playing.value) return;
    const id = setInterval(() => {
      const n = labResult.value?.frames?.length ?? 0;
      if (frameIndex.value >= n - 1) { playing.value = false; return; }
      frameIndex.value++;
    }, 60);
    return () => clearInterval(id);
  }, [playing.value]);

  if (!subject || !grn) {
    return (
      <div class="panel">
        <h2>Lab</h2>
        <p>Pick a preset to grow, or select an organism on the Breed page and choose “Inspect in lab”.</p>
        <PresetPicker />
      </div>
    );
  }

  const frames = result?.frames ?? [];
  const fi = Math.min(frameIndex.value, frames.length - 1);
  const frame: Frame | undefined = frames[fi];
  const pFrames = perturbedResult.value?.frames ?? [];
  const pFrame = pFrames.length ? pFrames[Math.min(fi, pFrames.length - 1)] : undefined;
  const cfg = subject.config;
  const grid = { nx: cfg.gridNx ?? 128, ny: cfg.gridNy ?? 128, h: cfg.gridH ?? 1 };
  const ov = overlay.value;
  const morphNames = Array.from(grn.morphIdx, (g) => grn.names[g]);
  const levels = frame ? meanLevels(frame, grn.G, grn.maxLevel) : [];
  const types = frame ? assignTypes(stateOf(frame, grn)) : null;
  const typingNames = grn.names.filter((_, i) => grn.types[i] === 'tf' || grn.types[i] === 'contact');
  const perturbedMap = new Map(perturbations.value.map((p) => [p.gene, label(p)]));
  const sel = selectedGene.value;
  const gene = sel !== null ? subject.genome.genes[sel] : null;
  const comparison = frame && pFrame && pFrame === pFrames.at(-1) && frame === frames.at(-1)
    ? compareToWildType(stateOf(frame, grn), stateOf(pFrame, grn), perturbations.value.map((p) => grn.indexOf.get(p.gene)!).filter((i) => i !== undefined))
    : null;

  return (
    <div class="lab">
      <section class="panel controls">
        <div class="row">
          <b>{subject.label}</b>
          <span class="muted">{subject.genome.genes.length} genes</span>
          <PresetPicker />
          <button onClick={() => offerText(`${subject.label.replace(/\W+/g, '-')}.genome.json`, genomeToJSON(subject.genome))}>Save genome</button>
          <button onClick={async () => { const text = await pickTextFile(); if (text) await loadGenomeText(text); }}>Load genome file</button>
          <button onClick={() => { pasteOpen.value = !pasteOpen.value; }}>Paste genome</button>
          {busy.value && <span class="busy" role="status">{busy.value}</span>}
        </div>
        {pasteOpen.value && (
          <div class="row paste">
            <label for="paste-genome" class="small">Paste genome JSON</label>
            <textarea id="paste-genome" rows={3} value={pasteText.value} onInput={(e) => { pasteText.value = (e.target as HTMLTextAreaElement).value; }} />
            <button class="primary" disabled={!pasteText.value.trim()} onClick={() => loadGenomeText(pasteText.value)}>Load</button>
          </div>
        )}
        {loadError.value && <p class="error" role="alert">Could not load that genome: {loadError.value}. Check that it is a genome JSON saved from this app.</p>}
      </section>

      <div class="lab-main">
        <section class="panel">
          <div class="views">
            <figure>
              {frame ? <EmbryoView frame={frame} grn={grn} grid={grid} overlay={ov} size={pFrame ? 300 : 440} typeOf={types?.typeOf}
                region={brush.value.region}
                onPick={brush.value.armed ? (x, y) => { brush.value = { ...brush.value, region: { x, y, r: brush.value.r }, armed: false }; } : undefined} />
                : <div class="placeholder big" />}
              <figcaption>Wild type{brush.value.armed ? ' — click to place the ectopic region' : ''}</figcaption>
            </figure>
            {pFrame && (
              <figure>
                <EmbryoView frame={pFrame} grn={grn} grid={grid} overlay={ov} size={300} />
                <figcaption>Perturbed: {perturbations.value.map(label).join(', ')}</figcaption>
              </figure>
            )}
          </div>
          {types && ov.colour === 'type' && (
            <ul class="legend" aria-label="cell types">
              {types.signatures.map((sig, t) => (
                <li><span class="swatch" style={{ background: typeColor(t) }} />{
                  typingNames.filter((_, k) => sig[k] === '1').join(' + ') || 'no TF on'
                } <span class="muted">({types.counts[t]})</span></li>
              ))}
            </ul>
          )}
          {frame && (
            <div class="row playback">
              <button class="icon" aria-label={playing.value ? 'pause' : 'play'} onClick={() => {
                if (!playing.value && fi >= frames.length - 1) frameIndex.value = 0;
                playing.value = !playing.value;
              }}>{playing.value ? '❚❚' : '▶'}</button>
              <input type="range" min="0" max={frames.length - 1} value={fi} aria-label="development time"
                onInput={(e) => { playing.value = false; frameIndex.value = Number((e.target as HTMLInputElement).value); }} />
              <span class="num">t = {frame.t.toFixed(1)}τ · {frame.n} cells</span>
            </div>
          )}
          <div class="row">
            <label>Colour cells by
              <select value={ov.colour} onChange={(e) => { overlay.value = { ...ov, colour: (e.target as HTMLSelectElement).value as Overlay['colour'] }; }}>
                <option value="type">cell type</option><option value="gene">expression of a gene</option><option value="lineage">lineage (8-cell founders)</option><option value="pressure">mechanical pressure</option>
              </select>
            </label>
            {ov.colour === 'gene' && (
              <select value={ov.gene} aria-label="gene" onChange={(e) => { overlay.value = { ...ov, gene: Number((e.target as HTMLSelectElement).value) }; }}>
                {grn.names.map((n, i) => <option value={i}>{n}</option>)}
              </select>
            )}
            <label>Field
              <select value={ov.field ?? ''} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; overlay.value = { ...ov, field: v === '' ? null : Number(v) }; }}>
                <option value="">none</option>
                {morphNames.map((n, m) => <option value={m}>{n}</option>)}
              </select>
            </label>
            <label><input type="checkbox" checked={ov.polarity} onChange={(e) => { overlay.value = { ...ov, polarity: (e.target as HTMLInputElement).checked }; }} /> polarity</label>
            <label><input type="checkbox" checked={ov.fit === 'grid'} onChange={(e) => { overlay.value = { ...ov, fit: (e.target as HTMLInputElement).checked ? 'grid' : 'cells' }; }} /> whole grid</label>
          </div>
          {result && <MetricsTable a={result.metrics} b={perturbedResult.value?.metrics} />}
          {comparison && (
            <p class="note">
              Compared with the wild type: {comparison.unchanged} cells unchanged, <b>{comparison.transformed} transformed into another wild-type fate</b>
              {comparison.topTransformation && ` (mostly ${comparison.topTransformation.from} → ${comparison.topTransformation.to})`}, {comparison.novel} in a novel state.
              {comparison.transformed > 0.1 * (comparison.unchanged + comparison.transformed + comparison.novel) && ' Homeotic-like: normal fates now appear where other normal fates used to be.'}
            </p>
          )}
        </section>

        <section class="panel side">
          <h2>Gene regulatory network</h2>
          <p class="muted small">Click a gene. Fill = mean expression now; green arrows activate, red bars repress; dashed = inert (that product does not bind DNA).</p>
          <GrnView genome={subject.genome} levels={levels} selected={sel} perturbed={perturbedMap} onSelect={(i) => {
            selectedGene.value = i;
            overlay.value = { ...overlay.value, colour: 'gene', gene: i };
          }} />
          {gene && (
            <div class="gene">
              <h3>{gene.name} <span class="muted">{gene.type}{gene.effector ? ` · ${gene.effector}` : ''}</span></h3>
              <p class="small num">bias {gene.bias.toFixed(2)} · rate {gene.rate.toFixed(2)} · decay {gene.decay.toFixed(2)}
                {gene.asymmetry ? ` · asymmetry ${gene.asymmetry.toFixed(2)}` : ''}
                {gene.type === 'morphogen' ? ` · D ${gene.diffusion!.toFixed(2)} · k ${gene.fieldDecay!.toFixed(3)} · L = ${Math.sqrt(gene.diffusion! / gene.fieldDecay!).toFixed(1)}ℓ` : ''}
                {gene.binding !== undefined && (gene.type === 'adhesion' || gene.type === 'contact') ? ` · binding ${gene.binding.toFixed(2)}` : ''}</p>
              <label class="small"><input type="checkbox" checked={lockedGenes.value.includes(gene.id)} onChange={(e) => {
                const on = (e.target as HTMLInputElement).checked;
                lockedGenes.value = on ? [...lockedGenes.value, gene.id] : lockedGenes.value.filter((id) => id !== gene.id);
              }} /> locked during breeding (mutations skip this gene)</label>
              <p class="small">Inputs: {gene.sites.length ? gene.sites.map((s) => `${subject.genome.genes.find((g) => g.id === s.regulator)?.name} (${s.weight > 0 ? '+' : ''}${s.weight.toFixed(1)})`).join(', ') : 'none'}</p>
              <div class="row">
                <button onClick={() => addPerturbation({ gene: gene.id, mode: 'knockout' })}>Knock out</button>
                <button onClick={() => addPerturbation({ gene: gene.id, mode: 'overexpress' })}>Overexpress</button>
                <button onClick={() => { brush.value = { ...brush.value, armed: true }; }}>Ectopic in region…</button>
              </div>
              {(brush.value.armed || brush.value.region) && (
                <div class="row small">
                  <label>radius <input type="number" min="1" max="30" value={brush.value.r} onChange={(e) => { const r = Number((e.target as HTMLInputElement).value); brush.value = { ...brush.value, r, region: brush.value.region && { ...brush.value.region, r } }; }} /></label>
                  <label>from t <input type="number" min="0" value={brush.value.from} onChange={(e) => { brush.value = { ...brush.value, from: Number((e.target as HTMLInputElement).value) }; }} /></label>
                  <button disabled={!brush.value.region} onClick={() => {
                    const r = brush.value.region!;
                    addPerturbation({ gene: gene.id, mode: 'overexpress', region: r, from: brush.value.from });
                    brush.value = { ...brush.value, region: null };
                  }}>Add ectopic expression</button>
                </div>
              )}
            </div>
          )}
          <h3>Perturbations</h3>
          {perturbations.value.length === 0 ? <p class="muted small">None. Knock out or overexpress a gene, then regrow.</p> : (
            <ul class="perts">
              {perturbations.value.map((p, k) => (
                <li>{label(p)} <button class="icon" aria-label="remove" onClick={() => { perturbations.value = perturbations.value.filter((_, j) => j !== k); }}>×</button></li>
              ))}
            </ul>
          )}
          <div class="row">
            <button class="primary" disabled={!!busy.value} onClick={regrowPerturbed}>Regrow perturbed</button>
            <button disabled={!!busy.value} onClick={growLab}>Regrow wild type</button>
          </div>
        </section>
      </div>
    </div>
  );

  function label(p: Perturbation): string {
    const name = subject!.genome.genes.find((g) => g.id === p.gene)?.name ?? `#${p.gene}`;
    const what = p.mode === 'knockout' ? 'KO' : p.mode === 'overexpress' ? (p.region ? 'ectopic' : 'OE') : `=${p.mode.level}`;
    return `${name} ${what}${p.from ? ` from t=${p.from}` : ''}`;
  }
}

function addPerturbation(p: Perturbation) {
  perturbations.value = [...perturbations.value.filter((q) => !(q.gene === p.gene && !q.region && !p.region)), p];
}

function PresetPicker() {
  return (
    <label>Preset
      <select value="" onChange={(e) => {
        const p = PRESETS.find((x) => x.id === (e.target as HTMLSelectElement).value);
        if (p) openInLab(presetSubject(p));
      }}>
        <option value="">choose…</option>
        {PRESETS.map((p) => <option value={p.id}>{p.name}</option>)}
      </select>
    </label>
  );
}

function meanLevels(frame: Frame, G: number, maxLevel: Float64Array): number[] {
  const out = new Array<number>(G).fill(0);
  for (let c = 0; c < frame.n; c++) for (let i = 0; i < G; i++) out[i] += frame.x[c * G + i];
  return out.map((v, i) => (frame.n ? v / frame.n / (maxLevel[i] || 1) : 0));
}

function stateOf(frame: Frame, grn: NonNullable<typeof labGRN.value>) {
  return { n: frame.n, px: frame.px, py: frame.py, x: frame.x, grn };
}

function MetricsTable({ a, b }: { a: NonNullable<typeof labResult.value>['metrics']; b?: NonNullable<typeof labResult.value>['metrics'] }) {
  const rows: [string, (m: typeof a) => string][] = [
    ['cells', (m) => String(m.cells)],
    ['cell types', (m) => String(m.cellTypes)],
    ['segments', (m) => (m.segments ? `${m.segments} (${m.segmentGene})` : '0')],
    ['elongation', (m) => m.elongation.toFixed(2)],
    ['pattern mirror κ', (m) => m.patternBilateral.toFixed(2)],
    ['pattern rotation κ', (m) => (m.radialOrder ? `${m.patternRadial.toFixed(2)} (${m.radialOrder}-fold)` : m.patternRadial.toFixed(2))],
  ];
  return (
    <table class="metrics">
      <thead><tr><th>final organism</th><th>wild type</th>{b && <th>perturbed</th>}</tr></thead>
      <tbody>{rows.map(([k, f]) => <tr><td>{k}</td><td class="num">{f(a)}</td>{b && <td class="num">{f(b)}</td>}</tr>)}</tbody>
    </table>
  );
}
