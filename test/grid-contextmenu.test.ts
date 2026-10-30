import { afterEach, describe, expect, it } from 'vitest';
import { CenituGrid, trTR, type GridOptions } from '../src';

let grid: CenituGrid;
afterEach(() => {
  grid?.destroy();
  document.querySelectorAll('.ct-menu').forEach((m) => m.remove());
});

function make(data: unknown[][], opts: GridOptions = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  grid = new CenituGrid(host, { data: data as GridOptions['data'], contextMenu: true, ...opts });
  return grid;
}

const menu = () => document.querySelector<HTMLElement>('.ct-context');
const item = (key: string) => menu()!.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)!;
const rightClick = (el: Element) =>
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));

describe('context menu', () => {
  it('is off by default and opens with Shift+F10 when enabled', () => {
    const g = make([[1]], { contextMenu: false });
    g.selectCell(0, 0);
    g.openContextMenu();
    expect(menu()).toBeNull();
    g.updateSettings({ contextMenu: true });
    g.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
    expect(menu()).toBeTruthy();
    expect(document.activeElement).toBe(item('cut'));
  });

  it('right-clicking a row header selects the row and offers row actions', () => {
    const g = make([[1, 2], [3, 4], [5, 6]], { language: trTR });
    rightClick(g.root.querySelectorAll('.ct-rowhead')[1]);
    expect(g.getSelected()).toEqual([[1, 0, 1, 1]]);
    expect(item('remove_row').textContent).toContain('Satırı sil');
    item('remove_row').click();
    expect(menu()).toBeNull();
    expect(g.getData()).toEqual([[1, 2], [5, 6]]);
    g.selectCell(0, 0);
    g.openContextMenu();
    expect(item('undo').disabled).toBe(false);
    item('undo').click();
    expect(g.countRows()).toBe(3);
  });

  it('inserts as many rows/columns as are selected and merges', () => {
    const g = make([[1, 2, 3], [4, 5, 6]]);
    g.selectCell(0, 0, 1, 1);
    g.openContextMenu();
    item('col_right').click();
    expect(g.countCols()).toBe(5);
    expect(g.getData()[0]).toEqual([1, 2, null, null, 3]);
    g.selectCell(0, 0, 1, 1);
    g.openContextMenu();
    item('merge').click();
    expect(g.getMergedCells()).toEqual([{ row: 0, col: 0, rowspan: 2, colspan: 2 }]);
    g.openContextMenu();
    expect(item('unmerge')).toBeTruthy();
    item('unmerge').click();
    expect(g.getMergedCells()).toEqual([]);
  });

  it('read-only grids disable editing entries; custom entries can be added', () => {
    let ran = false;
    const g = make([[1]], {
      readOnly: true,
      contextMenu: (entries) => [...entries.filter((e) => e === '---' || e.key !== 'undo'), '---', { key: 'mine', name: 'Mine', run: () => (ran = true) }],
    });
    g.selectCell(0, 0);
    g.openContextMenu();
    expect(item('cut').disabled).toBe(true);
    expect(item('copy').disabled).toBe(false);
    expect(menu()!.querySelector('[data-key="undo"]')).toBeNull();
    item('mine').click();
    expect(ran).toBe(true);
  });

  it('closes with Escape and on outside click', () => {
    const g = make([[1]]);
    g.selectCell(0, 0);
    g.openContextMenu();
    menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu()).toBeNull();
    g.openContextMenu();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(menu()).toBeNull();
  });
});
