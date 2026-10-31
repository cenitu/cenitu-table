import { afterEach, describe, expect, it } from 'vitest';
import { CenituGrid, readXLSX, toXLSX, type GridOptions } from '../src';
import { parseHtmlTable, styleToCss, tableHtml } from '../src/grid/clipboardHtml';

let grid: CenituGrid;
afterEach(() => grid?.destroy());

function make(opts: GridOptions) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  grid = new CenituGrid(host, opts);
  return grid;
}

describe('multi-column sort', () => {
  const rows = () => [['h', 'n'], ['b', 2], ['a', 2], ['c', 1], [null, 1]];
  const first = (g: CenituGrid) => g.getData().map((r) => r[0]);

  it('uses later keys to break ties and keeps data order after that', () => {
    const g = make({ data: rows(), fixedRowsTop: 1 });
    g.sortBy([{ col: 1, order: 'desc' }, { col: 0, order: 'asc' }]);
    expect(first(g)).toEqual(['h', 'a', 'b', 'c', null]);
    g.sortBy([{ col: 1, order: 'asc' }]);
    expect(first(g)).toEqual(['h', 'c', null, 'a', 'b']);
    g.sortBy([]);
    expect(first(g)).toEqual(['h', 'b', 'a', 'c', null]);
    expect(g.getSortState()).toBeNull();
  });

  it('shows key priority in the headers and reports through hooks', () => {
    const g = make({ data: rows() });
    const seen: number[] = [];
    g.addHook('afterSort', (keys) => seen.push(keys.length));
    g.sortBy([{ col: 1, order: 'desc' }, { col: 0, order: 'asc' }]);
    const marks = [...g.root.querySelectorAll('.ct-colhead .ct-sort')].map((e) => e.textContent);
    expect(marks.slice(0, 2)).toEqual(['▲2', '▼1']);
    expect(g.getSortState()).toEqual({ col: 1, order: 'desc' });
    g.sort(0, 'asc');
    expect(g.getSortKeys()).toEqual([{ col: 0, order: 'asc' }]);
    expect([...g.root.querySelectorAll('.ct-colhead .ct-sort')][0].textContent).toBe('▲');
    expect(seen).toEqual([2, 1]);
  });

  it('keys follow column inserts, removals and moves, and undo restores them', () => {
    const g = make({ data: [[2, 'x', 1], [1, 'y', 2]] });
    g.sortBy([{ col: 2, order: 'asc' }, { col: 0, order: 'asc' }]);
    g.alter('remove_col', 1);
    expect(g.getSortKeys().map((k) => k.col)).toEqual([1, 0]);
    g.undo();
    expect(g.getSortKeys().map((k) => k.col)).toEqual([2, 0]);
    g.alter('remove_col', 0);
    expect(g.getSortKeys().map((k) => k.col)).toEqual([1]);
    g.undo();
    g.moveColumns(0, 1, 3);
    expect(g.getSortKeys().map((k) => k.col)).toEqual([1, 2]);
  });

  it('adds and removes keys from the column menu', () => {
    const g = make({ data: rows(), fixedRowsTop: 1, columnSorting: true });
    const open = (c: number) => g.root.querySelectorAll<HTMLElement>('.ct-colhead .ct-menu-btn')[c].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const click = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.ct-menu button')].find((b) => b.textContent === text)!.click();
    open(1);
    expect(document.querySelector('.ct-menu')!.textContent).not.toContain('Then sort');
    click('Sort Z → A');
    open(0);
    click('Then sort A → Z');
    expect(g.getSortKeys()).toEqual([{ col: 1, order: 'desc' }, { col: 0, order: 'asc' }]);
    open(1);
    click('Clear sort');
    expect(g.getSortKeys()).toEqual([{ col: 0, order: 'asc' }]);
  });
});

