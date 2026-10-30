import { afterEach, describe, expect, it } from 'vitest';
import { CenituGrid, type GridOptions } from '../src';
import { extendSeries } from '../src/grid/autofill';
import { Merges } from '../src/grid/merges';
import { RowMapper } from '../src/grid/rowMapper';

let grid: CenituGrid;
afterEach(() => grid?.destroy());

function make(data: unknown[][], opts: GridOptions = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  grid = new CenituGrid(host, { data: data as GridOptions['data'], ...opts });
  return grid;
}

const key = (k: string, extra: Partial<KeyboardEventInit> = {}) =>
  grid.root.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));

const col = (g: CenituGrid, c: number) => g.getData().map((r) => r[c]);

describe('RowMapper', () => {
  it('maps, sorts, hides and keeps pinned rows first', () => {
    const m = new RowMapper(5, 1);
    m.sort((a, b) => b - a);
    expect([0, 1, 2, 3, 4].map((v) => m.toPhysical(v))).toEqual([0, 4, 3, 2, 1]);
    m.setHidden([3, 0]);
    expect(m.count).toBe(4); // pinned row 0 cannot be hidden
    expect(m.toVisual(3)).toBe(-1);
    m.insert(2, 1, 1);
    expect(m.toPhysical(1)).toBe(2);
    m.remove(0, 1);
    expect(m.physicalCount).toBe(5);
  });
});

describe('autofill series', () => {
  const shift = (raw: string) => raw;
  it.each([
    [[1, 2], 3, [3, 4, 5]],
    [[5], 2, [5, 5]],
    [[2, 4, 8], 3, [2, 4, 8]],
    [['Item 1'], 2, ['Item 2', 'Item 3']],
    [['Q1', 'Q3'], 2, ['Q5', 'Q7']],
    [['a', 'b'], 3, ['a', 'b', 'a']],
    [[0.1, 0.2], 2, [0.3, 0.4]],
  ])('%j +%i -> %j', (src, n, expected) => {
    expect(extendSeries(src as never, n as number, shift)).toEqual(expected);
  });
});

describe('Merges model', () => {
  it('expands ranges and shifts on insert/remove', () => {
    const m = new Merges();
    m.add({ row: 1, col: 1, rowspan: 2, colspan: 2 });
    expect(m.expand({ start: { row: 0, col: 0 }, end: { row: 1, col: 1 } })).toEqual({
      start: { row: 0, col: 0 }, end: { row: 2, col: 2 },
    });
    m.shift('row', 0, 2);
    expect(m.list[0].row).toBe(3);
    m.shift('row', 4, -1);
    expect(m.list).toEqual([{ row: 3, col: 1, rowspan: 1, colspan: 2 }]);
    m.shift('col', 2, -1);
    expect(m.list).toHaveLength(0); // shrank to a single cell
  });
});

