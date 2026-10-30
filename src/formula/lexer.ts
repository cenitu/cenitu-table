import { ERROR_CODES, type ErrorCode } from './values';
import { columnIndex, MAX_COLS, MAX_ROWS } from './address';

export type Token =
  | { type: 'number'; value: number; pos: number }
  | { type: 'string'; value: string; pos: number }
  | { type: 'bool'; value: boolean; pos: number }
  | { type: 'error'; value: ErrorCode; pos: number }
  | { type: 'ref'; row: number; col: number; rowAbs: boolean; colAbs: boolean; sheet?: string; pos: number }
  | { type: 'func'; value: string; pos: number }
  | { type: 'name'; value: string; pos: number }
  | { type: 'op'; value: string; pos: number }
  | { type: 'eof'; pos: number };

export class FormulaSyntaxError extends Error {
  constructor(message: string, readonly pos: number) {
    super(message);
  }
}

const NUMBER_RE = /(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/y;
const IDENT_RE = /[\p{L}_][\p{L}\p{N}_.]*/uy;
/** Unquoted sheet prefix such as `Sheet2!`. */
const SHEET_PREFIX_RE = /([\p{L}_][\p{L}\p{N}_.]*)!/uy;
const IDENT_START = /[\p{L}_]/u;
const REF_RE = /(\$?)([A-Za-z]{1,3})(\$?)(\d+)/y;
const TWO_CHAR_OPS = ['<=', '>=', '<>'];
const ONE_CHAR_OPS = '+-*/^&=<>%(),;:';

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const matchAt = (re: RegExp): RegExpExecArray | null => {
    re.lastIndex = i;
    return re.exec(src);
  };

  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    if ((ch >= '0' && ch <= '9') || (ch === '.' && /\d/.test(src[i + 1] ?? ''))) {
      const m = matchAt(NUMBER_RE)!;
      tokens.push({ type: 'number', value: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }

    if (ch === '"') {
      const start = i;
      let value = '';
      i++;
      for (;;) {
        if (i >= src.length) throw new FormulaSyntaxError('Unterminated string', start);
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += src[i++];
      }
      tokens.push({ type: 'string', value, pos: start });
      continue;
    }

    if (ch === '#') {
      const code = ERROR_CODES.find((c) => src.startsWith(c, i) || src.toUpperCase().startsWith(c, i));
      if (!code) throw new FormulaSyntaxError('Unknown error literal', i);
      tokens.push({ type: 'error', value: code, pos: i });
      i += code.length;
      continue;
    }

    if (ch === "'") {
      const start = i;
      let sheet = '';
      i++;
      for (;;) {
        if (i >= src.length) throw new FormulaSyntaxError('Unterminated sheet name', start);
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            sheet += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        sheet += src[i++];
      }
      if (src[i] !== '!') throw new FormulaSyntaxError('Expected "!" after sheet name', i);
      i = pushSheetRef(sheet, start, i + 1);
      continue;
    }

    if (ch === '$' || IDENT_START.test(ch)) {
      const prefix = ch === '$' ? null : matchAt(SHEET_PREFIX_RE);
      if (prefix) {
        i = pushSheetRef(prefix[1], i, i + prefix[0].length);
        continue;
      }
      const ref = tryRef(src, i);
      const ident = ch === '$' ? null : matchAt(IDENT_RE);
      // A function call wins over a cell reference ("LOG10(" is a function, not column LOG row 10).
      if (ident && nextNonSpace(src, i + ident[0].length) === '(') {
        tokens.push({ type: 'func', value: ident[0].toUpperCase(), pos: i });
        i += ident[0].length;
        continue;
      }
      if (ref && (!ident || ref.length >= ident[0].length)) {
        tokens.push({ ...ref.token, pos: i });
        i += ref.length;
        continue;
      }
      if (!ident) throw new FormulaSyntaxError('Invalid reference', i);
      const upper = ident[0].toUpperCase();
      if (upper === 'TRUE' || upper === 'FALSE') {
        tokens.push({ type: 'bool', value: upper === 'TRUE', pos: i });
      } else {
        tokens.push({ type: 'name', value: ident[0], pos: i });
      }
      i += ident[0].length;
      continue;
    }

    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) {
      tokens.push({ type: 'op', value: two, pos: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.includes(ch)) {
      tokens.push({ type: 'op', value: ch === ';' ? ',' : ch, pos: i });
      i++;
      continue;
    }
    throw new FormulaSyntaxError(`Unexpected character "${ch}"`, i);
  }
  tokens.push({ type: 'eof', pos: src.length });
  return tokens;

  function pushSheetRef(sheet: string, start: number, at: number): number {
    const ref = tryRef(src, at);
    if (!ref) throw new FormulaSyntaxError('Expected cell reference after "!"', at);
    tokens.push({ ...ref.token, sheet, pos: start });
    return at + ref.length;
  }
}

function nextNonSpace(src: string, i: number): string | undefined {
  while (i < src.length && src[i] === ' ') i++;
  return src[i];
}

function tryRef(src: string, i: number) {
  REF_RE.lastIndex = i;
  const m = REF_RE.exec(src);
  if (!m) return undefined;
  // Reject things like "A1B" where the reference is followed by identifier characters.
  if (/[\p{L}\p{N}_]/u.test(src[i + m[0].length] ?? '')) return undefined;
  const col = columnIndex(m[2]);
  const row = Number(m[4]) - 1;
  if (col < 0 || col >= MAX_COLS || row < 0 || row >= MAX_ROWS) return undefined;
  return {
    length: m[0].length,
    token: { type: 'ref' as const, row, col, colAbs: m[1] === '$', rowAbs: m[3] === '$' },
  };
}
