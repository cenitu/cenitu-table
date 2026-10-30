import { CellError, err, isError, normalizeNumber, parseNumber, RangeValue, type CellValue, type Value } from './values';

export function toNumber(v: CellValue): number | CellError {
  if (isError(v)) return v;
  if (v === null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = parseNumber(v);
  return n === undefined ? err('#VALUE!', `"${v}" is not a number`) : n;
}

export function toText(v: CellValue): string | CellError {
  if (isError(v)) return v;
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return formatNumber(v);
  return v;
}

export function toBool(v: CellValue): boolean | CellError {
  if (isError(v)) return v;
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const upper = v.toUpperCase();
  if (upper === 'TRUE') return true;
  if (upper === 'FALSE') return false;
  return err('#VALUE!', `"${v}" is not a boolean`);
}

export function formatNumber(n: number): string {
  return String(normalizeNumber(n));
}

/** A range used where a single value is expected: only a 1x1 range is accepted. */
export function toScalar(v: Value): CellValue {
  if (v instanceof RangeValue) {
    return v.height === 1 && v.width === 1 ? v.values[0][0] : err('#VALUE!', 'Range used where a single value is expected');
  }
  return v;
}

const typeRank = (v: CellValue): number => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);

/**
 * Spreadsheet comparison: numbers < text < booleans, text compared case-insensitively.
 * An empty cell takes the "zero value" of the other operand's type.
 */
export function compare(a: CellValue, b: CellValue): number {
  if (a === null) a = b === null ? 0 : typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'string') {
    const x = a.toLowerCase();
    const y = (b as string).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const x = Number(a);
  const y = Number(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