describe('sorting and filtering', () => {
  const data = [
    ['Name', 'Qty', 'Total'],
    ['pear', 3, '=B2*10'],
    ['apple', 10, '=B3*10'],
    ['fig', null, '=B4*10'],
    ['banana', 1, '=B5*10'],
  ];

  it('sorts visually while formulas keep their physical references', () => {
    const g = make(data, { fixedRowsTop: 1, columnSorting: true });
    g.sort(1, 'asc');
    expect(col(g, 0)).toEqual(['Name', 'banana', 'pear', 'apple', 'fig']); // blank last
    expect(col(g, 2)).toEqual(['Total', 10, 30, 100, 0]);
    expect(g.getSourceDataAtCell(1, 2)).toBe('=B5*10');
    g.sort(0, 'desc');
    expect(col(g, 0)).toEqual(['Name', 'pear', 'fig', 'banana', 'apple']);
    g.sort(0, null);
    expect(col(g, 0)).toEqual(data.map((r) => r[0]));
  });

  it('edits through a sorted view hit the right physical row', () => {
    const g = make(data, { fixedRowsTop: 1 });
    g.sort(1, 'desc');
    g.setDataAtCell(1, 1, 7); // visual row 1 = apple (physical 2)
    expect(g.getSourceData()[2][1]).toBe(7);
    expect(g.getDataAtCell(1, 2)).toBe(70);
    // Row headers show physical row numbers so they match formula references.
    const labels = [...g.root.querySelectorAll('.ct-rowhead')].filter((e) => (e as HTMLElement).style.display !== 'none').map((e) => e.textContent);
    expect(labels.slice(0, 3)).toEqual(['1', '3', '2']);
  });

  it('filters by condition and by values, combining columns', () => {
    const g = make(data, { fixedRowsTop: 1, filters: true });
    g.setFilter(1, { condition: { op: 'greaterThan', value: '2' } });
    expect(col(g, 0)).toEqual(['Name', 'pear', 'apple']);
    g.setFilter(0, { values: ['apple', 'banana'] });
    expect(col(g, 0)).toEqual(['Name', 'apple']);
    g.setFilter(1, null);
    expect(col(g, 0)).toEqual(['Name', 'apple', 'banana']);
    g.clearFilters();
    expect(g.countRows()).toBe(5);
  });

  it('filter conditions on text', () => {
    const g = make(data, { fixedRowsTop: 1 });
    g.setFilter(0, { condition: { op: 'contains', value: 'AN' } });
    expect(col(g, 0)).toEqual(['Name', 'banana']);
    g.setFilter(0, { condition: { op: 'isEmpty' } });
    expect(g.countRows()).toBe(1);
  });

  it('opens the column menu and applies a value filter from the UI', () => {
    const g = make(data, { fixedRowsTop: 1, filters: true, columnSorting: true });
    const btn = g.root.querySelectorAll<HTMLElement>('.ct-colhead .ct-menu-btn')[0];
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    const menu = document.querySelector('.ct-menu')!;
    expect(menu).toBeTruthy();
    const boxes = [...menu.querySelectorAll<HTMLLabelElement>('.ct-menu-list label')];
    // first label is "select all"; uncheck "pear"
    const pear = boxes.find((l) => l.textContent === 'pear')!;
    pear.querySelector('input')!.checked = false;
    [...menu.querySelectorAll('button')].find((b) => b.textContent === 'OK')!.click();
    expect(document.querySelector('.ct-menu')).toBeNull();
    expect(col(g, 0)).not.toContain('pear');
    expect(g.root.querySelector('.ct-colhead.ct-filtered')).toBeTruthy();
  });

  it('inserting a row in a sorted view keeps mapping consistent', () => {
    const g = make(data, { fixedRowsTop: 1 });
    g.sort(1, 'asc');
    g.alter('insert_row_above', 2);
    expect(g.countRows()).toBe(6);
    expect(g.getDataAtCell(2, 0)).toBe(null);
    expect(col(g, 2)).toEqual(['Total', 10, null, 30, 100, 0]);
    g.undo();
    expect(g.countRows()).toBe(5);
    g.redo();
    expect(g.countRows()).toBe(6);
    expect(col(g, 2)).toEqual(['Total', 10, null, 30, 100, 0]);
    g.undo();
    expect(col(g, 2)).toEqual(['Total', 10, 30, 100, 0]);
  });
});

describe('autofill in the grid', () => {
  it('fills numbers, text series and shifted formulas down', () => {
    const g = make([[1, 'Day 1', '=A1*2'], [2, null, null], [null, null, null], [null, null, null]]);
    g.autofill({ start: { row: 0, col: 0 }, end: { row: 1, col: 0 } }, { start: { row: 2, col: 0 }, end: { row: 4, col: 0 } });
    expect(col(g, 0)).toEqual([1, 2, 3, 4, 5]);
    g.autofill({ start: { row: 0, col: 1 }, end: { row: 0, col: 2 } }, { start: { row: 1, col: 1 }, end: { row: 3, col: 2 } });
    expect(col(g, 1).slice(0, 4)).toEqual(['Day 1', 'Day 2', 'Day 3', 'Day 4']);
    expect(g.getSourceDataAtCell(3, 2)).toBe('=A4*2');
    expect(g.getDataAtCell(3, 2)).toBe(8);
    expect(g.getSelected()).toEqual([[0, 1, 3, 2]]);
    g.undo();
    expect(g.getSourceDataAtCell(3, 2)).toBe(null);
  });

  it('fills up and right', () => {
    const g = make([[null, null, null], [null, null, null], [5, 10, null]]);
    g.autofill({ start: { row: 2, col: 0 }, end: { row: 2, col: 1 } }, { start: { row: 2, col: 2 }, end: { row: 2, col: 3 } });
    expect(g.getData()[2]).toEqual([5, 10, 15, 20]);
    g.autofill({ start: { row: 2, col: 0 }, end: { row: 2, col: 0 } }, { start: { row: 0, col: 0 }, end: { row: 1, col: 0 } });
    expect(col(g, 0)).toEqual([5, 5, 5]);
  });

  it('Ctrl+D fills down the selection', () => {
    const g = make([[null], [null], [null]]);
    g.setDataAtCell(0, 0, 'x');
    g.selectCell(0, 0, 2, 0);
    key('d', { ctrlKey: true });
    expect(col(g, 0)).toEqual(['x', 'x', 'x']);
  });
});

