// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FormulaEngine, parseA1, registerFunction, type CellValue, type RawCell } from '../src/formula';

const a = (ref: string) => parseA1(ref)!;
const code = (v: CellValue) => (v instanceof Object ? v.code : v);

/** One data row; `r` is the 1-based spreadsheet row number its formulas refer to. */
function dataRow(i: number, r: number): RawCell[] {
  return [
    `Item${i}`,
    (i % 17) + 1,
    ((i * 37) % 300) + 0.5,
    `=B${r}*C${r}`,
    `=ROUND(D${r}*0.2,2)`,
    `=D${r}+E${r}`,
    `=IF(F${r}>2000,"Yüksek",IF(F${r}>500,"Orta","Düşük"))`,
    `=F${r}-D${r}`,
    `=IF(B${r}>5,B${r},0)`,
    `=G${r}&"-"&A${r}`,
  ];
}

/**
 * The benchmark sheet: a header, `count` data rows with 7 formula columns, and summary formulas
 * over the data block in L1:O1. `gapAt` puts an empty row before that data index (as if a row
 * had been inserted); `skip` leaves that data index out (as if its row had been removed).
 */
function sheet(count: number, opts: { gapAt?: number; skip?: number } = {}): RawCell[][] {
  const rows: RawCell[][] = [['Name', 'Qty', 'Price', 'Net', 'Tax', 'Total', 'Band', 'Diff', 'Big', 'Label']];
  let first = 0;
  let last = 0;
  for (let i = 0; i < count; i++) {
    if (i === opts.gapAt) rows.push([]);
    if (i === opts.skip) continue;
    rows.push(dataRow(i, rows.length + 1));
    first ||= rows.length;
    last = rows.length;
  }
  if (opts.gapAt === count) rows.push([]);
  const span = (col: string) => `${col}${first}:${col}${last}`;
  rows[0].push(null, `=SUM(${span('F')})`, `=AVERAGE(${span('D')})`, `=MAX(${span('F')})`, `=COUNTIF(${span('G')},"Yüksek")`);
  return rows;
}

function expectSameAs(e: FormulaEngine, expected: RawCell[][]) {
  const fresh = FormulaEngine.buildFromArray(expected);
  expect(e.getSheetSerialized()).toEqual(fresh.getSheetSerialized());
  expect(e.getSheetValues()).toEqual(fresh.getSheetValues());
}

describe('incremental row/column changes match a freshly built engine', () => {
  const n = 1500;
  it.each([1, 2, 700, n, n + 1])('insert one row at index %i', (index) => {
    const e = FormulaEngine.buildFromArray(sheet(n));
    e.addRows(index, 1);
    // Index 1 is the first data row: inserting there shifts the summary ranges instead of growing them.
    expectSameAs(e, sheet(n, { gapAt: index - 1 }));
  });

  it.each([1, 700, n])('remove the row at index %i', (index) => {
    const e = FormulaEngine.buildFromArray(sheet(n));
    e.removeRows(index, 1);
    expectSameAs(e, sheet(n, { skip: index - 1 }));
  });

  it('insert followed by remove restores the original sheet', () => {
    const e = FormulaEngine.buildFromArray(sheet(n));
    e.addRows(300, 3);
    const total = e.getCellValue(a('L1')) as number;
    e.setCellContents(a('F302'), 1000); // inside the gap: the summary ranges grew to include it
    expect(e.getCellValue(a('L1'))).toBeCloseTo(total + 1000, 6);
    e.setCellContents(a('F302'), null);
    e.removeRows(300, 3);
    expectSameAs(e, sheet(n));
  });

  it('columns: insert and remove keep every value', () => {
    const e = FormulaEngine.buildFromArray(sheet(200));
    const before = e.getSheetValues();
    e.addColumns(3, 2);
    expect(e.getCellFormula(a('H2'))).toBe('=F2+G2');
    expect(e.getCellFormula(a('N1'))).toBe('=SUM(H2:H201)');
    e.removeColumns(3, 2);
    expect(e.getSheetValues()).toEqual(before);
    expectSameAs(e, sheet(200));
  });

  it('a removed column turns references into #REF! and recalculates dependents', () => {
    const e = FormulaEngine.buildFromArray(sheet(50));
    e.removeColumns(4, 1); // column E (Tax)
    expect(e.getCellFormula(a('E2'))).toBe('=D2+#REF!');
    expect(code(e.getCellValue(a('E2')))).toBe('#REF!');
    expect(code(e.getCellValue(a('F2')))).toBe('#REF!'); // IF(E2>2000, ...) depends on it
    expect(code(e.getCellValue(a('K1')))).toBe('#REF!'); // SUM over the column of totals
  });
});

