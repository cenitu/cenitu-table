import { CellError, isFormula, normalizeNumber, parseLiteral, type CellValue, type RawCell } from '../formula/values';
import { formatDateCode, isDateFormat } from './numberFormat';
import type { ExportSheet } from './types';

export interface CsvOptions {
  /** Field separator (default ","; ";" is what tr-TR spreadsheet apps expect). */
  delimiter?: string;
  /**
   * 'computed' (default) writes formula results as plain numbers so other systems can read them,
   * 'formatted' writes numbers as displayed (needs `sheet.text`), 'raw' writes cells as entered.
   */
  values?: 'computed' | 'formatted' | 'raw';
  /** Prefix a UTF-8 BOM so spreadsheet apps detect the encoding (default true). */
  bom?: boolean;
  /** Record separator (default "\r\n" per RFC 4180). */
  lineEnding?: '\n' | '\r\n';
  /** Decimal separator for numbers (default "."); use "," together with delimiter ";" for tr-TR. */
  decimalSeparator?: string;
  /** Locale for month/day names in date formats. */
  locale?: string;
  /**
   * Prefix text starting with = + - @ (or tab/CR) with an apostrophe so spreadsheet apps do not
   * run it as a formula when the file is opened ("CSV injection"). Default true. In raw mode real
   * formulas are written unchanged.
   */
  escapeFormulas?: boolean;
}

const RISKY = /^[=+\-@\t\r]/;

function needsQuotes(field: string, delimiter: string): boolean {
  return field.includes(delimiter) || /["\r\n]/.test(field) || /^\s|\s$/.test(field);
}

const quote = (field: string, delimiter: string): string =>
  needsQuotes(field, delimiter) ? `"${field.replace(/"/g, '""')}"` : field;

function computedValue(sheet: ExportSheet, r: number, c: number, raw: RawCell): CellValue {
  const v = sheet.values?.[r]?.[c];
  if (v !== undefined) return v;
  // Without computed values a formula can only be written as its text.
  return isFormula(raw) ? raw : parseLiteral(raw);
}

/** Serializes one sheet as RFC 4180 CSV. */
export function toCSV(sheet: ExportSheet, opts: CsvOptions = {}): string {
  const delimiter = opts.delimiter ?? ',';
  const eol = opts.lineEnding ?? '\r\n';
  const dec = opts.decimalSeparator ?? '.';
  const raw = opts.values === 'raw';
  const escape = opts.escapeFormulas !== false;
  const safe = (t: string): string => (escape && RISKY.test(t) ? `'${t}` : t);
  const rows = Math.max(sheet.data.length, sheet.values?.length ?? 0);
  let width = 0;
  for (let r = 0; r < rows; r++) width = Math.max(width, sheet.data[r]?.length ?? 0, sheet.values?.[r]?.length ?? 0);

  const text = (r: number, c: number): string => {
    const cell = sheet.data[r]?.[c];
    if (raw) {
      if (cell === null || cell === undefined) return '';
      if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE';
      if (typeof cell === 'string') return isFormula(cell) ? cell : safe(cell);
      return num(cell);
    }
    const v = computedValue(sheet, r, c, cell);
    if (v === null || v === undefined) return '';
    if (v instanceof CellError) return v.code;
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') {
      if (opts.values === 'formatted' && sheet.text) return sheet.text(r, c);
      const code = sheet.format?.(r, c)?.numberFormat;
      if (isDateFormat(code) && Number.isFinite(v) && v >= 0) return formatDateCode(v, code!, opts.locale);
      return num(v);
    }
    if (opts.values === 'formatted' && sheet.text) return safe(sheet.text(r, c));
    // A formula written as text (no computed value available) is intentional, like raw mode.
    return v === cell && isFormula(cell) ? v : safe(v);
  };
  const num = (v: number | string): string => {
    if (typeof v === 'string') return v;
    const s = String(normalizeNumber(v));
    return dec === '.' ? s : s.replace('.', dec);
  };

  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const fields: string[] = [];
    for (let c = 0; c < width; c++) fields.push(quote(text(r, c), delimiter));
    lines.push(fields.join(delimiter));
  }
  return (opts.bom === false ? '' : '﻿') + lines.join(eol);
}
