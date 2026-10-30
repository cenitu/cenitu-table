// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FormulaEngine, inverseMove, parseA1, registerFunction, type CellValue, type RawCell } from '../src/formula';

const a = (ref: string) => parseA1(ref)!;
const code = (v: CellValue) => (v instanceof Object ? v.code : v);

const state = (e: FormulaEngine) => ({
  sheets: e.getSheetNames().map((_, i) => e.getSheetSerialized(i)),
  values: e.getSheetNames().map((_, i) => e.getSheetValues(i).map((r) => r.map(code))),
  names: e.listNamedExpressions().map((n) => [n, e.getNamedExpressionFormula(n), code(e.getNamedExpressionValue(n) as CellValue)]),
});

describe('moveRows / moveColumns', () => {
  it('moves rows down; references follow the moved cells', () => {
    const e = FormulaEngine.buildFromArray([[1, '=A1*10'], [2, '=A2*10'], [3, '=A1+A3'], [4], [5]]);
    e.moveRows(0, 1, 3); // row 1 goes between rows 3 and 4
    expect(e.getSheetSerialized()).toEqual([
      [2, '=A1*10'],
      [3, '=A3+A2'],
      [1, '=A3*10'],
      [4, null],
      [5, null],
    ]);
    expect(e.getSheetValues()).toEqual([[2, 20], [3, 4], [1, 10], [4, null], [5, null]]);
  });

  it('moves rows up', () => {
    const e = FormulaEngine.buildFromArray([[1], [2], [3], [4, '=A4+A1']]);
    e.moveRows(2, 2, 0);
    expect(e.getSheetSerialized()).toEqual([[3, null], [4, '=A2+A3'], [1, null], [2, null]]);
    expect(e.getCellValue(a('B2'))).toBe(5);
  });

  it('a range keeps its first and last cells', () => {
    const data: RawCell[][] = [[1, '=SUM(A1:A5)', '=SUM(A2:A4)'], [2], [3], [4], [5]];
    const e = FormulaEngine.buildFromArray(data);
    // B1 keeps its ends (same value); C1's last cell (old row 4) moved up, so it covers less.
    const changes = e.moveRows(2, 1, 4);
    expect(e.getCellFormula(a('B1'))).toBe('=SUM(A1:A5)');
    expect(e.getCellFormula(a('C1'))).toBe('=SUM(A2:A3)');
    expect(e.getCellValue(a('C1'))).toBe(6);
    expect(changes.map((c) => [c.address.col, c.value])).toEqual([[2, 6]]);

    // The first cell (10) moves to the end, the last (30) moves up: the range spans between them.
    const f = FormulaEngine.buildFromArray([['=SUM(A2:A4)'], [10], [20], [30], [40]]);
    const moved = f.moveRows(1, 1, 5);
    expect(f.getSheetValues()).toEqual([[80], [20], [30], [40], [10]]);
    expect(f.getCellFormula(a('A1'))).toBe('=SUM(A3:A5)');
    expect(moved.map((c) => [c.address.row, c.value])).toEqual([[0, 80]]);
  });

  it('a reversed range keeps its orientation', () => {
    const e = FormulaEngine.buildFromArray([[1, '=SUM(A3:A1)'], [2], [3]]);
    e.moveRows(0, 1, 3);
    expect(e.getCellFormula(a('B3'))).toBe('=SUM(A3:A2)');
    e.moveRows(...Object.values(inverseMove(0, 1, 3)) as [number, number, number]);
    expect(e.getCellFormula(a('B1'))).toBe('=SUM(A3:A1)');
  });

  it('moves columns with absolute and mixed references', () => {
    const e = FormulaEngine.buildFromArray([[1, 2, 3, '=$A$1+B$1+SUM(A1:C1)']]);
    e.moveColumns(0, 1, 3);
    expect(e.getSheetSerialized()).toEqual([[2, 3, 1, '=$C$1+A$1+SUM(B1:C1)']]);
    expect(e.getCellValue(a('D1'))).toBe(7);
  });

  it('cross-sheet references and named expressions follow', () => {
    const e = FormulaEngine.buildFromSheets({ Data: [[1], [2], [3]], Report: [['=Data!A1', '=SUM(Data!A1:A2)', '=Top']] });
    e.addNamedExpression('Top', '=Data!$A$1*100');
    e.moveRows(0, 1, 3, 0);
    expect(e.getSheetSerialized(1)).toEqual([['=Data!A3', '=SUM(Data!A1:A3)', '=Top']]);
    expect(e.getNamedExpressionFormula('Top')).toBe('=Data!$A$3*100');
    expect(e.getSheetValues(1)).toEqual([[1, 6, 100]]);
  });

  it('only formulas whose meaning changed are recalculated', () => {
    let calls = 0;
    registerFunction('MOVECOUNTED', { minArgs: 1, maxArgs: 1, impl: ([x]) => (calls++, x) });
    const data: RawCell[][] = Array.from({ length: 50 }, (_, i) => [i, `=MOVECOUNTED(A${i + 1})`]);
    data[0].push('=MOVECOUNTED(SUM(A1:A50))');
    const e = FormulaEngine.buildFromArray(data);
    calls = 0;
    expect(e.moveRows(10, 5, 30)).toEqual([]);
    expect(calls).toBe(0); // single references moved with their cells, the range kept its ends
    expect(e.getCellFormula(a('B25'))).toBe('=MOVECOUNTED(A25)');
    expect(e.getCellValue(a('B25'))).toBe(29);
    e.moveRows(0, 1, 50); // the range's first cell moves: it now covers different cells
    expect(calls).toBe(1);
  });

  it('ROW() and COLUMN() update when their cell moves', () => {
    const e = FormulaEngine.buildFromArray([['=ROW()', '=COLUMN()'], [null], ['=ROW(A1)']]);
    const changes = e.moveRows(0, 1, 3);
    expect(e.getSheetValues()).toEqual([[null, null], [3, null], [3, 2]]);
    expect(changes.map((c) => `${c.address.row}:${c.address.col}=${c.value}`).sort()).toEqual(['1:0=3', '2:0=3']);
    e.moveColumns(0, 1, 2);
    expect(e.getCellFormula(a('A3'))).toBe('=COLUMN()');
    expect(e.getSheetValues()).toEqual([[null, null], [null, 3], [1, 3]]);
  });

  it('spills are laid out again at their new place', () => {
    const e = FormulaEngine.buildFromArray([['=SEQUENCE(3)', '=SUM(A1:A3)'], [], [], ['x']]);
    e.moveRows(0, 1, 6);
    expect(e.getSheetValues().map((r) => r.map(code))).toEqual([
      [null, null],
      [null, null],
      ['x', null],
      [null, null],
      [null, null],
      [1, 1],
      [2, null],
      [3, null],
    ]);
    expect(e.getSpillRange(a('A6'))).toEqual({ start: a('A6'), end: a('A8') });
    // The range's first cell (the anchor) went down, its last cell up one: it spans between them.
    expect(e.getCellFormula(a('B6'))).toBe('=SUM(A2:A6)');
  });

  it('no-ops and invalid arguments', () => {
    const e = FormulaEngine.buildFromArray([[1], ['=A1']]);
    expect(e.moveRows(0, 1, 0)).toEqual([]);
    expect(e.moveRows(0, 1, 1)).toEqual([]);
    expect(e.moveRows(0, 2, 1)).toEqual([]);
    expect(e.moveRows(0, 0, 5)).toEqual([]);
    expect(e.getCellFormula(a('A2'))).toBe('=A1');
    expect(() => e.moveRows(-1, 1, 3)).toThrow(RangeError);
    expect(() => e.moveColumns(0, 1.5, 3)).toThrow(RangeError);
    expect(() => e.moveRows(0, 1, 3, 7)).toThrow();
  });

  it('inverseMove gives the parameters that undo a move', () => {
    expect(inverseMove(2, 3, 10)).toEqual({ start: 7, count: 3, target: 2 });
    expect(inverseMove(7, 3, 2)).toEqual({ start: 2, count: 3, target: 10 });
    expect(new FormulaEngine().inverseMove(0, 1, 1)).toEqual({ start: 0, count: 1, target: 1 });
  });
});