describe('only formulas whose meaning changed are recalculated', () => {
  let calls = 0;
  registerFunction('COUNTED', { minArgs: 1, maxArgs: 1, impl: ([x]) => (calls++, x) });

  it('shifted references keep their value without re-evaluation', () => {
    const data: RawCell[][] = Array.from({ length: 100 }, (_, i) => [i, `=COUNTED(A${i + 1})`]);
    data[0].push('=SUM(A1:A100)', '=COUNTED(A50)');
    const e = FormulaEngine.buildFromArray(data);
    calls = 0;
    const changes = e.addRows(10, 5);
    expect(calls).toBe(0); // SUM's range grew, but it is not a COUNTED call
    expect(changes).toEqual([]); // inserted rows are empty, so the SUM value is unchanged
    expect(e.getCellFormula(a('B16'))).toBe('=COUNTED(A16)');
    expect(e.getCellFormula(a('D1'))).toBe('=COUNTED(A55)');
    expect(e.getCellFormula(a('C1'))).toBe('=SUM(A1:A105)');

    e.setCellContents(a('A12'), 1000);
    expect(e.getCellValue(a('C1'))).toBe(4950 + 1000);
    expect(calls).toBe(0);

    calls = 0;
    e.removeRows(54, 1); // the row D1 points at
    expect(calls).toBe(1);
    expect(code(e.getCellValue(a('D1')))).toBe('#REF!');
  });

  it('values in a moved formula stay correct after later edits', () => {
    const e = FormulaEngine.buildFromArray([[1], [2], ['=A1+A2'], ['=A3*2']]);
    e.addRows(1, 1);
    e.addColumns(0, 1);
    expect(e.getCellFormula(a('B5'))).toBe('=B4*2');
    e.setCellContents(a('B1'), 10);
    expect(e.getCellValue(a('B5'))).toBe(24);
    expect(e.getCellPrecedents(a('B4'))).toEqual([a('B1'), a('B3')]);
    expect(e.getCellDependents(a('B3'))).toEqual([a('B4')]);
  });

  it('references to empty cells follow structural changes', () => {
    const e = FormulaEngine.buildFromArray([['=A5*2']]);
    e.addRows(2, 3);
    expect(e.getCellFormula(a('A1'))).toBe('=A8*2');
    e.setCellContents(a('A8'), 21);
    expect(e.getCellValue(a('A1'))).toBe(42);
  });

  it('cells written earlier in a batch move with the data', () => {
    const e = FormulaEngine.buildFromArray([[1], ['=A1+1']]);
    const changes = e.batch(() => {
      e.setCellContents(a('A1'), 5);
      e.addRows(0, 1);
    });
    expect(e.getCellValue(a('A3'))).toBe(6);
    expect(changes.map((c) => c.address)).toContainEqual({ row: 1, col: 0, sheet: 0 });
  });
});

describe('structural change performance', () => {
  it('inserts and removes one row in a 70k-formula sheet quickly', () => {
    const N = 10000;
    const data = sheet(N);
    const tb = performance.now();
    const e = FormulaEngine.buildFromArray(data);
    const t0 = performance.now();
    console.log(`70k formulas: build ${(t0 - tb).toFixed(0)} ms`);
    e.addRows(500, 1);
    const t1 = performance.now();
    e.removeRows(500, 1);
    const t2 = performance.now();
    console.log(`70k formulas: addRows ${(t1 - t0).toFixed(1)} ms, removeRows ${(t2 - t1).toFixed(1)} ms`);
    // Target is < 60 ms; the bound is generous so CI noise does not flake.
    expect(t1 - t0).toBeLessThan(250);
    expect(t2 - t1).toBeLessThan(250);
    expect(e.getSheetValues()).toEqual(FormulaEngine.buildFromArray(sheet(N)).getSheetValues());
  });
});
