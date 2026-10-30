import { asArray } from './arrays';
import { toScalar } from './coerce';
import { Accumulator, makeCriterion, registerFunction } from './functions';
import { err, isError, normalizeNumber, type CellValue, type RangeValue, type Value } from './values';

type Reduce = 'sum' | 'count' | 'average' | 'max' | 'min';

/**
 * SUMIFS and friends: `args` holds the value range (except for COUNTIFS) followed by
 * (criteria range, criterion) pairs. Every criteria range must have the value range's shape;
 * a position counts when all criteria match it.
 */
function multiConditional(args: Value[], reduce: Reduce): Value {
  const hasValues = reduce !== 'count';
  const pairs = args.slice(hasValues ? 1 : 0);
  if (pairs.length === 0 || pairs.length % 2) return err('#VALUE!', 'Criteria come in range/criterion pairs');
  const tests: { range: RangeValue; test: (v: CellValue) => boolean }[] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const criterion = toScalar(pairs[i + 1]);
    if (isError(criterion)) return criterion;
    tests.push({ range: asArray(pairs[i]), test: makeCriterion(criterion) });
  }
  const values = hasValues ? asArray(args[0]) : tests[0].range;
  const { height, width } = values;
  if (tests.some((t) => t.range.height !== height || t.range.width !== width)) {
    return err('#VALUE!', 'Criteria ranges must have the same size');
  }

  const sum = new Accumulator();
  let count = 0;
  let extreme: number | undefined;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (!tests.every((t) => t.test(t.range.values[r][c]))) continue;
      if (!hasValues) {
        count++;
        continue;
      }
      const v = values.values[r][c];
      if (isError(v)) return v;
      if (typeof v !== 'number') continue;
      sum.add(v);
      count++;
      if (extreme === undefined || (reduce === 'max' ? v > extreme : v < extreme)) extreme = v;
    }
  }
  switch (reduce) {
    case 'count': return count;
    case 'sum': return normalizeNumber(sum.value);
    case 'average': return count === 0 ? err('#DIV/0!') : normalizeNumber(sum.value / count);
    default: return extreme ?? 0;
  }
}

registerFunction('SUMIFS', { minArgs: 3, impl: (args) => multiConditional(args, 'sum') });
registerFunction('COUNTIFS', { minArgs: 2, impl: (args) => multiConditional(args, 'count') });
registerFunction('AVERAGEIFS', { minArgs: 3, impl: (args) => multiConditional(args, 'average') });
registerFunction('MAXIFS', { minArgs: 3, impl: (args) => multiConditional(args, 'max') });
registerFunction('MINIFS', { minArgs: 3, impl: (args) => multiConditional(args, 'min') });
