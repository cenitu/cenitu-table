import { isArray, mapArrays } from './arrays';
import type { Ast } from './ast';
import { compare, toBool, toNumber, toScalar, toText } from './coerce';
import { CellError, err, isError, normalizeNumber, parseLiteral, RangeValue, type CellValue, type Value } from './values';

/** Position and size of a referenced block of cells. */
export interface Reference {
  sheet: number;
  row: number;
  col: number;
  height: number;
  width: number;
}

export interface FunctionContext {
  evaluate(node: Ast): Value;
  /** The cell being evaluated (row 0 / col 0 outside cells, e.g. calculateFormula and names). */
  readonly sheet: number;
  readonly row: number;
  readonly col: number;
  /** Where a reference argument points; undefined when the argument is not a reference. */
  reference(node: Ast): Reference | undefined;
}

export type FunctionImpl = (args: Value[], ctx: FunctionContext) => Value;
/** Receives unevaluated arguments; used for short-circuiting functions such as IF. */
export type LazyFunctionImpl = (args: Ast[], ctx: FunctionContext) => Value;

export interface FunctionDefinition {
  impl?: FunctionImpl;
  lazy?: LazyFunctionImpl;
  minArgs?: number;
  maxArgs?: number;
  /** Single-cell references are passed as 1x1 ranges (text and blanks in them are skipped). */
  aggregate?: boolean;
  /** Result changes without any input changing (TODAY, RAND): re-evaluated on every recalculation. */
  volatile?: boolean;
  /** Result depends on the formula's own position (ROW, COLUMN): re-evaluated when it moves. */
  positional?: boolean;
}

const registry = new Map<string, FunctionDefinition>();

export function registerFunction(name: string, def: FunctionDefinition | FunctionImpl): void {
  const d = typeof def === 'function' ? { impl: def } : def;
  registry.set(name.toUpperCase(), withArity(name.toUpperCase(), d));
}

export function unregisterFunction(name: string): void {
  registry.delete(name.toUpperCase());
}

export const getFunction = (name: string): FunctionDefinition | undefined => registry.get(name.toUpperCase());
export const getRegisteredFunctionNames = (): string[] => [...registry.keys()].sort();

function withArity(name: string, d: FunctionDefinition): FunctionDefinition {
  const { minArgs = 0, maxArgs = Infinity } = d;
  const check = (n: number): CellError | undefined =>
    n < minArgs || n > maxArgs ? err('#VALUE!', `Wrong number of arguments to ${name}`) : undefined;
  return {
    ...d,
    impl: d.impl && ((args, ctx) => check(args.length) ?? d.impl!(args, ctx)),
    lazy: d.lazy && ((args, ctx) => check(args.length) ?? d.lazy!(args, ctx)),
  };
}

// ---------- helpers ----------

export const scalarNumber = (v: Value): number | CellError => toNumber(toScalar(v));

/**
 * Collects numbers the way aggregate functions do: inside ranges only real numbers count
 * (text, booleans and blanks are skipped); direct arguments are coerced.
 */
export function collectNumbers(args: Value[]): number[] | CellError {
  const out: number[] = [];
  for (const a of args) {
    if (a instanceof RangeValue) {
      for (const v of a.flat()) {
        if (isError(v)) return v;
        if (typeof v === 'number') out.push(v);
      }
    } else {
      if (a === null) continue;
      const n = toNumber(a);
      if (isError(n)) return n;
      out.push(n);
    }
  }
  return out;
}

/** Number-to-number function; array arguments are mapped element-wise. */
export function numeric(fn: (...n: number[]) => number | CellError): FunctionImpl {
  return (args) =>
    mapArrays(args, (...values) => {
      const nums: number[] = [];
      for (const v of values) {
        const n = toNumber(v);
        if (isError(n)) return n;
        nums.push(n);
      }
      const r = fn(...nums);
      return isError(r) ? r : Number.isFinite(r) ? normalizeNumber(r) : err('#NUM!');
    });
}

