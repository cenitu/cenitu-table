import { formatNumber } from '../formula/coerce';
import { formatSerialDate, parseDateString } from '../formula/dates';
import type { ConditionOp } from './filters';
import type { ServerFilterDef } from './serverMode';
import { CellError, isFormula, parseLiteral, parseNumber, type CellValue, type RawCell } from '../formula/values';

export type CellType = 'text' | 'numeric' | 'date' | 'checkbox' | 'dropdown';

export interface NumericFormat {
  style?: 'decimal' | 'currency' | 'percent';
  currency?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  /** Group thousands (default true). */
  useGrouping?: boolean;
}

/** Visual formatting of a cell. `false` explicitly turns off a flag set at column level. */
export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** CSS color, e.g. "#cf222e". */
  color?: string;
  background?: string;
  align?: 'left' | 'center' | 'right';
  /** Wrap long text instead of cutting it off (row height does not grow automatically). */
  wrap?: boolean;
}

/** Styles cells (or whole rows) whose computed value meets a condition. */
export interface ConditionalFormat {
  /** Columns whose cells are tested; default every column (required with `entireRow`). */
  columns?: number[];
  when: { op: ConditionOp; value?: string } | ((value: CellValue, row: number, col: number) => boolean);
  style: CellStyle;
  /** Style the whole row when any tested cell in it matches. */
  entireRow?: boolean;
}

/** Extra class names for a style; colors are applied inline. */
export function styleClasses(s: CellStyle): string {
  let cls = '';
  if (s.bold) cls += ' ct-b';
  if (s.italic) cls += ' ct-i';
  if (s.underline) cls += ' ct-u';
  if (s.strike) cls += ' ct-s';
  if (s.wrap) cls += ' ct-wrap';
  if (s.align) cls += ` ct-al-${s.align[0]}`;
  return cls;
}

export interface CellRenderContext {
  row: number;
  col: number;
  meta: CellMeta;
}

