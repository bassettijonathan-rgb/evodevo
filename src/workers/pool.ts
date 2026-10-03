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

/** A pool of browser Web Workers (one per spare core by default). */
export function browserPool(size = Math.max(1, (navigator.hardwareConcurrency || 4) - 1)): EvalPool {
  const workers: WorkerLike[] = Array.from({ length: size }, () => {
    const w = new Worker(new URL('./eval.worker.ts', import.meta.url), { type: 'module' });
    return {
      postMessage: (m) => w.postMessage(m),
      onMessage: (h) => { w.onmessage = (e) => h(e.data); },
      terminate: () => w.terminate(),
    };
  });
  return new EvalPool(workers);
}
