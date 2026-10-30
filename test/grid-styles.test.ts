import { afterEach, describe, expect, it } from 'vitest';
import { CenituGrid, type GridOptions } from '../src';

let grid: CenituGrid;
afterEach(() => grid?.destroy());

function make(data: unknown[][], opts: GridOptions = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  grid = new CenituGrid(host, { data: data as GridOptions['data'], ...opts });
  return grid;
}

const cellEl = (g: CenituGrid, text: string) =>
  [...g.root.querySelectorAll<HTMLElement>('.ct-cell')].find((e) => e.style.display !== 'none' && e.textContent === text)!;
const key = (g: CenituGrid, k: string, extra: Partial<KeyboardEventInit> = {}) =>
  g.root.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));

describe('cell styles', () => {
  it('applies, merges with column styles, toggles with Ctrl+B and undoes', () => {
    const g = make([['a', 'b'], ['c', 'd']], { columns: [{ style: { color: '#ff0000' } }] });
    g.setCellStyle({ start: { row: 0, col: 0 }, end: { row: 0, col: 1 } }, { bold: true, background: '#ffff00' });
    expect(g.getCellStyle(0, 0)).toEqual({ color: '#ff0000', bold: true, background: '#ffff00' });
    const a = cellEl(g, 'a');
    expect(a.classList.contains('ct-b')).toBe(true);
    expect(a.style.color).toBe('rgb(255, 0, 0)');
    expect(a.style.backgroundColor).toBe('rgb(255, 255, 0)');
    g.selectCell(0, 0, 1, 0);
    key(g, 'b', { ctrlKey: true }); // c is not bold -> all become bold
    expect(g.getCellStyle(1, 0).bold).toBe(true);
    key(g, 'b', { ctrlKey: true }); // now all bold -> off
    expect(g.getCellStyle(0, 0).bold).toBe(false);
    g.undo();
    g.undo();
    expect(g.getCellStyle(1, 0).bold).toBeUndefined();
    expect(g.getCellStyle(0, 0).bold).toBe(true);
    g.setCellStyle({ start: { row: 0, col: 0 }, end: { row: 0, col: 0 } }, null);
    expect(g.getCellStyle(0, 0)).toEqual({ color: '#ff0000' });
    expect(cellEl(g, 'a').style.backgroundColor).toBe('');
  });

  it('keeps cell styles with their cells across row/column insert and remove', () => {
    const g = make([['a'], ['b'], ['c']]);
    g.setCellStyle({ start: { row: 2, col: 0 }, end: { row: 2, col: 0 } }, { italic: true });
    g.alter('insert_row_above', 0);
    expect(g.getCellStyle(3, 0).italic).toBe(true);
    g.alter('remove_row', 1);
    expect(g.getCellStyle(2, 0).italic).toBe(true);
    g.alter('insert_col_start', 0);
    expect(g.getCellStyle(2, 1).italic).toBe(true);
    g.undo();
    g.undo();
    g.undo();
    expect(g.getCellStyle(2, 0).italic).toBe(true);
    expect(g.getCellStyle(1, 0).italic).toBeUndefined();
  });
});

describe('conditional formats', () => {
  it('styles matching cells and entire rows', () => {
    const g = make([['Açık', 5], ['Gecikti', 50], ['Teslim', 500]], {
      conditionalFormats: [
        { columns: [0], when: { op: 'equals', value: 'Gecikti' }, entireRow: true, style: { color: '#cf222e' } },
        { columns: [1], when: (v) => typeof v === 'number' && v > 100, style: { bold: true } },
      ],
    });
    expect(g.getCellStyle(1, 1).color).toBe('#cf222e');
    expect(g.getCellStyle(0, 1).color).toBeUndefined();
    expect(g.getCellStyle(2, 1).bold).toBe(true);
    expect(cellEl(g, '500').classList.contains('ct-b')).toBe(true);
    g.setDataAtCell(0, 0, 'Gecikti');
    expect(g.getCellStyle(0, 1).color).toBe('#cf222e');
    g.updateSettings({ conditionalFormats: [] });
    expect(g.getCellStyle(0, 1).color).toBeUndefined();
  });
});

describe('row heights and hidden columns', () => {
  it('sets row heights that follow rows through sorting', () => {
    const g = make([[3], [1], [2]]);
    g.setRowHeight(0, 60);
    expect(g.getRowHeight(0)).toBe(60);
    g.sort(0, 'asc');
    expect(g.getRowHeight(2)).toBe(60); // value 3 moved to the bottom
    expect(g.getRowHeight(0)).toBe(24);
    expect(g.root.querySelectorAll('.ct-rowhead .ct-rresize').length).toBeGreaterThan(0);
  });

  it('hides columns, skips them while navigating and shows them again', () => {
    const g = make([[1, 2, 3, 4]], { hiddenColumns: [2] });
    expect(g.isColumnHidden(2)).toBe(true);
    expect(cellEl(g, '3')).toBeUndefined();
    g.selectCell(0, 1);
    key(g, 'ArrowRight');
    expect(g.getSelected()).toEqual([[0, 3, 0, 3]]);
    g.hideColumns([0, 1]);
    expect(g.getHiddenColumns()).toEqual([0, 1, 2]);
    g.alter('insert_col_start', 0);
    expect(g.getHiddenColumns()).toEqual([1, 2, 3]);
    g.showColumns();
    expect(g.getHiddenColumns()).toEqual([]);
    expect(g.getColWidth(3)).toBe(100);
  });
});

describe('accessibility', () => {
  it('exposes grid roles, positions and announces the active cell', async () => {
    const g = make([['x', 'y']]);
    expect(g.root.getAttribute('role')).toBe('grid');
    expect(g.root.getAttribute('aria-rowcount')).toBe('2');
    const y = cellEl(g, 'y');
    expect(y.getAttribute('role')).toBe('gridcell');
    expect(y.getAttribute('aria-colindex')).toBe('3');
    expect(y.getAttribute('aria-rowindex')).toBe('2');
    expect(g.root.querySelector('.ct-colhead')!.getAttribute('role')).toBe('columnheader');
    g.selectCell(0, 1);
    expect(g.root.querySelector('textarea')!.getAttribute('aria-label')).toBe('B1: y');
    await new Promise((r) => setTimeout(r, 150));
    expect(g.root.querySelector('.ct-sr')!.textContent).toBe('B1: y');
  });
});
