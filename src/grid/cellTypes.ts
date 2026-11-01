import { formatNumber } from '../formula/coerce';
import { dateToSerial, formatSerialDate, parseDateString } from '../formula/dates';
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

/** A dropdown choice: the cell stores `value` and shows `label`. A plain string is both. */
export type DropdownOption = string | { value: string | number; label: string };

export const optionValue = (o: DropdownOption): string | number => (typeof o === 'string' ? o : o.value);
export const optionLabel = (o: DropdownOption): string => (typeof o === 'string' ? o : o.label);

/** What a custom editor gets. Call `commit` or `cancel` to finish. */
export interface CellEditorContext {
  /** Element placed over the cell; the editor renders into it. */
  el: HTMLElement;
  value: RawCell;
  /** Text typed over the cell, when editing started that way. */
  initial?: string;
  /** Visual row and column. */
  row: number;
  col: number;
  meta: CellMeta;
  /** The source object (object mode) or raw row. */
  rowData: unknown;
  /** Stores a value and closes; `move` then moves the active cell, e.g. [1, 0] for down. */
  commit(value: RawCell, move?: [number, number]): void;
  cancel(): void;
}

const LINK_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];

/** Renderer turning a cell into a link. Addresses with any other protocol stay plain text. */
export function linkRenderer(href: (value: CellValue, ctx: CellRenderContext) => string | undefined): CellRenderer {
  return (el, value, ctx) => {
    // The grid repaints only when the text changes, so an old anchor may still be here.
    const stale = el.querySelector('a');
    if (stale) el.textContent = stale.textContent;
    const url = href(value, ctx);
    if (!url) return;
    const doc = el.ownerDocument;
    let parsed: URL;
    try {
      parsed = new URL(url, doc.baseURI);
    } catch {
      return;
    }
    if (!LINK_PROTOCOLS.includes(parsed.protocol)) return;
    const a = doc.createElement('a');
    a.href = parsed.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = el.textContent;
    el.textContent = '';
    el.append(a);
  };
}

/** Returned by a custom editor. */
export interface CellEditorInstance {
  /** Value to store when the editor closes without `commit` (a click elsewhere). Omit to discard. */
  getValue?(): RawCell;
  /** Cleanup, called exactly once however the editor closes. */
  destroy?(): void;
}

export type CellEditor = (ctx: CellEditorContext) => CellEditorInstance | void;

