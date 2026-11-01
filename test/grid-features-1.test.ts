import { afterEach, describe, expect, it, vi } from 'vitest';
import { CenituGrid, type GridOptions } from '../src';

let grid: CenituGrid;
afterEach(() => {
  grid?.destroy();
  document.body.textContent = '';
  vi.useRealTimers();
});

function make(opts: GridOptions) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  grid = new CenituGrid(host, opts);
  return grid;
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const rows = [{ id: 1, n: 'a' }, { id: 2, n: 'b' }, { id: 3, n: 'c' }];
const server: GridOptions = { dataMode: 'server', rowKey: 'id', columns: [{ data: 'id' }, { data: 'n' }], data: rows, totalCount: 3, query: { pageSize: 25 } };

describe('row actions in server mode', () => {
  it('leaves rows alone without actions', () => {
    const g = make(server);
    g.alter('remove_row', 0);
    expect(g.countRows()).toBe(3);
  });

  it('runs the request, then asks for the page again', async () => {
    const remove = vi.fn();
    const g = make({ ...server, rowActions: { remove } });
    const asked: string[] = [];
    g.addHook('afterQueryChange', (_, reason) => asked.push(reason));
    g.alter('remove_row', 1, 2);
    expect(g.countRows()).toBe(3);
    await flush();
    expect(remove).toHaveBeenCalledWith([rows[1], rows[2]], [2, 3]);
    expect(asked).toEqual(['refresh']);
  });

  it('steps back from a page that would be empty', async () => {
    const g = make({ ...server, data: [rows[0]], totalCount: 26, query: { page: 2, pageSize: 25 }, rowActions: { remove: () => undefined } });
    g.alter('remove_row', 0);
    await flush();
    expect(g.getQuery()!.page).toBe(1);
  });

  it('tells create where the row belongs', async () => {
    const create = vi.fn();
    const g = make({ ...server, rowActions: { create } });
    g.alter('insert_row_below', 0);
    await flush();
    expect(create).toHaveBeenCalledWith({ row: rows[0], rowKey: 1, position: 'below' });
  });

  it('shows a refused request as a load error and does not reload', async () => {
    const g = make({ ...server, rowActions: { remove: () => Promise.reject(new Error('Yetki yok')) } });
    const asked = vi.fn();
    g.addHook('afterQueryChange', asked);
    g.alter('remove_row', 0);
    await flush();
    expect(asked).not.toHaveBeenCalled();
    expect(g.root.querySelector('.ct-status')!.textContent).toBe('Yetki yok');
  });
});