describe('frozen panes', () => {
  it('renders frozen rows/columns in their own panes and keeps navigation working', () => {
    const data = Array.from({ length: 100 }, (_, r) => Array.from({ length: 30 }, (_, c) => `${r}:${c}`));
    const g = make(data, { fixedRowsTop: 2, fixedColumnsStart: 1, formulas: false });
    const pane = (name: string) => g.root.querySelector(`.ct-pane-${name}`)!;
    const texts = (name: string) => [...pane(name).querySelectorAll<HTMLElement>('.ct-cell')].filter((e) => e.style.display !== 'none').map((e) => e.textContent);
    expect(texts('corner').sort()).toEqual(['0:0', '1:0']);
    expect(texts('top')).toContain('0:5');
    expect(texts('left')).toContain('10:0');
    expect(texts('main')).toContain('10:5');
    expect(texts('main')).not.toContain('0:5');
    g.selectCell(0, 0);
    key('ArrowDown');
    key('ArrowDown');
    expect(g.getSelected()).toEqual([[2, 0, 2, 0]]);
    expect(pane('left').querySelector('textarea')).toBeTruthy();
  });

  it('can be changed at runtime and excludes frozen rows from sorting', () => {
    const g = make([['h'], [3], [1], [2]]);
    g.updateSettings({ fixedRowsTop: 1 });
    g.sort(0, 'asc');
    expect(col(g, 0)).toEqual(['h', 1, 2, 3]);
  });
});

describe('merged cells', () => {
  it('renders one element spanning the area and expands selection', () => {
    const g = make([[1, 2, 3], [4, 5, 6], [7, 8, 9]], { mergeCells: [{ row: 0, col: 0, rowspan: 2, colspan: 2 }] });
    const visible = [...g.root.querySelectorAll<HTMLElement>('.ct-pane-main .ct-cell')].filter((e) => e.style.display !== 'none');
    expect(visible).toHaveLength(6);
    expect(visible.find((e) => e.textContent === '1')!.style.width).toBe('200px');
    g.selectCell(1, 1);
    expect(g.getSelected()).toEqual([[0, 0, 0, 0]]);
    key('ArrowDown');
    expect(g.getSelected()).toEqual([[2, 0, 2, 0]]);
    g.selectCell(2, 1, 1, 2);
    expect(g.getSelectedRange()).toEqual({ start: { row: 0, col: 0 }, end: { row: 2, col: 2 } });
  });

  it('merges/unmerges via API, refuses overlaps across frozen edges and shifts on insert', () => {
    const g = make([[1, 2, 3], [4, 5, 6], [7, 8, 9]], { fixedRowsTop: 1 });
    expect(g.mergeCells(0, 0, 2, 1)).toBe(false);
    expect(g.mergeCells(1, 0, 2, 2)).toBe(true);
    g.alter('insert_row_above', 1);
    expect(g.getMergedCells()).toEqual([{ row: 2, col: 0, rowspan: 2, colspan: 2 }]);
    expect(g.unmergeCells(3, 1)).toBe(true);
    expect(g.getMergedCells()).toEqual([]);
  });
});

