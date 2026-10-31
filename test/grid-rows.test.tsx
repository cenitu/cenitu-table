import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { CenituGrid, type ColumnLayout, type GridOptions, type RowEvent } from '../src';
import { CenituTable } from '../src/react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let grid: CenituGrid;
afterEach(() => {
  grid?.destroy();
  document.body.textContent = '';
});

const rows = () => [{ id: 7, a: 1, b: 2, c: 3 }, { id: 8, a: 4, b: 5, c: 6 }];
const columns = [{ id: 'a', data: 'a' }, { id: 'b', data: 'b' }, { id: 'c', data: 'c' }];

function make(opts: GridOptions = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  grid = new CenituGrid(host, { data: rows(), columns, rowKey: 'id', ...opts });
  return grid;
}

const cell = (g: CenituGrid, text: string) => [...g.root.querySelectorAll<HTMLElement>('.ct-cell')].find((c) => c.textContent === text)!;
const fire = (el: Element, type: string) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 60, clientY: 40 }));

describe('row events', () => {
  it('reports clicks with the row key and data', () => {
    const g = make();
    const seen: RowEvent[] = [];
    g.addHook('afterRowClick', (e) => seen.push(e));
    fire(cell(g, '1'), 'click');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ row: 0, physicalRow: 0, rowKey: 7, rowData: { id: 7, a: 1 } });
    expect(seen[0].originalEvent).toBeInstanceOf(MouseEvent);
  });

  it('gives the data row when the view is sorted', () => {
    const g = make();
    g.sort(0, 'desc');
    const seen: RowEvent[] = [];
    g.addHook('afterRowClick', (e) => seen.push(e));
    fire(cell(g, '4'), 'click');
    expect(seen[0]).toMatchObject({ physicalRow: 1, rowKey: 8 });
  });

  it('ignores headers and checkboxes', () => {
    const g = make({ columns: [{ ...columns[0], type: 'checkbox' }, columns[1]] });
    let clicks = 0;
    g.addHook('afterRowClick', () => clicks++);
    fire(g.root.querySelector('.ct-colhead')!, 'click');
    fire(g.root.querySelector('.ct-checkbox')!, 'click');
    expect(clicks).toBe(0);
  });

  it('opens the editor on double click unless the hook returns false', () => {
    const g = make();
    let cancel = false;
    const seen: unknown[] = [];
    g.addHook('afterRowDoubleClick', (e) => {
      seen.push(e.rowKey);
      return cancel ? false : undefined;
    });
    g.selectCell(0, 0);
    fire(cell(g, '1'), 'dblclick');
    expect(g.isEditing()).toBe(true);
    g.closeEditor(false);
    cancel = true;
    fire(cell(g, '1'), 'dblclick');
    expect(g.isEditing()).toBe(false);
    expect(seen).toEqual([7, 7]);
  });

  it('works without rowKey, on array rows', () => {
    const g = make({ data: [[1, 2]], columns: undefined, rowKey: undefined });
    const seen: RowEvent[] = [];
    g.addHook('afterRowClick', (e) => seen.push(e));
    fire(cell(g, '1'), 'click');
    expect(seen[0].rowKey).toBeUndefined();
    expect(seen[0].rowData).toEqual([1, 2]);
  });
});

