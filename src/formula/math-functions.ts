import { nextRandom } from './environment';
import { collectNumbers, numeric, registerFunction } from './functions';
import { err, isError, normalizeNumber } from './values';

/** n / s with binary noise removed, so 0.3 / 0.1 counts as exactly 3 before rounding. */
const quotient = (n: number, s: number): number => normalizeNumber(n / s);

registerFunction('CEILING', { minArgs: 1, maxArgs: 2, impl: numeric((x, s = 1) => {
  if (s === 0) return 0;
  if (x > 0 && s < 0) return err('#NUM!');
  // A negative significance rounds a negative number away from zero.
  return s < 0 ? -Math.ceil(quotient(-x, -s)) * -s : Math.ceil(quotient(x, s)) * s;
}) });

registerFunction('FLOOR', { minArgs: 1, maxArgs: 2, impl: numeric((x, s = 1) => {
  if (s === 0) return x === 0 ? 0 : err('#DIV/0!');
  if (x > 0 && s < 0) return err('#NUM!');
  return s < 0 ? -Math.floor(quotient(-x, -s)) * -s : Math.floor(quotient(x, s)) * s;
}) });

// *.MATH: the sign of significance is ignored; `mode` flips the direction for negative numbers.
registerFunction('CEILING.MATH', { minArgs: 1, maxArgs: 3, impl: numeric((x, s = 1, mode = 0) => {
  const sig = Math.abs(s);
  if (sig === 0) return 0;
  return x < 0 && mode !== 0 ? -Math.ceil(quotient(-x, sig)) * sig : Math.ceil(quotient(x, sig)) * sig;
}) });

registerFunction('FLOOR.MATH', { minArgs: 1, maxArgs: 3, impl: numeric((x, s = 1, mode = 0) => {
  const sig = Math.abs(s);
  if (sig === 0) return 0;
  return x < 0 && mode !== 0 ? -Math.floor(quotient(-x, sig)) * sig : Math.floor(quotient(x, sig)) * sig;
}) });

registerFunction('MROUND', { minArgs: 2, maxArgs: 2, impl: numeric((x, m) => {
  if (m === 0) return 0;
  if (x * m < 0) return err('#NUM!');
  const q = quotient(x, m);
  return Math.sign(q) * Math.round(Math.abs(q)) * m;
}) });

registerFunction('TRUNC', { minArgs: 1, maxArgs: 2, impl: numeric((x, d = 0) => {
  const f = Math.pow(10, Math.trunc(d));
  return Math.trunc(normalizeNumber(x * f)) / f;
}) });

registerFunction('SIGN', { minArgs: 1, maxArgs: 1, impl: numeric((x) => Math.sign(x)) });

registerFunction('PRODUCT', { minArgs: 1, aggregate: true, impl: (args) => {
  const nums = collectNumbers(args);
  if (isError(nums)) return nums;
  if (nums.length === 0) return 0;
  const p = nums.reduce((a, b) => a * b, 1);
  return Number.isFinite(p) ? normalizeNumber(p) : err('#NUM!');
} });

registerFunction('RAND', { maxArgs: 0, volatile: true, impl: () => nextRandom() });

registerFunction('RANDBETWEEN', { minArgs: 2, maxArgs: 2, volatile: true, impl: numeric((lo, hi) => {
  const a = Math.ceil(lo);
  const b = Math.floor(hi);
  return a > b ? err('#NUM!') : a + Math.floor(nextRandom() * (b - a + 1));
}) });
