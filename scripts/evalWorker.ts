/** Node worker_threads counterpart of src/workers/eval.worker.ts. */
import { parentPort } from 'node:worker_threads';
import { evaluate } from '../src/core/evolution/evaluate';

parentPort!.on('message', (msg: { id: number; job: Parameters<typeof evaluate>[0] }) => {
  parentPort!.postMessage({ id: msg.id, result: evaluate(msg.job) });
});
