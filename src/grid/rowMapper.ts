/**
 * Maps visual rows (what the user sees) to physical rows (positions in the data and in formulas).
 * Sorting changes the order, filtering hides rows; the data itself never moves, so formula
 * references stay valid. The first `pinned` physical rows (frozen header rows) are always shown
 * first and never sorted or hidden.
 */
export class RowMapper {
  private order: number[];
  private hidden = new Set<number>();
  private visible: number[] = [];
  private inverse = new Int32Array(0);
  /** Cached on rebuild: these are read for every rendered cell. */
  private sorted = false;
  private identity = true;

  constructor(count: number, private pinned = 0) {
    this.order = Array.from({ length: count }, (_, i) => i);
    this.rebuild();
  }

  /** Number of visible rows. */
  get count(): number {
    return this.visible.length;
  }

  get physicalCount(): number {
    return this.order.length;
  }

  get pinnedCount(): number {
    return Math.min(this.pinned, this.order.length);
  }

  get isIdentity(): boolean {
    return this.identity;
  }

  get isSorted(): boolean {
    return this.sorted;
  }

  toPhysical(visual: number): number {
    return this.visible[visual] ?? visual - this.visible.length + this.order.length;
  }

  /** Visual index of a physical row, or -1 when it is hidden. */
  toVisual(physical: number): number {
    return physical < this.inverse.length ? this.inverse[physical] : -1;
  }

  setPinned(pinned: number): void {
    this.pinned = pinned;
    this.rebuild();
  }

  /** Orders the non-pinned rows by `compare` (stable). */
  sort(compare: ((a: number, b: number) => number) | null): void {
    const head = this.order.filter((p) => p < this.pinned).sort((a, b) => a - b);
    const rest = this.order.filter((p) => p >= this.pinned);
    rest.sort(compare ?? ((a, b) => a - b));
    this.order = [...head, ...rest];
    this.rebuild();
  }

  setHidden(hidden: Iterable<number>): void {
    this.hidden = new Set([...hidden].filter((p) => p >= this.pinned));
    this.rebuild();
  }

  /** Inserts `count` new physical rows at physical index `at`, shown at visual position `visualAt`. */
  insert(at: number, count: number, visualAt = this.count): void {
    const shift = (p: number) => (p >= at ? p + count : p);
    const anchor = this.visible[visualAt];
    this.order = this.order.map(shift);
    this.hidden = new Set([...this.hidden].map(shift));
    const fresh = Array.from({ length: count }, (_, i) => at + i);
    const pos = anchor === undefined ? this.order.length : this.order.indexOf(shift(anchor));
    this.order.splice(pos, 0, ...fresh);
    this.rebuild();
  }

  /** Removes physical rows [at, at + count). */
  remove(at: number, count: number): void {
    const shift = (p: number) => (p >= at + count ? p - count : p);
    const gone = (p: number) => p >= at && p < at + count;
    this.order = this.order.filter((p) => !gone(p)).map(shift);
    this.hidden = new Set([...this.hidden].filter((p) => !gone(p)).map(shift));
    this.rebuild();
  }

  snapshot(): { order: number[]; hidden: number[] } {
    return { order: [...this.order], hidden: [...this.hidden] };
  }

  restore(s: { order: number[]; hidden: number[] }): void {
    this.order = [...s.order];
    this.hidden = new Set(s.hidden);
    this.rebuild();
  }

  reset(count: number): void {
    this.order = Array.from({ length: count }, (_, i) => i);
    this.hidden.clear();
    this.rebuild();
  }

  private rebuild(): void {
    // Keep pinned rows first, in physical order.
    const pinned = this.order.filter((p) => p < this.pinned).sort((a, b) => a - b);
    this.order = [...pinned, ...this.order.filter((p) => p >= this.pinned)];
    this.visible = this.order.filter((p) => !this.hidden.has(p));
    this.inverse = new Int32Array(this.order.length).fill(-1);
    this.visible.forEach((p, v) => (this.inverse[p] = v));
    this.sorted = !this.order.every((p, i) => p === i);
    this.identity = !this.sorted && this.hidden.size === 0;
  }
}