describe('a move followed by its inverse restores the workbook', () => {
  function workbook() {
    const e = FormulaEngine.buildFromSheets({
      Data: [
        [1, 10, '=A1+B1', '=SUM($A$1:$A$6)', '=SEQUENCE(2,1,A1)'],
        [2, 20, '=A2+B2', '=SUM(A1:B3)'],
        [3, 30, '=A3*B3', '=SUM(A6:A1)'],
        [4, 40, '=C1+C2+C3', '=AVERAGE(B2:B5)'],
        [5, 50, '=A$5+$B5', '=MAX(A1:D4)'],
        [6, 60, '=SEQUENCE(1,1,A6)', '=ROW()+COLUMN(B2)'],
      ],
      Report: [['=SUM(Data!A1:A6)', '=Data!C4', '=Data!B2+Total', '=COUNTIF(Data!A2:A5,">2")']],
    });
    e.addNamedExpression('Total', '=SUM(Data!$B$2:$B$4)');
    e.addNamedExpression('First', '=Data!$A$1');
    return e;
  }

  const rowMoves: [number, number, number][] = [[0, 1, 3], [0, 2, 6], [1, 3, 0], [5, 1, 0], [2, 2, 5], [3, 1, 10], [4, 2, 1]];
  it.each(rowMoves)('rows: start %i, count %i, target %i', (start, count, target) => {
    const e = workbook();
    const before = state(e);
    e.moveRows(start, count, target, 0);
    expect(state(e)).not.toEqual(before);
    const inv = e.inverseMove(start, count, target);
    e.moveRows(inv.start, inv.count, inv.target, 0);
    expect(state(e)).toEqual(before);
  });

  const colMoves: [number, number, number][] = [[0, 1, 2], [0, 2, 4], [3, 1, 0], [1, 2, 0], [2, 1, 6]];
  it.each(colMoves)('columns: start %i, count %i, target %i', (start, count, target) => {
    const e = workbook();
    const before = state(e);
    e.moveColumns(start, count, target, 0);
    expect(state(e)).not.toEqual(before);
    const inv = e.inverseMove(start, count, target);
    e.moveColumns(inv.start, inv.count, inv.target, 0);
    expect(state(e)).toEqual(before);
  });

  it('a moved workbook equals a freshly built one with the moved content', () => {
    const e = workbook();
    e.moveRows(0, 2, 4, 0);
    const fresh = FormulaEngine.buildFromSheets({
      Data: e.getSheetSerialized(0),
      Report: e.getSheetSerialized(1),
    });
    fresh.addNamedExpression('Total', e.getNamedExpressionFormula('Total'));
    fresh.addNamedExpression('First', e.getNamedExpressionFormula('First'));
    expect(state(e)).toEqual(state(fresh));
  });
});