/** Text function; array arguments are mapped element-wise. */
function text(fn: (...s: string[]) => CellValue): FunctionImpl {
  return (args) =>
    mapArrays(args, (...values) => {
      const strs: string[] = [];
      for (const v of values) {
        const s = toText(v);
        if (isError(s)) return s;
        strs.push(s);
      }
      return fn(...strs);
    });
}

const asRange = (v: Value): RangeValue => (v instanceof RangeValue ? v : new RangeValue([[v]]));

/** Neumaier compensated summation: keeps long columns of decimals from accumulating rounding noise. */
export class Accumulator {
  private sum = 0;
  private comp = 0;
  add(x: number): void {
    const t = this.sum + x;
    this.comp += Math.abs(this.sum) >= Math.abs(x) ? this.sum - t + x : x - t + this.sum;
    this.sum = t;
  }
  get value(): number {
    return this.sum + this.comp;
  }
}

export const sumOf = (nums: number[]): number => {
  const acc = new Accumulator();
  nums.forEach((n) => acc.add(n));
  return acc.value;
};

/** Rounds half away from zero, like spreadsheets do. */
function roundTo(x: number, digits: number): number {
  const f = Math.pow(10, Math.trunc(digits));
  return normalizeNumber((Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9)) / f);
}

/**
 * Pattern with spreadsheet wildcards (`*` any run, `?` one character, `~` escapes the next one)
 * as a case-insensitive RegExp; `whole` anchors it to the entire text.
 */
export function wildcardRegExp(pattern: string, whole = true): RegExp {
  let src = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '~' && i + 1 < pattern.length) src += escapeRegExp(pattern[++i]);
    else if (ch === '*') src += '[\\s\\S]*';
    else if (ch === '?') src += '[\\s\\S]';
    else src += escapeRegExp(ch);
  }
  return new RegExp(whole ? `^${src}$` : src, 'i');
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

export const hasWildcards = (s: string): boolean => /[*?~]/.test(s);

/** Parses criteria such as ">5", "<>apple", "a*" used by SUMIF/COUNTIF and the *IFS functions. */
export function makeCriterion(criterion: CellValue): (v: CellValue) => boolean {
  if (typeof criterion !== 'string') {
    return (v) => v !== null && !isError(v) && compare(v, criterion) === 0;
  }
  const m = /^(<=|>=|<>|=|<|>)?(.*)$/s.exec(criterion)!;
  const op = m[1] ?? '=';
  const operand = parseLiteral(m[2]);
  if (operand === null) {
    return op === '<>' ? (v) => v !== null && v !== '' : (v) => v === null || v === '';
  }
  if (typeof operand === 'string' && (op === '=' || op === '<>') && hasWildcards(operand)) {
    const re = wildcardRegExp(operand);
    return op === '=' ? (v) => typeof v === 'string' && re.test(v) : (v) => !(typeof v === 'string' && re.test(v));
  }
  return (v) => {
    if (isError(v)) return false;
    // Ordering comparisons only match values of the same kind (">5" never matches text).
    if (op !== '=' && op !== '<>' && (v === null || typeof v !== typeof operand)) return false;
    if (op === '=' && v === null) return false;
    const c = compare(v, operand);
    switch (op) {
      case '=': return c === 0;
      case '<>': return c !== 0;
      case '<': return c < 0;
      case '<=': return c <= 0;
      case '>': return c > 0;
      default: return c >= 0;
    }
  };
}

