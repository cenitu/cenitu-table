// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  dateToSerial,
  formatSerialDate,
  FormulaEngine,
  parseDateString,
  serialToDate,
  type CellValue,
} from '../src/formula';

const code = (v: CellValue) => (v instanceof Object ? v.code : v);

describe('serial date helpers', () => {
  it.each([
    [1900, 1, 1, 1],
    [1900, 2, 28, 59],
    [1900, 2, 29, 60], // the fictitious leap day
    [1900, 3, 1, 61],
    [1970, 1, 1, 25569],
    [2000, 1, 1, 36526],
    [2024, 2, 29, 45351],
  ])('%i-%i-%i is serial %i', (y, m, d, serial) => {
    expect(dateToSerial(y, m, d)).toBe(serial);
    expect(serialToDate(serial)).toEqual({ year: y, month: m, day: d });
  });

  it('round-trips every day across a century', () => {
    for (let s = 1; s < 40000; s += 7) {
      const { year, month, day } = serialToDate(s);
      expect(dateToSerial(year, month, day)).toBe(s);
    }
  });

  it('normalizes overflowing months and days like DATE', () => {
    expect(dateToSerial(2024, 13, 1)).toBe(dateToSerial(2025, 1, 1));
    expect(dateToSerial(2024, 3, 0)).toBe(dateToSerial(2024, 2, 29));
  });

  it.each([
    ['2024-02-29', 45351],
    ['29.02.2024', 45351],
    ['29/02/2024', 45351],
    ['1.3.2024', 45352],
    [' 1970-01-01 ', 25569],
    ['2023-02-29', undefined],
    ['31.04.2024', undefined],
    ['2024-13-01', undefined],
    ['29.02/2024', undefined],
    ['1899-12-31', undefined],
    ['hello', undefined],
  ])('parseDateString(%j) -> %s', (text, serial) => {
    expect(parseDateString(text)).toBe(serial);
  });

  it('formats serials', () => {
    expect(formatSerialDate(45351)).toBe('2024-02-29');
    expect(formatSerialDate(45351, 'DD.MM.YYYY')).toBe('29.02.2024');
    expect(formatSerialDate(45352, 'D/M/YY')).toBe('1/3/24');
    expect(formatSerialDate(45351.75, 'YYYY-MM-DD HH:mm:ss')).toBe('2024-02-29 18:00:00');
  });
});

describe('date functions', () => {
  const e = FormulaEngine.buildFromArray([[45351, '2024-01-31', '15.06.2023']]);
  it.each([
    ['=DATE(2024,2,29)', 45351],
    ['=DATE(2024,14,1)', 45689],
    ['=DATE(124,1,1)', 45292],
    ['=DATE(1900,2,29)', 60],
    ['=DATE(-1,1,1)', '#NUM!'],
    ['=YEAR(A1)', 2024],
    ['=MONTH(A1)', 2],
    ['=DAY(A1)', 29],
    ['=YEAR("15.06.2023")', 2023],
    ['=MONTH(C1)', 6],
    ['=DAY(60)', 29],
    ['=YEAR(-1)', '#NUM!'],
    ['=YEAR("soon")', '#VALUE!'],
    ['=WEEKDAY(A1)', 5], // Thursday
    ['=WEEKDAY(A1,2)', 4],
    ['=WEEKDAY(1)', 1], // serial 1 is a Sunday
    ['=WEEKDAY(A1,9)', '#NUM!'],
    ['=EDATE(B1,1)', 45351],
    ['=EDATE(B1,-2)', 45260], // 2023-11-30
    ['=EDATE(A1,12)', 45716], // 2025-02-28
    ['=EOMONTH("2024-01-15",1)', 45351],
    ['=EOMONTH(A1,-1)', 45322],
    ['=DAYS("2024-03-01","2024-02-01")', 29],
    ['=DAYS(B1,A1)', -29],
    ['=DATEDIF("2020-02-29","2024-02-28","Y")', 3],
    ['=DATEDIF("2020-02-29","2024-02-28","M")', 47],
    ['=DATEDIF("2020-02-29","2024-02-29","Y")', 4],
    ['=DATEDIF("2024-01-31","2024-03-01","M")', 1],
    ['=DATEDIF("2024-01-31","2024-03-01","D")', 30],
    ['=DATEDIF("2024-03-01","2024-01-31","D")', '#NUM!'],
    ['=DATEDIF(B1,A1,"X")', '#NUM!'],
  ])('%s -> %s', (formula, expected) => {
    expect(code(e.calculateFormula(formula))).toBe(expected);
  });

  it('TODAY and NOW use the current date', () => {
    const now = new Date();
    const today = dateToSerial(now.getFullYear(), now.getMonth() + 1, now.getDate());
    const t = e.calculateFormula('=TODAY()') as number;
    const n = e.calculateFormula('=NOW()') as number;
    expect([today, today + 1]).toContain(t); // tolerate a midnight rollover
    expect(n - t).toBeGreaterThanOrEqual(0);
    expect(n - t).toBeLessThan(1);
  });
});
