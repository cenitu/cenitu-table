import { compare, toBool, toScalar } from './coerce';
import { logical, registerFunction } from './functions';
import { err, isError, type CellValue } from './values';

registerFunction('ISNA', { minArgs: 1, maxArgs: 1, impl: ([a]) => {
  const v = toScalar(a);
  return isError(v) && v.code === '#N/A';
} });

registerFunction('ISLOGICAL', { minArgs: 1, maxArgs: 1, impl: ([a]) => typeof toScalar(a) === 'boolean' });

registerFunction('XOR', { minArgs: 1, aggregate: true, impl: (args) => logical(args, (a, b) => a !== b, false) });

/** IFS(test1, value1, test2, value2, ...): the value of the first true test, else #N/A. */
registerFunction('IFS', { minArgs: 2, lazy: (args, ctx) => {
  if (args.length % 2) return err('#VALUE!', 'IFS needs test/value pairs');
  for (let i = 0; i < args.length; i += 2) {
    const test = toBool(toScalar(ctx.evaluate(args[i])));
    if (isError(test)) return test;
    if (test) return ctx.evaluate(args[i + 1]);
  }
  return err('#N/A', 'No test was true');
} });

/** Equality as SWITCH sees it: same type (text case-insensitive); a blank matches 0 and "". */
function same(a: CellValue, b: CellValue): boolean {
  if (a !== null && b !== null && typeof a !== typeof b) return false;
  return compare(a, b) === 0;
}

/** SWITCH(expr, case1, result1, ..., [default]). */
registerFunction('SWITCH', { minArgs: 3, lazy: (args, ctx) => {
  const value = toScalar(ctx.evaluate(args[0]));
  if (isError(value)) return value;
  const pairs = Math.floor((args.length - 1) / 2);
  for (let k = 0; k < pairs; k++) {
    const i = 1 + 2 * k;
    const candidate = toScalar(ctx.evaluate(args[i]));
    if (isError(candidate)) return candidate;
    if (same(value, candidate)) return ctx.evaluate(args[i + 1]);
  }
  return args.length % 2 === 0 ? ctx.evaluate(args[args.length - 1]) : err('#N/A', 'No case matched');
} });
