// Unit tests run from source, so they cannot notice code a bundler drops from the published files.
// Function modules register themselves on import, which makes them easy to lose that way.
import { readdirSync, readFileSync } from 'node:fs';

const REQUIRED = ['SUM', 'XLOOKUP', 'SUMIFS', 'TEXT', 'SORT', 'UNIQUE', 'FILTER', 'TODAY', 'MEDIAN', 'IFS'];

const lib = await import(new URL('../dist/cenitu-table.js', import.meta.url));
const names = lib.getRegisteredFunctionNames();
const missing = REQUIRED.filter((n) => !names.includes(n));
if (missing.length) throw new Error(`Missing from dist: ${missing.join(', ')}`);

const engine = lib.FormulaEngine.buildFromArray([['b'], ['a'], ['=SORT(A1:A2)']]);
if (engine.getCellValue({ row: 2, col: 0 }) !== 'a') throw new Error('SORT does not work in dist');

const assets = new URL('../demo-dist/assets/', import.meta.url);
const demo = readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => readFileSync(new URL(f, assets), 'utf8')).join('');
const lost = REQUIRED.filter((n) => !demo.includes(n));
if (lost.length) throw new Error(`Missing from demo build: ${lost.join(', ')}`);

console.log(`dist OK: ${names.length} functions`);
