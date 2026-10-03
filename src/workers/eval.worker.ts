/**
 * Browser Web Worker: grows and measures organisms off the main thread.
 */
import { evaluate, type EvalJob } from '../core/evolution/evaluate';

interface Request { id: number; job: EvalJob }

self.onmessage = (e: MessageEvent<Request>) => {
  const result = evaluate(e.data.job);
  const f = result.final;
  // Transfer the big buffers instead of copying them.
  const transfer: Transferable[] = [f.px.buffer, f.py.buffer, f.typeOf.buffer, f.x.buffer];
  (self as unknown as Worker).postMessage({ id: e.data.id, result }, transfer);
};
