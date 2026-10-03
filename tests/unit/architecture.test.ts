/**
 * Dependency rule (DESIGN.md §8.1): src/core must not import anything outside
 * src/core, so the simulator runs headless in Node, workers and tests.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE = resolve(__dirname, '../../src/core');

function* tsFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* tsFiles(p);
    else if (p.endsWith('.ts')) yield p;
  }
}

describe('architecture', () => {
  it('src/core only imports from src/core', () => {
    const violations: string[] = [];
    for (const file of tsFiles(CORE)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1];
        if (!spec.startsWith('.')) { violations.push(`${relative(CORE, file)} imports package "${spec}"`); continue; }
        const target = resolve(dirname(file), spec);
        if (!target.startsWith(CORE)) violations.push(`${relative(CORE, file)} imports ${spec}`);
      }
      if (/\b(document|window)\.[a-zA-Z]/.test(src)) violations.push(`${relative(CORE, file)} touches the DOM`);
    }
    expect(violations).toEqual([]);
  });

  it('simulation, metrics and evolution use only portable math (D13)', () => {
    // Math.exp/log/sin/cos/pow/hypot… are not guaranteed bit-identical across JS engines.
    // Only analysis/ (used by tests for theory predictions) may use them.
    const offenders: string[] = [];
    for (const file of tsFiles(CORE)) {
      if (relative(CORE, file).startsWith('analysis')) continue;
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''); // strip comments
      for (const m of code.matchAll(/Math\.(exp|expm1|log|log1p|log2|log10|pow|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|hypot|cbrt)\b/g)) {
        offenders.push(`${relative(CORE, file)}: Math.${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
