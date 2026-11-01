import type { CellRange } from '../formula/address';
import { isFormula, type RawCell } from '../formula/values';

export const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

export const pushed = <T>(list: T[], item: T): T => (list.push(item), item);

/** Max without spreading (spreading 100k+ items overflows the call stack). */
export function maxOf<T>(items: readonly T[], pick: (item: T) => number): number {
  let max = -Infinity;
  for (const item of items) max = Math.max(max, pick(item));
  return max;
}

/** Locales whose spreadsheet apps use "," as decimal separator (and therefore ";" in CSV). */
export function commaDecimalLocale(locale: string | undefined): boolean {
  if (!locale) return false;
  return new Intl.NumberFormat(locale).format(1.5).includes(',');
}

/** New index of column `c` after moving [start, start + count) before `target`. */
export function moveColumnIndex(c: number, start: number, count: number, target: number): number {
  const end = start + count;
  if (c >= start && c < end) return target > start ? c + (target - end) : c - (start - target);
  if (target > end && c >= end && c < target) return c - count;
  if (target < start && c >= target && c < start) return c + count;
  return c;
}

/** New index after inserting (n > 0) or removing (n < 0) items at `at`; -1 when removed. */
export const moveIndex = (i: number, at: number, n: number): number =>
  i < at ? i : n > 0 ? i + n : i < at - n ? -1 : i + n;

export function shiftKeys<V>(map: Map<number, V>, move: (key: number) => number): Map<number, V> {
  const next = new Map<number, V>();
  for (const [k, v] of map) {
    const nk = move(k);
    if (nk >= 0) next.set(nk, v);
  }
  return next;
}

/** Without an engine "=…" is text; marked as such, it cannot run as a formula in an exported file. */
export const inertText = (v: RawCell): RawCell => (isFormula(v) ? `'${v}` : v);

export const isEmpty = (v: RawCell): boolean => v === null || v === undefined || v === '';

export const unite = (a: CellRange, b: CellRange): CellRange => ({
  start: { row: Math.min(a.start.row, b.start.row), col: Math.min(a.start.col, b.start.col) },
  end: { row: Math.max(a.end.row, b.end.row), col: Math.max(a.end.col, b.end.col) },
});

export function setBox(el: HTMLElement, left: number, top: number, width: number, height: number): void {
  const s = el.style;
  s.left = `${left}px`;
  s.top = `${top}px`;
  s.width = `${width}px`;
  s.height = `${height}px`;
}

export const requestFrame = (fn: () => void): number =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : (setTimeout(fn, 16) as unknown as number);

export const cancelFrame = (id: number): void => {
  if (!id) return;
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
};
