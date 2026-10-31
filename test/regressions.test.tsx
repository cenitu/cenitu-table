import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CenituGrid, enUS, linkRenderer, readXLSX, zipStore, type CellEditorContext, type GridOptions } from '../src';
import { convertInput, parseByPattern } from '../src/grid/cellTypes';
import { dateToSerial } from '../src/formula/dates';
import { CenituTable, reactRenderer } from '../src/react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let grid: CenituGrid;
afterEach(() => {
  grid?.destroy();
  document.body.textContent = '';
  vi.useRealTimers();
});

function make(opts: GridOptions) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  grid = new CenituGrid(host, { language: enUS, ...opts });
  return grid;
}

const openAndEnter = (g: CenituGrid) => {
  g.selectCell(0, 0);
  g.openEditor();
  g.closeEditor(true);
};

describe('opening an editor changes nothing by itself', () => {
  it('keeps decimals with a dot', () => {
    for (const v of [1.234, 0.125]) {
      const g = make({ data: [[v]], columns: [{ type: 'numeric' }] });
      openAndEnter(g);
      expect(g.getSourceDataAtCell(0, 0)).toBe(v);
      g.destroy();
    }
  });

  it('keeps ids behind labels, duplicate labels and date values', () => {
    const cases: [unknown, GridOptions['columns']][] = [
      [17, [{ type: 'dropdown', strict: false, resolveLabel: () => 'Acme' }]],
      [2, [{ type: 'dropdown', source: [{ value: 1, label: 'X' }, { value: 2, label: 'X' }] }]],
      [46000, [{ type: 'date', dateFormat: 'MM/DD/YYYY' }]],
      [46000.75, [{ type: 'date', dateFormat: 'DD.MM.YYYY' }]],
    ];
    for (const [value, columns] of cases) {
      const g = make({ data: [[value as number]], columns });
      openAndEnter(g);
      expect(g.getSourceDataAtCell(0, 0)).toBe(value);
      expect(g.isUndoAvailable()).toBe(false);
      g.destroy();
    }
  });

  it('reads numbers by locale when text does change', () => {
    expect(convertInput('1.234', { type: 'numeric' })).toBe(1.234);
    expect(convertInput('1.234', { type: 'numeric' }, 'en-US')).toBe(1.234);
    expect(convertInput('1.234', { type: 'numeric' }, 'tr-TR')).toBe(1234);
    expect(convertInput('1.234,5', { type: 'numeric' })).toBe(1234.5);
    expect(convertInput('4,5', { type: 'numeric' })).toBe(4.5);
  });

  it('reads dates by the cell pattern', () => {
    expect(parseByPattern('02/03/2026', 'MM/DD/YYYY')).toBe(dateToSerial(2026, 2, 3));
    expect(parseByPattern('03.02.26', 'DD.MM.YY')).toBe(dateToSerial(2026, 2, 3));
    expect(parseByPattern('03.02.2026 12:00', 'DD.MM.YYYY HH:mm')).toBe(dateToSerial(2026, 2, 3) + 0.5);
    expect(parseByPattern('12:00', 'HH:mm')).toBe(0.5);
    expect(parseByPattern('31.13.2026', 'DD.MM.YYYY')).toBeUndefined();
    expect(convertInput('02/03/2026', { type: 'date', dateFormat: 'MM/DD/YYYY' })).toBe(dateToSerial(2026, 2, 3));
  });
});

