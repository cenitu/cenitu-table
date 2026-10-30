import type { Ast, RefNode } from './ast';
import { FormulaSyntaxError, tokenize, type Token } from './lexer';

// Binary operator precedence; all binary operators are left-associative (2^3^2 = 64).
const PRECEDENCE: Record<string, number> = {
  '=': 1, '<>': 1, '<': 1, '<=': 1, '>': 1, '>=': 1,
  '&': 2,
  '+': 3, '-': 3,
  '*': 4, '/': 4,
  '^': 5,
};

export interface ParseOptions {
  /** Maps a sheet name to its id; an unknown sheet turns the reference into #REF!. */
  resolveSheet?(name: string): number | undefined;
  /** Relative references are stored as offsets from this cell (default A1, i.e. absolute). */
  base?: { row: number; col: number };
}

/** Parses formula text without the leading "=". Throws FormulaSyntaxError on invalid input. */
export function parseFormula(text: string, options: ParseOptions = {}): Ast {
  const tokens = tokenize(text);
  const baseRow = options.base?.row ?? 0;
  const baseCol = options.base?.col ?? 0;
  let pos = 0;

  const makeRef = (t: Extract<Token, { type: 'ref' }>, sheet: number | undefined): RefNode => ({
    type: 'ref',
    row: t.rowAbs ? t.row : t.row - baseRow,
    col: t.colAbs ? t.col : t.col - baseCol,
    rowAbs: t.rowAbs,
    colAbs: t.colAbs,
    ...(sheet === undefined ? {} : { sheet }),
  });

  const peek = (): Token => tokens[pos];
  const next = (): Token => tokens[pos++];
  const isOp = (t: Token, value: string): boolean => t.type === 'op' && t.value === value;
  const expectOp = (value: string): void => {
    const t = next();
    if (!isOp(t, value)) throw new FormulaSyntaxError(`Expected "${value}"`, t.pos);
  };

  function parseExpression(minPrec: number): Ast {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (t.type !== 'op') break;
      const prec = PRECEDENCE[t.value];
      if (prec === undefined || prec < minPrec) break;
      next();
      const right = parseExpression(prec + 1);
      left = { type: 'binary', op: t.value, left, right };
    }
    return left;
  }

  // Unary minus binds tighter than "^", as in spreadsheets: -2^2 = 4.
  function parseUnary(): Ast {
    const t = peek();
    if (isOp(t, '-') || isOp(t, '+')) {
      next();
      return { type: 'unary', op: isOp(t, '-') ? '-' : '+', arg: parseUnary() };
    }
    let node = parsePrimary();
    while (isOp(peek(), '%')) {
      next();
      node = { type: 'percent', arg: node };
    }
    return node;
  }

  function parsePrimary(): Ast {
    const t = next();
    switch (t.type) {
      case 'number':
        return { type: 'number', value: t.value };
      case 'string':
        return { type: 'string', value: t.value };
      case 'bool':
        return { type: 'bool', value: t.value };
      case 'error':
        return { type: 'error', code: t.value };
      case 'name':
        return { type: 'name', name: t.value };
      case 'ref': {
        const sheet = t.sheet === undefined ? undefined : options.resolveSheet?.(t.sheet);
        const missing = t.sheet !== undefined && sheet === undefined;
        const start = makeRef(t, sheet);
        if (!isOp(peek(), ':')) return missing ? { type: 'error', code: '#REF!' } : start;
        next();
        const e = next();
        if (e.type !== 'ref') throw new FormulaSyntaxError('Expected cell reference after ":"', e.pos);
        if (e.sheet !== undefined && e.sheet.toUpperCase() !== t.sheet?.toUpperCase()) {
          throw new FormulaSyntaxError('A range cannot span sheets', e.pos);
        }
        return missing ? { type: 'error', code: '#REF!' } : { type: 'range', start, end: makeRef(e, sheet) };
      }
      case 'func': {
        expectOp('(');
        const args: Ast[] = [];
        if (!isOp(peek(), ')')) {
          for (;;) {
            // Empty argument, e.g. VLOOKUP(a,b,2,) — treated as missing.
            if (isOp(peek(), ',') || isOp(peek(), ')')) {
              args.push({ type: 'name', name: '' });
            } else {
              args.push(parseExpression(1));
            }
            if (!isOp(peek(), ',')) break;
            next();
          }
        }
        expectOp(')');
        return { type: 'call', name: t.value, args };
      }
      case 'op':
        if (t.value === '(') {
          const expr = parseExpression(1);
          expectOp(')');
          return { type: 'paren', expr };
        }
        throw new FormulaSyntaxError(`Unexpected "${t.value}"`, t.pos);
      case 'eof':
        throw new FormulaSyntaxError('Unexpected end of formula', t.pos);
    }
  }

  const ast = parseExpression(1);
  const rest = peek();
  if (rest.type !== 'eof') throw new FormulaSyntaxError('Unexpected token', rest.pos);
  return ast;
}
