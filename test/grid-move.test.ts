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

describe('moving columns', () => {
  it('moves data, formulas, widths, meta and selection; undo and redo restore', () => {
    const g = make([['a', 'b', 'c', '=A1&B1&C1']], {
      colHeaders: ['A', 'B', 'C', 'D'],
      columns: [{ className: 'col-a' }],
      colWidths: [50, 60, 70, 80],
    });
    g.setCellStyle({ start: { row: 0, col: 0 }, end: { row: 0, col: 0 } }, { bold: true });
    g.selectCell(0, 0, 0, 0);
    g.moveColumns(0, 1, 3); // A goes before D
    expect(g.getData()[0].slice(0, 3)).toEqual(['b', 'c', 'a']);
    expect(g.getDataAtCell(0, 3)).toBe('abc'); // formula follows its cells
    expect(g.getSourceDataAtCell(0, 3)).toBe('=C1&A1&B1');
    expect(g.getColWidth(2)).toBe(50);
    expect(g.getCellMeta(0, 2).className).toBe('col-a');
    expect(g.getCellStyle(0, 2).bold).toBe(true);
    expect(g.getSelected()).toEqual([[0, 2, 0, 2]]);
    g.undo();
    expect(g.getData()[0].slice(0, 3)).toEqual(['a', 'b', 'c']);
    expect(g.getSourceDataAtCell(0, 3)).toBe('=A1&B1&C1');
    expect(g.getColWidth(0)).toBe(50);
    g.redo();
    expect(g.getData()[0].slice(0, 3)).toEqual(['b', 'c', 'a']);
  });

  it('moves a block to the left and keeps object bindings in sync', () => {
    const data = [{ a: 1, b: 2, c: 3 }];
    const g = make(data as never);
    g.moveColumns(1, 2, 0);
    expect(g.getData()[0]).toEqual([2, 3, 1]);
    expect(g.colToProp(0)).toBe('b');
    g.setDataAtCell(0, 0, 20);
    expect(data[0].b).toBe(20);
  });

  it('ignores moves onto themselves', () => {
    const g = make([[1, 2, 3]]);
    g.moveColumns(0, 2, 1);
    g.moveColumns(0, 2, 2);
    expect(g.getData()[0]).toEqual([1, 2, 3]);
    expect(g.isUndoAvailable()).toBe(false);
  });
});

describe('moving columns and merged cells', () => {
  it('refuses a move that would split a merge, allows one that carries it whole', () => {
    const g = make([[1, 2, 3, 4]], { mergeCells: [{ row: 0, col: 1, rowspan: 1, colspan: 2 }] });
    expect(g.moveColumns(1, 1, 4)).toBe(false); // only half of the merge
    expect(g.moveColumns(0, 1, 2)).toBe(false); // lands inside the merge
    expect(g.getMergedCells()).toEqual([{ row: 0, col: 1, rowspan: 1, colspan: 2 }]);
    expect(g.isUndoAvailable()).toBe(false);
    expect(g.moveColumns(1, 2, 4)).toBe(true);
    expect(g.getMergedCells()).toEqual([{ row: 0, col: 2, rowspan: 1, colspan: 2 }]);
  });
});
