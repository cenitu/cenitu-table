export type ErrorCode =
  | '#DIV/0!'
  | '#VALUE!'
  | '#REF!'
  | '#NAME?'
  | '#N/A'
  | '#NUM!'
  | '#NULL!'
  | '#ERROR!'
  | '#CYCLE!'
  | '#SPILL!'
  | '#CALC!';

export const ERROR_CODES: readonly ErrorCode[] = [
  '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#N/A', '#NUM!', '#NULL!', '#ERROR!', '#CYCLE!', '#SPILL!', '#CALC!',
];

export class CellError {
  constructor(readonly code: ErrorCode, readonly message?: string) {}
  toString(): string {
    return this.code;
  }
}

/** Value as entered by the user or loaded from data. Strings starting with "=" are formulas. */
export type RawCell = number | string | boolean | null | undefined;

/** Computed value of a cell. `null` means empty. */
export type CellValue = number | string | boolean | null | CellError;

/**
 * 2D block of values: a range reference or an array result (FILTER, SEQUENCE, A1:A3*2, ...).
 * `origin` is set when the block was read from cells, so ROW/COLUMN can locate it.
 */
export class RangeValue {
  constructor(
    readonly values: CellValue[][],
    readonly origin?: { sheet: number; row: number; col: number },
  ) {}
  get height(): number {
    return this.values.length;
  }
  get width(): number {
    return this.values[0]?.length ?? 0;
  }
  *flat(): IterableIterator<CellValue> {
    for (const row of this.values) yield* row;
  }
}

export type Value = CellValue | RangeValue;

export const isError = (v: unknown): v is CellError => v instanceof CellError;
export const err = (code: ErrorCode, message?: string): CellError => new CellError(code, message);

export function isFormula(raw: RawCell): raw is string {
  return typeof raw === 'string' && raw.length > 1 && raw[0] === '=';
}

/** Converts user input to a literal cell value (numbers and booleans are recognized). */
export function parseLiteral(raw: RawCell): CellValue {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') return raw;
  if (raw[0] === "'") return raw.slice(1);
  const num = parseNumber(raw);
  if (num !== undefined) return num;
  const upper = raw.toUpperCase();
  if (upper === 'TRUE') return true;
  if (upper === 'FALSE') return false;
  return raw;
}

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?%?$/;

export function parseNumber(text: string): number | undefined {
  const t = text.trim();
  if (!NUMBER_RE.test(t)) return undefined;
  if (t.endsWith('%')) return Number(t.slice(0, -1)) / 100;
  return Number(t);
}

/** Removes binary floating-point noise, e.g. 0.1 + 0.2 -> 0.3 (15 significant digits like spreadsheets). */
export function normalizeNumber(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return n;
  return Number(n.toPrecision(15));
}