export interface CellRenderer {
  (el: HTMLElement, value: CellValue, ctx: CellRenderContext): void | (() => void);
  /** The renderer draws the whole cell: the grid leaves the element's content alone. */
  ownsContent?: boolean;
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
  source?: DropdownOption[];
  /** Dropdown: fetches choices for what was typed, instead of `source`. */
  loadOptions?: (query: string, signal: AbortSignal) => Promise<DropdownOption[]>;
  /** Dropdown: label of a stored value that is not among the loaded choices, e.g. from the row. */
  resolveLabel?: (value: CellValue, rowData: unknown) => string | undefined;
  /** Column total in the footer row. Client mode only; server totals come from `summaryValues`. */
  summary?: 'sum' | 'avg' | 'count' | 'min' | 'max' | ((values: CellValue[]) => CellValue);
  /** Text note: a corner mark on the cell, shown on hover. */
  note?: string;
  /** Custom cell editor, replacing the built-in one for this column or cell. */
  editor?: CellEditor;
  /** Dropdown: reject values outside `source` (default true). */
  strict?: boolean;
  /** Return true when valid, false or a message when invalid. */
  validator?: ((value: CellValue, row: number, col: number) => boolean | string) | RegExp;
  /** Keep invalid values (marked red) instead of rejecting the change. Default true. */
  allowInvalid?: boolean;
  className?: string;
  style?: CellStyle;
  /**
   * Custom renderer; receives the cell element after the default rendering, on every paint. It may
   * return a cleanup function, called before the next paint and when the element is recycled. With
   * `ownsContent`, only the last one runs, when the element is recycled.
   */
  renderer?: CellRenderer;
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

const labelMaps = new WeakMap<DropdownOption[], Map<string, string>>();

/** Label of a value in a static `source`, or undefined. */
function sourceLabel(source: DropdownOption[], v: unknown): string | undefined {
  let map = labelMaps.get(source);
  if (!map) labelMaps.set(source, (map = new Map(source.map((o) => [String(optionValue(o)), optionLabel(o)]))));
  return map.get(String(v));
}

export const defaultDateFormat = (locale?: string): string =>
  locale?.startsWith('tr') || locale?.startsWith('de') ? 'DD.MM.YYYY' : 'YYYY-MM-DD';

export type ValueKind = 'num' | 'bool' | 'err' | 'check' | 'date';

/** Display text of a computed value, honoring the cell's type and format. */
export function formatCell(v: CellValue, meta: CellMeta, locale?: string): { text: string; kind?: ValueKind } {
  if (meta.type === 'checkbox') return { text: v === true ? '☑' : '☐', kind: 'check' };
  if (v === null || v === undefined) return { text: '' };
  if (v instanceof CellError) return { text: v.code, kind: 'err' };
  if (meta.type === 'dropdown' && meta.source) {
    const label = sourceLabel(meta.source, v);
    if (label !== undefined) return { text: label };
  }
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
  if (meta.type === 'dropdown' && meta.source) {
    const label = sourceLabel(meta.source, raw);
    if (label !== undefined) return label;
  }
  if (meta.type === 'date' && typeof raw === 'number') return formatSerialDate(raw, meta.dateFormat ?? defaultDateFormat(locale));
  return String(raw);
}

/** Reads text by a date pattern, so day and month cannot swap; undefined when it does not fit. */
export function parseByPattern(text: string, pattern: string): number | undefined {
  const order: string[] = [];
  const source = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/YYYY|YY|MM|M|DD|D|HH|mm|ss/g, (t) => {
      order.push(t);
      return t === 'YYYY' ? '(\\d{4})' : '(\\d{1,2})';
    });
  const m = new RegExp(`^${source}$`).exec(text);
  if (!m) return undefined;
  const part = (...tokens: string[]) => {
    const i = order.findIndex((t) => tokens.includes(t));
    return i < 0 ? undefined : Number(m[i + 1]);
  };
  const year = part('YYYY') ?? (part('YY') === undefined ? 1900 : 2000 + part('YY')!);
  const month = part('MM', 'M') ?? 1;
  const day = part('DD', 'D') ?? 1;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const time = ((part('HH') ?? 0) * 3600 + (part('mm') ?? 0) * 60 + (part('ss') ?? 0)) / 86400;
  const dated = order.some((t) => t[0] === 'Y' || t[0] === 'D' || t[0] === 'M');
  return (dated ? dateToSerial(year, month, day) : 0) + time;
}

/** Locales that write 1.234,5. */
const dotGroups = (locale?: string): boolean => !!locale && new Intl.NumberFormat(locale).format(1234.5).includes(',5');

/** Typed text -> stored value: numbers, booleans and (for date cells) dates are converted. */
export function convertInput(text: string, meta: CellMeta = {}, locale?: string): RawCell {
  if (text === '') return null;
  if (text.length > 1 && text[0] === '=') return text;
  if (meta.type === 'date') {
    const t = text.trim();
    return parseByPattern(t, meta.dateFormat ?? defaultDateFormat(locale)) ?? parseDateString(t) ?? text;
  }
  if (meta.type === 'checkbox') {
    const v = parseLiteral(text);
    return typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : text;
  }
  if (meta.type === 'numeric') {
    // Accept a decimal comma ("4,5" or "1.234,5"). Dots alone are thousands only in locales that
    // write them so: elsewhere 1.234 is a decimal.
    const t = text.trim();
    const grouped = /^[+-]?\d{1,3}(\.\d{3})+,\d+$/.test(t) || (dotGroups(locale) && /^[+-]?\d{1,3}(\.\d{3})+$/.test(t));
    if (grouped || /^[+-]?\d+,\d+$/.test(t)) {
      const n = parseNumber(t.replace(/\./g, '').replace(',', '.'));
      if (n !== undefined) return n;
    }
  }
  if (meta.type === 'dropdown' && meta.source) {
    // Typed or pasted labels become their value, matching exact text first.
    const t = text.trim().toLowerCase();
    const hit = meta.source.find((o) => optionLabel(o) === text) ?? meta.source.find((o) => optionLabel(o).toLowerCase() === t);
    if (hit !== undefined) return optionValue(hit);
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
    if (meta.type === 'dropdown' && meta.strict !== false && meta.source && sourceLabel(meta.source, value) === undefined)
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
