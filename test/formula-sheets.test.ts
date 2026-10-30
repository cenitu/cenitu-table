// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FormulaEngine, parseA1, type CellAddress, type CellValue } from '../src/formula';

const at = (ref: string, sheet = 0): CellAddress => ({ ...parseA1(ref)!, sheet });
const code = (v: CellValue | CellValue[][] | undefined) => (v instanceof Object && 'code' in v ? v.code : v);

function workbook() {
  return FormulaEngine.buildFromSheets({
    Sheet1: [
      [1, '=Sheet2!A1*2', "=SUM('My Sheet'!A1:A3)", '=sheet2!a1+A1'],
      ['=Nope!A1', "='It''s'!B1", null],
    ],
    Sheet2: [[10, 20]],
    'My Sheet': [[1], [2], [3]],
    "It's": [[null, 'quoted']],
  });
}

describe('multiple sheets', () => {
  it('builds sheets and resolves sheet references (quoted, escaped, case-insensitive)', () => {
    const e = workbook();
    expect(e.getSheetNames()).toEqual(['Sheet1', 'Sheet2', 'My Sheet', "It's"]);
    expect(e.countSheets()).toBe(4);
    expect(e.getSheetId('my sheet')).toBe(2);
    expect(e.getSheetName(1)).toBe('Sheet2');
    expect(e.doesSheetExist('SHEET2')).toBe(true);
    expect(e.doesSheetExist('Sheet9')).toBe(false);
    expect(e.getCellValue(at('B1'))).toBe(20);
    expect(e.getCellValue(at('C1'))).toBe(6);
    expect(e.getCellValue(at('D1'))).toBe(11);
    expect(e.getCellValue(at('B2'))).toBe('quoted');
    expect(code(e.getCellValue(at('A2')))).toBe('#REF!');
    expect(e.getCellValue(at('A1', 1))).toBe(10);
    expect(e.getSheetValues(2)).toEqual([[1], [2], [3]]);
    expect(e.getSheetDimensions(1)).toEqual({ width: 2, height: 1 });
    expect(e.calculateFormula('=A1+B1', 1)).toBe(30);
    expect(e.calculateFormula("=SUM('My Sheet'!A1:A2)")).toBe(3);
  });

  it('recalculates across sheets and reports the sheet in changes', () => {
    const e = workbook();
    const changes = e.setCellContents(at('A1', 1), 5);
    expect(changes).toContainEqual({ address: { row: 0, col: 0, sheet: 1 }, value: 5 });
    expect(changes).toContainEqual({ address: { row: 0, col: 1, sheet: 0 }, value: 10 });
    expect(e.getCellDependents(at('A1', 1))).toEqual([parseA1('B1'), parseA1('D1')]);
    expect(e.getCellPrecedents(at('C1'))).toEqual([{ start: at('A1', 2), end: at('A3', 2) }]);
  });

  it('resolves a formula once the sheet it names is added', () => {
    const e = workbook();
    const id = e.addSheet('Nope');
    expect(id).toBe(4);
    expect(e.getCellValue(at('A2'))).toBe(0);
    e.setCellContents(at('A1', id), 7);
    expect(e.getCellValue(at('A2'))).toBe(7);
    expect(e.getCellFormula(at('A2'))).toBe('=Nope!A1');
  });

  it('addSheet picks free default names and rejects duplicates', () => {
    const e = FormulaEngine.buildFromArray([[1]], 'Data');
    expect(e.getSheetNames()).toEqual(['Data']);
    expect(e.addSheet()).toBe(1);
    expect(e.getSheetName(1)).toBe('Sheet2');
    expect(() => e.addSheet('data')).toThrow();
    expect(() => e.setCellContents(at('A1', 7), 1)).toThrow();
  });

  it('renaming a sheet rewrites formula text everywhere', () => {
    const e = workbook();
    e.renameSheet(1, 'Prices 2024');
    expect(e.getCellFormula(at('B1'))).toBe("='Prices 2024'!A1*2");
    expect(e.getCellFormula(at('D1'))).toBe("='Prices 2024'!A1+A1");
    expect(e.getCellFormula(at('C1'))).toBe("=SUM('My Sheet'!A1:A3)"); // untouched text
    expect(e.getSheetId('prices 2024')).toBe(1);
    expect(e.getSheetId('Sheet2')).toBeUndefined();
    expect(e.calculateFormula("='Prices 2024'!B1")).toBe(20);
    e.renameSheet(2, 'Satış');
    expect(e.getCellFormula(at('C1'))).toBe('=SUM(Satış!A1:A3)');
    expect(() => e.renameSheet(2, 'sheet1')).toThrow();
  });

  it('removing a sheet turns references into #REF! and recalculates dependents', () => {
    const e = workbook();
    e.setCellContents(at('C2'), '=B1+1');
    const changes = e.removeSheet(1);
    expect(code(e.getCellValue(at('B1')))).toBe('#REF!');
    expect(code(e.getCellValue(at('C2')))).toBe('#REF!');
    expect(e.getCellFormula(at('B1'))).toBe('=#REF!*2');
    expect(e.getCellValue(at('C1'))).toBe(6);
    expect(changes.map((c) => c.address)).toContainEqual({ row: 1, col: 2, sheet: 0 });
    expect(e.getSheetNames()).toEqual(['Sheet1', 'My Sheet', "It's"]);
    expect(e.getCellValue(at('A1', 1))).toBeNull();
    // A new sheet with the old name does not revive the references (ids are never reused).
    expect(e.addSheet('Sheet2')).toBe(4);
    expect(code(e.getCellValue(at('B1')))).toBe('#REF!');
  });

  it('row/column changes on one sheet only shift references into that sheet', () => {
    const e = FormulaEngine.buildFromSheets({
      A: [[1, '=B!A2', '=A1'], [2]],
      B: [[100], [200], ['=A!A2+A1']],
    });
    e.addRows(0, 1, 1);
    expect(e.getCellFormula(at('B1'))).toBe('=B!A3');
    expect(e.getCellFormula(at('C1'))).toBe('=A1');
    expect(e.getCellFormula(at('A4', 1))).toBe('=A!A2+A2');
    expect(e.getCellValue(at('B1'))).toBe(200);
    e.removeColumns(0, 1, 1);
    expect(e.getCellFormula(at('B1'))).toBe('=#REF!');
    expect(code(e.getCellValue(at('B1')))).toBe('#REF!');
    e.addRows(0, 2, 0);
    expect(e.getCellFormula(at('C3'))).toBe('=A3');
    expect(e.getCellValue(at('C3'))).toBe(1);
  });

  it('setSheetContent replaces only the given sheet', () => {
    const e = workbook();
    e.setSheetContent([[50]], 1);
    expect(e.getSheetValues(1)).toEqual([[50]]);
    expect(e.getCellValue(at('B1'))).toBe(100);
    expect(e.getSheetValues(2)).toEqual([[1], [2], [3]]);
  });

  it('shiftFormula keeps sheet prefixes, including unknown sheets', () => {
    const e = workbook();
    expect(e.shiftFormula("=Sheet2!A1+'My Sheet'!$B2+'New One'!C3", 1, 1)).toBe(
      "=Sheet2!B2+'My Sheet'!$B3+'New One'!D4",
    );
  });

  it('rejects ranges spanning two sheets', () => {
    const e = workbook();
    expect(e.validateFormula('=Sheet1!A1:Sheet2!B2')).toBe(false);
    expect(e.validateFormula('=Sheet2!A1:Sheet2!B2')).toBe(true);
  });
});