describe('cell types, formats and validation', () => {
  it('formats numbers with Intl and parses a decimal comma', () => {
    const g = make([[1234.5, 0.25]], {
      locale: 'tr-TR',
      columns: [
        { type: 'numeric', numericFormat: { style: 'currency', currency: 'TRY' } },
        { type: 'numeric', numericFormat: { style: 'percent' } },
      ],
    });
    const texts = [...g.root.querySelectorAll('.ct-pane-main .ct-cell')].map((e) => e.textContent);
    expect(texts[0]).toMatch(/1\.234,50/);
    expect(texts[1]).toMatch(/25/);
    g.selectCell(0, 0);
    const ta = g.root.querySelector('textarea')!;
    ta.value = '99,75';
    ta.dispatchEvent(new Event('input'));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(g.getSourceDataAtCell(0, 0)).toBe(99.75);
  });

  it('marks invalid values, or rejects them with allowInvalid: false', () => {
    const errors: unknown[] = [];
    const g = make([[5, 'ok']], {
      columns: [
        { type: 'numeric', validator: (v) => (typeof v === 'number' && v >= 0) || 'Must be positive' },
        { validator: /^[a-z]+$/, allowInvalid: false },
      ],
    });
    g.addHook('afterValidate', (r, c, e) => errors.push([r, c, e]));
    g.selectCell(0, 0);
    let ta = g.root.querySelector('textarea')!;
    ta.value = '-1';
    ta.dispatchEvent(new Event('input'));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(g.getCellError(0, 0)).toBe('Must be positive');
    expect(g.root.querySelector('.ct-invalid')).toBeTruthy();
    expect(errors).toEqual([[0, 0, 'Must be positive']]);
    ta = g.root.querySelector('textarea')!;
    ta.value = 'NOPE1';
    ta.dispatchEvent(new Event('input'));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(g.getSourceDataAtCell(0, 1)).toBe('ok');
  });

  it('toggles checkboxes with Space and click; read-only cells cannot change', () => {
    const g = make([[true, false, 'x']], {
      columns: [{ type: 'checkbox' }, { type: 'checkbox' }, { readOnly: true }],
    });
    expect(g.root.querySelectorAll('.ct-checkbox')).toHaveLength(2);
    g.selectCell(0, 0, 0, 1);
    key(' ');
    expect(g.getData()[0].slice(0, 2)).toEqual([false, true]);
    g.selectCell(0, 2);
    key('Delete');
    const ta = g.root.querySelector('textarea')!;
    ta.value = 'y';
    ta.dispatchEvent(new Event('input'));
    expect(g.isEditing()).toBe(false);
    expect(g.getSourceDataAtCell(0, 2)).toBe('x');
  });

  it('dropdown cells offer filtered choices and validate against the list', () => {
    const g = make([['Red']], { columns: [{ type: 'dropdown', source: ['Red', 'Green', 'Blue'] }] });
    g.selectCell(0, 0);
    const ta = g.root.querySelector('textarea')!;
    ta.value = 'gr';
    ta.dispatchEvent(new Event('input'));
    const items = [...g.root.querySelectorAll('.ct-dd-item')].map((e) => e.textContent);
    expect(items).toEqual(['Green']);
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(g.getSourceDataAtCell(0, 0)).toBe('Green');
    g.setDataAtCell(0, 0, 'Purple');
    expect(g.getCellError(0, 0)).toBe('Not in list');
  });

  it('date cells store serial numbers and display/edit formatted dates', () => {
    const g = make([[null]], { locale: 'tr-TR', columns: [{ type: 'date' }] });
    g.selectCell(0, 0);
    const ta = g.root.querySelector('textarea')!;
    ta.value = '30.10.2026';
    ta.dispatchEvent(new Event('input'));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(g.getSourceDataAtCell(0, 0)).toBe(46325);
    expect(g.root.querySelector('.ct-pane-main .ct-cell')!.textContent).toBe('30.10.2026');
    g.setDataAtCell(0, 0, 'not a date');
    expect(g.getCellError(0, 0)).toBe('Not a date');
  });
});

describe('multiple sheets in grids', () => {
  it('grids sharing an engine see each other through cross-sheet formulas', async () => {
    const { FormulaEngine } = await import('../src');
    const engine = FormulaEngine.buildEmpty();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const orders = new CenituGrid(host, { formulas: engine, sheetName: 'Siparişler', data: [[10], [20]] });
    const summary = new CenituGrid(host, { formulas: engine, sheetName: 'Özet', data: [['=SUM(Siparişler!A1:A2)*Oran']] });
    engine.addNamedExpression('Oran', 2);
    expect(summary.getDataAtCell(0, 0)).toBe(60);
    orders.setDataAtCell(1, 0, 5);
    expect(summary.getDataAtCell(0, 0)).toBe(30);
    engine.renameSheet(orders.getSheetId(), 'Orders');
    expect(summary.getSourceDataAtCell(0, 0)).toBe('=SUM(Orders!A1:A2)*Oran');
    orders.alter('insert_row_above', 0);
    expect(summary.getSourceDataAtCell(0, 0)).toBe('=SUM(Orders!A2:A3)*Oran');
    expect(summary.getDataAtCell(0, 0)).toBe(30);
    expect(orders.getSheetName()).toBe('Orders');
    orders.destroy();
    summary.destroy();
  });
});

describe('structural undo across sheets', () => {
  it('undo/redo of row removal restores formulas on other sheets', async () => {
    const { FormulaEngine } = await import('../src');
    const engine = FormulaEngine.buildEmpty();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const data = new CenituGrid(host, { formulas: engine, sheetName: 'Data', data: [[1], [2], [3], [4]] });
    const report = new CenituGrid(host, { formulas: engine, sheetName: 'Report', data: [['=SUM(Data!A1:A4)', '=Data!A2*10']] });
    data.alter('remove_row', 1);
    expect(report.getSourceDataAtCell(0, 0)).toBe('=SUM(Data!A1:A3)');
    expect(report.getDataAtCell(0, 1)).toMatchObject({ code: '#REF!' });
    data.undo();
    expect(report.getSourceDataAtCell(0, 0)).toBe('=SUM(Data!A1:A4)');
    expect(report.getSourceDataAtCell(0, 1)).toBe('=Data!A2*10');
    expect(report.getData()[0]).toEqual([10, 20]);
    expect(data.getData().map((r) => r[0])).toEqual([1, 2, 3, 4]);
    data.redo();
    expect(report.getDataAtCell(0, 0)).toBe(8);
    data.alter('insert_row_above', 0, 2);
    data.undo();
    data.undo();
    expect(report.getData()[0]).toEqual([10, 20]);
    data.destroy();
    report.destroy();
  });
});
