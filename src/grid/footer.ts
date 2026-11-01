import type { CellValue } from '../formula/values';
import { formatCell, type CellMeta } from './cellTypes';
import { setBox } from './gridUtil';

export const FOOTER_HEIGHT = 28;

export interface FooterLayout {
  width: number;
  locale?: string;
  metaOf(col: number): CellMeta;
  /** Left edge; frozen columns stay in place while the rest scrolls. */
  leftOf(col: number): number;
  widthOf(col: number): number;
  frozen(col: number): boolean;
  compute(): Map<number, CellValue>;
}

/** Row of totals under the grid. Values are kept until rows or values change. */
export class Footer {
  values: Map<number, CellValue> | null = null;
  private cells = new Map<number, HTMLDivElement>();

  constructor(readonly el: HTMLDivElement, private readonly make: (cls: string, parent: HTMLElement) => HTMLDivElement) {}

  cell(col: number): HTMLDivElement | undefined {
    return this.cells.get(col);
  }

  render(at: FooterLayout): void {
    this.el.style.height = `${FOOTER_HEIGHT}px`;
    this.el.style.width = `${at.width}px`;
    this.values ??= at.compute();
    for (const [col, el] of this.cells) {
      if (!this.values.has(col)) {
        el.remove();
        this.cells.delete(col);
      }
    }
    for (const [col, value] of this.values) {
      let el = this.cells.get(col);
      if (!el) this.cells.set(col, (el = this.make('ct-foot-cell', this.el)));
      const meta = at.metaOf(col);
      const shown = meta.summary === 'count' ? {} : { numericFormat: meta.numericFormat };
      const text = formatCell(value, shown, at.locale).text;
      if (el.textContent !== text) el.textContent = text;
      setBox(el, at.leftOf(col), 0, at.widthOf(col), FOOTER_HEIGHT - 2);
      el.style.display = at.widthOf(col) ? '' : 'none';
      el.style.zIndex = at.frozen(col) ? '1' : '';
    }
  }
}

export function summarize(kind: NonNullable<CellMeta['summary']>, values: CellValue[]): CellValue {
  if (typeof kind === 'function') return kind(values);
  if (kind === 'count') return values.filter((v) => v !== null && v !== '').length;
  const numbers = values.filter((v): v is number => typeof v === 'number');
  if (!numbers.length) return null;
  if (kind === 'min') return numbers.reduce((a, b) => Math.min(a, b));
  if (kind === 'max') return numbers.reduce((a, b) => Math.max(a, b));
  const sum = numbers.reduce((a, b) => a + b, 0);
  return kind === 'sum' ? sum : sum / numbers.length;
}
