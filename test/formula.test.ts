import { describe, expect, it } from 'vitest';
import { FormulaEngine, parseA1, registerFunction, type CellValue } from '../src/formula';

const a = (ref: string) => parseA1(ref)!;
const code = (v: CellValue) => (v instanceof Object ? v.code : v);

function engine(data: (string | number | boolean | null)[][]) {
  const e = FormulaEngine.buildFromArray(data);
  return { e, v: (ref: string) => code(e.getCellValue(a(ref))) };
}

describe('parser & operators', () => {
  it.each([
    ['=1+2*3', 7],
    ['=(1+2)*3', 9],
    ['=2^3^2', 64],
    ['=-2^2', 4],
    ['=10/4', 2.5],
    ['=0.1+0.2', 0.3],
    ['=50%', 0.5],
    ['="a"&"b"&1', 'ab1'],
    ['=1<2', true],
    ['="abc"="ABC"', true],
    ['=1/0', '#DIV/0!'],
    ['="x"+1', '#VALUE!'],
    ['=FOO(1)', '#NAME?'],
    ['=1+', '#ERROR!'],
    ['=TRUE+1', 2],
    ['=LOG10(1)', '#NAME?'],
  ])('%s -> %s', (formula, expected) => {
    const { v } = engine([[formula]]);
    expect(v('A1')).toBe(expected);
  });
});

describe('references and recalculation', () => {
  it('evaluates references and ranges', () => {
    const { v } = engine([
      [1, 2, '=A1+B1'],
      [3, 4, '=SUM(A1:B2)'],
      [null, null, '=A3'],
    ]);
    expect(v('C1')).toBe(3);
    expect(v('C2')).toBe(10);
    expect(v('C3')).toBe(0);
  });

  it('propagates changes through the graph and reports them', () => {
    const { e, v } = engine([[1, '=A1*2', '=B1+1', '=SUM(A1:C1)']]);
    const events: number[] = [];
    e.on('valuesUpdated', (c) => events.push(c.length));
    const changes = e.setCellContents(a('A1'), 10);
    expect(v('B1')).toBe(20);
    expect(v('C1')).toBe(21);
    expect(v('D1')).toBe(51);
    expect(changes.map((c) => c.address)).toHaveLength(4);
    expect(events).toEqual([4]);
  });

  it('only reports cells whose value changed', () => {
    const { e } = engine([[1, 2, '=MAX(A1:B1)']]);
    const changes = e.setCellContents(a('A1'), 0);
    expect(changes).toHaveLength(1);
  });

  it('detects cycles and recovers when broken', () => {
    const { e, v } = engine([['=B1', '=A1', '=A1+1']]);
    expect(v('A1')).toBe('#CYCLE!');
    expect(v('C1')).toBe('#CYCLE!');
    e.setCellContents(a('B1'), 5);
    expect(v('A1')).toBe(5);
    expect(v('C1')).toBe(6);
  });

  it('detects self reference', () => {
    const { v } = engine([['=A1+1']]);
    expect(v('A1')).toBe('#CYCLE!');
  });

  it('batches changes into one recalculation', () => {
    const { e, v } = engine([[null, null, '=A1+B1']]);
    let calls = 0;
    e.on('valuesUpdated', () => calls++);
    e.batch(() => {
      e.setCellContents(a('A1'), 1);
      e.setCellContents(a('B1'), 2);
    });
    expect(calls).toBe(1);
    expect(v('C1')).toBe(3);
  });

  it('handles long dependency chains', () => {
    const data = [[1], ...Array.from({ length: 5000 }, (_, i) => [`=A${i + 1}+1`])];
    const { e, v } = engine(data);
    expect(v('A5001')).toBe(5001);
    e.setCellContents(a('A1'), 0);
    expect(v('A5001')).toBe(5000);
  });

  it('exposes precedents and dependents', () => {
    const { e } = engine([[1, '=A1+SUM(A1:A3)']]);
    expect(e.getCellPrecedents(a('B1'))).toHaveLength(2);
    expect(e.getCellDependents(a('A1'))).toEqual([a('B1')]);
  });
});

