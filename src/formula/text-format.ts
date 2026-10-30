import { formatNumber } from './coerce';
import { serialToDate } from './dates';
import { normalizeNumber } from './values';

/**
 * Number and date formatting for TEXT. Supported (en-US separators, English month/day names):
 * - sections `positive;negative;zero;text` (`@` in the text section is the text itself);
 * - digit placeholders `0` (mandatory), `#` and `?` (optional), decimal point `.`, thousands `,`,
 *   trailing `,` (scale by 1000 each), `%` (scale by 100), scientific `0.00E+00`;
 * - date/time tokens `yyyy yy mmmm mmm mm m dddd ddd dd d hh h mm m ss s AM/PM A/P`
 *   (`m`/`mm` means minutes right after an hour or before a seconds token);
 * - literals: "quoted text", `\x`, `_x` (one space), `*x` (ignored) and any other character.
 * Not supported: colors/conditions (`[Red]`, `[>100]`), elapsed time (`[h]`), fractions (`# ?/?`),
 * literals between digit placeholders (`000-0000`).
 */
export function formatValue(value: number, format: string): string | undefined {
  const sections = splitSections(format);
  let section = sections[0];
  let minus = value < 0;
  if (value < 0 && sections.length > 1 && sections[1] !== '') {
    section = sections[1];
    minus = false;
  } else if (value === 0 && sections.length > 2 && sections[2] !== '') {
    section = sections[2];
  }
  const tokens = tokenize(section);
  // Dates keep their sign (negative serials cannot be shown) unless a negative section is in use.
  if (tokens.some((t) => t.kind === 'date')) return formatDate(value < 0 && !minus ? -value : value, tokens);
  const abs = Math.abs(value);
  if (tokens.length === 0 || /^general$/i.test(section.trim())) return (minus ? '-' : '') + formatNumber(abs);
  const text = formatNumberTokens(abs, tokens);
  // No minus for a value that rounds to zero ("-0.00").
  return minus && /[1-9]/.test(text) ? '-' + text : text;
}

/** The text section (4th) applied to a text value; undefined when the format has none. */
export function formatTextSection(value: string, format: string): string | undefined {
  const sections = splitSections(format);
  const section = sections.length > 3 ? sections[3] : sections.length === 1 && section1IsText(sections[0]) ? sections[0] : undefined;
  if (section === undefined) return undefined;
  return tokenize(section)
    .map((t) => (t.kind === 'lit' ? t.text : t.kind === 'ph' && t.ch === '@' ? value : ''))
    .join('');
}

const section1IsText = (s: string): boolean => tokenize(s).some((t) => t.kind === 'ph' && t.ch === '@');

type Token = { kind: 'lit'; text: string } | { kind: 'ph'; ch: string } | { kind: 'date'; text: string };

function splitSections(format: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < format.length; i++) {
    const ch = format[i];
    if (ch === '"') {
      const end = format.indexOf('"', i + 1);
      const stop = end < 0 ? format.length : end;
      cur += format.slice(i, stop + 1);
      i = stop;
    } else if (ch === '\\' && i + 1 < format.length) {
      cur += ch + format[++i];
    } else if (ch === ';') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const DATE_TOKEN = /^(am\/pm|a\/p|y+|m+|d+|h+|s+)/i;

function tokenize(section: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < section.length; i++) {
    const ch = section[i];
    const rest = section.slice(i);
    if (ch === '"') {
      const end = section.indexOf('"', i + 1);
      const stop = end < 0 ? section.length : end;
      tokens.push({ kind: 'lit', text: section.slice(i + 1, stop) });
      i = stop;
    } else if (ch === '\\') {
      if (i + 1 < section.length) tokens.push({ kind: 'lit', text: section[++i] });
    } else if (ch === '_') {
      i++;
      tokens.push({ kind: 'lit', text: ' ' });
    } else if (ch === '*') {
      i++;
    } else if (ch === '[') {
      // Colors and conditions are not supported; skip the bracketed part.
      const end = section.indexOf(']', i);
      i = end < 0 ? section.length : end;
    } else if ('0#?.,%@'.includes(ch)) {
      tokens.push({ kind: 'ph', ch });
    } else if ((ch === 'E' || ch === 'e') && /^[eE][+-]0/.test(rest)) {
      tokens.push({ kind: 'ph', ch: 'E' + rest[1] });
      i++;
    } else {
      const m = DATE_TOKEN.exec(rest);
      if (m) {
        tokens.push({ kind: 'date', text: m[0] });
        i += m[0].length - 1;
      } else {
        tokens.push({ kind: 'lit', text: ch });
      }
    }
  }
  return tokens;
}

const isDigit = (t: Token): boolean => t.kind === 'ph' && (t.ch === '0' || t.ch === '#' || t.ch === '?');

