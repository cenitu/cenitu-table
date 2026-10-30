import { describe, expect, it } from 'vitest';
import { FormulaEngine } from '../src/formula';

function workbook() {
  const e = FormulaEngine.buildFromSheets({
    Data: [[1, 10], [2, 20], [3, 30], [4, 40], ['=A2*2', '=SUM(B1:B4)']],
    Report: [['=SUM(Data!A1:A4)', '=Data!B3', '=Data!A4+Total']],
  });
  e.addNamedExpression('Total', '=SUM(Data!$B$2:$B$3)');
  return e;
}

const state = (e: FormulaEngine) => ({
  sheets: e.getSheetNames().map((_, i) => e.getSheetSerialized(i)),
  values: e.getSheetNames().map((_, i) => e.getSheetValues(i)),
  names: e.listNamedExpressions().map((n) => [n, e.getNamedExpressionFormula(n)]),
});

describe('captureRemoval / restoreRemoval', () => {
  it.each([
    ['row', 1, 2],
    ['row', 3, 1],
    ['row', 0, 5],
    ['col', 0, 1],
    ['col', 1, 1],
  ] as const)('restores the whole workbook after removing %s %i x%i', (axis, index, count) => {
    const e = workbook();
    const before = state(e);
    const record = e.captureRemoval(axis, index, count, 0);
    if (axis === 'row') e.removeRows(index, count, 0);
    else e.removeColumns(index, count, 0);
    expect(state(e)).not.toEqual(before);
    e.restoreRemoval(record);
    expect(state(e)).toEqual(before);
  });

  it('only captures what the removal touches', () => {
    const e = workbook();
    const r = e.captureRemoval('row', 3, 1, 0); // row 4: A4/B4
    const addresses = r.cells.map((c) => `${c.address.sheet}:${c.address.row}:${c.address.col}`).sort();
    // removed cells A4, B4; Data!B5 (SUM(B1:B4) shrinks); Report!A1 (range shrinks), Report!C1 (A4 -> #REF!)
    expect(addresses).toEqual(['0:3:0', '0:3:1', '0:4:1', '1:0:0', '1:0:2']);
    expect(r.names).toEqual([]);
  });
});

describe('range cache during recalculation', () => {
  it('ranges shared by many formulas see values computed earlier in the same pass', () => {
    // C column depends on B, which depends on A; SUMIFs over B must see the new B values.
    const rows = Array.from({ length: 50 }, (_, i) => [i % 2 ? 'x' : 'y', `=C${i + 1}*2`, i]);
    const e = FormulaEngine.buildFromArray([...rows, ['=SUMIF(A1:A50,"x",B1:B50)', '=SUMIF(A1:A50,"y",B1:B50)', '=A51+B51']]);
    const total = () => e.getCellValue({ row: 50, col: 2 });
    expect(total()).toBe(2 * (49 * 50) / 2);
    e.setCellContents({ row: 0, col: 2 }, 1000);
    expect(total()).toBe(2 * ((49 * 50) / 2 + 1000));
    e.batch(() => {
      for (let i = 0; i < 50; i++) e.setCellContents({ row: i, col: 2 }, 1);
    });
    expect(e.getCellValue({ row: 50, col: 0 })).toBe(50);
    expect(total()).toBe(100);
  });
});