describe('named expressions', () => {
  function priced() {
    const e = FormulaEngine.buildFromArray([
      ['apple', 10, '=SUM(Prices)*VatRate'],
      ['pear', 20, '=VLOOKUP("pear", Table, 2, FALSE)'],
      ['plum', 30, '=Unknown+1'],
    ]);
    e.addNamedExpression('VatRate', 0.2);
    e.addNamedExpression('Prices', '=Sheet1!$B$1:$B$3');
    e.addNamedExpression('Table', '=$A$1:$B$3');
    return e;
  }

  it('evaluates names, including ranges inside functions', () => {
    const e = priced();
    expect(e.getCellValue(at('C1'))).toBe(12);
    expect(e.getCellValue(at('C2'))).toBe(20);
    expect(code(e.getCellValue(at('C3')))).toBe('#NAME?');
    expect(e.getNamedExpressionValue('vatrate')).toBe(0.2);
    expect(e.getNamedExpressionValue('Prices')).toEqual([[10], [20], [30]]);
    expect(e.getNamedExpressionValue('Missing')).toBeUndefined();
    expect(e.listNamedExpressions()).toEqual(['VatRate', 'Prices', 'Table']);
    expect(e.getNamedExpressionFormula('Table')).toBe('=Sheet1!$A$1:$B$3');
    expect(e.calculateFormula('=VatRate*10')).toBe(2);
  });

  it('recalculates users when the name or its cells change', () => {
    const e = priced();
    e.setCellContents(at('B2'), 50);
    expect(e.getCellValue(at('C1'))).toBe(18);
    expect(e.getCellDependents(at('B2'))).toEqual([parseA1('C1'), parseA1('C2')]);
    e.changeNamedExpression('VatRate', '=0.1*2*2');
    expect(e.getCellValue(at('C1'))).toBeCloseTo(36);
    e.removeNamedExpression('VatRate');
    expect(code(e.getCellValue(at('C1')))).toBe('#NAME?');
    e.addNamedExpression('Unknown', 41);
    expect(e.getCellValue(at('C3'))).toBe(42);
    expect(() => e.changeNamedExpression('VatRate', 1)).toThrow();
  });

  it('validates names', () => {
    const e = priced();
    expect(e.isItPossibleToAddNamedExpression('Discount')).toBe(true);
    expect(e.isItPossibleToAddNamedExpression('KDV_Oranı')).toBe(true);
    expect(e.isItPossibleToAddNamedExpression('prices')).toBe(false); // taken, case-insensitively
    expect(e.isItPossibleToAddNamedExpression('A1')).toBe(false);
    expect(e.isItPossibleToAddNamedExpression('Tax2024')).toBe(false); // a valid cell reference
    expect(e.isItPossibleToAddNamedExpression('SUM')).toBe(false);
    expect(e.isItPossibleToAddNamedExpression('true')).toBe(false);
    expect(e.isItPossibleToAddNamedExpression('1st')).toBe(false);
    expect(e.isItPossibleToAddNamedExpression('My Name')).toBe(false);
    expect(() => e.addNamedExpression('A1', 1)).toThrow();
  });

  it('follows structural changes and sheet renames', () => {
    const e = priced();
    e.addRows(1, 1);
    expect(e.getNamedExpressionFormula('Prices')).toBe('=Sheet1!$B$1:$B$4');
    e.setCellContents(at('B2'), 40);
    expect(e.getCellValue(at('C1'))).toBe(20);
    e.renameSheet(0, 'Fiyat');
    expect(e.getNamedExpressionFormula('Prices')).toBe('=Fiyat!$B$1:$B$4');
    e.removeRows(0, 4);
    expect(code(e.getNamedExpressionValue('Prices'))).toBe('#REF!');
  });

  it('supports names referring to names and detects cycles', () => {
    const e = priced();
    e.addNamedExpression('Gross', '=SUM(Prices)*(1+VatRate)');
    expect(e.calculateFormula('=Gross')).toBe(72);
    e.addNamedExpression('Loop', '=Loop+1');
    expect(code(e.calculateFormula('=Loop'))).toBe('#CYCLE!');
    e.setCellContents(at('D1'), '=Sheet1!D2');
    e.addNamedExpression('Back', '=Sheet1!D1');
    e.setCellContents(at('D2'), '=Back');
    expect(code(e.getCellValue(at('D1')))).toBe('#CYCLE!');
  });

  it('names on a removed sheet become #REF!', () => {
    const e = FormulaEngine.buildFromSheets({ Main: [['=Rate*2']], Config: [[0.5]] });
    e.addNamedExpression('Rate', '=Config!$A$1');
    expect(e.getCellValue(at('A1'))).toBe(1);
    e.removeSheet(1);
    expect(code(e.getCellValue(at('A1')))).toBe('#REF!');
  });
});
