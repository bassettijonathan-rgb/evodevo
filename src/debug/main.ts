/**
 * M1 debug page: plot single-cell GRN time series for the preset circuits.
 * Throwaway scaffolding until the real UI (M5).
 */
import { oscillationStats } from '../core/analysis/timeseries';
import type { Genome } from '../core/genome/types';
import { simulateSingleCell } from '../core/sim/singleCell';
import { autoActivator, constitutive, repressilator, toggleSwitch } from '../presets/circuits';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const circuitSel = $<HTMLSelectElement>('circuit');
const wInput = $<HTMLInputElement>('w');
const noiseInput = $<HTMLInputElement>('noise');
const seedInput = $<HTMLInputElement>('seed');
const canvas = $<HTMLCanvasElement>('plot');
const stats = $<HTMLDivElement>('stats');

const COLORS = ['#2a78d6', '#d6532a', '#2aa15a', '#9a4fd6'];

function genomeFor(kind: string, w: number): { genome: Genome; initial: Record<number, number> } {
  switch (kind) {
    case 'toggle': return { genome: toggleSwitch(w), initial: { 0: 0.55, 1: 0.45 } };
    case 'auto': return { genome: autoActivator(w, -w / 2), initial: { 0: 0.3 } };
    case 'constitutive': return { genome: constitutive(w / 5 - 2, 1, 1), initial: {} };
    default: return { genome: repressilator(w), initial: { 0: 0.6, 1: 0.5, 2: 0.4 } };
  }
}

function draw(): void {
  const w = Number(wInput.value);
  const noise = Number(noiseInput.value);
  $('wv').textContent = w.toFixed(1);
  $('nv').textContent = noise.toFixed(3);
  const { genome, initial } = genomeFor(circuitSel.value, w);
  const ts = simulateSingleCell(genome, {
    tEnd: 60, initial, seed: Number(seedInput.value), config: { dt: 0.02, expressionNoise: noise },
  });

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const pad = { l: 40, r: 24, t: 10, b: 24 };
  const tMax = ts.t[ts.length - 1];
  const sx = (t: number) => pad.l + (t / tMax) * (W - pad.l - pad.r);
  const sy = (x: number) => H - pad.b - x * (H - pad.t - pad.b);

  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = css.getPropertyValue('--grid');
  ctx.fillStyle = css.getPropertyValue('--muted');
  ctx.font = '11px system-ui';
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    ctx.beginPath(); ctx.moveTo(pad.l, sy(v)); ctx.lineTo(W - pad.r, sy(v)); ctx.stroke();
    ctx.fillText(v.toFixed(2), 4, sy(v) + 4);
  }
  for (let t = 0; t <= tMax; t += 10) ctx.fillText(`${t}τ`, sx(t) - 8, H - 6);

  ts.grn.names.forEach((name, i) => {
    const y = ts.gene(i);
    ctx.strokeStyle = COLORS[i % COLORS.length];
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k < ts.length; k++) (k ? ctx.lineTo : ctx.moveTo).call(ctx, sx(ts.t[k]), sy(y[k]));
    ctx.stroke();
    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.fillText(name, W - pad.r - 40 + i * 12, pad.t + 12);
  });

  const s = oscillationStats(ts.t, ts.gene(0), 30);
  stats.textContent =
    `final state: ${Array.from(ts.final()).map((v) => v.toFixed(3)).join(', ')}` +
    (s.amplitude > 1e-3 && s.peaks > 2 ? ` · period ${s.period.toFixed(2)}τ, amplitude ${s.amplitude.toFixed(3)}` : '');
}

for (const el of [circuitSel, wInput, noiseInput, seedInput]) el.addEventListener('input', draw);
window.addEventListener('resize', draw);
draw();
