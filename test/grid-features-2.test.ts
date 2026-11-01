import { afterEach, describe, expect, it, vi } from 'vitest';
import { CenituGrid, fetchAllPages, readXLSX, toXLSX, type GridOptions, type ServerQuery } from '../src';

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

const rows = [{ id: 1, n: 'a' }, { id: 2, n: 'b' }];
const server: GridOptions = { dataMode: 'server', rowKey: 'id', columns: [{ data: 'id' }, { data: 'n' }], data: rows, totalCount: 2 };
const endless: GridOptions = { ...server, pager: false, totalCount: 100 };

describe('rows given to the application after a column move', () => {
  it('keep their source order and key', async () => {
    const remove = vi.fn();
    const g = make({ dataMode: 'server', rowKey: (r) => (r as string[])[0], columns: [{ id: 'a' }, { id: 'b' }], data: [['id1', 'x']], rowActions: { remove } });
    g.moveColumns(0, 1, 2);
    g.alter('remove_row', 0);
    await flush();
    expect(remove).toHaveBeenCalledWith([['id1', 'x']], ['id1']);
  });
});

describe('row groups after changes', () => {
  it('shows the rows of a collapsed group whose header is removed', () => {
    const g = make({ data: [['a'], ['h'], ['b'], ['c'], ['d']], rowGroups: [{ row: 1, count: 2, collapsed: true }] });
    g.alter('remove_row', 1);
    expect(g.getData().flat()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('stay when new rows are loaded, and follow settings', () => {
    const g = make({ data: [['h'], ['a']], rowGroups: [{ row: 0, count: 1, collapsed: true }] });
    g.loadData([['h2'], ['b'], ['c']]);
    expect(g.getData().flat()).toEqual(['h2', 'c']);
    g.updateSettings({ rowGroups: [] });
    expect(g.countRows()).toBe(3);
  });
});

describe('list values in files', () => {
  it('survive quotes', async () => {
    const values = ['6"', '8"'];
    const { sheets } = await readXLSX(toXLSX([{ name: 'A', data: [['x']], validations: [{ ranges: [{ row: 0, col: 0, rows: 1, cols: 1 }], values }] }]));
    expect(sheets[0].validations![0].values).toEqual(values);
  });
});

describe('asking for more rows', () => {
  it('asks again after a new query', () => {
    const g = make(endless);
    const asked = vi.fn();
    g.addHook('afterReachEnd', asked);
    g.render();
    expect(asked).toHaveBeenCalledTimes(1);
    g.setQuery({ filters: {} }, 'filter');
    expect(asked).toHaveBeenCalledTimes(2);
  });

  it('waits out a failure and asks again when it clears', () => {
    const g = make(endless);
    const asked = vi.fn();
    g.addHook('afterReachEnd', asked);
    g.render();
    g.updateSettings({ loadError: 'x' });
    expect(asked).toHaveBeenCalledTimes(1);
    g.updateSettings({ loadError: false });
    expect(asked).toHaveBeenCalledTimes(2);
  });

  it('works without a total, and stops at an answer with no rows', () => {
    const g = make({ ...endless, totalCount: undefined });
    const asked = vi.fn();
    g.addHook('afterReachEnd', asked);
    g.render();
    expect(asked).toHaveBeenCalledTimes(1);
    g.appendRows([]);
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('does not ask before anything is loaded', () => {
    const g = make({ ...endless, data: [] });
    const asked = vi.fn();
    g.addHook('afterReachEnd', asked);
    g.render();
    expect(asked).not.toHaveBeenCalled();
  });
});

describe('appendRows', () => {
  it('keeps state on loaded rows, the editor, and the array given', () => {
    const data = [...rows];
    const g = make({ ...endless, data, rowDetail: () => undefined });
    g.toggleRowDetail(0);
    g.setCellNote(0, 1, 'not');
    g.setDataAtCell(1, 1, 'z');
    g.selectCell(1, 1);
    g.openEditor();
    g.appendRows([{ id: 3, n: 'c' }]);
    expect(g.isEditing()).toBe(true);
    expect(g.isRowDetailOpen(0)).toBe(true);
    expect(g.getCellNote(0, 1)).toBe('not');
    expect(g.isUndoAvailable()).toBe(true);
    expect(g.countRows()).toBe(3);
    expect(data).toHaveLength(2);
    expect(g.getSourceObjects()).toHaveLength(3);
    g.setDataAtCell(2, 1, 'y');
    expect((g.getSourceObjects()![2] as { n: string }).n).toBe('y');
  });

  it('refuses an outdated answer', () => {
    const g = make({ ...endless, query: { requestId: 3 } });
    expect(g.appendRows([{ id: 3, n: 'c' }], undefined, { requestId: 2 })).toBe(false);
    expect(g.countRows()).toBe(2);
  });
});

describe('a failed row request', () => {
  const failing: GridOptions = { ...server, rowActions: { remove: () => Promise.reject(new Error('Yetki yok')) } };

  it('clears with the next query or page', async () => {
    const g = make(failing);
    g.alter('remove_row', 0);
    await flush();
    expect(g.root.querySelector('.ct-status')).not.toBeNull();
    g.setPageRows(rows, 2);
    expect(g.root.querySelector('.ct-status')).toBeNull();
  });

  it('does nothing after the grid is gone', async () => {
    const g = make({ ...server, rowActions: { remove: () => undefined } });
    const asked = vi.fn();
    g.addHook('afterQueryChange', asked);
    g.alter('remove_row', 0);
    g.destroy();
    await flush();
    expect(asked).not.toHaveBeenCalled();
    grid = make({ data: [[1]] });
  });
});

describe('fetchAllPages', () => {
  it('goes on when the server caps page sizes', async () => {
    const fetchPage = async (q: ServerQuery) => ({ items: q.page <= 3 ? [1, 2] : [], totalCount: 6 });
    const all = await fetchAllPages(fetchPage, { page: 1, pageSize: 500, sort: [], filters: {} });
    expect(all).toHaveLength(6);
  });

  it('does not loop when the total is too high', async () => {
    const fetchPage = async (q: ServerQuery) => ({ items: q.page === 1 ? [1] : [], totalCount: 9 });
    expect(await fetchAllPages(fetchPage, { page: 1, pageSize: 500, sort: [], filters: {} })).toEqual([1]);
  });
});

describe('Ctrl+click', () => {
  it('shows every range to selection hooks', () => {
    const g = make({ data: [[1, 2], [3, 4]] });
    g.selectCell(0, 0);
    const seen: number[] = [];
    g.addHook('afterSelection', () => seen.push(g.getSelectedRanges().length));
    const cell = g.root.querySelector('.ct-cell')!;
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, ctrlKey: true, clientX: 160, clientY: 60 }));
    g.root.ownerDocument.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(seen).toEqual([2]);
  });

  it('leaves no boxes behind when data is replaced', () => {
    const g = make({ data: [[1, 2], [3, 4]] });
    g.selectCell(0, 0);
    g.root.querySelector('.ct-cell')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, ctrlKey: true, clientX: 160, clientY: 60 }));
    g.root.ownerDocument.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    g.loadData([[9]]);
    expect(g.getSelectedRanges()).toEqual([]);
    expect([...g.root.querySelectorAll<HTMLElement>('.ct-range')].filter((b) => b.style.display !== 'none')).toEqual([]);
  });
});
