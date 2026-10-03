/**
 * Breeding page: interactive selection (Dawkins biomorphs / Picbreeder) and
 * target selection on shape metrics.
 */
import type { NumericMetric } from '../core/evolution/population';
import { PRESETS } from '../presets';
import {
  autoRunning, breedNext, breedPreset, busy, chosen, evolution, fitnessHistory, fitnessTerms, individualSubject,
  mutationScale, openInLab, population, runTargetSelection, startBreeding, toggleChosen,
} from './state';
import { Thumb } from './Thumb';
import { useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { loadSavedSession } from './session';
import { lockedGenes, resumeSession } from './state';

const savedSession = signal<{ generation: number; savedAt: number } | null>(null);
import { Sparkline } from './Sparkline';

const BREEDABLE = PRESETS.filter((p) => !p.initial);
const METRIC_LABELS: Record<NumericMetric, string> = {
  cells: 'cells', area: 'area', cellTypes: 'cell types', typeEntropy: 'type entropy', elongation: 'elongation',
  shapeBilateral: 'shape mirror symmetry', patternBilateral: 'pattern mirror symmetry (κ)',
  patternRadial: 'pattern rotational symmetry (κ)', radialOrder: 'rotational order', patternIsotropy: 'pattern isotropy (κ at 37°)', segments: 'segments',
};

export function Breed() {
  const evo = evolution.value;
  const pop = population.value;
  useEffect(() => {
    if (!evolution.value) void loadSavedSession().then((s) => { savedSession.value = s ? { generation: s.meta.generation, savedAt: s.meta.savedAt } : null; });
  }, []);
  return (
    <div class="breed">
      <section class="panel controls">
        <div class="row">
          <label>Start from
            <select value={breedPreset.value.id} onChange={(e) => { breedPreset.value = BREEDABLE.find((p) => p.id === (e.target as HTMLSelectElement).value)!; }}>
              {BREEDABLE.map((p) => <option value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <button onClick={() => startBreeding(breedPreset.value)} disabled={!!busy.value}>{evo ? 'Restart' : 'Start'}</button>
          {!evo && savedSession.value && (
            <button onClick={() => resumeSession()} disabled={!!busy.value}>
              Resume saved session (generation {savedSession.value.generation}, {new Date(savedSession.value.savedAt).toLocaleString()})
            </button>
          )}
          <span class="muted">{breedPreset.value.description}</span>
        </div>
        {evo && (
          <div class="row">
            <span>Generation <b>{evo.generation}</b></span>
            <label>Mutation strength
              <input type="range" min="0.25" max="4" step="0.25" value={mutationScale.value}
                onInput={(e) => { mutationScale.value = Number((e.target as HTMLInputElement).value); }} />
              <span class="num">{mutationScale.value.toFixed(2)}×</span>
            </label>
            <button class="primary" onClick={breedNext} disabled={!chosen.value.length || !!busy.value}>
              Breed {chosen.value.length === 2 ? 'the pair (crossover)' : 'selected'}
            </button>
            {lockedGenes.value.length > 0 && (
              <span class="muted small">{lockedGenes.value.length} gene{lockedGenes.value.length > 1 ? 's' : ''} locked <button class="icon" onClick={() => { lockedGenes.value = []; }}>unlock all</button></span>
            )}
            <button disabled={chosen.value.length !== 1 || !!busy.value} onClick={() => {
              const ind = pop.find((i) => i.id === chosen.value[0])!;
              openInLab(individualSubject(ind, evo.settings.sim, evo.seedFor(ind)));
            }}>Inspect in lab</button>
          </div>
        )}
        {busy.value && <div class="busy" role="status">{busy.value}</div>}
      </section>

      {evo && (
        <section class="grid" aria-label="population">
          {pop.map((ind) => {
            const m = ind.result?.metrics;
            const on = chosen.value.includes(ind.id);
            return (
              <button class={`card ${on ? 'chosen' : ''}`} onClick={() => toggleChosen(ind.id)} aria-pressed={on} key={ind.id}>
                {ind.result ? <Thumb snap={ind.result.final} /> : <div class="placeholder" />}
                <div class="caption">
                  <span>#{ind.id}</span>
                  {m && <span class="muted">{m.cells} cells · {m.cellTypes} types{m.segments ? ` · ${m.segments} seg` : ''}</span>}
                  {ind.fitness !== undefined && evo.settings.objective.kind === 'weighted' && <span class="muted">fitness {ind.fitness.toFixed(3)}</span>}
                </div>
              </button>
            );
          })}
        </section>
      )}

      {evo && (
        <section class="panel">
          <h2>Target selection</h2>
          <p class="muted">Run generations automatically with a fitness built from shape metrics. Starts from the selected organisms (or the whole brood).</p>
          <table class="terms">
            <thead><tr><th>metric</th><th>mode</th><th>target</th><th>weight</th><th /></tr></thead>
            <tbody>
              {fitnessTerms.value.map((t, k) => (
                <tr key={k}>
                  <td><select value={t.metric} onChange={(e) => updateTerm(k, { metric: (e.target as HTMLSelectElement).value as NumericMetric })}>
                    {Object.entries(METRIC_LABELS).map(([m, l]) => <option value={m}>{l}</option>)}
                  </select></td>
                  <td><select value={t.mode} onChange={(e) => updateTerm(k, { mode: (e.target as HTMLSelectElement).value as 'maximize' | 'match' })}>
                    <option value="maximize">reach at least</option><option value="match">match</option>
                  </select></td>
                  <td><input type="number" value={t.target} step="any" onChange={(e) => updateTerm(k, { target: Number((e.target as HTMLInputElement).value) })} /></td>
                  <td><input type="number" value={t.weight} step="0.1" min="0" onChange={(e) => updateTerm(k, { weight: Number((e.target as HTMLInputElement).value) })} /></td>
                  <td><button class="icon" aria-label="remove term" onClick={() => { fitnessTerms.value = fitnessTerms.value.filter((_, j) => j !== k); }}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div class="row">
            <button onClick={() => { fitnessTerms.value = [...fitnessTerms.value, { metric: 'segments', mode: 'maximize', target: 4, weight: 1 }]; }}>Add term</button>
            {autoRunning.value
              ? <button onClick={() => { autoRunning.value = false; }}>Stop</button>
              : <><button class="primary" disabled={!!busy.value} onClick={() => runTargetSelection(20)}>Run 20 generations</button>
                 <button disabled={!!busy.value} onClick={() => runTargetSelection(100)}>Run 100</button></>}
            {fitnessHistory.value.length > 1 && <Sparkline values={fitnessHistory.value} label="best fitness" />}
          </div>
        </section>
      )}
    </div>
  );
}

function updateTerm(k: number, patch: Partial<(typeof fitnessTerms.value)[number]>) {
  fitnessTerms.value = fitnessTerms.value.map((t, j) => (j === k ? { ...t, ...patch } : t));
}
