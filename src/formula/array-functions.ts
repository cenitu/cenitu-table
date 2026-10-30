import { asArray, transpose } from './arrays';
import { MAX_COLS, MAX_ROWS } from './address';
import { compare, toBool, toNumber, toScalar } from './coerce';
import { registerFunction } from './functions';
import { CellError, err, isError, normalizeNumber, RangeValue, type CellValue, type Value } from './values';

const calcError = (): CellError => err('#CALC!', 'The result is an empty array');

/** Optional numeric argument; missing or skipped (`SORT(a,,-1)`) gives the default. */
function optionalNumber(args: Value[], i: number, fallback: number): number | CellError {
  if (args.length <= i || args[i] === null) return fallback;
  const n = toNumber(toScalar(args[i]));
  return isError(n) ? n : Math.trunc(n);
}

function optionalBool(args: Value[], i: number): boolean | CellError {
  return args.length <= i || args[i] === null ? false : toBool(toScalar(args[i]));
}

/** Rows of `v`, or its columns (as rows) when `byCol`; `rebuild` turns the chosen rows back into a block. */
function lines(v: RangeValue, byCol: boolean): { rows: CellValue[][]; rebuild: (rows: CellValue[][]) => RangeValue } {
  if (!byCol) return { rows: v.values, rebuild: (rows) => new RangeValue(rows) };
  return { rows: transpose(v).values, rebuild: (rows) => transpose(new RangeValue(rows)) };
}

/** Total order for sorting: numbers < text < booleans < errors; blanks count as 0. */
function sortCompare(a: CellValue, b: CellValue): number {
  const x = a ?? 0;
  const y = b ?? 0;
  const ex = isError(x);
  const ey = isError(y);
  if (ex || ey) return ex && ey ? 0 : ex ? 1 : -1;
  return compare(x, y);
}

/** FILTER(array, include, [if_empty]): rows (or columns) whose include value is true. */
registerFunction('FILTER', { minArgs: 2, maxArgs: 3, impl: (args) => {
  const array = asArray(args[0]);
  const include = asArray(args[1]);
  let byCol: boolean;
  if (include.width === 1 && include.height === array.height) byCol = false;
  else if (include.height === 1 && include.width === array.width) byCol = true;
  else return err('#VALUE!', 'FILTER include must match the array height or width');
  const keep = [...include.flat()];
  const { rows, rebuild } = lines(array, byCol);
  const out: CellValue[][] = [];
  for (let i = 0; i < rows.length; i++) {
    const v = keep[i];
    if (typeof v === 'string') return err('#VALUE!');
    const b = toBool(v);
    if (isError(b)) return b;
    if (b) out.push(rows[i]);
  }
  if (out.length === 0) return args.length > 2 ? args[2] : calcError();
  return rebuild(out);
} });

function checkOrder(order: number | CellError): number | CellError {
  return isError(order) || order === 1 || order === -1 ? order : err('#VALUE!', 'Sort order must be 1 or -1');
}

/** Stable sort of `rows` by the given keys (one key array per criterion, parallel to `rows`). */
function sortRows(rows: CellValue[][], keys: { values: CellValue[]; order: number }[]): CellValue[][] {
  const index = rows.map((_, i) => i);
  index.sort((i, j) => {
    for (const k of keys) {
      const c = sortCompare(k.values[i], k.values[j]);
      if (c !== 0) return c * k.order;
    }
    return i - j;
  });
  return index.map((i) => rows[i]);
}

/** SORT(array, [sort_index], [sort_order], [by_col]). */
registerFunction('SORT', { minArgs: 1, maxArgs: 4, impl: (args) => {
  const array = asArray(args[0]);
  const index = optionalNumber(args, 1, 1);
  const order = checkOrder(optionalNumber(args, 2, 1));
  const byCol = optionalBool(args, 3);
  if (isError(index)) return index;
  if (isError(order)) return order;
  if (isError(byCol)) return byCol;
  const { rows, rebuild } = lines(array, byCol);
  if (index < 1 || index > (rows[0]?.length ?? 0)) return err('#VALUE!', 'Sort index out of range');
  return rebuild(sortRows(rows, [{ values: rows.map((r) => r[index - 1]), order }]));
} });

/** SORTBY(array, by_array1, [order1], by_array2, [order2], ...). */
registerFunction('SORTBY', { minArgs: 2, impl: (args) => {
  const array = asArray(args[0]);
  let byCol: boolean | undefined;
  const keys: { values: CellValue[]; order: number }[] = [];
  for (let i = 1; i < args.length; i += 2) {
    const by = asArray(args[i]);
    const col = by.height === 1 && by.width === array.width && !(by.width === 1 && by.height === array.height);
    const fits = col || (by.width === 1 && by.height === array.height);
    if (!fits || (byCol !== undefined && byCol !== col)) return err('#VALUE!', 'SORTBY arrays must match the array');
    byCol = col;
    const order = checkOrder(optionalNumber(args, i + 1, 1));
    if (isError(order)) return order;
    keys.push({ values: [...by.flat()], order });
  }
  const { rows, rebuild } = lines(array, byCol ?? false);
  return rebuild(sortRows(rows, keys));
} });

/** Identity of a value for UNIQUE: case-insensitive text, blanks equal to 0 (as they display). */
function keyOf(v: CellValue): string {
  if (v === null) return 'n:0';
  if (isError(v)) return 'e:' + v.code;
  if (typeof v === 'string') return 's:' + v.toLowerCase();
  return (typeof v === 'number' ? 'n:' : 'b:') + String(v);
}

/** UNIQUE(array, [by_col], [exactly_once]). */
registerFunction('UNIQUE', { minArgs: 1, maxArgs: 3, impl: (args) => {
  const byCol = optionalBool(args, 1);
  const once = optionalBool(args, 2);
  if (isError(byCol)) return byCol;
  if (isError(once)) return once;
  const { rows, rebuild } = lines(asArray(args[0]), byCol);
  const seen = new Map<string, { row: CellValue[]; count: number }>();
  for (const row of rows) {
    const key = row.map(keyOf).join('\u0000');
    const entry = seen.get(key);
    if (entry) entry.count++;
    else seen.set(key, { row, count: 1 });
  }
  const out = [...seen.values()].filter((e) => !once || e.count === 1).map((e) => e.row);
  return out.length ? rebuild(out) : calcError();
} });

/** SEQUENCE(rows, [columns], [start], [step]). */
registerFunction('SEQUENCE', { minArgs: 1, maxArgs: 4, impl: (args) => {
  const rows = optionalNumber(args, 0, 1);
  const cols = optionalNumber(args, 1, 1);
  if (isError(rows)) return rows;
  if (isError(cols)) return cols;
  const start = args.length > 2 && args[2] !== null ? toNumber(toScalar(args[2])) : 1;
  const step = args.length > 3 && args[3] !== null ? toNumber(toScalar(args[3])) : 1;
  if (isError(start)) return start;
  if (isError(step)) return step;
  if (rows < 0 || cols < 0 || rows > MAX_ROWS || cols > MAX_COLS) return err('#VALUE!');
  if (rows === 0 || cols === 0) return calcError();
  if (rows * cols > MAX_ROWS) return err('#NUM!', 'SEQUENCE is too large');
  return new RangeValue(
    Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => normalizeNumber(start + step * (r * cols + c)))),
  );
} });

registerFunction('TRANSPOSE', { minArgs: 1, maxArgs: 1, impl: ([a]) => (a instanceof RangeValue ? transpose(a) : a) });