/** Approximate match: index of the largest value <= target in ascending data (binary search). */
function approximateIndex(values: CellValue[], target: CellValue): number {
  let lo = 0;
  let hi = values.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = values[mid];
    if (v === null || compare(v, target) <= 0) {
      if (v !== null && (typeof v === typeof target)) found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

function exactIndex(values: CellValue[], target: CellValue): number {
  const matches = typeof target === 'string' ? makeCriterion('=' + target) : undefined;
  return values.findIndex((v) => (matches ? matches(v) : v !== null && !isError(v) && compare(v, target) === 0));
}

function lookup(args: Value[], vertical: boolean): Value {
  const target = toScalar(args[0]);
  if (isError(target)) return target;
  const table = asRange(args[1]);
  const index = scalarNumber(args[2]);
  if (isError(index)) return index;
  const approx = args.length > 3 ? toBool(toScalar(args[3])) : true;
  if (isError(approx)) return approx;
  const span = vertical ? table.width : table.height;
  const i = Math.trunc(index);
  if (i < 1) return err('#VALUE!');
  if (i > span) return err('#REF!');
  const keys = vertical ? table.values.map((r) => r[0]) : table.values[0];
  const pos = approx ? approximateIndex(keys, target) : exactIndex(keys, target);
  if (pos < 0) return err('#N/A');
  return vertical ? table.values[pos][i - 1] : table.values[i - 1][pos];
}

function conditional(args: Value[], reduce: 'sum' | 'count' | 'average'): Value {
  const range = asRange(args[0]);
  const criterion = toScalar(args[1]);
  if (isError(criterion)) return criterion;
  const values = args[2] !== undefined ? asRange(args[2]) : range;
  const test = makeCriterion(criterion);
  const sum = new Accumulator();
  let count = 0;
  for (let r = 0; r < range.height; r++) {
    for (let c = 0; c < range.width; c++) {
      if (!test(range.values[r][c])) continue;
      if (reduce === 'count') {
        count++;
        continue;
      }
      const v = values.values[r]?.[c] ?? null;
      if (isError(v)) return v;
      if (typeof v === 'number') {
        sum.add(v);
        count++;
      }
    }
  }
  if (reduce === 'count') return count;
  if (reduce === 'sum') return normalizeNumber(sum.value);
  return count === 0 ? err('#DIV/0!') : normalizeNumber(sum.value / count);
}

// ---------- built-in functions ----------

registerFunction('SUM', { aggregate: true, impl: (args) => {
  const nums = collectNumbers(args);
  return isError(nums) ? nums : normalizeNumber(sumOf(nums));
} });

registerFunction('AVERAGE', { minArgs: 1, aggregate: true, impl: (args) => {
  const nums = collectNumbers(args);
  if (isError(nums)) return nums;
  return nums.length === 0 ? err('#DIV/0!') : normalizeNumber(sumOf(nums) / nums.length);
} });

registerFunction('MIN', { aggregate: true, impl: (args) => {
  const nums = collectNumbers(args);
  return isError(nums) ? nums : nums.length ? Math.min(...nums) : 0;
} });

registerFunction('MAX', { aggregate: true, impl: (args) => {
  const nums = collectNumbers(args);
  return isError(nums) ? nums : nums.length ? Math.max(...nums) : 0;
} });

registerFunction('COUNT', { aggregate: true, impl: (args) => {
  let n = 0;
  for (const a of args) {
    if (a instanceof RangeValue) {
      for (const v of a.flat()) if (typeof v === 'number') n++;
    } else if (a !== null && !isError(toNumber(a))) {
      n++;
    }
  }
  return n;
} });

registerFunction('COUNTA', { aggregate: true, impl: (args) => {
  let n = 0;
  for (const a of args) {
    if (a instanceof RangeValue) {
      for (const v of a.flat()) if (v !== null) n++;
    } else if (a !== null) {
      n++;
    }
  }
  return n;
} });

registerFunction('COUNTBLANK', { minArgs: 1, maxArgs: 1, impl: ([a]) => {
  let n = 0;
  for (const v of asRange(a).flat()) if (v === null || v === '') n++;
  return n;
} });

registerFunction('IF', { minArgs: 2, maxArgs: 3, lazy: (args, ctx) => {
  const test = ctx.evaluate(args[0]);
  if (isArray(test)) {
    // Array condition: both branches are evaluated and chosen element by element.
    const yes = ctx.evaluate(args[1]);
    const no = args.length > 2 ? ctx.evaluate(args[2]) : false;
    return mapArrays([test, yes, no], (c, y, n) => {
      const b = toBool(c);
      return isError(b) ? b : b ? y : n;
    });
  }
  const cond = toBool(toScalar(test));
  if (isError(cond)) return cond;
  if (cond) return ctx.evaluate(args[1]);
  return args.length > 2 ? ctx.evaluate(args[2]) : false;
} });

registerFunction('IFERROR', { minArgs: 2, maxArgs: 2, lazy: (args, ctx) => {
  const v = ctx.evaluate(args[0]);
  return isError(v) ? ctx.evaluate(args[1]) : v;
} });

registerFunction('IFNA', { minArgs: 2, maxArgs: 2, lazy: (args, ctx) => {
  const v = ctx.evaluate(args[0]);
  return isError(v) && v.code === '#N/A' ? ctx.evaluate(args[1]) : v;
} });

export function logical(args: Value[], combine: (acc: boolean, b: boolean) => boolean, initial: boolean): Value {
  let acc = initial;
  let seen = false;
  for (const a of args) {
    const values = a instanceof RangeValue ? [...a.flat()].filter((v) => typeof v !== 'string' && v !== null) : [a];
    for (const v of values) {
      const b = toBool(v);
      if (isError(b)) return b;
      acc = combine(acc, b);
      seen = true;
    }
  }
  return seen ? acc : err('#VALUE!');
}

registerFunction('AND', { minArgs: 1, aggregate: true, impl: (args) => logical(args, (a, b) => a && b, true) });
registerFunction('OR', { minArgs: 1, aggregate: true, impl: (args) => logical(args, (a, b) => a || b, false) });
registerFunction('NOT', { minArgs: 1, maxArgs: 1, impl: ([a]) => {
  const b = toBool(toScalar(a));
  return isError(b) ? b : !b;
} });

registerFunction('ABS', { minArgs: 1, maxArgs: 1, impl: numeric(Math.abs) });
registerFunction('INT', { minArgs: 1, maxArgs: 1, impl: numeric(Math.floor) });
registerFunction('SQRT', { minArgs: 1, maxArgs: 1, impl: numeric(Math.sqrt) });
registerFunction('POWER', { minArgs: 2, maxArgs: 2, impl: numeric(Math.pow) });
registerFunction('PI', { maxArgs: 0, impl: () => Math.PI });
registerFunction('MOD', { minArgs: 2, maxArgs: 2, impl: (args) => {
  const [a, b] = args.map(scalarNumber);
  if (isError(a)) return a;
  if (isError(b)) return b;
  if (b === 0) return err('#DIV/0!');
  return normalizeNumber(a - b * Math.floor(a / b));
} });
registerFunction('ROUND', { minArgs: 1, maxArgs: 2, impl: numeric((x, d = 0) => roundTo(x, d)) });
registerFunction('ROUNDUP', { minArgs: 1, maxArgs: 2, impl: numeric((x, d = 0) => {
  const f = Math.pow(10, Math.trunc(d));
  return (Math.sign(x) * Math.ceil(Math.abs(x) * f - 1e-9)) / f;
}) });
registerFunction('ROUNDDOWN', { minArgs: 1, maxArgs: 2, impl: numeric((x, d = 0) => {
  const f = Math.pow(10, Math.trunc(d));
  return (Math.sign(x) * Math.floor(Math.abs(x) * f + 1e-9)) / f;
}) });

registerFunction('CONCATENATE', { minArgs: 1, impl: text((...s) => s.join('')) });
registerFunction('CONCAT', { minArgs: 1, impl: (args) => {
  let out = '';
  for (const a of args) {
    for (const v of asRange(a).flat()) {
      const s = toText(v);
      if (isError(s)) return s;
      out += s;
    }
  }
  return out;
} });
registerFunction('LEN', { minArgs: 1, maxArgs: 1, impl: text((s) => s.length) });
registerFunction('UPPER', { minArgs: 1, maxArgs: 1, impl: text((s) => s.toUpperCase()) });
registerFunction('LOWER', { minArgs: 1, maxArgs: 1, impl: text((s) => s.toLowerCase()) });
registerFunction('TRIM', { minArgs: 1, maxArgs: 1, impl: text((s) => s.trim().replace(/ {2,}/g, ' ')) });
registerFunction('LEFT', { minArgs: 1, maxArgs: 2, impl: (args) => {
  const s = toText(toScalar(args[0]));
  const n = args.length > 1 ? scalarNumber(args[1]) : 1;
  if (isError(s)) return s;
  if (isError(n)) return n;
  return n < 0 ? err('#VALUE!') : s.slice(0, n);
} });
registerFunction('RIGHT', { minArgs: 1, maxArgs: 2, impl: (args) => {
  const s = toText(toScalar(args[0]));
  const n = args.length > 1 ? scalarNumber(args[1]) : 1;
  if (isError(s)) return s;
  if (isError(n)) return n;
  return n < 0 ? err('#VALUE!') : n === 0 ? '' : s.slice(-n);
} });
registerFunction('MID', { minArgs: 3, maxArgs: 3, impl: (args) => {
  const s = toText(toScalar(args[0]));
  const start = scalarNumber(args[1]);
  const n = scalarNumber(args[2]);
  if (isError(s)) return s;
  if (isError(start)) return start;
  if (isError(n)) return n;
  return start < 1 || n < 0 ? err('#VALUE!') : s.substr(start - 1, n);
} });

registerFunction('ISBLANK', { minArgs: 1, maxArgs: 1, impl: ([a]) => toScalar(a) === null });
registerFunction('ISNUMBER', { minArgs: 1, maxArgs: 1, impl: ([a]) => typeof toScalar(a) === 'number' });
registerFunction('ISTEXT', { minArgs: 1, maxArgs: 1, impl: ([a]) => typeof toScalar(a) === 'string' });
registerFunction('ISERROR', { minArgs: 1, maxArgs: 1, impl: ([a]) => isError(toScalar(a)) });
registerFunction('NA', { maxArgs: 0, impl: () => err('#N/A') });

registerFunction('VLOOKUP', { minArgs: 3, maxArgs: 4, impl: (args) => lookup(args, true) });
registerFunction('HLOOKUP', { minArgs: 3, maxArgs: 4, impl: (args) => lookup(args, false) });

registerFunction('INDEX', { minArgs: 2, maxArgs: 3, impl: (args) => {
  const range = asRange(args[0]);
  const r = scalarNumber(args[1]);
  const c = args.length > 2 ? scalarNumber(args[2]) : 1;
  if (isError(r)) return r;
  if (isError(c)) return c;
  // A single-row range indexed with one argument picks a column.
  const [row, col] = range.height === 1 && args.length === 2 ? [1, r] : [r, c];
  if (row < 1 || col < 1 || row > range.height || col > range.width) return err('#REF!');
  return range.values[row - 1][col - 1];
} });

registerFunction('MATCH', { minArgs: 2, maxArgs: 3, impl: (args) => {
  const target = toScalar(args[0]);
  if (isError(target)) return target;
  const range = asRange(args[1]);
  if (range.height > 1 && range.width > 1) return err('#N/A');
  const values = [...range.flat()];
  const type = args.length > 2 ? scalarNumber(args[2]) : 1;
  if (isError(type)) return type;
  let pos: number;
  if (type === 0) {
    pos = exactIndex(values, target);
  } else if (type > 0) {
    pos = approximateIndex(values, target);
  } else {
    // Descending data: smallest value >= target.
    pos = -1;
    for (let i = 0; i < values.length; i++) {
      if (values[i] !== null && compare(values[i], target) >= 0) pos = i;
      else break;
    }
  }
  return pos < 0 ? err('#N/A') : pos + 1;
} });

registerFunction('SUMIF', { minArgs: 2, maxArgs: 3, impl: (args) => conditional(args, 'sum') });
registerFunction('COUNTIF', { minArgs: 2, maxArgs: 2, impl: (args) => conditional(args, 'count') });
registerFunction('AVERAGEIF', { minArgs: 2, maxArgs: 3, impl: (args) => conditional(args, 'average') });

registerFunction('SUMPRODUCT', { minArgs: 1, impl: (args) => {
  const ranges = args.map(asRange);
  const { height, width } = ranges[0];
  if (ranges.some((r) => r.height !== height || r.width !== width)) return err('#VALUE!');
  const sum = new Accumulator();
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let p = 1;
      for (const range of ranges) {
        const v = range.values[r][c];
        if (isError(v)) return v;
        p *= typeof v === 'number' ? v : 0;
      }
      sum.add(p);
    }
  }
  return normalizeNumber(sum.value);
} });
