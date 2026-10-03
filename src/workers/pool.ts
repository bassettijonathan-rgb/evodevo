/**
 * A pool of evaluation workers. `evaluate(jobs)` resolves with results in job
 * order, whatever order the workers finish in. Works with browser Web Workers;
 * the Node experiment runner (scripts/) uses the same protocol with worker_threads.
 */
import type { EvalJob, EvalResult } from '../core/evolution/evaluate';

/** The subset of the Worker interface the pool needs (Web Worker or an adapter). */
export interface WorkerLike {
  postMessage(msg: unknown): void;
  onMessage(handler: (msg: { id: number; result: EvalResult }) => void): void;
  terminate(): void;
}

export class EvalPool {
  private readonly idle: WorkerLike[] = [];
  private readonly queue: { id: number; job: EvalJob }[] = [];
  private readonly pending = new Map<number, (r: EvalResult) => void>();
  private nextId = 0;

  constructor(private readonly workers: WorkerLike[]) {
    for (const w of workers) {
      w.onMessage(({ id, result }) => {
        this.pending.get(id)?.(result);
        this.pending.delete(id);
        this.idle.push(w);
        this.pump();
      });
      this.idle.push(w);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) this.idle.pop()!.postMessage(this.queue.shift()!);
  }

  evaluate(jobs: EvalJob[]): Promise<EvalResult[]> {
    return Promise.all(
      jobs.map((job) => new Promise<EvalResult>((resolve) => {
        const id = this.nextId++;
        this.pending.set(id, resolve);
        this.queue.push({ id, job });
        this.pump();
      })),
    );
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
  }
}

/**
 * A "worker" that runs jobs on the main thread. Slower and it blocks the page
 * while a job runs, but it works where Web Workers are unavailable.
 */
function mainThreadWorker(evaluate: (job: EvalJob) => EvalResult): WorkerLike {
  let handler: ((msg: { id: number; result: EvalResult }) => void) | null = null;
  return {
    postMessage: (m) => {
      const { id, job } = m as { id: number; job: EvalJob };
      setTimeout(() => handler?.({ id, result: evaluate(job) }), 0);
    },
    onMessage: (h) => { handler = h; },
    terminate: () => {},
  };
}

/**
 * A Web Worker that falls back to the main thread if the worker cannot be
 * created or fails to load (e.g. a host that blocks workers); the job that was
 * in flight is re-run on the fallback.
 */
function resilientWorker(evaluate: (job: EvalJob) => EvalResult, onFallback: () => void): WorkerLike {
  let handler: ((msg: { id: number; result: EvalResult }) => void) | null = null;
  let fallback: WorkerLike | null = null;
  let inflight: unknown = null;
  let worker: Worker | null = null;
  const useFallback = () => {
    if (fallback) return;
    fallback = mainThreadWorker(evaluate);
    if (handler) fallback.onMessage(handler);
    worker?.terminate();
    onFallback();
    if (inflight) fallback.postMessage(inflight);
  };
  try {
    worker = new Worker(new URL('./eval.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { inflight = null; handler?.(e.data); };
    worker.onerror = (e) => { e.preventDefault(); useFallback(); };
  } catch {
    useFallback();
  }
  return {
    postMessage: (m) => {
      if (fallback) fallback.postMessage(m);
      else { inflight = m; worker!.postMessage(m); }
    },
    onMessage: (h) => { handler = h; fallback?.onMessage(h); },
    terminate: () => worker?.terminate(),
  };
}

/** True once any worker had to fall back to the main thread. */
export let workersUnavailable = false;

/** A pool of browser Web Workers (one per spare core by default). */
export function browserPool(evaluate: (job: EvalJob) => EvalResult, size = Math.max(1, (navigator.hardwareConcurrency || 4) - 1)): EvalPool {
  const workers = Array.from({ length: size }, () => resilientWorker(evaluate, () => { workersUnavailable = true; }));
  return new EvalPool(workers);
}
