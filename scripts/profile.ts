/** Profile the development of a few random founders (npx tsx --cpu-prof scripts/profile.ts). */
import { evaluate } from '../src/core/evolution/evaluate';
import { randomFounder } from '../src/core/evolution/founders';
import { Rng } from '../src/core/rng';
const rng = new Rng('profile');
let total = 0;
for (let k = 0; k < 6; k++) {
  const r = evaluate({ genome: randomFounder(rng), config: { gridNx: 64, gridNy: 64, maxCells: 200, tDev: 150 }, seed: k });
  total += r.elapsedMs;
}
console.log('total ms', total.toFixed(0));
