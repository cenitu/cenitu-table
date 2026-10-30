export interface CellAddress {
  row: number;
  col: number;
  /** Sheet id; omitted means sheet 0. */
  sheet?: number;
}

export interface CellRange {
  start: CellAddress;
  end: CellAddress;
}

/** Spreadsheet column limit (XFD). Also used to pack addresses into a single number key. */
export const MAX_COLS = 16384;
export const MAX_ROWS = 1048576;

/** Cells per sheet in the key space; 2^53 / 2^34 leaves room for ~500k sheets. */
export const SHEET_SPAN = MAX_ROWS * MAX_COLS;

export const cellKey = (row: number, col: number, sheet = 0): number => sheet * SHEET_SPAN + row * MAX_COLS + col;
export const keyToAddress = (key: number): Required<CellAddress> => {
  const sheet = Math.floor(key / SHEET_SPAN);
  const rest = key - sheet * SHEET_SPAN;
  return { row: Math.floor(rest / MAX_COLS), col: rest % MAX_COLS, sheet };
};

/** 0 -> "A", 25 -> "Z", 26 -> "AA" */
export function columnLabel(col: number): string {
  let label = '';
  let n = col + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

/** "A" -> 0, "AA" -> 26. Returns -1 for invalid labels. */
export function columnIndex(label: string): number {
  let n = 0;
  for (const ch of label.toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) return -1;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

const A1_RE = /^\$?([A-Za-z]{1,3})\$?(\d+)$/;

export function parseA1(text: string): CellAddress | undefined {
  const m = A1_RE.exec(text.trim());
  if (!m) return undefined;
  const col = columnIndex(m[1]);
  const row = Number(m[2]) - 1;
  if (col < 0 || col >= MAX_COLS || row < 0 || row >= MAX_ROWS) return undefined;
  return { row, col };
}

export const toA1 = ({ row, col }: CellAddress): string => `${columnLabel(col)}${row + 1}`;

export function normalizeRange(a: CellAddress, b: CellAddress): CellRange {
  return {
    start: { row: Math.min(a.row, b.row), col: Math.min(a.col, b.col) },
    end: { row: Math.max(a.row, b.row), col: Math.max(a.col, b.col) },
  };
}

export const rangeContains = (r: CellRange, row: number, col: number): boolean =>
  row >= r.start.row && row <= r.end.row && col >= r.start.col && col <= r.end.col;
