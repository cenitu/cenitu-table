import { isFormula, type RawCell } from '../formula/values';

export type FillDirection = 'down' | 'up' | 'right' | 'left';

/**
 * Extends one line of source values (in fill order) by `count` items:
 * - two or more numbers with a constant step continue the arithmetic series;
 * - text ending in a number ("Item 7") increments that number;
 * - formulas are moved by `shift(raw, from, to)`, where `from` is the position of the source cell in
 *   the line and `to` the position of the target (n + i); everything else repeats cyclically.
 * For "up"/"left" fills the caller passes the line reversed.
 */
export function extendSeries(
  source: RawCell[],
  count: number,
  shift: (raw: string, from: number, to: number) => string,
): RawCell[] {
  const n = source.length;
  const out: RawCell[] = [];
  const numbers = source.every((v) => typeof v === 'number') ? (source as number[]) : null;
  const step = numbers && n >= 2 ? constantStep(numbers) : undefined;
  const textSeries = textNumberSeries(source);

  for (let i = 0; i < count; i++) {
    if (numbers && step !== undefined) {
      out.push(roundFloat(numbers[n - 1] + step * (i + 1)));
      continue;
    }
    if (textSeries) {
      const k = i + 1;
      out.push(`${textSeries.prefix}${textSeries.last + textSeries.step * k}${textSeries.suffix}`);
      continue;
    }
    const from = i % n;
    const raw = source[from];
    out.push(isFormula(raw) ? shift(raw, from, n + i) : raw);
  }
  return out;
}

function constantStep(nums: number[]): number | undefined {
  const step = nums[1] - nums[0];
  for (let i = 2; i < nums.length; i++) {
    if (Math.abs(nums[i] - nums[i - 1] - step) > 1e-9) return undefined;
  }
  return step;
}

const TEXT_NUM = /^(.*?)(\d+)(\D*)$/;

function textNumberSeries(source: RawCell[]) {
  if (!source.every((v) => typeof v === 'string' && !isFormula(v) && TEXT_NUM.test(v))) return undefined;
  const parts = (source as string[]).map((v) => TEXT_NUM.exec(v)!);
  const { 1: prefix, 3: suffix } = parts[0];
  if (!parts.every((p) => p[1] === prefix && p[3] === suffix)) return undefined;
  const nums = parts.map((p) => Number(p[2]));
  const step = nums.length >= 2 ? constantStep(nums) : 1;
  if (step === undefined) return undefined;
  return { prefix, suffix, last: nums[nums.length - 1], step };
}

const roundFloat = (n: number): number => Number(n.toPrecision(15));