describe('formula bar', () => {
  const bar = () => document.querySelector<HTMLTextAreaElement>('.ct-bar-input')!;
  const address = () => document.querySelector('.ct-bar-address')!.textContent;
  const type = (text: string) => {
    bar().focus();
    bar().value = text;
    bar().dispatchEvent(new Event('input', { bubbles: true }));
  };
  const key = (k: string, init: KeyboardEventInit = {}) => bar().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

  it('is only there when asked for, and leaves with the grid', () => {
    make({ data: [[1]] });
    expect(document.querySelector('.ct-bar')).toBeNull();
    grid.destroy();
    make({ data: [[1]], formulaBar: true });
    expect(grid.root.previousElementSibling?.className).toContain('ct-bar');
    grid.destroy();
    expect(document.querySelector('.ct-bar')).toBeNull();
  });

  it('shows the address and raw content of the active cell, also after undo', () => {
    const g = make({ data: [[2, '=A1*2']], formulaBar: true });
    expect(bar().disabled).toBe(true);
    g.selectCell(0, 1);
    expect(address()).toBe('B1');
    expect(bar().value).toBe('=A1*2');
    g.setDataAtCell(0, 1, 5);
    expect(bar().value).toBe('5');
    g.undo();
    expect(bar().value).toBe('=A1*2');
  });

  it('edits from the bar: Enter commits and moves, Tab moves right, Escape cancels', () => {
    const g = make({ data: [[1, 2], [3, 4]], formulaBar: true });
    g.selectCell(0, 0);
    type('=B1*10');
    expect(g.isEditing()).toBe(true);
    expect(document.activeElement).toBe(bar());
    key('Enter');
    expect(g.isEditing()).toBe(false);
    expect(g.getDataAtCell(0, 0)).toBe(20);
    expect(g.getSelected()).toEqual([[1, 0, 1, 0]]);
    expect(document.activeElement).toBe(g.root.querySelector('textarea'));
    type('7');
    key('Tab');
    expect(g.getDataAtCell(1, 0)).toBe(7);
    expect(g.getSelected()).toEqual([[1, 1, 1, 1]]);
    type('99');
    key('Escape');
    expect(g.getDataAtCell(1, 1)).toBe(4);
    expect(bar().value).toBe('4');
    expect(g.isEditing()).toBe(false);
  });

  it('mirrors the cell editor and survives moving focus between the two', () => {
    const g = make({ data: [['a']], formulaBar: true });
    g.selectCell(0, 0);
    const editor = g.root.querySelector('textarea')!;
    g.openEditor();
    editor.value = 'abc';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    expect(bar().value).toBe('abc');
    bar().focus();
    expect(g.isEditing()).toBe(true);
    type('abcd');
    expect(editor.value).toBe('abcd');
    bar().blur();
    expect(g.isEditing()).toBe(false);
    expect(g.getDataAtCell(0, 0)).toBe('abcd');
  });

  it('is read-only where the cell is', () => {
    const g = make({ data: [['a', true]], formulaBar: true, columns: [{ readOnly: true }, { type: 'checkbox' }] });
    g.selectCell(0, 0);
    expect(bar().readOnly).toBe(true);
    g.selectCell(0, 1);
    expect(bar().readOnly).toBe(true);
  });
});

