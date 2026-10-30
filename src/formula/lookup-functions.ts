import { asArray, column } from './arrays';
import { compare, toNumber, toScalar } from './coerce';
import { registerFunction, scalarNumber, wildcardRegExp, type FunctionDefinition } from './functions';
import { err, isError, RangeValue, type CellValue, type Value } from './values';

/** Same kind of value (number/text/boolean), so 1 never matches "1" in a lookup. */
const sameKind = (a: CellValue, b: CellValue): boolean => a !== null && !isError(a) && typeof a === typeof b;

/**
 * Index of `target` in `keys` for XLOOKUP. match: 0 exact, -1 exact or next smaller, 1 exact or
 * next larger, 2 wildcard; search: 1 (or 2) from the first item, -1 (or -2) from the last.
 */
function xmatch(keys: CellValue[], target: CellValue, match: number, search: number): number {
  const order = keys.map((_, i) => i);
  if (search < 0) order.reverse();
  const re = match === 2 && typeof target === 'string' ? wildcardRegExp(target) : undefined;
  let best = -1;
  for (const i of order) {
    const v = keys[i];
    if (!sameKind(v, target)) continue;
    if (re ? re.test(v as string) : compare(v, target) === 0) return i;
    if (match === -1 && compare(v, target) < 0 && (best < 0 || compare(v, keys[best]) > 0)) best = i;
    if (match === 1 && compare(v, target) > 0 && (best < 0 || compare(v, keys[best]) < 0)) best = i;
  }
  return best;
}

/** XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode]). */
registerFunction('XLOOKUP', { minArgs: 3, maxArgs: 6, impl: (args) => {
  const target = toScalar(args[0]);
  if (isError(target)) return target;
  const look = asArray(args[1]);
  const ret = asArray(args[2]);
  if (look.width !== 1 && look.height !== 1) return err('#VALUE!', 'Lookup array must be one row or column');
  // A single cell lookup array pairs with a return row; otherwise the lookup array's shape decides.
  const vertical = look.width === 1 && (look.height > 1 || ret.height === 1);
  const n = vertical ? look.height : look.width;
  if ((vertical ? ret.height : ret.width) !== n) return err('#VALUE!', 'Arrays must have the same length');
  const notFound = args.length > 3 && args[3] !== null ? args[3] : undefined;
  const match = args.length > 4 && args[4] !== null ? scalarNumber(args[4]) : 0;
  const search = args.length > 5 && args[5] !== null ? scalarNumber(args[5]) : 1;
  if (isError(match)) return match;
  if (isError(search)) return search;
  if (![0, -1, 1, 2].includes(match) || ![1, -1, 2, -2].includes(search)) return err('#VALUE!');

  const keys = vertical ? column(look, 0) : look.values[0];
  const i = xmatch(keys, target, match, search);
  if (i < 0) return notFound ?? err('#N/A');
  if (vertical) return ret.width === 1 ? ret.values[i][0] : new RangeValue([ret.values[i]]);
  return ret.height === 1 ? ret.values[0][i] : new RangeValue(ret.values.map((row) => [row[i]]));
} });

/** CHOOSE(index, value1, value2, ...): only the chosen argument is evaluated. */
registerFunction('CHOOSE', { minArgs: 2, lazy: (args, ctx) => {
  const n = toNumber(toScalar(ctx.evaluate(args[0])));
  if (isError(n)) return n;
  const i = Math.trunc(n);
  return i < 1 || i >= args.length ? err('#VALUE!', 'CHOOSE index out of range') : ctx.evaluate(args[i]);
} });

// ROW/COLUMN: of the formula's own cell without an argument; a multi-cell reference gives an array.
registerFunction('ROW', { maxArgs: 1, positional: true, lazy: (args, ctx) => {
  if (args.length === 0) return ctx.row + 1;
  const ref = ctx.reference(args[0]);
  if (!ref) return referenceError(ctx.evaluate(args[0]));
  if (ref.height === 1) return ref.row + 1;
  return new RangeValue(Array.from({ length: ref.height }, (_, i) => [ref.row + i + 1]));
} });

registerFunction('COLUMN', { maxArgs: 1, positional: true, lazy: (args, ctx) => {
  if (args.length === 0) return ctx.col + 1;
  const ref = ctx.reference(args[0]);
  if (!ref) return referenceError(ctx.evaluate(args[0]));
  if (ref.width === 1) return ref.col + 1;
  return new RangeValue([Array.from({ length: ref.width }, (_, i) => ref.col + i + 1)]);
} });

const referenceError = (v: Value): Value => (isError(v) ? v : err('#VALUE!', 'Argument must be a reference'));

/** ROWS/COLUMNS: size of a reference or array; a single value counts as 1x1. */
function size(pick: (r: { height: number; width: number }) => number): FunctionDefinition {
  return {
    minArgs: 1,
    maxArgs: 1,
    lazy: (args, ctx) => {
      const ref = ctx.reference(args[0]);
      if (ref) return pick(ref);
      const v = ctx.evaluate(args[0]);
      if (isError(v)) return v;
      return pick(v instanceof RangeValue ? v : { height: 1, width: 1 });
    },
  };
}

registerFunction('ROWS', size((r) => r.height));
registerFunction('COLUMNS', size((r) => r.width));
