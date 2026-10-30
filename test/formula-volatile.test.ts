// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { FormulaEngine, parseA1, setClock, setRandom, type ChangedCell } from '../src/formula';

const a = (ref: string) => parseA1(ref)!;
const at = (y: number, m: number, d: number, h = 0, min = 0) => () => new Date(y, m - 1, d, h, min);
const refs = (changes: ChangedCell[]) => changes.map((c) => `${c.address.row}:${c.address.col}`).sort();

afterEach(() => {
  setClock();
  setRandom();
});

describe('volatile functions', () => {
  it('recalculateVolatile refreshes TODAY/NOW and their dependents and emits valuesUpdated', () => {
    setClock(at(2024, 1, 15, 12));
    const e = FormulaEngine.buildFromArray([['=TODAY()', '=A1+1', '=NOW()', 5, '=D1*2']]);
    expect(e.getCellValue(a('A1'))).toBe(45306);
    expect(e.getCellValue(a('C1'))).toBe(45306.5);
    const events: ChangedCell[][] = [];
    e.on('valuesUpdated', (c) => events.push(c));

    setClock(at(2024, 1, 16, 6));
    const changes = e.recalculateVolatile();
    expect(e.getCellValue(a('A1'))).toBe(45307);
    expect(e.getCellValue(a('B1'))).toBe(45308);
    expect(e.getCellValue(a('C1'))).toBe(45307.25);
    expect(refs(changes)).toEqual(['0:0', '0:1', '0:2']);
    expect(events).toEqual([changes]);
  });

  it('nothing to report when the clock has not moved', () => {
    setClock(at(2024, 1, 15));
    const e = FormulaEngine.buildFromArray([['=TODAY()']]);
    expect(e.recalculateVolatile()).toEqual([]);
  });

  it('any change also refreshes volatile formulas', () => {
    setClock(at(2024, 1, 15));
    const e = FormulaEngine.buildFromArray([['=TODAY()', '=YEAR(A1)']]);
    setClock(at(2025, 3, 1));
    const changes = e.setCellContents(a('D5'), 1);
    expect(e.getCellValue(a('B1'))).toBe(2025);
    expect(refs(changes)).toEqual(['0:0', '0:1', '4:3']);
  });

  it('RAND and RANDBETWEEN use the injectable source and change on every recalculation', () => {
    setRandom(() => 0.25);
    const e = FormulaEngine.buildFromArray([['=RAND()', '=RANDBETWEEN(1, 10)']]);
    expect([e.getCellValue(a('A1')), e.getCellValue(a('B1'))]).toEqual([0.25, 3]);
    setRandom(() => 0.95);
    e.recalculateVolatile();
    expect([e.getCellValue(a('A1')), e.getCellValue(a('B1'))]).toEqual([0.95, 10]);
    expect(e.calculateFormula('=RANDBETWEEN(5, 1)')).toMatchObject({ code: '#NUM!' });
  });

  it('volatile named expressions refresh their users', () => {
    setClock(at(2024, 1, 15));
    const e = FormulaEngine.buildFromArray([['=Today2+0']]);
    e.addNamedExpression('Today2', '=TODAY()');
    expect(e.getCellValue(a('A1'))).toBe(45306);
    setClock(at(2024, 1, 20));
    e.recalculateVolatile();
    expect(e.getCellValue(a('A1'))).toBe(45311);
  });

  it('a cell stops being volatile when its formula no longer is', () => {
    setRandom(() => 0.5);
    const e = FormulaEngine.buildFromArray([['=RAND()']]);
    e.setCellContents(a('A1'), '=1+1');
    setRandom(() => 0.1);
    expect(e.recalculateVolatile()).toEqual([]);
    expect(e.getCellValue(a('A1'))).toBe(2);
  });

  it('volatile spills resize when refreshed', () => {
    let n = 2;
    setRandom(() => n / 10);
    const e = FormulaEngine.buildFromArray([['=SEQUENCE(RAND()*10)', '=SUM(A1:A9)']]);
    expect(e.getCellValue(a('B1'))).toBe(3);
    n = 4;
    const changes = e.recalculateVolatile();
    expect(e.getCellValue(a('A4'))).toBe(4);
    expect(e.getCellValue(a('B1'))).toBe(10);
    expect(refs(changes)).toEqual(['0:1', '2:0', '3:0']);
  });
});
