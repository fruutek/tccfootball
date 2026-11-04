import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

describe('browser bundle hygiene', () => {
  // zod is a build/CLI-time dependency. The browser may import TYPES from schema.ts (erased at build),
  // but never VALUES — a value import would ship the whole of zod to every visitor.
  it('nothing the website imports takes a runtime value from shared/schema.ts', () => {
    const offenders: string[] = [];
    for (const file of walk('src').filter((f) => !f.endsWith('src/shared/schema.ts'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/^import\s+(?!type\b)([^;]*?)\s+from\s+['"]([^'"]*\/schema)['"]/gms)) {
        // `import { type A, type B }` is fine; anything that names a value is not.
        const names = m[1]!.replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
        if (names.some((n) => !n.startsWith('type '))) offenders.push(`${file}: ${m[0].replace(/\s+/g, ' ')}`);
      }
      for (const m of src.matchAll(/^export\s+(?!type\b)[^;]*?\s+from\s+['"]([^'"]*\/schema)['"]/gms)) {
        offenders.push(`${file}: ${m[0].replace(/\s+/g, ' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the website does not import the admin SDK or the CLI', () => {
    const bad = walk('src').filter((f) => /firebase-admin|\.\.\/cli\/|\.\.\/\.\.\/cli\//.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
