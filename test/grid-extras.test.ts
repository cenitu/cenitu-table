import { afterEach, describe, expect, it } from 'vitest';
import { CenituGrid, enUS, linkRenderer, readXLSX, toXLSX, type GridOptions } from '../src';

let grid: CenituGrid;
afterEach(() => {
  grid?.destroy();
  document.body.textContent = '';
});

function make(opts: GridOptions) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  grid = new CenituGrid(host, { language: enUS, ...opts });
  return grid;
}

const foot = () => [...document.querySelectorAll('.ct-foot-cell')].map((e) => e.textContent);

describe('footer totals', () => {
  it('shows nothing unless asked for', () => {
    make({ data: [[1]] });
    expect(document.querySelector('.ct-foot')).toBeNull();
  });

  it('computes sum, avg, count, min, max and custom totals', () => {
    make({
      data: [[1, 2, 'a', 4, 5, 6], [3, 4, null, 8, 1, 7]],
      columns: [{ summary: 'sum' }, { summary: 'avg' }, { summary: 'count' }, { summary: 'min' }, { summary: 'max' }, { summary: (v) => v.length * 10 }],
    });
    expect(foot()).toEqual(['4', '3', '1', '4', '5', '20']);
  });

  it('follows edits, formulas, filters and hidden rows, skipping pinned rows', () => {
    const g = make({ data: [['Tutar', null], [1, '=A2*10'], [2, null]], fixedRowsTop: 1, columns: [{ summary: 'sum' }] });
    expect(foot()).toEqual(['3']);
    g.setDataAtCell(2, 0, 5);
    expect(foot()).toEqual(['6']);
    g.setFilter(0, { condition: { op: 'greaterThan', value: '2' } });
    expect(foot()).toEqual(['5']);
    g.clearFilters();
    g.hideRows([1]);
    expect(foot()).toEqual(['5']);
    g.undo();
    g.showRows();
    expect(foot()).toEqual(['3']);
  });

  it('uses the column format, and does not add it to a count', () => {
    make({
      data: [[1000], [2000.5]],
      locale: 'tr-TR',
      columns: [{ summary: 'sum', numericFormat: { style: 'currency', currency: 'TRY' } }],
    });
    expect(foot()[0]).toContain('3.000,50');
  });

  it('takes values from outside in server mode, computing nothing', () => {
    const g = make({
      dataMode: 'server', locale: 'en-US', data: [{ t: 1 }], columns: [{ id: 't', data: 't', summary: 'sum', numericFormat: {} }],
      summaryValues: { t: 99000 },
    });
    expect(foot()).toEqual(['99,000']);
    g.updateSettings({ summaryValues: { t: 5 } });
    expect(foot()).toEqual(['5']);
    g.setPageRows([{ t: 2 }]);
    expect(foot()).toEqual(['5']);
  });

  it('counts its height when scrolling a cell into view', () => {
    const g = make({ data: [[1]], columns: [{ summary: 'sum' }] });
    expect(document.querySelector<HTMLElement>('.ct-foot')!.style.height).toBe('28px');
    expect(g.root.querySelector<HTMLElement>('.ct-canvas')!.style.height).toBe(`${26 + 24 + 28}px`);
  });
});

describe('row detail', () => {
  const opened: unknown[] = [];
  const setup = (opts: GridOptions = {}) => {
    opened.length = 0;
    return make({
      data: [{ id: 1, a: 'x' }, { id: 2, a: 'y' }],
      columns: [{ data: 'a' }],
      rowDetailHeight: 100,
      rowDetail: (el, row) => {
        opened.push(row);
        el.textContent = `detay ${(row as { id: number }).id}`;
        return () => opened.push('closed');
      },
      ...opts,
    });
  };

  it('opens under the row, keeping the row height, and pushes rows below down', () => {
    const g = setup();
    g.toggleRowDetail(0);
    expect(g.isRowDetailOpen(0)).toBe(true);
    const detail = g.root.querySelector<HTMLElement>('.ct-detail')!;
    expect(detail.textContent).toBe('detay 1');
    expect(detail.style.top).toBe('24px');
    expect(detail.style.height).toBe('100px');
    const cells = [...g.root.querySelectorAll<HTMLElement>('.ct-cell')];
    expect(cells[0].style.height).toBe('24px');
    expect(cells[1].style.top).toBe('124px');
    g.toggleRowDetail(0);
    expect(g.root.querySelector('.ct-detail')).toBeNull();
    expect(opened).toEqual([{ id: 1, a: 'x' }, 'closed']);
    expect([...g.root.querySelectorAll<HTMLElement>('.ct-cell')][1].style.top).toBe('24px');
  });

  it('toggles from the row header mark', () => {
    const g = setup();
    const mark = g.root.querySelector<HTMLElement>('.ct-expand')!;
    expect(mark.textContent).toBe('▸');
    mark.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(g.isRowDetailOpen(0)).toBe(true);
    expect(mark.textContent).toBe('▾');
  });

  it('stays with its row when the view is sorted, and when rows are inserted above', () => {
    const g = setup();
    g.toggleRowDetail(0);
    g.sort(0, 'desc');
    expect(g.isRowDetailOpen(1)).toBe(true);
    expect(g.isRowDetailOpen(0)).toBe(false);
    g.sort(0, null);
    g.alter('insert_row_above', 0);
    expect(g.isRowDetailOpen(1)).toBe(true);
    g.undo();
    expect(g.isRowDetailOpen(0)).toBe(true);
  });

  it('closes on new data and with the grid', () => {
    const g = setup();
    g.toggleRowDetail(0);
    g.loadData([{ id: 3, a: 'z' }]);
    expect(opened).toContain('closed');
    expect(g.root.querySelector('.ct-detail')).toBeNull();
    g.toggleRowDetail(0);
    opened.length = 0;
    g.destroy();
    expect(opened).toEqual(['closed']);
  });

  it('does nothing without the option', () => {
    const g = make({ data: [[1]] });
    g.toggleRowDetail(0);
    expect(g.isRowDetailOpen(0)).toBe(false);
    expect(g.root.querySelector('.ct-expand')).toBeNull();
  });
});

