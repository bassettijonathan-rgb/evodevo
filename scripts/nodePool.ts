/** EvalPool backed by Node worker threads (each worker runs TypeScript through tsx). */
import { cpus } from 'node:os';
import { Worker } from 'node:worker_threads';
import { EvalPool, type WorkerLike } from '../src/workers/pool';

export function nodePool(size = cpus().length): EvalPool {
  const file = new URL('./evalWorker.mjs', import.meta.url);
  const workers: WorkerLike[] = Array.from({ length: size }, () => {
    const w = new Worker(file);
    return {
      postMessage: (m) => w.postMessage(m),
      onMessage: (h) => { w.on('message', h); },
      terminate: () => { void w.terminate(); },
    };
  });
  return new EvalPool(workers);
}
