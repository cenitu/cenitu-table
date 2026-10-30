import { rewriteRefs, visitRefs, type Ast, type RangeNode, type RefNode } from './ast';

/** Insertion or removal of `count` rows/columns at `index` on one sheet. */
export interface StructuralChange {
  sheet: number;
  axis: 'row' | 'col';
  index: number;
  count: number;
  remove: boolean;
}

export const REMOVED = -1;

/** New position of a row/column index, or REMOVED. */
export function moveIndex(ch: StructuralChange, n: number): number {
  if (n < ch.index) return n;
  if (!ch.remove) return n + ch.count;
  return n < ch.index + ch.count ? REMOVED : n - ch.count;
}

/**
 * New [lo, hi] of a span: inserting inside grows it, removing part of it shrinks it.
 * Undefined when the whole span is removed.
 */
export function moveSpan(ch: StructuralChange, lo: number, hi: number): [number, number] | undefined {
  if (!ch.remove) return [moveIndex(ch, lo), moveIndex(ch, hi)];
  const end = ch.index + ch.count;
  if (lo >= ch.index && hi < end) return undefined;
  return [lo < ch.index ? lo : lo < end ? ch.index : lo - ch.count, hi < ch.index ? hi : hi < end ? ch.index - 1 : hi - ch.count];
}

const refError = (): Ast => ({ type: 'error', code: '#REF!' });

/**
 * Applies one structural change to engine ASTs in place. Relative coordinates are offsets from the
 * formula cell, which itself moves from `homeBefore` to `homeAfter` on the changed axis, so a
 * formula that moves together with its targets keeps its AST. Written without closures because it
 * runs once per formula in the workbook.
 */
export class AstAdjuster {
  /** Some absolute target moved, so the formula text must be regenerated. */
  text = false;
  /** A reference became #REF! or a range grew/shrank: the value must be recalculated. */
  meaning = false;
  private homeSheet = 0;
  private homeBefore = 0;
  private homeAfter = 0;
  private readonly isRow: boolean;

  constructor(private readonly ch: StructuralChange) {
    this.isRow = ch.axis === 'row';
  }

  adjust(ast: Ast, homeSheet: number, homeBefore: number, homeAfter: number): Ast {
    this.text = this.meaning = false;
    this.homeSheet = homeSheet;
    this.homeBefore = homeBefore;
    this.homeAfter = homeAfter;
    return this.walk(ast);
  }

  private walk(node: Ast): Ast {
    switch (node.type) {
      case 'ref':
        return this.ref(node);
      case 'range':
        return this.range(node);
      case 'unary':
      case 'percent':
        node.arg = this.walk(node.arg);
        return node;
      case 'binary':
        node.left = this.walk(node.left);
        node.right = this.walk(node.right);
        return node;
      case 'paren':
        node.expr = this.walk(node.expr);
        return node;
      case 'call':
        for (let i = 0; i < node.args.length; i++) node.args[i] = this.walk(node.args[i]);
        return node;
      default:
        return node;
    }
  }

  private absolute(r: RefNode): number {
    if (this.isRow) return r.rowAbs ? r.row : r.row + this.homeBefore;
    return r.colAbs ? r.col : r.col + this.homeBefore;
  }

  private store(r: RefNode, n: number): void {
    if (this.isRow) r.row = r.rowAbs ? n : n - this.homeAfter;
    else r.col = r.colAbs ? n : n - this.homeAfter;
  }

  private ref(node: RefNode): Ast {
    const before = this.absolute(node);
    const after = (node.sheet ?? this.homeSheet) === this.ch.sheet ? moveIndex(this.ch, before) : before;
    if (after === REMOVED) {
      this.text = this.meaning = true;
      return refError();
    }
    if (after !== before) this.text = true;
    this.store(node, after);
    return node;
  }

  private range(node: RangeNode): Ast {
    const a = this.absolute(node.start);
    const b = this.absolute(node.end);
    let na = a;
    let nb = b;
    if ((node.start.sheet ?? this.homeSheet) === this.ch.sheet) {
      const lo = a <= b ? a : b;
      const hi = a <= b ? b : a;
      const span = moveSpan(this.ch, lo, hi);
      if (!span) {
        this.text = this.meaning = true;
        return refError();
      }
      if (span[1] - span[0] !== hi - lo) this.meaning = true;
      if (span[0] !== lo || span[1] !== hi) this.text = true;
      na = a <= b ? span[0] : span[1];
      nb = a <= b ? span[1] : span[0];
    }
    this.store(node.start, na);
    this.store(node.end, nb);
    return node;
  }
}
/**
 * Whether a removal would break or shrink a reference of this formula (read-only check).
 * `homePos` is the formula cell's index on the changed axis.
 */
export function touchesRemoval(ch: StructuralChange, ast: Ast, homeSheet: number, homePos: number): boolean {
  const isRow = ch.axis === 'row';
  const end = ch.index + ch.count;
  const pos = (r: RefNode) => (isRow ? (r.rowAbs ? r.row : r.row + homePos) : r.colAbs ? r.col : r.col + homePos);
  let hit = false;
  visitRefs(ast, (n) => {
    if (hit || n.type === 'name') return;
    const target = n.type === 'ref' ? n : n.start;
    if ((target.sheet ?? homeSheet) !== ch.sheet) return;
    if (n.type === 'ref') {
      const p = pos(n);
      hit = p >= ch.index && p < end;
    } else {
      const a = pos(n.start);
      const b = pos(n.end);
      hit = Math.min(a, b) < end && Math.max(a, b) >= ch.index;
    }
  });
  return hit;
}

/** Replaces every reference to `sheet` with #REF! (sheet removal). Returns whether anything changed. */
export function dropSheetRefs(ast: Ast, sheet: number, homeSheet: number): { ast: Ast; changed: boolean } {
  let changed = false;
  const result = rewriteRefs(ast, (node) => {
    const target = node.type === 'ref' ? node.sheet : node.type === 'range' ? node.start.sheet : undefined;
    if (node.type === 'name' || (target ?? homeSheet) !== sheet) return node;
    changed = true;
    return refError();
  });
  return { ast: result, changed };
}