describe('column layout', () => {
  const layout = (g: CenituGrid) => g.getColumnLayout().columns;

  it('reports widths, order and visibility, keeping the width of hidden columns', () => {
    const g = make({ colWidths: [100, 120, 140] });
    g.hideColumns([1]);
    g.moveColumns(2, 1, 0);
    expect(layout(g)).toEqual([
      { id: 'c', width: 140, hidden: false },
      { id: 'a', width: 100, hidden: false },
      { id: 'b', width: 120, hidden: true },
    ]);
  });

  it('round-trips through JSON into a fresh grid', () => {
    const g = make();
    g.setColWidth(0, 222);
    g.moveColumns(0, 1, 3);
    g.hideColumns([0]);
    const saved: ColumnLayout = JSON.parse(JSON.stringify(g.getColumnLayout()));
    g.destroy();
    const fresh = make({ columnLayout: saved });
    expect(fresh.getColumnLayout()).toEqual(saved);
    expect(fresh.colToProp(2)).toBe('a');
    expect(fresh.getColWidth(2)).toBe(222);
    expect(fresh.getHiddenColumns()).toEqual([0]);
    expect(fresh.getData()[0]).toEqual([2, 3, 1]);
    expect(fresh.isUndoAvailable()).toBe(false);
  });

  it('writes edits to the right property after restoring order', () => {
    const data = rows();
    const g = make({ data, columnLayout: { columns: [{ id: 'c', width: 90, hidden: false }] } });
    g.setDataAtCell(0, 0, 9);
    expect(data[0].c).toBe(9);
  });

  it('survives removed and added columns', () => {
    const g = make();
    g.setColumnLayout({ columns: [{ id: 'gone', width: 50, hidden: false }, { id: 'b', width: 150, hidden: false }, { id: 'a', width: 60, hidden: false }] });
    expect(layout(g).map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(g.getColWidth(0)).toBe(150);
  });

  it('shows a column the saved layout has visible, and keeps its width', () => {
    const g = make({ hiddenColumns: [1] });
    g.setColumnLayout({ columns: [{ id: 'a', width: 100, hidden: false }, { id: 'b', width: 130, hidden: false }] });
    expect(g.getHiddenColumns()).toEqual([]);
    expect(g.getColWidth(1)).toBe(130);
    g.setColumnLayout({ columns: [{ id: 'b', width: 130, hidden: true }] });
    g.showColumns();
    expect(g.getColWidth(0)).toBe(130);
  });

  it('clears undo only when columns moved, and keeps formulas right', () => {
    const g = make({ data: [[1, 2, '=A1+B1*10']], columns: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], rowKey: undefined });
    g.setDataAtCell(0, 0, 5);
    g.setColumnLayout({ columns: [{ id: 'a', width: 90, hidden: false }] });
    expect(g.isUndoAvailable()).toBe(true);
    g.setColumnLayout({ columns: [{ id: 'c', width: 90, hidden: false }, { id: 'b', width: 90, hidden: false }] });
    expect(g.isUndoAvailable()).toBe(false);
    expect(g.getDataAtCell(0, 0)).toBe(25);
    expect(g.getSourceDataAtCell(0, 0)).toBe('=C1+B1*10');
  });

  it('leaves columns without an id out of the layout', () => {
    const g = make({ data: [[1, 2]], columns: [{ id: 'a' }], rowKey: undefined });
    expect(layout(g).map((c) => c.id)).toEqual(['a']);
  });

  it('announces changes from hiding, showing, moving, undo and column edits, not from restoring', () => {
    const g = make();
    let count = 0;
    g.addHook('afterColumnLayout', () => count++);
    g.setColumnLayout({ columns: [{ id: 'b', width: 90, hidden: false }] });
    expect(count).toBe(0);
    g.hideColumns([1]);
    g.showColumns();
    g.moveColumns(0, 1, 3);
    g.undo();
    g.alter('insert_col_start', 0);
    expect(count).toBe(5);
  });

  it('works with server mode, where the query keeps following ids', () => {
    const g = make({ dataMode: 'server', columns: columns.map((c) => ({ ...c, sortable: true })) });
    g.sort(0, 'asc');
    g.setColumnLayout({ columns: [{ id: 'c', width: 90, hidden: false }] });
    expect(g.getSortKeys()).toEqual([{ col: 1, order: 'asc' }]);
    g.setPageRows(rows());
    expect(layout(g).map((c) => c.id)).toEqual(['c', 'a', 'b']);
    expect(g.getDataAtCell(0, 0)).toBe(3);
  });
});

describe('React', () => {
  it('passes row and layout events, and takes a saved layout', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const keys: unknown[] = [];
    let saved: ColumnLayout | undefined;
    let g: CenituGrid | null = null;
    act(() =>
      root.render(
        <CenituTable
          ref={(r) => {
            g = r;
          }}
          data={rows()}
          columns={columns}
          rowKey="id"
          columnLayout={{ columns: [{ id: 'b', width: 90, hidden: false }] }}
          onRowClick={(e) => keys.push(e.rowKey)}
          onRowDoubleClick={() => false}
          onColumnLayoutChange={(l) => (saved = l)}
        />,
      ),
    );
    expect(g!.colToProp(0)).toBe('b');
    fire([...host.querySelectorAll('.ct-cell')].find((c) => c.textContent === '2')!, 'click');
    expect(keys).toEqual([7]);
    act(() => g!.hideColumns([1]));
    expect(saved!.columns.find((c) => c.id === 'a')!.hidden).toBe(true);
    act(() => root.unmount());
  });
});
