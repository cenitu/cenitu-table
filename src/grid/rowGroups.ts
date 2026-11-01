import { moveIndex } from './gridUtil';

/** A header row and the rows under it, which can be collapsed. Rows are physical. */
export interface RowGroup {
  row: number;
  count: number;
  collapsed?: boolean;
}

/** Collapsible row groups. Groups may nest. */
export class RowGroups {
  private groups = new Map<number, { count: number; collapsed: boolean }>();

  get size(): number {
    return this.groups.size;
  }

  set(list: RowGroup[]): void {
    this.groups = new Map(list.filter((g) => g.count > 0).map((g) => [g.row, { count: g.count, collapsed: !!g.collapsed }]));
  }

  list(): RowGroup[] {
    return [...this.groups].sort(([a], [b]) => a - b).map(([row, g]) => ({ row, ...g }));
  }

  has(row: number): boolean {
    return this.groups.has(row);
  }

  isCollapsed(row: number): boolean {
    return !!this.groups.get(row)?.collapsed;
  }

  toggle(row: number, open?: boolean): void {
    const group = this.groups.get(row);
    if (group) group.collapsed = !(open ?? group.collapsed);
  }

  /** Rows inside collapsed groups. */
  hidden(): number[] {
    const out = new Set<number>();
    for (const [row, g] of this.groups) {
      if (g.collapsed) for (let i = 1; i <= g.count; i++) out.add(row + i);
    }
    return [...out];
  }

  /** Follows physical rows inserted (n > 0) or removed (n < 0) at `at`. */
  shift(at: number, n: number): void {
    const next = new Map<number, { count: number; collapsed: boolean }>();
    for (const [row, g] of this.groups) {
      const moved = moveIndex(row, at, n);
      if (moved < 0) continue;
      const first = row + 1;
      const last = row + g.count;
      const lost = n < 0 ? Math.max(0, Math.min(last, at - n - 1) - Math.max(first, at) + 1) : 0;
      const count = n > 0 && at >= first && at <= last ? g.count + n : g.count - lost;
      if (count > 0) next.set(moved, { ...g, count });
    }
    this.groups = next;
  }
}