describe('an editor stays tied to its cell', () => {
  const type = (g: CenituGrid, text: string) => {
    const ta = g.root.querySelector('textarea')!;
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('is discarded when the data is replaced', () => {
    const g = make({ data: [['a'], ['b'], ['c']] });
    g.selectCell(0, 0);
    g.openEditor();
    type(g, 'zz');
    g.loadData([['x'], ['y'], ['w']]);
    expect(g.isEditing()).toBe(false);
    g.selectCell(2, 0);
    expect(g.getData().flat()).toEqual(['x', 'y', 'w']);
  });

  it('does not write into a new server page', () => {
    const g = make({ dataMode: 'server', rowKey: 'id', data: [{ id: 1, a: 'x' }], columns: [{ data: 'a' }] });
    g.selectCell(0, 0);
    g.openEditor();
    type(g, 'yeni');
    g.setPageRows([{ id: 9, a: 'q' }]);
    expect(g.getDataAtCell(0, 0)).toBe('q');
    expect(g.isEditing()).toBe(false);
  });

  it('commits to the edited cell when the selection moves', () => {
    const g = make({ data: [['a'], ['b']] });
    g.selectCell(0, 0);
    g.openEditor();
    type(g, 'yeni');
    g.selectCell(1, 0);
    expect(g.getData().flat()).toEqual(['yeni', 'b']);
  });

  it('commits a custom editor after a row was inserted above it', () => {
    let ctx!: CellEditorContext;
    const g = make({ data: [[1], [2]], columns: [{ editor: (c) => void (ctx = c) }] });
    g.selectCell(1, 0);
    g.openEditor();
    g.alter('insert_row_above', 0);
    expect(g.isEditing()).toBe(false);
    ctx.commit(9);
    expect(g.getData().flat()).toEqual([null, 1, 2]);
  });

  it('cleans up custom editors on new data and on destroy, also when they finish at once', () => {
    const destroyed: string[] = [];
    const g = make({ data: [[1]], columns: [{ editor: () => ({ destroy: () => void destroyed.push('a') }) }] });
    g.selectCell(0, 0);
    g.openEditor();
    g.loadData([[2]]);
    expect(destroyed).toEqual(['a']);
    expect(g.isEditing()).toBe(false);
    g.selectCell(0, 0);
    g.openEditor();
    g.destroy();
    expect(destroyed).toEqual(['a', 'a']);
    const sync = make({ data: [[1]], columns: [{ editor: (c) => (c.cancel(), { destroy: () => void destroyed.push('sync') }) }] });
    sync.selectCell(0, 0);
    sync.openEditor();
    expect(destroyed).toContain('sync');
    expect(sync.isEditing()).toBe(false);
  });

  it('stops a pending option search on destroy', async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => []);
    const g = make({ data: [[1]], columns: [{ type: 'dropdown', loadOptions: load }] });
    g.selectCell(0, 0);
    g.openEditor();
    g.destroy();
    await vi.advanceTimersByTimeAsync(500);
    expect(load).not.toHaveBeenCalled();
  });
});

describe('server array rows after a column move', () => {
  it('keeps each value under its column id', () => {
    const g = make({ dataMode: 'server', data: [['a', 'b']], columns: [{ id: 'a' }, { id: 'b' }] });
    g.moveColumns(0, 1, 2);
    g.setPageRows([['A2', 'B2']]);
    expect(g.getDataAtCell(0, g.getColumnLayout().columns.findIndex((c) => c.id === 'b'))).toBe('B2');
    g.setPageRows([['A3', 'B3']]);
    expect(g.getData()[0]).toEqual(['B3', 'A3']);
  });
});

describe('row detail content belongs to the application', () => {
  it('keeps its own input, focus and keys', () => {
    const g = make({
      data: [['x'], ['y']],
      rowDetail: (el) => void el.append(Object.assign(document.createElement('input'), { value: 'yazı' })),
    });
    g.selectCell(1, 0);
    g.toggleRowDetail(0);
    const input = g.root.querySelector<HTMLInputElement>('.ct-detail input')!;
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    input.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    expect(g.getSelected()).toEqual([[1, 0, 1, 0]]);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    expect(g.getDataAtCell(1, 0)).toBe('y');
  });
});

