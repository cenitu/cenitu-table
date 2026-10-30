/**
 * Spreadsheet serial dates, 1900 date system: 1 = 1900-01-01 and the fraction is the time of day.
 * Serial 60 is the fictitious 1900-02-29 kept for compatibility, so modern serials match Excel
 * (25569 = 1970-01-01).
 */

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

const MS_PER_DAY = 86_400_000;
const UNIX_EPOCH_SERIAL = 25569;
const FAKE_LEAP_DAY = 60;

/** UTC date built with setUTCFullYear, because Date.UTC maps years 0-99 to 1900-1999. */
function utcDate(year: number, month: number, day: number): Date {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  return d;
}

export function daysInMonth(year: number, month: number): number {
  return utcDate(year, month + 1, 0).getUTCDate();
}

/** Serial number of a date. Month and day may overflow (month 13 = January of the next year), as in DATE. */
export function dateToSerial(year: number, month: number, day: number): number {
  if (year === 1900 && month === 2 && day === 29) return FAKE_LEAP_DAY;
  const serial = Math.round(utcDate(year, month, day).getTime() / MS_PER_DAY) + UNIX_EPOCH_SERIAL;
  return serial <= FAKE_LEAP_DAY ? serial - 1 : serial;
}

export function serialToDate(serial: number): DateParts {
  const s = Math.floor(serial);
  if (s === FAKE_LEAP_DAY) return { year: 1900, month: 2, day: 29 };
  const d = new Date(((s < FAKE_LEAP_DAY ? s + 1 : s) - UNIX_EPOCH_SERIAL) * MS_PER_DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DMY_RE = /^(\d{1,2})([./])(\d{1,2})\2(\d{4})$/;

/** Parses 'YYYY-MM-DD', 'DD.MM.YYYY' or 'DD/MM/YYYY' into a serial; invalid calendar dates give undefined. */
export function parseDateString(text: string): number | undefined {
  const t = text.trim();
  let m = ISO_RE.exec(t);
  let parts: [number, number, number] | undefined;
  if (m) parts = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = DMY_RE.exec(t))) parts = [Number(m[4]), Number(m[3]), Number(m[1])];
  if (!parts) return undefined;
  const [year, month, day] = parts;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  return dateToSerial(year, month, day);
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/**
 * Formats a serial with tokens YYYY, YY, MM, M, DD, D (date) and HH, mm, ss (time, case-sensitive).
 * Default pattern 'YYYY-MM-DD'.
 */
export function formatSerialDate(serial: number, pattern = 'YYYY-MM-DD'): string {
  const { year, month, day } = serialToDate(serial);
  const seconds = Math.round((serial - Math.floor(serial)) * 86400);
  const tokens: Record<string, string> = {
    YYYY: pad(year, 4),
    YY: pad(year % 100),
    MM: pad(month),
    M: String(month),
    DD: pad(day),
    D: String(day),
    HH: pad(Math.floor(seconds / 3600) % 24),
    mm: pad(Math.floor(seconds / 60) % 60),
    ss: pad(seconds % 60),
  };
  return pattern.replace(/YYYY|YY|MM|M|DD|D|HH|mm|ss/g, (t) => tokens[t]);
}

/** Serial of the current local date (with `withTime`, plus the time of day as a fraction). */
export function currentSerial(withTime: boolean, now = new Date()): number {
  const date = dateToSerial(now.getFullYear(), now.getMonth() + 1, now.getDate());
  if (!withTime) return date;
  const ms = ((now.getHours() * 60 + now.getMinutes()) * 60 + now.getSeconds()) * 1000 + now.getMilliseconds();
  return date + ms / MS_PER_DAY;
}
