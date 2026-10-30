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

/**
 * How one structural operation renumbers the rows (or columns) of one sheet: insertion/removal
 * (`ShiftMap`) or moving a block (`MoveMap`). Classes rather than closures because the adjuster
 * calls them once per reference in the workbook.
 */
export interface AxisMap {
  readonly sheet: number;
  readonly axis: 'row' | 'col';
  /** New index, or REMOVED. */
  index(n: number): number;
  /** New [lo, hi] of a span (lo <= hi), or undefined when the whole span is removed. */
  span(lo: number, hi: number): [number, number] | undefined;
}

export class ShiftMap implements AxisMap {
  readonly sheet: number;
  readonly axis: 'row' | 'col';
  constructor(private readonly ch: StructuralChange) {
    this.sheet = ch.sheet;
    this.axis = ch.axis;
  }
  index(n: number): number {
    return moveIndex(this.ch, n);
  }
  span(lo: number, hi: number): [number, number] | undefined {
    return moveSpan(this.ch, lo, hi);
  }
}

/**
 * Moving `count` rows/columns from `start` so they are inserted before `target` (an index in
 * pre-move coordinates). Every index has a new place, so nothing becomes #REF!; a span keeps its
 * first and last cells, wherever they went.
 */
export class MoveMap implements AxisMap {
  constructor(
    readonly sheet: number,
    readonly axis: 'row' | 'col',
    private readonly start: number,
    private readonly count: number,
    private readonly target: number,
  ) {}
  index(n: number): number {
    const { start, count, target } = this;
    const end = start + count;
    if (target > end) {
      if (n < start || n >= target) return n;
      return n < end ? n + target - end : n - count;
    }
    if (n < target || n >= end) return n;
    return n >= start ? n - (start - target) : n + count;
  }
  span(lo: number, hi: number): [number, number] {
    const a = this.index(lo);
    const b = this.index(hi);
    return a <= b ? [a, b] : [b, a];
  }
}

/** Parameters of the move that undoes `move(start, count, target)`. */
export function inverseMove(start: number, count: number, target: number): { start: number; count: number; target: number } {
  if (target > start + count) return { start: target - count, count, target: start };
  if (target < start) return { start: target, count, target: start + count };
  return { start, count, target };
}

/**
 * A span's contents changed rather than shifting as a whole: its ends moved by different amounts
 * (a move can also swap them, which the normalized `span` hides).
 */
export function spanReshaped(map: AxisMap, lo: number, hi: number, span: [number, number]): boolean {
  return span[0] - lo !== span[1] - hi || (lo !== hi && span[0] !== map.index(lo));
}

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
  /** A reference became #REF! or a range covers other cells now: the value must be recalculated. */
  meaning = false;
  private homeSheet = 0;
  private homeBefore = 0;
  private homeAfter = 0;
  private readonly isRow: boolean;

  constructor(private readonly map: AxisMap) {
    this.isRow = map.axis === 'row';
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
    const after = (node.sheet ?? this.homeSheet) === this.map.sheet ? this.map.index(before) : before;
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
    if ((node.start.sheet ?? this.homeSheet) === this.map.sheet) {
      const lo = a <= b ? a : b;
      const hi = a <= b ? b : a;
      const span = this.map.span(lo, hi);
      if (!span) {
        this.text = this.meaning = true;
        return refError();
      }
      if (spanReshaped(this.map, lo, hi, span)) this.meaning = true;
      if (span[0] !== lo || span[1] !== hi) this.text = true;
      // Keep the written orientation (A10:A1 stays reversed), so an inverse move restores the text.
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