describe('styled clipboard', () => {
  const view = window as Window & typeof globalThis;

  it('writes styles as a table and escapes text', () => {
    expect(styleToCss({ bold: true, underline: true, strike: true, color: '#f00', align: 'right', wrap: true }))
      .toBe('font-weight:700;text-decoration:underline line-through;color:#f00;text-align:right;white-space:normal');
    expect(tableHtml([['<a>', 'b']], [[{ italic: true }, undefined]])).toBe('<table><tr><td style="font-style:italic">&lt;a&gt;</td><td>b</td></tr></table>');
  });

  it('reads the class-based tables spreadsheet apps write, ignoring default colors', () => {
    const html = `<html><head><style><!--
      td {color:black; font-weight:400; white-space:nowrap; text-align:general;}
      .xl65 {color:red; font-weight:700; background:#FFFF00;}
      .xl66 {color:windowtext; font-style:italic; text-decoration:underline; text-align:center; white-space:normal;}
    --></style></head><body><table><tr><td class="xl65">a</td><td class="xl66">b</td><td>c</td></tr></table></body></html>`;
    expect(parseHtmlTable(html, view)!.styles).toEqual([[
      { bold: true, color: 'red', background: '#ffff00' },
      { italic: true, underline: true, align: 'center', wrap: true },
      undefined,
    ]]);
  });

  it('reads inline styles and expands spans', () => {
    const html = '<table><tr><td rowspan="2" style="color:rgb(255, 0, 0);background-color:rgba(0,0,0,0)">a</td><td colspan="2" style="font-weight:bold">b</td></tr><tr><td>c</td><td>d</td></tr></table>';
    const t = parseHtmlTable(html, view)!;
    expect(t.texts).toEqual([['a', 'b', ''], ['', 'c', 'd']]);
    expect(t.styles[0][0]).toEqual({ color: '#ff0000' });
    expect(t.styles[1][0]).toEqual({ color: '#ff0000' });
    expect(t.styles[0][2]).toEqual({ bold: true });
    expect(parseHtmlTable('<p>no table</p>', view)).toBeNull();
  });

  it('pastes styles from another app, undoing values and styles in one step', () => {
    const g = make({ data: [[null, null], [null, null]] });
    g.selectCell(0, 0);
    g.paste('1\tx', '<table><tr><td style="font-weight:bold">1</td><td style="color:#00ff00">x</td></tr></table>');
    expect(g.getDataAtCell(0, 0)).toBe(1);
    expect(g.getCellStyle(0, 0).bold).toBe(true);
    expect(g.getCellStyle(0, 1).color).toBe('#00ff00');
    g.undo();
    expect(g.getDataAtCell(0, 0)).toBeNull();
    expect(g.getCellStyle(0, 0).bold).toBeUndefined();
    g.redo();
    expect(g.getDataAtCell(0, 1)).toBe('x');
    expect(g.getCellStyle(0, 1).color).toBe('#00ff00');
  });

  it('keeps existing styles for plain text and drops them when HTML says none', () => {
    const g = make({ data: [['a']] });
    g.selectCell(0, 0);
    g.toggleCellStyle('bold');
    g.paste('b');
    expect(g.getCellStyle(0, 0).bold).toBe(true);
    g.paste('c', '<table><tr><td>c</td></tr></table>');
    expect(g.getCellStyle(0, 0).bold).toBeUndefined();
  });

  it('takes values from HTML when there is no text, and ignores tables of another shape', () => {
    const g = make({ data: [[null, null]] });
    g.selectCell(0, 0);
    g.paste('', '<table><tr><td>a</td><td>b</td></tr></table>');
    expect(g.getSourceData()).toEqual([['a', 'b']]);
    g.selectCell(0, 0);
    g.paste('z', '<table><tr><td style="font-weight:bold">a</td><td>b</td></tr></table>');
    expect(g.getCellStyle(0, 0).bold).toBeUndefined();
  });

  it('copies styles inside the grid, skipping read-only targets', () => {
    const g = make({ data: [['a', 'b', 'c']], columns: [{}, {}, { readOnly: true }] });
    g.selectCell(0, 0);
    g.toggleCellStyle('italic');
    const text = g.copy()!;
    g.selectCell(0, 1);
    g.paste(text);
    expect(g.getCellStyle(0, 1).italic).toBe(true);
    g.selectCell(0, 2);
    g.paste(text);
    expect(g.getCellStyle(0, 2).italic).toBeUndefined();
  });

  it('puts HTML on the clipboard event only for styled selections', () => {
    const g = make({ data: [['a'], ['b']] });
    const copy = () => {
      const store = new Map<string, string>();
      const e = new Event('copy', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
      e.clipboardData = { setData: (t: string, v: string) => store.set(t, v) };
      document.dispatchEvent(e);
      return store;
    };
    g.selectCell(0, 0);
    g.focus();
    expect(copy().has('text/html')).toBe(false);
    g.toggleCellStyle('bold');
    expect(copy().get('text/html')).toContain('font-weight:700');
  });
});

describe('importing into the grid', () => {
  const file = () => toXLSX([{
    name: 'Veri',
    data: [['Ad', 'Tarih', 'Tutar'], ['Çay', 46000, '=B2*2'], ['Metin', 'tarih değil', null]],
    colWidths: [150, 90, 90],
    rowHeights: [40],
    frozen: { rows: 1, cols: 0 },
    merges: [{ row: 2, col: 1, rowspan: 1, colspan: 2 }],
    format: (r, c) => (r === 0 ? { bold: true, background: '#ddeeff' } : c === 1 ? { numberFormat: 'dd.mm.yyyy' } : c === 2 ? { numberFormat: '#,##0.00 "₺"' } : undefined),
  }]);

  it('loads content, formats and layout with importXLSX', async () => {
    const g = make({ data: [['eski']], locale: 'tr-TR' });
    g.setDataAtCell(0, 0, 'x');
    await g.importXLSX(file());
    expect(g.getSourceDataAtCell(1, 2)).toBe('=B2*2');
    expect(g.getDataAtCell(1, 2)).toBe(92000);
    expect(g.getCellStyle(0, 0)).toMatchObject({ bold: true, background: '#ddeeff' });
    expect(g.getCellMeta(1, 1)).toMatchObject({ type: 'date', dateFormat: 'DD.MM.YYYY' });
    expect(g.getCellMeta(1, 2).numericFormat).toMatchObject({ style: 'currency', currency: 'TRY' });
    expect(g.getColWidth(0)).toBe(150);
    expect(g.getRowHeight(0)).toBe(40);
    expect(g.getMergedCells()).toEqual([{ row: 2, col: 1, rowspan: 1, colspan: 2 }]);
    expect(g.isUndoAvailable()).toBe(false);
    expect(g.root.textContent).toContain('92.000,00');
  });

  it('marks no text as invalid under a date format and keeps custom codes on re-export', async () => {
    const g = make({ data: [[1]] });
    await g.importXLSX(file());
    expect(g.getCellError(2, 1)).toBeUndefined();
    expect(g.getCellMeta(2, 1).type).toBeUndefined();
    const again = await readXLSX(toXLSX([g.toExportSheet()]));
    expect(again.sheets[0].format(1, 2)?.numberFormat).toBe('#,##0.00 "₺"');
    expect(again.sheets[0].frozen).toEqual({ rows: 1, cols: 0 });
  });

  it('selects a sheet by name and fails clearly for an unknown one', async () => {
    const bytes = toXLSX([{ name: 'A', data: [[1]] }, { name: 'B', data: [[2]] }]);
    const g = make({ data: [[0]] });
    await g.importXLSX(bytes, { sheet: 'B' });
    expect(g.getDataAtCell(0, 0)).toBe(2);
    await expect(g.importXLSX(bytes, { sheet: 'C' })).rejects.toThrow('Sheet not found');
  });

  it('hides columns from the file and shows them again', async () => {
    const g = make({ data: [[0]] });
    const { sheets } = await readXLSX(toXLSX([{ name: 'A', data: [[1, 2]] }]));
    g.loadSheet({ ...sheets[0], hiddenColumns: [1] });
    expect(g.getHiddenColumns()).toEqual([1]);
    g.showColumns();
    expect(g.getColWidth(1)).toBeGreaterThan(0);
  });
});