function formatNumberTokens(value: number, tokens: Token[]): string {
  const first = tokens.findIndex(isDigit);
  if (first < 0) {
    // Only literals (and maybe %): the number itself is not shown.
    return tokens.map((t) => (t.kind === 'lit' ? t.text : t.kind === 'ph' && t.ch === '%' ? '%' : '')).join('');
  }
  let last = tokens.length - 1;
  while (!isDigit(tokens[last])) last--;
  // Separators right after the last digit ("0." or "#,##0,") still belong to the number.
  while (last + 1 < tokens.length && tokens[last + 1].kind === 'ph' && ',.'.includes((tokens[last + 1] as { ch: string }).ch)) last++;

  let scaled = value;
  for (const t of tokens) if (t.kind === 'ph' && t.ch === '%') scaled *= 100;

  const spec = tokens.slice(first, last + 1).filter((t): t is { kind: 'ph'; ch: string } => t.kind === 'ph');
  const expAt = spec.findIndex((t) => t.ch.startsWith('E'));
  const mantissa = expAt < 0 ? spec : spec.slice(0, expAt);
  const dot = mantissa.findIndex((t) => t.ch === '.');
  const intSpec = (dot < 0 ? mantissa : mantissa.slice(0, dot)).map((t) => t.ch).join('');
  const fracSpec = dot < 0 ? '' : mantissa.slice(dot + 1).map((t) => t.ch).join('').replace(/[^0#?]/g, '');
  const intDigits = intSpec.replace(/[^0#?]/g, '');
  const grouping = /[0#?],+[0#?]/.test(intSpec);
  // Each comma after the last integer digit ("#,##0," or "0,.0") divides by 1000.
  scaled /= Math.pow(1000, /,+$/.exec(intSpec)?.[0].length ?? 0);

  let body: string;
  if (expAt >= 0) {
    const expSpec = spec.slice(expAt);
    const expDigits = Math.max(expSpec.slice(1).filter((t) => t.ch === '0').length, 1);
    const sign = expSpec[0].ch[1];
    let exp = scaled === 0 ? 0 : Math.floor(Math.log10(scaled)) - Math.max(intDigits.length - 1, 0);
    let m = scaled / Math.pow(10, exp);
    const digits = numberBody(m, intDigits, fracSpec, false, dot >= 0);
    if (Number(digits.replace(/,/g, '')) >= Math.pow(10, Math.max(intDigits.length, 1))) {
      exp++;
      m = scaled / Math.pow(10, exp);
    }
    const expText = String(Math.abs(exp)).padStart(expDigits, '0');
    body = numberBody(m, intDigits, fracSpec, false, dot >= 0) + 'E' + (exp < 0 ? '-' : sign === '+' ? '+' : '') + expText;
  } else {
    body = numberBody(scaled, intDigits, fracSpec, grouping, dot >= 0);
  }

  // Outside the number, separators and % print as themselves.
  const literal = (t: Token): string => (t.kind === 'lit' ? t.text : t.kind === 'ph' && ',.%'.includes(t.ch) ? t.ch : '');
  return tokens.slice(0, first).map(literal).join('') + body + tokens.slice(last + 1).map(literal).join('');
}

function numberBody(value: number, intDigits: string, fracSpec: string, grouping: boolean, showDot: boolean): string {
  const decimals = fracSpec.length;
  const minFrac = fracSpec.lastIndexOf('0') + 1;
  const minInt = (intDigits.match(/0/g) ?? []).length;
  const f = Math.pow(10, decimals);
  const rounded = normalizeNumber(Math.round(value * f + 1e-9 * Math.sign(value)) / f);
  let [intPart, fracPart = ''] = rounded.toFixed(decimals).split('.');
  while (fracPart.length > minFrac && fracPart.endsWith('0')) fracPart = fracPart.slice(0, -1);
  if (intPart === '0' && minInt === 0) intPart = '';
  intPart = intPart.padStart(minInt, '0');
  if (grouping) intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return intPart + (showDot ? '.' + fracPart : '');
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad2 = (n: number): string => String(n).padStart(2, '0');

function formatDate(serial: number, tokens: Token[]): string | undefined {
  if (serial < 0) return undefined;
  const totalSeconds = Math.round(serial * 86400);
  const day = Math.floor(totalSeconds / 86400);
  const secs = totalSeconds - day * 86400;
  const { year, month, day: dom } = serialToDate(day);
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor(secs / 60) % 60;
  const seconds = secs % 60;
  const twelveHour = tokens.some((t) => t.kind === 'date' && /^a/i.test(t.text));
  const weekday = (((day - 1) % 7) + 7) % 7;

  const kindAt = (i: number, step: number): string | undefined => {
    for (let j = i + step; j >= 0 && j < tokens.length; j += step) {
      const t = tokens[j];
      if (t.kind === 'date') return t.text[0].toLowerCase();
    }
    return undefined;
  };

  return tokens
    .map((t, i) => {
      if (t.kind === 'lit') return t.text;
      if (t.kind === 'ph') return t.ch === '@' ? '' : t.ch;
      const text = t.text;
      const lower = text.toLowerCase();
      const n = text.length;
      switch (lower[0]) {
        case 'y':
          return n <= 2 ? pad2(year % 100) : String(year).padStart(4, '0');
        case 'm':
          if (n <= 2 && (kindAt(i, -1) === 'h' || kindAt(i, 1) === 's')) return n === 2 ? pad2(minutes) : String(minutes);
          if (n === 1) return String(month);
          if (n === 2) return pad2(month);
          if (n === 3) return MONTHS[month - 1].slice(0, 3);
          if (n === 5) return MONTHS[month - 1][0];
          return MONTHS[month - 1];
        case 'd':
          if (n === 1) return String(dom);
          if (n === 2) return pad2(dom);
          if (n === 3) return DAYS[weekday].slice(0, 3);
          return DAYS[weekday];
        case 'h': {
          const h = twelveHour ? ((hours + 11) % 12) + 1 : hours;
          return n >= 2 ? pad2(h) : String(h);
        }
        case 's':
          return n >= 2 ? pad2(seconds) : String(seconds);
        default: {
          // AM/PM or A/P, keeping the case written in the format.
          const pm = hours >= 12;
          if (lower === 'a/p') return pm ? (text[2] === 'P' ? 'P' : 'p') : text[0];
          const am = text.slice(0, 2);
          const pmText = text.slice(3, 5);
          return pm ? pmText : am;
        }
      }
    })
    .join('');
}
