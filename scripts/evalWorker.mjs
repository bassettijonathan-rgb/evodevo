// Bootstrap: register tsx's loader in this worker thread, then load the TypeScript worker.
import { register } from 'tsx/esm/api';
register();
await import('./evalWorker.ts');