describe('recycled cell elements', () => {
  it('clears old text when a component column reuses an element', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const renderer = reactRenderer(() => <b>R</b>);
    let g: CenituGrid | null = null;
    await act(async () => root.render(<CenituTable ref={(r) => void (g = r)} data={[['bb']]} />));
    await act(async () => g!.updateSettings({ columns: [{ renderer }] }));
    expect(host.querySelector('.ct-cell')!.textContent).toBe('R');
    await act(async () => root.unmount());
  });

  it('drops a stale link when the address goes away', () => {
    let url: string | undefined = 'https://a.test/x';
    const g = make({ data: [['aynı']], columns: [{ renderer: linkRenderer(() => url) }] });
    expect(g.root.querySelector('a')).not.toBeNull();
    url = undefined;
    g.render();
    expect(g.root.querySelector('a')).toBeNull();
    expect(g.root.querySelector('.ct-cell')!.textContent).toBe('aynı');
  });

  it('runs every cleanup of a decorating renderer', () => {
    let live = 0;
    const g = make({ data: [['a']], columns: [{ renderer: () => (live++, () => void live--) }] });
    g.render();
    g.render();
    expect(live).toBe(1);
  });
});

describe('empty grids', () => {
  it('keeps no phantom selection, and survives the next page', () => {
    const g = make({ dataMode: 'server', rowKey: (r) => (r as { id: number }).id, data: [], columns: [{ data: 'id' }] });
    g.selectCell(0, 0);
    expect(g.getSelected()).toBeUndefined();
    expect(() => g.setPageRows([{ id: 1 }])).not.toThrow();
    expect(g.getDataAtCell(0, 0)).toBe(1);
  });

  it('keeps columns after all rows were removed', () => {
    const g = make({ data: [[1, 2]] });
    g.alter('remove_row', 0);
    expect(g.countCols()).toBe(2);
    g.alter('insert_row_below');
    expect(g.getSourceData()).toEqual([[null, null]]);
  });

  it('draws no ghost cell for a frozen row on an empty page', () => {
    const g = make({ dataMode: 'server', data: [], fixedRowsTop: 1, columns: [{ data: 'a' }] });
    expect(g.root.querySelectorAll('.ct-cell').length).toBe(0);
  });
});

describe('React props', () => {
  it('clears a removed error, follows new functions and conditional formats', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const columns = [{ id: 'a', data: 'a' }, { id: 'b', data: 'b' }];
    let g: CenituGrid | null = null;
    const base = { dataMode: 'server' as const, data: [{ a: 1, b: 2 }], ref: (r: CenituGrid | null) => void (g = r) };
    act(() => root.render(<CenituTable {...base} columns={columns} loadError="bozuk" fetchAllRows={async () => [[1]]} />));
    expect(host.textContent).toContain('bozuk');
    act(() => root.render(<CenituTable {...base} columns={columns} fetchAllRows={async () => [[1], [2]]} />));
    expect(host.textContent).not.toContain('bozuk');
    expect((await g!.toExportSheetAll()).data).toHaveLength(2);
    act(() => root.unmount());
  });

  it('keeps a moved column in place when inline columns come again', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let g: CenituGrid | null = null;
    const render = () => <CenituTable ref={(r) => void (g = r)} data={[{ a: 1, b: 2 }]} columns={[{ id: 'a', data: 'a' }, { id: 'b', data: 'b' }]} />;
    act(() => root.render(render()));
    act(() => void g!.moveColumns(0, 1, 2));
    act(() => root.render(render()));
    expect(g!.getColumnId(0)).toBe('b');
    expect(g!.getDataAtCell(0, 0)).toBe(2);
    act(() => root.unmount());
  });
});

describe('labels of hidden rows', () => {
  it('come from the row itself', () => {
    const g = make({
      data: [{ v: 1, n: 'L1' }, { v: 2, n: 'L2' }, { v: 3, n: 'L3' }],
      columns: [{ data: 'v', type: 'dropdown', strict: false, resolveLabel: (_, r) => (r as { n: string }).n }],
    });
    g.hideRows([1]);
    expect(g.toExportSheet().text!(1, 0)).toBe('L2');
  });
});

