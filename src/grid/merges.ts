import type { CellRange } from '../formula/address';

export interface MergeArea {
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
}

const toRange = (m: MergeArea): CellRange => ({
  start: { row: m.row, col: m.col },
  end: { row: m.row + m.rowspan - 1, col: m.col + m.colspan - 1 },
});

const intersects = (a: CellRange, b: CellRange): boolean =>
  a.start.row <= b.end.row && a.end.row >= b.start.row && a.start.col <= b.end.col && a.end.col >= b.start.col;

/** Merged cell areas in visual coordinates. Areas never overlap. */
export class Merges {
  private areas: MergeArea[] = [];
  /** cell (row * 2^20 + col) -> area covering it */
  private index = new Map<number, MergeArea>();

  get list(): readonly MergeArea[] {
    return this.areas;
  }

  set(areas: MergeArea[]): void {
    this.areas = [];
    for (const a of areas) this.add(a);
    this.reindex();
  }

  /** Adds an area, replacing any area it overlaps. Returns false for 1x1 areas. */
  add(area: MergeArea): boolean {
    if (area.rowspan < 1 || area.colspan < 1 || (area.rowspan === 1 && area.colspan === 1)) return false;
    const r = toRange(area);
    this.areas = this.areas.filter((a) => !intersects(toRange(a), r));
    this.areas.push({ ...area });
    this.reindex();
    return true;
  }

  removeAt(row: number, col: number): boolean {
    const hit = this.get(row, col);
    if (!hit) return false;
    this.areas = this.areas.filter((a) => a !== hit);
    this.reindex();
    return true;
  }

  get(row: number, col: number): MergeArea | undefined {
    return this.index.get(row * 1048576 + col);
  }

  /** Grows a range until it fully contains every merged area it touches. */
  expand(range: CellRange): CellRange {
    const r = { start: { ...range.start }, end: { ...range.end } };
    let changed = this.areas.length > 0;
    while (changed) {
      changed = false;
      for (const a of this.areas) {
        const m = toRange(a);
        if (!intersects(m, r)) continue;
        if (m.start.row < r.start.row) (r.start.row = m.start.row), (changed = true);
        if (m.start.col < r.start.col) (r.start.col = m.start.col), (changed = true);
        if (m.end.row > r.end.row) (r.end.row = m.end.row), (changed = true);
        if (m.end.col > r.end.col) (r.end.col = m.end.col), (changed = true);
      }
    }
    return r;
  }

  /** Adjusts areas after rows/columns were inserted (count > 0) or removed (count < 0) at `at`. */
  shift(axis: 'row' | 'col', at: number, count: number): void {
    const span = axis === 'row' ? 'rowspan' : 'colspan';
    const next: MergeArea[] = [];
    for (const a of this.areas) {
      const m = { ...a };
      const start = m[axis];
      const end = start + m[span] - 1;
      if (count > 0) {
        if (start >= at) m[axis] += count;
        else if (end >= at) m[span] += count;
      } else {
        const n = -count;
        const lo = Math.max(start, at);
        const hi = Math.min(end, at + n - 1);
        const removed = Math.max(0, hi - lo + 1);
        if (start >= at + n) m[axis] -= n;
        else if (start >= at) m[axis] = at;
        m[span] -= removed;
      }
      if (m[span] > 0 && (m.rowspan > 1 || m.colspan > 1)) next.push(m);
    }
    this.areas = next;
    this.reindex();
  }

  private reindex(): void {
    this.index.clear();
    for (const a of this.areas) {
      for (let r = a.row; r < a.row + a.rowspan; r++) {
        for (let c = a.col; c < a.col + a.colspan; c++) this.index.set(r * 1048576 + c, a);
      }
    }
  }
}