/** Settings that can be given per column (`columns`) or per cell (`cells`). */
export interface CellMeta {
  /** Stable column id used in server queries and change events; default `data`. */
  id?: string;
  /** Server mode: the server can sort this column. */
  sortable?: boolean;
  /** Server mode: what the server can filter this column by. */
  serverFilter?: ServerFilterDef;
  /** Object mode: property path bound to this column, e.g. "qty" or "customer.name". */
  data?: string;
  type?: CellType;
  /** Column header text. */
  title?: string;
  width?: number;
  readOnly?: boolean;
  numericFormat?: NumericFormat;
  /** Spreadsheet format code written to XLSX instead of one derived from these settings (set on import). */
  formatCode?: string;
  /** Tokens: DD, MM, YYYY, YY, HH, mm, ss (default "DD.MM.YYYY" for tr, "YYYY-MM-DD" otherwise). */
  dateFormat?: string;
  /** Allowed values of a dropdown cell. */
  source?: string[];
  /** Dropdown: reject values outside `source` (default true). */
  strict?: boolean;
  /** Return true when valid, false or a message when invalid. */
  validator?: ((value: CellValue, row: number, col: number) => boolean | string) | RegExp;
  /** Keep invalid values (marked red) instead of rejecting the change. Default true. */
  allowInvalid?: boolean;
  className?: string;
  style?: CellStyle;
  /** Custom renderer; receives the cell element after the default rendering. */
  renderer?: (el: HTMLElement, value: CellValue, ctx: CellRenderContext) => void;
}

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormatter(locale: string | undefined, f: NumericFormat): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(f)}`;
  let nf = numberFormats.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, {
      style: f.style ?? 'decimal',
      currency: f.style === 'currency' ? f.currency ?? 'TRY' : undefined,
      minimumFractionDigits: f.minimumFractionDigits,
      // Currency and percent keep Intl's defaults (e.g. 2 decimals for TRY); plain numbers show up to 10.
      maximumFractionDigits:
        f.maximumFractionDigits ?? (f.style === 'currency' || f.style === 'percent' ? undefined : Math.max(f.minimumFractionDigits ?? 0, 10)),
      useGrouping: f.useGrouping ?? true,
    });
    numberFormats.set(key, nf);
  }
  return nf;
}

export const defaultDateFormat = (locale?: string): string =>
  locale?.startsWith('tr') || locale?.startsWith('de') ? 'DD.MM.YYYY' : 'YYYY-MM-DD';

export type ValueKind = 'num' | 'bool' | 'err' | 'check' | 'date';

/** Display text of a computed value, honoring the cell's type and format. */
export function formatCell(v: CellValue, meta: CellMeta, locale?: string): { text: string; kind?: ValueKind } {
  if (meta.type === 'checkbox') return { text: v === true ? '☑' : '☐', kind: 'check' };
  if (v === null || v === undefined) return { text: '' };
  if (v instanceof CellError) return { text: v.code, kind: 'err' };
  if (typeof v === 'number') {
    if (meta.type === 'date') return { text: formatSerialDate(v, meta.dateFormat ?? defaultDateFormat(locale)), kind: 'date' };
    if (meta.numericFormat) return { text: numberFormatter(locale, meta.numericFormat).format(v), kind: 'num' };
    return { text: formatNumber(v), kind: 'num' };
  }
  if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', kind: 'bool' };
  return { text: v };
}

/** Text shown in the editor for a raw value. */
export function editText(raw: RawCell, meta: CellMeta, locale?: string): string {
  if (raw === null || raw === undefined) return '';
  if (meta.type === 'date' && typeof raw === 'number') return formatSerialDate(raw, meta.dateFormat ?? defaultDateFormat(locale));
  return String(raw);
}

/** Typed text -> stored value: numbers, booleans and (for date cells) dates are converted. */
export function convertInput(text: string, meta: CellMeta = {}): RawCell {
  if (text === '') return null;
  if (text.length > 1 && text[0] === '=') return text;
  if (meta.type === 'date') return parseDateString(text.trim()) ?? text;
  if (meta.type === 'checkbox') {
    const v = parseLiteral(text);
    return typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : text;
  }
  if (meta.type === 'numeric') {
    // Accept a decimal comma ("4,5" or "1.234,5") as typed in many locales.
    const t = text.trim();
    if (/^[+-]?\d{1,3}(\.\d{3})*(,\d+)?$/.test(t) || /^[+-]?\d+,\d+$/.test(t)) {
      const n = parseNumber(t.replace(/\./g, '').replace(',', '.'));
      if (n !== undefined) return n;
    }
  }
  if (meta.type === 'dropdown' || meta.type === 'text') {
    const n = meta.type === 'text' ? undefined : parseNumber(text);
    return n ?? text;
  }
  const v = parseLiteral(text);
  return typeof v === 'number' || typeof v === 'boolean' ? v : text;
}

/** Returns undefined when valid, otherwise a message. */
export function validate(value: CellValue, raw: RawCell, meta: CellMeta, row: number, col: number): string | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (!isFormula(raw)) {
    if (meta.type === 'numeric' && typeof value !== 'number') return 'Not a number';
    if (meta.type === 'date' && typeof value !== 'number') return 'Not a date';
    if (meta.type === 'dropdown' && meta.strict !== false && meta.source && !meta.source.includes(String(value)))
      return 'Not in list';
  }
  const v = meta.validator;
  if (!v) return undefined;
  if (v instanceof RegExp) return v.test(String(value ?? '')) ? undefined : 'Invalid value';
  const result = v(value, row, col);
  return result === true ? undefined : typeof result === 'string' ? result : 'Invalid value';
}

export const hasValidation = (meta: CellMeta): boolean =>
  !!meta.validator || meta.type === 'numeric' || meta.type === 'date' || meta.type === 'dropdown';