describe('row sizes', () => {
  it('survive undo of a row removal', () => {
    const g = make({ data: [[1], [2]] });
    g.setRowHeight(1, 80);
    g.alter('remove_row', 1);
    g.undo();
    expect(g.getRowHeight(1)).toBe(80);
  });

  it('do not carry over to new data or pages', () => {
    const g = make({ data: [[1]] });
    g.setRowHeight(0, 80);
    g.loadData([[2]]);
    expect(g.getRowHeight(0)).toBe(24);
    g.destroy();
    const s = make({ dataMode: 'server', data: [{ a: 1 }], columns: [{ data: 'a' }], rowDetail: () => undefined, rowDetailHeight: 100 });
    s.setRowHeight(0, 80);
    s.toggleRowDetail(0);
    s.setPageRows([{ a: 2 }]);
    expect(s.getRowHeight(0)).toBe(24);
  });

  it('does not show one row detail twice after undo', () => {
    const g = make({ data: [['b'], ['c']], rowDetail: (el, row) => void (el.textContent = `d:${(row as string[])[0]}`) });
    g.toggleRowDetail(0);
    g.toggleRowDetail(1);
    g.alter('remove_row', 0);
    g.undo();
    expect([...g.root.querySelectorAll('.ct-detail')].map((e) => e.textContent).sort()).toEqual(['d:b', 'd:c']);
  });
});

describe('reading files', () => {
  const enc = new TextEncoder();
  const part = (path: string, xml: string) => ({ path, data: enc.encode(xml) });
  const pack = (sheet: string, extra: ReturnType<typeof part>[] = []) =>
    zipStore([
      part('xl/workbook.xml', '<workbook xmlns:r="r"><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      part('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      part('xl/worksheets/sheet1.xml', `<worksheet>${sheet}</worksheet>`),
      ...extra,
    ]);

  it('refuses sheets too large to hold, instead of exhausting memory', async () => {
    await expect(readXLSX(pack('<sheetData/><mergeCells><mergeCell ref="A1:ZZ30000"/></mergeCells>'))).rejects.toThrow('too large');
    await expect(readXLSX(pack('<sheetData><row r="1048576"><c r="XFD1048576"><v>1</v></c></row></sheetData>'))).rejects.toThrow('too large');
    const { sheets } = await readXLSX(pack('<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>'), { maxCells: 1 });
    expect(sheets[0].data).toEqual([[1]]);
  });

  it('decodes escapes, empty string cells and ISO dates', async () => {
    const sst = part('xl/sharedStrings.xml', '<sst><si><t>ilk</t></si><si><t>a_x000D_b</t></si></sst>');
    const xml = '<sheetData><row r="1"><c r="A1" t="s"/><c r="B1" t="s"><v>1</v></c><c r="C1" t="d"><v>2024-01-15T00:00:00</v></c></row></sheetData>';
    const { sheets } = await readXLSX(pack(xml, [sst]));
    expect(sheets[0].data[0]).toEqual([null, 'a\rb', dateToSerial(2024, 1, 15)]);
  });

  it('ignores panes and filters of saved custom views', async () => {
    const xml = `<sheetViews><sheetView><pane ySplit="2" state="frozen"/></sheetView></sheetViews><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>
      <customSheetViews><customSheetView><pane ySplit="9" state="frozen"/><autoFilter ref="A1:B2"/></customSheetView></customSheetViews>`;
    const { sheets } = await readXLSX(pack(xml));
    expect(sheets[0].frozen!.rows).toBe(2);
    expect(sheets[0].autoFilter).toBeUndefined();
  });
});

describe('search box and exports', () => {
  it('shows the replace row on Ctrl+H after Ctrl+F', () => {
    const g = make({ data: [['a']] });
    g.openSearch(false);
    const row = document.querySelector<HTMLElement>('.ct-search-row:nth-child(2)')!;
    expect(row.hidden).toBe(true);
    g.openSearch(true);
    expect(row.hidden).toBe(false);
  });

  it('keeps merges in the export while rows are hidden', () => {
    const g = make({ data: [[1, 2], [3, 4], [5, 6]], mergeCells: [{ row: 0, col: 0, rowspan: 1, colspan: 2 }] });
    g.hideRows([2]);
    expect(g.toExportSheet().merges).toHaveLength(1);
  });

  it('caps huge spans in pasted tables', () => {
    const g = make({ data: [[null]] });
    g.selectCell(0, 0);
    expect(() => g.paste('', '<table><tr><td rowspan="1000000" colspan="1">a</td></tr></table>')).not.toThrow();
  });
});
