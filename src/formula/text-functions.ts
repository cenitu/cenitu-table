import { asArray, mapArrays } from './arrays';
import { toBool, toNumber, toScalar, toText } from './coerce';
import { parseDateString } from './dates';
import { hasWildcards, registerFunction, wildcardRegExp, type FunctionImpl } from './functions';
import { formatTextSection, formatValue } from './text-format';
import { err, isError, parseNumber, type CellError, type CellValue } from './values';

/** Longest text a cell may hold; longer results are #VALUE! as in spreadsheets. */
const MAX_TEXT = 32767;

/** Scalar implementation mapped over array arguments; errors in any argument propagate. */
function lifted(fn: (...v: CellValue[]) => CellValue): FunctionImpl {
  return (args) =>
    mapArrays(args, (...values) => {
      const e = values.find(isError);
      return e ?? fn(...values);
    });
}

function textArg(v: CellValue): string | CellError {
  return toText(v);
}

function intArg(v: CellValue): number | CellError {
  const n = toNumber(v);
  return isError(n) ? n : Math.trunc(n);
}

/** Numeric value of text: plain numbers, "1,234.5", percentages, dates and times. */
export function valueOfText(text: string): number | undefined {
  const t = text.trim();
  const plain = parseNumber(t);
  if (plain !== undefined) return plain;
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d*)?%?$/.test(t)) return parseNumber(t.replace(/,/g, ''));
  const date = parseDateString(t);
  if (date !== undefined) return date;
  const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (time && Number(time[2]) < 60 && Number(time[3] ?? 0) < 60) {
    return (Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3] ?? 0)) / 86400;
  }
  return undefined;
}

registerFunction('TEXT', { minArgs: 2, maxArgs: 2, impl: lifted((v, f) => {
  const format = textArg(f);
  if (isError(format)) return format;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  let n: number;
  if (typeof v === 'string') {
    const parsed = valueOfText(v);
    if (parsed === undefined) return formatTextSection(v, format) ?? v;
    n = parsed;
  } else {
    n = (v as number | null) ?? 0;
  }
  return formatValue(n, format) ?? err('#VALUE!', 'Value cannot be formatted as a date');
}) });

registerFunction('VALUE', { minArgs: 1, maxArgs: 1, impl: lifted((v) => {
  if (typeof v === 'number') return v;
  if (v === null) return 0;
  if (typeof v === 'boolean') return err('#VALUE!');
  return valueOfText(v as string) ?? err('#VALUE!', `"${v}" is not a number`);
}) });

function find(caseSensitive: boolean): FunctionImpl {
  return lifted((needleV, haystackV, startV = 1) => {
    const needle = textArg(needleV);
    const haystack = textArg(haystackV);
    const start = intArg(startV);
    if (isError(needle)) return needle;
    if (isError(haystack)) return haystack;
    if (isError(start)) return start;
    if (start < 1 || start > Math.max(haystack.length, 1)) return err('#VALUE!');
    let pos: number;
    if (caseSensitive) {
      pos = haystack.indexOf(needle, start - 1);
    } else if (hasWildcards(needle)) {
      const m = wildcardRegExp(needle, false).exec(haystack.slice(start - 1));
      pos = m ? m.index + start - 1 : -1;
    } else {
      pos = haystack.toLowerCase().indexOf(needle.toLowerCase(), start - 1);
    }
    return pos < 0 ? err('#VALUE!', 'Text not found') : pos + 1;
  });
}

registerFunction('FIND', { minArgs: 2, maxArgs: 3, impl: find(true) });
registerFunction('SEARCH', { minArgs: 2, maxArgs: 3, impl: find(false) });

registerFunction('SUBSTITUTE', { minArgs: 3, maxArgs: 4, impl: lifted((textV, oldV, newV, instanceV) => {
  const text = textArg(textV);
  const from = textArg(oldV);
  const to = textArg(newV);
  if (isError(text)) return text;
  if (isError(from)) return from;
  if (isError(to)) return to;
  if (from === '') return text;
  if (instanceV === undefined) return text.split(from).join(to);
  const n = intArg(instanceV);
  if (isError(n)) return n;
  if (n < 1) return err('#VALUE!');
  let at = -1;
  for (let i = 0; i < n; i++) {
    at = text.indexOf(from, at + (i === 0 ? 0 : from.length));
    if (at < 0) return text;
  }
  return text.slice(0, at) + to + text.slice(at + from.length);
}) });

registerFunction('REPLACE', { minArgs: 4, maxArgs: 4, impl: lifted((textV, startV, countV, newV) => {
  const text = textArg(textV);
  const start = intArg(startV);
  const count = intArg(countV);
  const to = textArg(newV);
  if (isError(text)) return text;
  if (isError(start)) return start;
  if (isError(count)) return count;
  if (isError(to)) return to;
  if (start < 1 || count < 0) return err('#VALUE!');
  return text.slice(0, start - 1) + to + text.slice(start - 1 + count);
}) });

registerFunction('REPT', { minArgs: 2, maxArgs: 2, impl: lifted((textV, countV) => {
  const text = textArg(textV);
  const count = intArg(countV);
  if (isError(text)) return text;
  if (isError(count)) return count;
  if (count < 0 || text.length * count > MAX_TEXT) return err('#VALUE!');
  return text.repeat(count);
}) });

registerFunction('PROPER', { minArgs: 1, maxArgs: 1, impl: lifted((v) => {
  const text = textArg(v);
  if (isError(text)) return text;
  // A letter is capitalized when the character before it is not a letter ("o'neil" -> "O'Neil").
  let out = '';
  let prevLetter = false;
  for (const ch of text) {
    const letter = /\p{L}/u.test(ch);
    out += letter ? (prevLetter ? ch.toLowerCase() : ch.toUpperCase()) : ch;
    prevLetter = letter;
  }
  return out;
}) });

registerFunction('EXACT', { minArgs: 2, maxArgs: 2, impl: lifted((a, b) => {
  const x = textArg(a);
  const y = textArg(b);
  if (isError(x)) return x;
  if (isError(y)) return y;
  return x === y;
}) });

registerFunction('TEXTJOIN', { minArgs: 3, impl: (args) => {
  const delimiters: string[] = [];
  for (const d of asArray(args[0]).flat()) {
    const s = toText(d);
    if (isError(s)) return s;
    delimiters.push(s);
  }
  const ignoreEmpty = toBool(toScalar(args[1]));
  if (isError(ignoreEmpty)) return ignoreEmpty;
  const parts: string[] = [];
  for (const a of args.slice(2)) {
    for (const v of asArray(a).flat()) {
      if (isError(v)) return v;
      const s = toText(v) as string;
      if (ignoreEmpty && s === '') continue;
      parts.push(s);
    }
  }
  // Several delimiters are used in turn.
  let out = parts[0] ?? '';
  for (let i = 1; i < parts.length; i++) out += (delimiters.length ? delimiters[(i - 1) % delimiters.length] : '') + parts[i];
  return out.length > MAX_TEXT ? err('#VALUE!') : out;
} });
