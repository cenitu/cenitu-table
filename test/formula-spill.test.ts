// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FormulaEngine, parseA1, type CellAddress, type CellValue, type RawCell } from '../src/formula';

const a = (ref: string, sheet?: number): CellAddress => (sheet === undefined ? parseA1(ref)! : { ...parseA1(ref)!, sheet });
const code = (v: CellValue) => (v instanceof Object ? v.code : v);

function engine(data: RawCell[][]) {
  const e = FormulaEngine.buildFromArray(data);
  const v = (ref: string, sheet?: number) => code(e.getCellValue(a(ref, sheet)));
  /** Values of a column block, top to bottom. */
  const col = (ref: string, n: number) => Array.from({ length: n }, (_, i) => {
    const p = a(ref);
    return code(e.getCellValue({ row: p.row + i, col: p.col }));
  });
  return { e, v, col };
}

describe('spilling array results', () => {
  it('SEQUENCE spills; spilled cells have values but no content', () => {
    const { e, v } = engine([['=SEQUENCE(3, 2)']]);
    expect([v('A1'), v('B1'), v('A2'), v('B2'), v('A3'), v('B3')]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(e.getCellFormula(a('A1'))).toBe('=SEQUENCE(3, 2)');
    expect(e.getCellSerialized(a('B2'))).toBeNull();
    expect(e.getCellType(a('B2'))).toBe('EMPTY');
    expect(e.getSpillRange(a('A1'))).toEqual({ start: { row: 0, col: 0 }, end: { row: 2, col: 1 } });
    expect(e.getSpillRange(a('B3'))).toEqual(e.getSpillRange(a('A1')));
    expect(e.getSpillRange(a('C1'))).toBeUndefined();
    expect(e.getSheetDimensions()).toEqual({ width: 2, height: 3 });
    expect(e.getSheetValues()).toEqual([[1, 2], [3, 4], [5, 6]]);
    expect(e.getSheetSerialized()).toEqual([['=SEQUENCE(3, 2)', null], [null, null], [null, null]]);
  });

  it('a plain range and element-wise arithmetic spill; blanks show 0', () => {
    const { col, v } = engine([
      [1, 10, '=A1:A3*2', '=A1:A3*B1:B3', '=A1:B3', null, '=A1:A3>1'],
      [2, null],
      [3, 30],
    ]);
    expect(col('C1', 3)).toEqual([2, 4, 6]);
    expect(col('D1', 3)).toEqual([10, 0, 90]);
    expect([v('E1'), v('F1'), v('E2'), v('F2'), v('F3')]).toEqual([1, 10, 2, 0, 30]);
    expect(col('G1', 3)).toEqual([false, true, true]);
  });

  it('broadcasts a row against a column', () => {
    const { e, v } = engine([['=SEQUENCE(3)*SEQUENCE(1, 3)']]);
    expect(e.getSpillRange(a('A1'))).toEqual({ start: { row: 0, col: 0 }, end: { row: 2, col: 2 } });
    expect([v('C1'), v('A3'), v('C3')]).toEqual([3, 3, 9]);
  });

  it('mismatched sizes fill the missing positions with #N/A', () => {
    const { col } = engine([[1, 1, '=A1:A3+B1:B2'], [2, 2], [3]]);
    expect(col('C1', 3)).toEqual([2, 4, '#N/A']);
  });

  it('dynamic array functions spill', () => {
    const { v, col, e } = engine([
      ['East', 'apple', 3],
      ['West', 'banana', 5],
      ['East', 'cherry', 10],
      ['North', 'Apricot', null],
      ['West', 'apple', 7],
      [],
      ['=FILTER(B1:C5, A1:A5="East")', null, '=SORT(C1:C5, 1, -1)', '=UNIQUE(A1:A5)', '=TRANSPOSE(A1:A3)'],
      [],
      [],
      [],
      [],
      ['=SORTBY(B1:B5, C1:C5)', '=XLOOKUP("cherry", B1:B5, A1:C5)'],
    ]);
    expect([v('A7'), v('B7'), v('A8'), v('B8'), v('A9')]).toEqual(['apple', 3, 'cherry', 10, null]);
    expect(col('C7', 5)).toEqual([10, 7, 5, 3, 0]);
    expect(col('D7', 4)).toEqual(['East', 'West', 'North', null]);
    expect([v('E7'), v('F7'), v('G7')]).toEqual(['East', 'West', 'East']);
    expect(col('A12', 5)).toEqual(['Apricot', 'apple', 'banana', 'apple', 'cherry']);
    expect([v('B12'), v('C12'), v('D12')]).toEqual(['East', 'cherry', 10]);
    expect(e.getSpillRange(a('E7'))).toEqual({ start: a('E7'), end: a('G7') });
  });

  it('ROW/COLUMN over a block and IF with an array condition spill', () => {
    const { col, v } = engine([[5, '=ROW(A1:A2)', '=COLUMN(A2:C2)'], [-1], [3, '=IF(A1:A3>0, "pos", "neg")']]);
    expect(col('B1', 2)).toEqual([1, 2]);
    expect([v('C1'), v('D1'), v('E1')]).toEqual([1, 2, 3]);
    expect(col('B3', 3)).toEqual(['pos', 'neg', 'pos']);
  });
});

describe('#SPILL! blocking', () => {
  it('a non-empty cell in the area blocks the spill until it is cleared', () => {
    const { e, v } = engine([['=SEQUENCE(3)'], [], ['x']]);
    expect(v('A1')).toBe('#SPILL!');
    expect(v('A2')).toBeNull();
    expect(e.getSpillRange(a('A1'))).toBeUndefined();
    const changes = e.setCellContents(a('A3'), null);
    expect([v('A1'), v('A2'), v('A3')]).toEqual([1, 2, 3]);
    expect(changes.map((c) => [c.address.row, code(c.value)])).toEqual(expect.arrayContaining([[0, 1], [1, 2], [2, 3]]));
  });

  it('typing into a spilled cell blocks it; clearing it spills again', () => {
    const { e, v } = engine([['=SEQUENCE(3)']]);
    e.setCellContents(a('A2'), 5);
    expect([v('A1'), v('A2'), v('A3')]).toEqual(['#SPILL!', 5, null]);
    e.setCellContents(a('A2'), null);
    expect([v('A1'), v('A2'), v('A3')]).toEqual([1, 2, 3]);
  });

  it('clearing a spilled cell changes nothing', () => {
    const { e, v } = engine([['=SEQUENCE(3)']]);
    expect(e.setCellContents(a('A2'), null)).toEqual([]);
    expect(v('A2')).toBe(2);
  });

  it('another spill blocks; when it shrinks the blocked one spills', () => {
    const { e, v } = engine([[null, null], ['=SEQUENCE(1, 3)']]);
    e.setCellContents(a('B1'), '=SEQUENCE(2)');
    expect(v('B1')).toBe('#SPILL!');
    expect(v('B2')).toBe(2); // still A2's spill
    e.setCellContents(a('A2'), '=SEQUENCE(1, 1)');
    expect([v('A2'), v('B1'), v('B2'), v('C2')]).toEqual([1, 1, 2, null]);
    expect(e.getSpillRange(a('B2'))).toEqual({ start: a('B1'), end: a('B2') });
  });

  it('a spill that would leave the sheet is #SPILL!', () => {
    const e = FormulaEngine.buildEmpty();
    e.setCellContents({ row: 1048575, col: 0 }, '=SEQUENCE(2)');
    expect(code(e.getCellValue({ row: 1048575, col: 0 }))).toBe('#SPILL!');
  });

  it('overwriting the anchor clears its spill', () => {
    const { e, v } = engine([['=SEQUENCE(3)']]);
    const changes = e.setCellContents(a('A1'), 7);
    expect([v('A1'), v('A2'), v('A3')]).toEqual([7, null, null]);
    expect(changes.map((c) => [c.address.row, c.value])).toEqual(expect.arrayContaining([[1, null], [2, null]]));
    expect(e.getSheetDimensions()).toEqual({ width: 1, height: 1 });
  });
});

describe('spill size changes and dependents', () => {
  it('resizes and recalculates readers of the spill area', () => {
    const { e, v, col } = engine([['=SEQUENCE(D1)', '=SUM(A1:A10)', '=A2*100', 3]]);
    expect([v('B1'), v('C1')]).toEqual([6, 200]);
    const changes = e.setCellContents(a('D1'), 5);
    expect(col('A1', 6)).toEqual([1, 2, 3, 4, 5, null]);
    expect(v('B1')).toBe(15);
    const changed = changes.map((c) => `${c.address.row}:${c.address.col}`);
    expect(changed).toEqual(expect.arrayContaining(['3:0', '4:0', '0:1']));
    e.setCellContents(a('D1'), 2);
    expect(col('A1', 4)).toEqual([1, 2, null, null]);
    expect(v('B1')).toBe(3);
    e.setCellContents(a('D1'), 1);
    expect([v('A1'), v('A2'), v('B1'), v('C1')]).toEqual([1, null, 1, 0]);
    expect(e.getSpillRange(a('A1'))).toBeUndefined();
  });

  it('formulas reading cells that a spill covers for the first time get its values', () => {
    const { v } = engine([['=SEQUENCE(3)', '=A3*10', '=SUM(A2:A3)', '=C1+B1']]);
    expect([v('B1'), v('C1'), v('D1')]).toEqual([30, 5, 35]);
  });

  it('a spill feeding another spill', () => {
    const { e, col } = engine([['=SEQUENCE(3)', '=A1:A3*10', '=SUM(B1:B3)']]);
    expect(col('B1', 3)).toEqual([10, 20, 30]);
    e.setCellContents(a('A1'), '=SEQUENCE(4, 1, 2)');
    expect(col('B1', 3)).toEqual([20, 30, 40]);
    expect(e.getCellValue(a('C1'))).toBe(90);
  });

  it('valuesUpdated carries the spilled cells', () => {
    const { e } = engine([[2]]);
    const events: string[][] = [];
    e.on('valuesUpdated', (c) => events.push(c.map((x) => `${x.address.row}:${x.address.col}=${code(x.value)}`)));
    e.setCellContents(a('B1'), '=SEQUENCE(A1)');
    expect(events).toEqual([['0:1=1', '1:1=2']]);
  });

  it('spills from named ranges and other sheets', () => {
    const e = FormulaEngine.buildFromSheets({ S1: [[1], [2], [3]], S2: [['=S1!A1:A3+1', '=SUM(A1:A3)']] });
    e.addNamedExpression('Data', '=S1!$A$1:$A$3');
    e.setCellContents(a('C1'), '=Data');
    expect([e.getCellValue(a('A3', 1)), e.getCellValue(a('B1', 1))]).toEqual([4, 9]);
    expect(e.getCellValue(a('C3'))).toBe(3);
    e.setCellContents(a('A3'), 10);
    expect([e.getCellValue(a('A3', 1)), e.getCellValue(a('B1', 1)), e.getCellValue(a('C3'))]).toEqual([11, 16, 10]);
  });

  it('a non-spilling consumer of a multi-cell range still gets #VALUE!', () => {
    const { v } = engine([[1, '=MID(A1:A2, 1, 1)', '=VLOOKUP(A1:A2, A1:A2, 1, FALSE)'], [2]]);
    expect([v('B1'), v('C1')]).toEqual(['#VALUE!', '#VALUE!']);
  });
});

describe('cycles through spills', () => {
  it('a formula reading its own spill area is a cycle', () => {
    const { e, v } = engine([['=SEQUENCE(3)+A3*0']]);
    expect([v('A1'), v('A2'), v('A3')]).toEqual(['#CYCLE!', null, null]);
    expect(e.getSpillRange(a('A1'))).toBeUndefined();
  });

  it('a cycle through another cell recovers when broken', () => {
    const { e, v } = engine([['=SEQUENCE(B1)', '=A2+2']]);
    expect([v('A1'), v('B1'), v('A2')]).toEqual(['#CYCLE!', '#CYCLE!', null]);
    e.setCellContents(a('B1'), 3);
    expect([v('A1'), v('A2'), v('A3')]).toEqual([1, 2, 3]);
  });

  it('a range over the spill and the anchor depending on it is a cycle', () => {
    const { v } = engine([['=SEQUENCE(3, 1, C1)', null, '=SUM(A1:A3)']]);
    expect([v('A1'), v('C1')]).toEqual(['#CYCLE!', '#CYCLE!']);
  });
});

describe('spills and structural changes', () => {
  const values = (e: FormulaEngine) => e.getSheetValues().map((r) => r.map(code));

  it('rows inserted above move the whole spill', () => {
    const { e, v } = engine([[null, '=SUM(A2:A4)'], ['=SEQUENCE(3)']]);
    e.addRows(0, 2);
    expect([v('A4'), v('A5'), v('A6'), v('B3')]).toEqual([1, 2, 3, 6]);
    expect(e.getSpillRange(a('A4'))).toEqual({ start: a('A4'), end: a('A6') });
    expect(e.getCellFormula(a('B3'))).toBe('=SUM(A4:A6)');
  });

  it('inserting or removing rows inside a spill lays it out again', () => {
    const { e } = engine([['=SEQUENCE(3)', '=SUM(A1:A3)']]);
    e.addRows(1, 1);
    expect(values(e)).toEqual([[1, 6], [2, null], [3, null]]);
    expect(e.getCellFormula(a('B1'))).toBe('=SUM(A1:A4)');
    e.removeRows(1, 2);
    expect(values(e)).toEqual([[1, 3], [2, null], [3, null]]);
    expect(e.getCellFormula(a('B1'))).toBe('=SUM(A1:A2)');
    expect(e.getCellValue(a('B1'))).toBe(3);
  });

  it('removing the anchor row removes the spill', () => {
    const { e } = engine([['x'], ['=SEQUENCE(2, 2)'], [], ['=SUM(A2:B3)']]);
    e.removeRows(1, 1);
    expect(values(e)).toEqual([['x'], [null], [0]]);
    expect(e.getCellFormula(a('A3'))).toBe('=SUM(A2:B2)');
    expect(e.getSpillRange(a('A2'))).toBeUndefined();
  });

  it('structural changes can block and unblock a spill', () => {
    const { e, v } = engine([['=SEQUENCE(3)'], [], [], [], [], ['x']]);
    e.removeRows(2, 3); // x moves to A3
    expect([v('A1'), v('A3')]).toEqual(['#SPILL!', 'x']);
    e.addRows(1, 1); // x moves to A4
    expect([v('A1'), v('A2'), v('A3'), v('A4')]).toEqual([1, 2, 3, 'x']);
  });

  it('columns behave like rows', () => {
    const { e } = engine([['=SEQUENCE(1, 3)', null, null, '=SUM(A1:C1)']]);
    e.addColumns(1, 1);
    expect(values(e)).toEqual([[1, 2, 3, null, 6]]);
    e.removeColumns(0, 1);
    expect(values(e)).toEqual([[null, null, null, 0]]);
    expect(e.getCellFormula(a('D1'))).toBe('=SUM(A1:C1)');
  });

  it('removing a sheet turns references into its spill into #REF!', () => {
    const e = FormulaEngine.buildFromSheets({ S1: [['=S2!A2']], S2: [['=SEQUENCE(2)']] });
    expect(e.getCellValue(a('A1'))).toBe(2);
    e.removeSheet(1);
    expect(code(e.getCellValue(a('A1')))).toBe('#REF!');
  });

  it('a spill on another sheet survives changes there', () => {
    const e = FormulaEngine.buildFromSheets({ S1: [[1], [2]], S2: [['=S1!A1:A2*2']] });
    e.addRows(0, 1, 0);
    expect(e.getCellFormula(a('A1', 1))).toBe("='S1'!A2:A3*2");
    expect([e.getCellValue(a('A1', 1)), e.getCellValue(a('A2', 1))]).toEqual([2, 4]);
  });
});
