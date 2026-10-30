// The package is ESM, so TypeScript's node16/nodenext resolution requires file extensions on
// relative imports in .d.ts files; tsc emits them exactly as the (bundler-style) source has them.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/types/', import.meta.url));

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    return e.isDirectory() ? files(path) : e.name.endsWith('.d.ts') ? [path] : [];
  });
}

const RELATIVE = /(from\s+|import\()(['"])(\.{1,2}\/[^'"]+)\2/g;
for (const file of files(root)) {
  const text = readFileSync(file, 'utf8').replace(RELATIVE, (match, lead, quote, spec) => {
    const base = join(dirname(file), spec);
    if (existsSync(`${base}.d.ts`)) return `${lead}${quote}${spec}.js${quote}`;
    if (existsSync(join(base, 'index.d.ts'))) return `${lead}${quote}${spec}/index.js${quote}`;
    return match;
  });
  writeFileSync(file, text);
}
