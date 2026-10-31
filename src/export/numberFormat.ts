import { serialToDate } from '../formula/dates';
import { defaultDateFormat, type CellMeta, type NumericFormat } from '../grid/cellTypes';

/*
 * Format codes always use '.' as decimal point and ',' as group separator; the spreadsheet app
 * localizes them on display, so the same code works for tr-TR and en-US readers.
 */

/** Removes quoted literals, backslash escapes and [..] sections so only real tokens remain. */
function stripLiterals(code: string): string {
  return code.replace(/"[^"]*"|\\.|_.|\*./g, '').replace(/\[(?![hms]+\])[^\]]*\]/gi, '');
}

/** True when the first section of a format code displays a date or time. */
export function isDateFormat(code: string | undefined): boolean {
  if (!code) return false;
  const first = code.split(';')[0];
  return /[dmyhs]/i.test(stripLiterals(first).replace(/General/gi, ''));
}

// Characters that may appear unescaped in a format code.
const SAFE_LITERAL = /[-/.:, $+()!^&'~{}<>=]/;

/** Converts the grid's date pattern (YYYY, YY, MM, M, DD, D, HH, mm, ss) to a format code. */
export function dateCodeFromPattern(pattern: string): string {
  const map: Record<string, string> = { YYYY: 'yyyy', YY: 'yy', MM: 'mm', M: 'm', DD: 'dd', D: 'd', HH: 'hh', mm: 'mm', ss: 'ss' };
  let out = '';
  const re = /YYYY|YY|MM|M|DD|D|HH|mm|ss/g;
  let last = 0;
  for (let m = re.exec(pattern); m; m = re.exec(pattern)) {
    out += escapeLiterals(pattern.slice(last, m.index)) + map[m[0]];
    last = m.index + m[0].length;
  }
  return out + escapeLiterals(pattern.slice(last));
}

function escapeLiterals(text: string): string {
  let out = '';
  for (const ch of text) out += SAFE_LITERAL.test(ch) ? ch : `\\${ch}`;
  return out;
}

const quoteLiteral = (s: string): string => (s ? `"${s.replace(/"/g, '')}"` : '');

function digits(intPart: string, min: number, max: number): string {
  if (max <= 0) return intPart;
  return `${intPart}.${'0'.repeat(min)}${'#'.repeat(Math.max(0, max - min))}`;
}

function numericCode(f: NumericFormat, locale?: string): string | undefined {
  const style = f.style ?? 'decimal';
  const intPart = f.useGrouping === false ? '0' : '#,##0';
  if (style === 'percent') {
    const n = f.minimumFractionDigits ?? f.maximumFractionDigits ?? 0;
    return `${digits(intPart, n, f.maximumFractionDigits ?? n)}%`;
  }
  if (style === 'currency') {
    const nf = new Intl.NumberFormat(locale, { style: 'currency', currency: f.currency ?? 'TRY' });
    const ro = nf.resolvedOptions();
    const min = f.minimumFractionDigits ?? ro.minimumFractionDigits ?? 2;
    const max = Math.max(min, f.maximumFractionDigits ?? ro.maximumFractionDigits ?? min);
    // Take symbol and its position from Intl so the code matches what the grid shows.
    const parts = nf.formatToParts(1);
    const ci = parts.findIndex((p) => p.type === 'currency');
    const ii = parts.findIndex((p) => p.type === 'integer');
    const symbol = quoteLiteral(parts[ci]?.value ?? f.currency ?? '');
    const between = parts.slice(Math.min(ci, ii) + 1, Math.max(ci, ii)).some((p) => p.type === 'literal') ? ' ' : '';
    const num = digits(intPart, min, max);
    return ci < ii ? `${symbol}${between}${num}` : `${num}${between}${symbol}`;
  }
  // Plain numbers without explicit digits stay "General" so no decimals are cut off.
  // (grouping is lost then, but "#,##0.###" would show a stray "." on integers).
  if (f.minimumFractionDigits === undefined && f.maximumFractionDigits === undefined) return undefined;
  const min = f.minimumFractionDigits ?? 0;
  return digits(intPart, min, Math.max(min, f.maximumFractionDigits ?? min));
}

/** Maps grid cell settings (date type, numericFormat) to a spreadsheet format code. */
export function numberFormatFromMeta(meta: CellMeta, locale?: string): string | undefined {
  if (meta.formatCode) return meta.formatCode;
  if (meta.type === 'date') return dateCodeFromPattern(meta.dateFormat ?? defaultDateFormat(locale));
  if (meta.numericFormat) return numericCode(meta.numericFormat, locale);
  return undefined;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/**
 * Formats a serial date with a format code (first section). Covers the date/time tokens
 * (y, m, d, h, s, AM/PM, [h]) — enough for CSV output; it is not a general number formatter.
 */
export function formatDateCode(serial: number, code: string, locale?: string): string {
  const section = code.split(';')[0];
  const { year, month, day } = serialToDate(serial);
  let secs = Math.round((serial - Math.floor(serial)) * 86400);
  if (secs >= 86400) secs = 86399;
  const H = Math.floor(secs / 3600);
  const M = Math.floor(secs / 60) % 60;
  const S = secs % 60;
  const ampm = /AM\/PM|A\/P/i.test(stripLiterals(section));
  const h12 = H % 12 === 0 ? 12 : H % 12;
  const utc = new Date(Date.UTC(2000, 0, 1));
  utc.setUTCFullYear(year, month - 1, day);
  const dt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { ...o, timeZone: 'UTC' }).format(utc);

  const re = /"([^"]*)"|\\(.)|_(.)|\*(.)|\[(h+|m+|s+)\]|\[[^\]]*\]|AM\/PM|A\/P|y+|m+|d+|h+|s+|./gi;
  const tokens: string[] = [];
  for (let m = re.exec(section); m; m = re.exec(section)) tokens.push(m[0]);
  let out = '';
  tokens.forEach((t, i) => {
    const lower = t.toLowerCase();
    if (t[0] === '"') out += t.slice(1, -1);
    else if (t[0] === '\\') out += t[1];
    else if (t[0] === '_') out += ' ';
    else if (t[0] === '*') out += '';
    else if (/^\[h+\]$/i.test(t)) out += pad(Math.floor(serial) * 24 + H, lower.length - 2);
    else if (/^\[m+\]$/i.test(t)) out += pad(Math.floor(serial * 1440), lower.length - 2);
    else if (/^\[s+\]$/i.test(t)) out += pad(Math.floor(serial * 86400), lower.length - 2);
    else if (t[0] === '[') out += '';
    else if (lower === 'am/pm') out += H < 12 ? 'AM' : 'PM';
    else if (lower === 'a/p') out += H < 12 ? 'A' : 'P';
    else if (lower[0] === 'y') out += lower.length <= 2 ? pad(year % 100) : pad(year, 4);
    else if (lower[0] === 'd') {
      out += lower.length === 1 ? String(day) : lower.length === 2 ? pad(day) : dt({ weekday: lower.length === 3 ? 'short' : 'long' });
    } else if (lower[0] === 'h') out += lower.length === 1 ? String(ampm ? h12 : H) : pad(ampm ? h12 : H);
    else if (lower[0] === 's') out += lower.length === 1 ? String(S) : pad(S);
    else if (lower[0] === 'm') {
      // "m" means minutes right after an hour token or right before a seconds token.
      const prev = tokens.slice(0, i).reverse().find((x) => /^(\[?h+\]?|[dmys]+)$/i.test(x));
      const next = tokens.slice(i + 1).find((x) => /^(\[?s+\]?|[dmyh]+)$/i.test(x));
      const minute = (!!prev && /h/i.test(prev)) || (!!next && /s/i.test(next));
      if (minute && lower.length <= 2) out += lower.length === 1 ? String(M) : pad(M);
      else if (lower.length === 1) out += String(month);
      else if (lower.length === 2) out += pad(month);
      else out += dt({ month: lower.length === 3 ? 'short' : lower.length === 4 ? 'long' : 'narrow' });
    } else out += t;
  });
  return out;
}