describe('hidden rows', () => {
  const rows = () => [['h'], ['a'], ['b'], ['c']];
  const first = (g: CenituGrid) => g.getData().map((r) => r[0]);

  it('hides and shows, keeping data and formulas', () => {
    const g = make({ data: [[1], [2], ['=A1+A2']] });
    g.hideRows([1]);
    expect(g.countRows()).toBe(2);
    expect(g.countSourceRows()).toBe(3);
    expect(g.getHiddenRows()).toEqual([1]);
    expect(g.getDataAtCell(1, 0)).toBe(3);
    g.showRows();
    expect(g.countRows()).toBe(3);
  });

  it('works next to filters, and frozen rows cannot be hidden', () => {
    const g = make({ data: rows(), fixedRowsTop: 1 });
    g.hideRows([0, 1]);
    expect(first(g)).toEqual(['h', 'b', 'c']);
    g.setFilter(0, { condition: { op: 'notEquals', value: 'c' } });
    expect(first(g)).toEqual(['h', 'b']);
    g.clearFilters();
    expect(first(g)).toEqual(['h', 'b', 'c']);
  });

  it('follows inserts and undo', () => {
    const g = make({ data: rows() });
    g.hideRows([2]);
    g.alter('insert_row_above', 0);
    expect(g.getHiddenRows()).toEqual([3]);
    g.undo();
    expect(g.getHiddenRows()).toEqual([2]);
  });

  it('offers menu entries', () => {
    const g = make({ data: rows(), contextMenu: true });
    g.selectCell(1, 0);
    g.openContextMenu(1, 1);
    document.querySelector<HTMLElement>('.ct-context [data-key="hide_row"]')!.click();
    expect(g.getHiddenRows()).toEqual([1]);
    g.selectCell(0, 0);
    g.openContextMenu(1, 1);
    document.querySelector<HTMLElement>('.ct-context [data-key="show_rows"]')!.click();
    expect(g.getHiddenRows()).toEqual([]);
  });

  it('round-trips hidden rows and columns through XLSX', async () => {
    const g = make({ data: [[1, 2], [3, 4]], colWidths: 120 });
    g.hideRows([1]);
    g.hideColumns([0]);
    const { sheets } = await readXLSX(toXLSX([g.toExportSheet()]));
    expect(sheets[0].hiddenRows).toEqual([1]);
    expect(sheets[0].hiddenColumns).toEqual([0]);
    expect(sheets[0].colWidths![0]).toBe(120);
    g.loadSheet(sheets[0]);
    expect(g.getHiddenRows()).toEqual([1]);
    expect(g.countRows()).toBe(1);
  });

  it('is refused in server mode', () => {
    const g = make({ dataMode: 'server', data: [{ a: 1 }], columns: [{ data: 'a' }] });
    g.hideRows([0]);
    expect(g.countRows()).toBe(1);
  });
});

describe('notes and links', () => {
  it('marks a noted cell, shows the note on hover, and undoes', () => {
    const g = make({ data: [['a']] });
    g.setCellNote(0, 0, 'Kontrol et');
    const cell = g.root.querySelector<HTMLElement>('.ct-cell')!;
    expect(cell.className).toContain('ct-has-note');
    expect(cell.title).toBe('Kontrol et');
    expect(g.getCellNote(0, 0)).toBe('Kontrol et');
    g.undo();
    expect(g.getCellNote(0, 0)).toBeUndefined();
    expect(cell.title).toBe('');
  });

  it('prefers a validation message over a note in the tooltip', () => {
    const g = make({ data: [['x']], columns: [{ type: 'numeric', note: 'not' }] });
    expect(g.root.querySelector<HTMLElement>('.ct-cell')!.title).toBe('Not a number');
  });

  it('renders safe links and leaves other addresses as text', () => {
    const g = make({
      data: [['https://cenitu.dev'], ['javascript:alert(1)'], ['mailto:a@b.co'], ['not a url at all']],
      formulas: false,
      columns: [{ renderer: linkRenderer((v) => String(v)) }],
    });
    const links = [...g.root.querySelectorAll('a')];
    expect(links.map((a) => a.protocol)).toEqual(expect.not.arrayContaining(['javascript:']));
    expect(links.find((a) => a.textContent === 'https://cenitu.dev')!.rel).toBe('noopener noreferrer');
    expect(g.root.textContent).toContain('javascript:alert(1)');
    expect(g.root.querySelector('a[href^="javascript"]')).toBeNull();
    g.setDataAtCell(0, 0, 'https://cenitu.dev/yeni');
    expect(g.root.querySelector('a')!.textContent).toBe('https://cenitu.dev/yeni');
  });
});

describe('keyboard selection', () => {
  const press = (g: CenituGrid, init: KeyboardEventInit) => g.root.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true, ...init }));

  it('selects the column with Ctrl+Space and the row with Shift+Space', () => {
    const g = make({ data: [[1, 2], [3, 4]] });
    g.selectCell(1, 1);
    press(g, { ctrlKey: true });
    expect(g.getSelected()).toEqual([[0, 1, 1, 1]]);
    g.selectCell(1, 1);
    press(g, { shiftKey: true });
    expect(g.getSelected()).toEqual([[1, 0, 1, 1]]);
  });
});
