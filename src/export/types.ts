import type { CellValue, RawCell } from '../formula/values';

/** Per-cell formatting understood by the exporters. */
export interface ExportCellFormat {
  /** Spreadsheet format code, e.g. '#,##0.00 "₺"', '0%', 'dd.mm.yyyy'. */
  numberFormat?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** '#rrggbb' (or '#rgb'). */
  color?: string;
  background?: string;
  align?: 'left' | 'center' | 'right';
  wrap?: boolean;
}

export interface ExportMerge {
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
}

/** Grid-independent description of one sheet to export. */
export interface ExportSheet {
  name: string;
  /** Raw cells as entered: numbers, strings, booleans, null, or formulas starting with "=". */
  data: RawCell[][];
  /** Computed values, same shape; used as cached results for formulas and for CSV. */
  values?: CellValue[][];
  /** Column widths in px. */
  colWidths?: number[];
  /** Row heights in px. */
  rowHeights?: number[];
  frozen?: { rows: number; cols: number };
  merges?: ExportMerge[];
  /** Per-cell formatting (row, col are data coordinates). */
  format?: (row: number, col: number) => ExportCellFormat | undefined;
  /** Text as displayed, for CSV with `values: 'formatted'`. */
  text?: (row: number, col: number) => string;
  /** Optional AutoFilter range over the header row and data. */
  autoFilter?: { row: number; col: number; rows: number; cols: number };
}