describe('functions', () => {
  const data = [
    ['Name', 'Qty', 'Price'],
    ['apple', 3, 1.5],
    ['banana', 5, 0.25],
    ['cherry', 10, 4],
    ['Apricot', null, 2],
  ];
  it.each([
    ['=SUM(B2:B5)', 18],
    ['=AVERAGE(B2:B5)', 6],
    ['=COUNT(A1:C5)', 7],
    ['=COUNTA(B1:B5)', 4],
    ['=MIN(C2:C5)', 0.25],
    ['=MAX(B2:B5, 20)', 20],
    ['=IF(B2>2, "big", "small")', 'big'],
    ['=IF(FALSE, 1/0, "ok")', 'ok'],
    ['=IFERROR(1/0, -1)', -1],
    ['=AND(TRUE, B2>1)', true],
    ['=OR(FALSE, 0)', false],
    ['=NOT(1)', false],
    ['=ROUND(2.345, 2)', 2.35],
    ['=ROUND(-2.5, 0)', -3],
    ['=CONCATENATE(A2, "-", B2)', 'apple-3'],
    ['=CONCAT(A2:A3)', 'applebanana'],
    ['=LEN(A3)', 6],
    ['=UPPER(A2)', 'APPLE'],
    ['=LEFT(A4, 3)', 'che'],
    ['=MID(A3, 2, 3)', 'ana'],
    ['=VLOOKUP("banana", A2:C5, 3, FALSE)', 0.25],
    ['=VLOOKUP("BANANA", A2:C5, 2, FALSE)', 5],
    ['=VLOOKUP("zzz", A2:C5, 2, FALSE)', '#N/A'],
    ['=VLOOKUP("apple", A2:C5, 9, FALSE)', '#REF!'],
    ['=INDEX(A2:C5, 3, 1)', 'cherry'],
    ['=MATCH("cherry", A2:A5, 0)', 3],
    ['=INDEX(C2:C5, MATCH("cherry", A2:A5, 0))', 4],
    ['=SUMIF(B2:B5, ">4")', 15],
    ['=SUMIF(A2:A5, "a*", C2:C5)', 3.5],
    ['=COUNTIF(A2:A5, "<>apple")', 3],
    ['=SUMPRODUCT(B2:B4, C2:C4)', 45.75],
    ['=COUNT(A2, B2)', 1],
    ['=MOD(-3, 2)', 1],
    ['=SUM(1, "2", TRUE)', 4],
    ['=SUM(A1)', 0],
    ['=IF(1)', '#VALUE!'],
  ])('%s -> %s', (formula, expected) => {
    const e = FormulaEngine.buildFromArray(data);
    expect(code(e.calculateFormula(formula))).toBe(expected);
  });

  it('approximate VLOOKUP and MATCH on sorted data', () => {
    const e = FormulaEngine.buildFromArray([[0, 'F'], [50, 'D'], [70, 'C'], [90, 'A']]);
    expect(e.calculateFormula('=VLOOKUP(75, A1:B4, 2)')).toBe('C');
    expect(e.calculateFormula('=MATCH(95, A1:A4)')).toBe(4);
    expect(code(e.calculateFormula('=VLOOKUP(-1, A1:B4, 2)'))).toBe('#N/A');
  });

  it('accepts custom functions', () => {
    registerFunction('DOUBLE', { minArgs: 1, maxArgs: 1, impl: ([x]) => (x as number) * 2 });
    const { v } = engine([[21, '=DOUBLE(A1)']]);
    expect(v('B1')).toBe(42);
  });
});

describe('structural changes', () => {
  it('shifts references when rows are inserted', () => {
    const { e, v } = engine([[1], [2], ['=SUM(A1:A2)'], ['=A2*10']]);
    e.addRows(1, 2);
    expect(e.getCellFormula(a('A5'))).toBe('=SUM(A1:A4)');
    expect(e.getCellFormula(a('A6'))).toBe('=A4*10');
    e.setCellContents(a('A2'), 7);
    expect(v('A5')).toBe(10);
  });

  it('produces #REF! when referenced rows are removed and shrinks ranges', () => {
    const { e, v } = engine([[1], [2], [3], ['=SUM(A1:A3)'], ['=A2']]);
    e.removeRows(1, 1);
    expect(e.getCellFormula(a('A3'))).toBe('=SUM(A1:A2)');
    expect(v('A3')).toBe(4);
    expect(e.getCellFormula(a('A4'))).toBe('=#REF!');
    expect(v('A4')).toBe('#REF!');
  });

  it('shrinks a range whose start is removed', () => {
    const { e } = engine([[1, 2, 3, 4, '=SUM(B1:D1)']]);
    e.removeColumns(0, 2);
    expect(e.getCellFormula(a('C1'))).toBe('=SUM(A1:B1)');
    expect(e.getCellValue(a('C1'))).toBe(7);
  });

  it('shifts columns and keeps absolute markers', () => {
    const { e } = engine([[1, '=$A$1+A1']]);
    e.addColumns(0, 1);
    expect(e.getCellFormula(a('C1'))).toBe('=$B$1+B1');
  });

  it('shiftFormula moves only relative parts', () => {
    const e = FormulaEngine.buildEmpty();
    expect(e.shiftFormula('=A1+$B$2+C$3+SUM(A1:B2)', 1, 1)).toBe('=B2+$B$2+D$3+SUM(B2:C3)');
    expect(e.shiftFormula('=A1', -1, 0)).toBe('=#REF!');
  });
});

describe('numeric precision', () => {
  it('sums long columns of decimals without accumulated noise', () => {
    const data = Array.from({ length: 10000 }, () => [0.1]);
    const e = FormulaEngine.buildFromArray(data);
    expect(e.calculateFormula('=SUM(A1:A10000)')).toBe(1000);
    expect(e.calculateFormula('=SUMIF(A1:A10000, ">0")')).toBe(1000);
  });
});
