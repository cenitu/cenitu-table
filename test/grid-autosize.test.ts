import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CenituGrid, type GridOptions } from '../src';

let grid: CenituGrid;
const fonts: string[] = [];

beforeEach(() => {
  fonts.length = 0;
  // Ten pixels per character, doubled for bold text.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText(this: { font: string }, text: string) {
      fonts.push(this.font);
      return { width: text.length * (this.font.includes('700') ? 20 : 10) };
    },
  } as never);
});

afterEach(() => {
  grid?.destroy();
  document.body.textContent = '';
  vi.restoreAllMocks();
});

function make(opts: GridOptions) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  grid = new CenituGrid(host, opts);
  return grid;
}

describe('autoSizeColumns', () => {
  it('fits the longest text in both directions', () => {
    const g = make({ data: [['abcdefghij'.repeat(3)], ['a']], colWidths: 100 });
    g.autoSizeColumns();
    const wide = g.getColWidth(0);
    expect(wide).toBeGreaterThanOrEqual(300);
    g.setDataAtCell(0, 0, 'ab');
    g.autoSizeColumns();
    expect(g.getColWidth(0)).toBeLessThan(wide);
    expect(g.getColWidth(0)).toBeGreaterThanOrEqual(24);
  });

  it('measures the text as shown, with its style', () => {
    const g = make({ data: [['abc']], columns: [{ style: { bold: true } }] });
    g.autoSizeColumns();
    expect(fonts.some((f) => f.includes('700'))).toBe(true);
    expect(g.getColWidth(0)).toBeGreaterThanOrEqual(60);
  });

  it('skips cells spanning columns, wrapped text keeps the column from shrinking', () => {
    const g = make({ data: [['x'.repeat(50), null], ['ab', null]], mergeCells: [{ row: 0, col: 0, rowspan: 1, colspan: 2 }] });
    g.autoSizeColumns([0]);
    expect(g.getColWidth(0)).toBeLessThan(100);
    g.destroy();
    const wrapped = make({ data: [['x'.repeat(50)]], columns: [{ style: { wrap: true } }], colWidths: 120 });
    wrapped.autoSizeColumns();
    expect(wrapped.getColWidth(0)).toBe(120);
  });

  it('leaves hidden and empty columns alone and reports a change once', () => {
    const g = make({ data: [['abcdefghijklmnopqrstuvwxyz', null, 'q']], colHeaders: false, colWidths: 90, hiddenColumns: [2] });
    const layouts = vi.fn();
    g.addHook('afterColumnLayout', layouts);
    g.autoSizeColumns();
    expect(layouts).toHaveBeenCalledTimes(1);
    expect(g.getColWidth(1)).toBe(90);
    g.showColumns([2]);
    expect(g.getColWidth(2)).toBe(90);
    layouts.mockClear();
    g.autoSizeColumns([0]);
    expect(layouts).not.toHaveBeenCalled();
  });

  it('samples very long lists but still fits rows on screen', () => {
    const data = Array.from({ length: 50000 }, (_, i) => [i === 1 ? 'x'.repeat(40) : 'a']);
    const g = make({ data });
    g.autoSizeColumns();
    expect(g.getColWidth(0)).toBeGreaterThanOrEqual(400);
  });
});

describe('column edge', () => {
  const edge = (g: CenituGrid, i: number) => g.root.querySelectorAll('.ct-colhead .ct-resize')[i];
  const dbl = (el: Element) => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));

  it('fits its own column on a double click, without opening an editor', () => {
    const g = make({ data: [['x'.repeat(40), 'y'.repeat(40)]] });
    dbl(edge(g, 0));
    expect(g.getColWidth(0)).toBeGreaterThanOrEqual(400);
    expect(g.getColWidth(1)).toBe(100);
    expect(g.isEditing()).toBe(false);
  });

  it('fits all selected columns from a selected edge', () => {
    const g = make({ data: [['x'.repeat(40), 'y'.repeat(40), 'z'.repeat(40)]] });
    g.selectCell(0, 0, 0, 1);
    dbl(edge(g, 1));
    expect(g.getColWidth(0)).toBeGreaterThanOrEqual(400);
    expect(g.getColWidth(1)).toBeGreaterThanOrEqual(400);
    expect(g.getColWidth(2)).toBe(100);
  });

  it('fits on a double tap but not on two drags', () => {
    const g = make({ data: [['x'.repeat(40)]] });
    const touch = (target: EventTarget, type: string, x: number) => {
      const e = new Event(type, { bubbles: true, cancelable: true }) as Event & { touches: unknown[]; changedTouches: unknown[] };
      e.touches = type === 'touchend' ? [] : [{ clientX: x, clientY: 5 }];
      e.changedTouches = [{ clientX: x, clientY: 5 }];
      target.dispatchEvent(e);
    };
    const tap = (to: number) => {
      touch(edge(g, 0), 'touchstart', 100);
      touch(document, 'touchend', to);
    };
    tap(130);
    tap(130);
    expect(g.getColWidth(0)).toBe(100);
    tap(100);
    tap(100);
    expect(g.getColWidth(0)).toBeGreaterThanOrEqual(400);
  });
});
