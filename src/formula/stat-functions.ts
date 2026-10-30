import { toNumber, toScalar } from './coerce';
import { collectNumbers, registerFunction, scalarNumber, sumOf, type FunctionDefinition } from './functions';
import { err, isError, normalizeNumber, type CellError, type Value } from './values';

/** Aggregate over the numbers of all arguments (ranges skip text, booleans and blanks). */
function overNumbers(minArgs: number, fn: (nums: number[]) => number | CellError): FunctionDefinition {
  return {
    minArgs,
    aggregate: true,
    impl: (args) => {
      const nums = collectNumbers(args);
      if (isError(nums)) return nums;
      const r = fn(nums);
      return isError(r) ? r : Number.isFinite(r) ? normalizeNumber(r) : err('#NUM!');
    },
  };
}

function median(nums: number[]): number | CellError {
  if (nums.length === 0) return err('#NUM!');
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Most frequent value; ties go to the value seen first. */
function mode(nums: number[]): number | CellError {
  const counts = new Map<number, number>();
  for (const n of nums) counts.set(n, (counts.get(n) ?? 0) + 1);
  let best: number | undefined;
  let bestCount = 1;
  // Map iteration follows first occurrence, so the earliest of equally frequent values wins.
  for (const [n, c] of counts) {
    if (c > bestCount) {
      best = n;
      bestCount = c;
    }
  }
  return best === undefined ? err('#N/A') : best;
}

/** Variance with a two-pass mean so large offsets do not lose precision. */
function variance(nums: number[], sample: boolean): number | CellError {
  const n = nums.length;
  if (n < (sample ? 2 : 1)) return err('#DIV/0!');
  const mean = sumOf(nums) / n;
  return sumOf(nums.map((x) => (x - mean) * (x - mean))) / (sample ? n - 1 : n);
}

const sqrtOf = (v: number | CellError): number | CellError => (isError(v) ? v : Math.sqrt(v));

registerFunction('MEDIAN', overNumbers(1, median));
registerFunction('MODE.SNGL', overNumbers(1, mode));
registerFunction('MODE', overNumbers(1, mode));
registerFunction('VAR.S', overNumbers(1, (n) => variance(n, true)));
registerFunction('VAR', overNumbers(1, (n) => variance(n, true)));
registerFunction('VAR.P', overNumbers(1, (n) => variance(n, false)));
registerFunction('STDEV.S', overNumbers(1, (n) => sqrtOf(variance(n, true))));
registerFunction('STDEV', overNumbers(1, (n) => sqrtOf(variance(n, true))));
registerFunction('STDEV.P', overNumbers(1, (n) => sqrtOf(variance(n, false))));

/** k-th largest (or smallest); k is rounded up as in spreadsheets. */
function kth(args: Value[], largest: boolean): Value {
  const nums = collectNumbers([args[0]]);
  if (isError(nums)) return nums;
  const k = scalarNumber(args[1]);
  if (isError(k)) return k;
  const i = Math.ceil(k);
  if (i < 1 || i > nums.length) return err('#NUM!');
  const sorted = [...nums].sort((a, b) => (largest ? b - a : a - b));
  return sorted[i - 1];
}

registerFunction('LARGE', { minArgs: 2, maxArgs: 2, aggregate: true, impl: (args) => kth(args, true) });
registerFunction('SMALL', { minArgs: 2, maxArgs: 2, aggregate: true, impl: (args) => kth(args, false) });

function rank(args: Value[]): Value {
  const x = toNumber(toScalar(args[0]));
  if (isError(x)) return x;
  const nums = collectNumbers([args[1]]);
  if (isError(nums)) return nums;
  const order = args.length > 2 ? scalarNumber(args[2]) : 0;
  if (isError(order)) return order;
  if (!nums.includes(x)) return err('#N/A');
  // Order 0 ranks the largest value 1; any other order ranks the smallest value 1.
  return 1 + nums.filter((n) => (order === 0 ? n > x : n < x)).length;
}

registerFunction('RANK.EQ', { minArgs: 2, maxArgs: 3, aggregate: true, impl: rank });
registerFunction('RANK', { minArgs: 2, maxArgs: 3, aggregate: true, impl: rank });
