import { columnLabel, parseA1 } from './address';
import type { ErrorCode } from './values';

/**
 * Cell reference. In engine-owned ASTs the non-absolute coordinates are offsets from the formula's
 * own cell (see ParseOptions.base), so a formula that moves together with its targets is unchanged.
 */
export interface RefNode {
  type: 'ref';
  row: number;
  col: number;
  rowAbs: boolean;
  colAbs: boolean;
  /** Explicit sheet id (`Sheet2!A1`); undefined means the formula's own sheet. */
  sheet?: number;
}

export type RangeNode = { type: 'range'; start: RefNode; end: RefNode };

export type Ast =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'bool'; value: boolean }
  | { type: 'error'; code: ErrorCode }
  | RefNode
  | RangeNode
  | { type: 'name'; name: string }
  | { type: 'unary'; op: '-' | '+'; arg: Ast }
  | { type: 'percent'; arg: Ast }
  | { type: 'binary'; op: string; left: Ast; right: Ast }
  | { type: 'paren'; expr: Ast }
  | { type: 'call'; name: string; args: Ast[] };

export interface UnparseOptions {
  /** Cell that relative coordinates are offsets from (default A1, i.e. coordinates are absolute). */
  base?: { row: number; col: number };
  sheetName?(id: number): string | undefined;
}

const PLAIN_SHEET_NAME = /^[\p{L}_][\p{L}\p{N}_.]*$/u;

/** Quotes a sheet name when it would not lex as a plain identifier: 'My Sheet', 'A1', 'It''s'. */
export function quoteSheetName(name: string): string {
  const plain = PLAIN_SHEET_NAME.test(name) && !parseA1(name) && !/^(TRUE|FALSE)$/i.test(name);
  return plain ? name : `'${name.replace(/'/g, "''")}'`;
}

export function refToString(r: RefNode, opts: UnparseOptions = {}): string {
  const row = r.rowAbs ? r.row : r.row + (opts.base?.row ?? 0);
  const col = r.colAbs ? r.col : r.col + (opts.base?.col ?? 0);
  if (row < 0 || col < 0) return '#REF!';
  return `${r.colAbs ? '$' : ''}${columnLabel(col)}${r.rowAbs ? '$' : ''}${row + 1}`;
}

function sheetPrefix(r: RefNode, opts: UnparseOptions): string {
  if (r.sheet === undefined) return '';
  return quoteSheetName(opts.sheetName?.(r.sheet) ?? `Sheet${r.sheet + 1}`) + '!';
}

/** Serializes an AST back to formula text (without the leading "="). */
export function unparse(ast: Ast, opts: UnparseOptions = {}): string {
  const go = (a: Ast): string => unparse(a, opts);
  switch (ast.type) {
    case 'number':
      return String(ast.value);
    case 'string':
      return `"${ast.value.replace(/"/g, '""')}"`;
    case 'bool':
      return ast.value ? 'TRUE' : 'FALSE';
    case 'error':
      return ast.code;
    case 'ref': {
      const text = refToString(ast, opts);
      return text === '#REF!' ? text : sheetPrefix(ast, opts) + text;
    }
    case 'range': {
      const start = refToString(ast.start, opts);
      const end = refToString(ast.end, opts);
      return start === '#REF!' || end === '#REF!' ? '#REF!' : `${sheetPrefix(ast.start, opts)}${start}:${end}`;
    }
    case 'name':
      return ast.name;
    case 'unary':
      return ast.op + go(ast.arg);
    case 'percent':
      return go(ast.arg) + '%';
    case 'binary':
      return go(ast.left) + ast.op + go(ast.right);
    case 'paren':
      return `(${go(ast.expr)})`;
    case 'call':
      return `${ast.name}(${ast.args.map(go).join(',')})`;
  }
}

/** Rebuilds the tree bottom-up, letting `fn` replace reference and range nodes. */
export function mapRefs(ast: Ast, fn: (node: RefNode | RangeNode) => Ast): Ast {
  switch (ast.type) {
    case 'ref':
    case 'range':
      return fn(ast);
    case 'unary':
      return { ...ast, arg: mapRefs(ast.arg, fn) };
    case 'percent':
      return { ...ast, arg: mapRefs(ast.arg, fn) };
    case 'binary':
      return { ...ast, left: mapRefs(ast.left, fn), right: mapRefs(ast.right, fn) };
    case 'paren':
      return { ...ast, expr: mapRefs(ast.expr, fn) };
    case 'call':
      return { ...ast, args: ast.args.map((a) => mapRefs(a, fn)) };
    default:
      return ast;
  }
}

type Leaf = RefNode | RangeNode | Extract<Ast, { type: 'name' }>;

/** Visits references, ranges and names without allocating. */
export function visitRefs(ast: Ast, fn: (node: Leaf) => void): void {
  switch (ast.type) {
    case 'ref':
    case 'range':
    case 'name':
      return fn(ast);
    case 'unary':
    case 'percent':
      return visitRefs(ast.arg, fn);
    case 'binary':
      visitRefs(ast.left, fn);
      return visitRefs(ast.right, fn);
    case 'paren':
      return visitRefs(ast.expr, fn);
    case 'call':
      for (const a of ast.args) visitRefs(a, fn);
  }
}

/** Visits the name of every function call. */
export function visitCalls(ast: Ast, fn: (name: string) => void): void {
  switch (ast.type) {
    case 'unary':
    case 'percent':
      return visitCalls(ast.arg, fn);
    case 'binary':
      visitCalls(ast.left, fn);
      return visitCalls(ast.right, fn);
    case 'paren':
      return visitCalls(ast.expr, fn);
    case 'call':
      fn(ast.name);
      for (const a of ast.args) visitCalls(a, fn);
  }
}

/**
 * Replaces children in place: `fn` gets every reference, range and name and returns the node
 * to keep (itself, possibly mutated) or a replacement. Used by structural changes to avoid copying.
 */
export function rewriteRefs(ast: Ast, fn: (node: Leaf) => Ast): Ast {
  switch (ast.type) {
    case 'ref':
    case 'range':
    case 'name':
      return fn(ast);
    case 'unary':
    case 'percent':
      ast.arg = rewriteRefs(ast.arg, fn);
      return ast;
    case 'binary':
      ast.left = rewriteRefs(ast.left, fn);
      ast.right = rewriteRefs(ast.right, fn);
      return ast;
    case 'paren':
      ast.expr = rewriteRefs(ast.expr, fn);
      return ast;
    case 'call':
      for (let i = 0; i < ast.args.length; i++) ast.args[i] = rewriteRefs(ast.args[i], fn);
      return ast;
    default:
      return ast;
  }
}
