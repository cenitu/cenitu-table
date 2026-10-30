import { toScalar } from './coerce';
import { err, RangeValue, type CellValue, type Value } from './values';

/** A value counts as an array only when it has more than one element; 1x1 ranges act as scalars. */
export const isArray = (v: Value): v is RangeValue => v instanceof RangeValue && (v.height !== 1 || v.width !== 1);

export const asArray = (v: Value): RangeValue => (v instanceof RangeValue ? v : new RangeValue([[v]]));

/**
 * Applies `fn` element-wise. Scalars and single rows/columns are broadcast across the other
 * operands; where sizes otherwise disagree the result takes the larger size and the missing
 * positions are #N/A. Without array operands this is just `fn` on the scalars.
 */
export function mapArrays(args: Value[], fn: (...scalars: CellValue[]) => CellValue): Value {
  let height = 0;
  let width = 0;
  for (const a of args) {
    if (!isArray(a)) continue;
    height = Math.max(height, a.height);
    width = Math.max(width, a.width);
  }
  if (height === 0) return fn(...args.map(toScalar));
  const rows: CellValue[][] = [];
  for (let r = 0; r < height; r++) {
    const row: CellValue[] = [];
    for (let c = 0; c < width; c++) row.push(fn(...args.map((a) => elementAt(a, r, c))));
    rows.push(row);
  }
  return new RangeValue(rows);
}

function elementAt(v: Value, r: number, c: number): CellValue {
  if (!(v instanceof RangeValue)) return v;
  const rr = v.height === 1 ? 0 : r;
  const cc = v.width === 1 ? 0 : c;
  return rr < v.height && cc < v.width ? v.values[rr][cc] : err('#N/A');
}

/** Column `c` of a block as a list. */
export const column = (v: RangeValue, c: number): CellValue[] => v.values.map((row) => row[c]);

export function transpose(v: RangeValue): RangeValue {
  return new RangeValue(Array.from({ length: v.width }, (_, c) => column(v, c)));
}