describe('scrolling on without a pager', () => {
  const opts: GridOptions = { ...server, pager: false, totalCount: 100, height: 200 };

  it('asks once for each loaded length, and stops at the total', () => {
    const g = make(opts);
    const asked = vi.fn();
    g.addHook('afterReachEnd', asked);
    g.root.dispatchEvent(new Event('scroll'));
    g.root.dispatchEvent(new Event('scroll'));
    expect(asked).toHaveBeenCalledTimes(1);
    g.appendRows([{ id: 4, n: 'd' }], 4);
    g.root.dispatchEvent(new Event('scroll'));
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('keeps rows and the selection', () => {
    const g = make(opts);
    g.selectCell(1, 1);
    g.appendRows([{ id: 4, n: 'd' }]);
    expect(g.getData().map((r) => r[1])).toEqual(['a', 'b', 'c', 'd']);
    expect(g.getSelected()).toEqual([[1, 1, 1, 1]]);
  });

  it('keeps array rows in place after columns moved', () => {
    const g = make({ dataMode: 'server', columns: [{ id: 'a' }, { id: 'b' }], data: [[1, 2]], pager: false, totalCount: 9 });
    g.moveColumns(0, 1, 2);
    g.appendRows([[3, 4]]);
    expect(g.getData()).toEqual([[2, 1], [4, 3]]);
  });
});

describe('several selected ranges', () => {
  const data = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
  const cellAt = (g: CenituGrid, row: number, col: number) => [...g.root.querySelectorAll<HTMLElement>('.ct-cell')].find((c) => c.getAttribute('aria-rowindex') === String(row + 2) && c.getAttribute('aria-colindex') === String(col + 2))!;
  const click = (g: CenituGrid, row: number, col: number, ctrl: boolean) => {
    const el = cellAt(g, row, col);
    const left = 50 + col * 100 + 5;
    const top = 26 + row * 24 + 5;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, ctrlKey: ctrl, clientX: left, clientY: top }));
    g.root.ownerDocument.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  };

  it('adds ranges with Ctrl+click and replaces them without', () => {
    const g = make({ data });
    click(g, 0, 0, false);
    click(g, 2, 2, true);
    expect(g.getSelected()).toEqual([[0, 0, 0, 0], [2, 2, 2, 2]]);
    click(g, 1, 1, false);
    expect(g.getSelected()).toEqual([[1, 1, 1, 1]]);
  });

  it('clears all of them in one undo step', () => {
    const g = make({ data });
    click(g, 0, 0, false);
    click(g, 2, 2, true);
    g.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(g.getDataAtCell(0, 0)).toBe(null);
    expect(g.getDataAtCell(2, 2)).toBe(null);
    g.undo();
    expect(g.getDataAtCell(0, 0)).toBe(1);
    expect(g.getDataAtCell(2, 2)).toBe(9);
  });

  it('styles all of them in one undo step', () => {
    const g = make({ data });
    click(g, 0, 0, false);
    click(g, 2, 2, true);
    g.toggleCellStyle('bold');
    expect(g.getCellStyle(0, 0).bold).toBe(true);
    expect(g.getCellStyle(2, 2).bold).toBe(true);
    g.undo();
    expect(g.getCellStyle(0, 0).bold).toBeUndefined();
    expect(g.getCellStyle(2, 2).bold).toBeUndefined();
  });

  it('forgets them when rows change', () => {
    const g = make({ data });
    click(g, 0, 0, false);
    click(g, 2, 2, true);
    g.sort(0, 'desc');
    expect(g.getSelected()).toHaveLength(1);
  });
});

describe('row groups', () => {
  const data = [['Grup'], ['a'], ['b'], ['Son']];

  it('collapses and expands', () => {
    const g = make({ data, rowGroups: [{ row: 0, count: 2 }] });
    expect(g.isRowGroupOpen(0)).toBe(true);
    g.toggleRowGroup(0);
    expect(g.getData().flat()).toEqual(['Grup', 'Son']);
    g.toggleRowGroup(0);
    expect(g.countRows()).toBe(4);
  });

  it('starts collapsed when told to, and shows a mark', () => {
    const g = make({ data, rowGroups: [{ row: 0, count: 2, collapsed: true }] });
    expect(g.countRows()).toBe(2);
    const mark = g.root.querySelector<HTMLElement>('.ct-group')!;
    expect(mark.getAttribute('aria-expanded')).toBe('false');
  });

  it('toggles from the mark', () => {
    const g = make({ data, rowGroups: [{ row: 0, count: 2 }] });
    g.root.querySelector('.ct-group')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(g.countRows()).toBe(2);
  });

  it('follows inserted and removed rows, also through undo', () => {
    const g = make({ data, rowGroups: [{ row: 1, count: 2 }] });
    g.alter('insert_row_above', 0);
    expect(g.getRowGroups()).toEqual([{ row: 2, count: 2, collapsed: false }]);
    g.alter('remove_row', 3);
    expect(g.getRowGroups()).toEqual([{ row: 2, count: 1, collapsed: false }]);
    g.undo();
    g.undo();
    expect(g.getRowGroups()).toEqual([{ row: 1, count: 2, collapsed: false }]);
  });

  it('goes with its rows when the header is removed', () => {
    const g = make({ data, rowGroups: [{ row: 0, count: 2 }] });
    g.alter('remove_row', 0);
    expect(g.getRowGroups()).toEqual([]);
  });

  it('keeps collapsed rows hidden with a filter on, and in exports', () => {
    const g = make({ data, rowGroups: [{ row: 0, count: 2, collapsed: true }] });
    g.setFilter(0, null);
    expect(g.countRows()).toBe(2);
    expect(g.toExportSheet().hiddenRows).toEqual([1, 2]);
  });

  it('is not available on server rows', () => {
    const g = make({ ...server, rowGroups: [{ row: 0, count: 1 }] });
    expect(g.getRowGroups()).toEqual([]);
  });
});
