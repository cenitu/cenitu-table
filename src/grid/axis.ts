/**
 * Sizes of rows or columns with a lazily rebuilt prefix-sum table, so offsets are O(1)
 * and finding the index at a pixel position is a binary search.
 */
export class Axis {
  private sizes: number[];
  private prefix: Float64Array | null = null;

  constructor(count: number, readonly defaultSize: number, sizes?: number | number[]) {
    this.sizes = Array.from({ length: count }, (_, i) =>
      Array.isArray(sizes) ? sizes[i] ?? defaultSize : sizes ?? defaultSize,
    );
  }

  get count(): number {
    return this.sizes.length;
  }

  get total(): number {
    return this.offset(this.count);
  }

  size(i: number): number {
    return this.sizes[i] ?? this.defaultSize;
  }

  setSize(i: number, px: number): void {
    this.sizes[i] = px;
    this.prefix = null;
  }

  /** Pixel position of the start of item `i` (i may equal count, giving the total). */
  offset(i: number): number {
    if (!this.prefix) {
      const p = new Float64Array(this.sizes.length + 1);
      for (let k = 0; k < this.sizes.length; k++) p[k + 1] = p[k] + this.sizes[k];
      this.prefix = p;
    }
    return this.prefix[Math.max(0, Math.min(i, this.sizes.length))];
  }

  /** Index of the item covering pixel `px`, clamped to the valid range. */
  indexAt(px: number): number {
    if (this.count === 0) return 0;
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offset(mid) <= px) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  insert(index: number, count: number): void {
    this.sizes.splice(index, 0, ...Array<number>(count).fill(this.defaultSize));
    this.prefix = null;
  }

  remove(index: number, count: number): void {
    this.sizes.splice(index, count);
    this.prefix = null;
  }

  resize(count: number): void {
    if (count > this.count) this.insert(this.count, count - this.count);
    else if (count < this.count) this.remove(count, this.count - count);
  }
}
