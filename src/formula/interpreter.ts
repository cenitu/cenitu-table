import type { Ast, RefNode } from './ast';
import './date-functions';
import { compare, toNumber, toScalar, toText } from './coerce';
import { getFunction, type FunctionContext } from './functions';
import { err, isError, normalizeNumber, RangeValue, type CellValue, type Value } from './values';

export interface EvaluationContext {
  /** Cell being evaluated: the default sheet, and the origin of relative references. */
  sheet: number;
  row: number;
  col: number;
  getCellValue(sheet: number, row: number, col: number): CellValue;
  /** Value of a named expression; a range-valued name yields a RangeValue. */
  resolveName?(name: string): Value;
  /** Optional shared range reader (bounds normalized); lets the engine reuse ranges within a recalculation. */
  getRange?(sheet: number, r0: number, c0: number, r1: number, c1: number): RangeValue;
}

export function readRange(ctx: EvaluationContext, sheet: number, r0: number, c0: number, r1: number, c1: number): RangeValue {
  const rows: CellValue[][] = [];
  for (let r = r0; r <= r1; r++) {
    const row: CellValue[] = [];
    for (let c = c0; c <= c1; c++) row.push(ctx.getCellValue(sheet, r, c));
    rows.push(row);
  }
  return new RangeValue(rows);
}

const refValue = (r: RefNode, ctx: EvaluationContext): CellValue =>
  ctx.getCellValue(r.sheet ?? ctx.sheet, r.rowAbs ? r.row : r.row + ctx.row, r.colAbs ? r.col : r.col + ctx.col);

export function evaluate(ast: Ast, ctx: EvaluationContext): Value {
  switch (ast.type) {
    case 'number':
      return ast.value;
    case 'string':
      return ast.value;
    case 'bool':
      return ast.value;
    case 'error':
      return err(ast.code);
    case 'ref':
      return refValue(ast, ctx);
    case 'range': {
      const { start, end } = ast;
      const sheet = start.sheet ?? ctx.sheet;
      const sr = start.rowAbs ? start.row : start.row + ctx.row;
      const er = end.rowAbs ? end.row : end.row + ctx.row;
      const sc = start.colAbs ? start.col : start.col + ctx.col;
      const ec = end.colAbs ? end.col : end.col + ctx.col;
      const [r0, r1, c0, c1] = [Math.min(sr, er), Math.max(sr, er), Math.min(sc, ec), Math.max(sc, ec)];
      return ctx.getRange ? ctx.getRange(sheet, r0, c0, r1, c1) : readRange(ctx, sheet, r0, c0, r1, c1);
    }
    case 'name':
      // An empty name is a skipped function argument, e.g. VLOOKUP(a,b,2,).
      if (ast.name === '') return null;
      return ctx.resolveName ? ctx.resolveName(ast.name) : err('#NAME?', `Unknown name "${ast.name}"`);
    case 'paren':
      return evaluate(ast.expr, ctx);
    case 'unary': {
      const n = toNumber(toScalar(evaluate(ast.arg, ctx)));
      if (isError(n)) return n;
      return ast.op === '-' ? -n : n;
    }
    case 'percent': {
      const n = toNumber(toScalar(evaluate(ast.arg, ctx)));
      return isError(n) ? n : n / 100;
    }
    case 'binary':
      return binary(ast.op, toScalar(evaluate(ast.left, ctx)), toScalar(evaluate(ast.right, ctx)));
    case 'call': {
      const fn = getFunction(ast.name);
      if (!fn) return err('#NAME?', `Unknown function ${ast.name}`);
      const fctx: FunctionContext = {
        evaluate: (node) => evaluate(node, ctx),
      };
      if (fn.lazy) return fn.lazy(ast.args, fctx);
      // For aggregates a single-cell reference behaves like a 1x1 range, so SUM(A1) ignores text
      // in A1 while SUM("text") is an error.
      const args = ast.args.map((a) =>
        fn.aggregate && a.type === 'ref' ? new RangeValue([[refValue(a, ctx)]]) : evaluate(a, ctx),
      );
      return fn.impl!(args, fctx);
    }
  }
}

function binary(op: string, a: CellValue, b: CellValue): CellValue {
  if (isError(a)) return a;
  if (isError(b)) return b;
  switch (op) {
    case '&': {
      const x = toText(a);
      const y = toText(b);
      if (isError(x)) return x;
      if (isError(y)) return y;
      return x + y;
    }
    case '=':
      return compare(a, b) === 0;
    case '<>':
      return compare(a, b) !== 0;
    case '<':
      return compare(a, b) < 0;
    case '<=':
      return compare(a, b) <= 0;
    case '>':
      return compare(a, b) > 0;
    case '>=':
      return compare(a, b) >= 0;
  }
  const x = toNumber(a);
  const y = toNumber(b);
  if (isError(x)) return x;
  if (isError(y)) return y;
  let result: number;
  switch (op) {
    case '+':
      result = x + y;
      break;
    case '-':
      result = x - y;
      break;
    case '*':
      result = x * y;
      break;
    case '/':
      if (y === 0) return err('#DIV/0!');
      result = x / y;
      break;
    case '^':
      if (x === 0 && y === 0) return err('#NUM!');
      result = Math.pow(x, y);
      break;
    default:
      return err('#ERROR!', `Unknown operator ${op}`);
  }
  return Number.isFinite(result) ? normalizeNumber(result) : err('#NUM!');
}
