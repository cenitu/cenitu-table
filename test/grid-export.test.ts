import { afterEach, describe, expect, it } from 'vitest';
import { CenituGrid, xlsxParts, type GridOptions } from '../src';

let grid: CenituGrid;
afterEach(() => grid?.destroy());

function make(data: unknown[][], opts: GridOptions = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  grid = new CenituGrid(host, { data: data as GridOptions['data'], ...opts });
  return grid;
}

describe('grid export', () => {
  const data = [['Ürün', 'Tutar'], ['Vida', 1234.5], ['Pul', '=B2*2']];

  it('describes the sheet in data order with formats, styles and layout', () => {
    const g = make(data, {
      sheetName: 'Siparişler',
      locale: 'tr-TR',
      fixedRowsTop: 1,
      filters: true,
      columns: [{}, { type: 'numeric', numericFormat: { style: 'currency', currency: 'TRY' } }],
    });
    g.sort(1, 'desc');
    g.setCellStyle({ start: { row: 0, col: 0 }, end: { row: 0, col: 1 } }, { bold: true, background: '#eeeeee' });
    const s = g.toExportSheet();
    expect(s.name).toBe('Siparişler');
    expect(s.data[2]).toEqual(['Pul', '=B2*2']); // physical order, formula kept
    expect(s.values![2][1]).toBe(2469);
    expect(s.frozen).toEqual({ rows: 1, cols: 0 });
    expect(s.autoFilter).toEqual({ row: 0, col: 0, rows: 3, cols: 2 });
    expect(s.format!(1, 1)?.numberFormat).toContain('#,##0.00');
    expect(s.format!(0, 0)).toMatchObject({ bold: true, background: '#eeeeee' });
    expect(s.format!(1, 0)).toBeUndefined();
  });

  it('exports CSV with locale defaults and builds a workbook from several grids', () => {
    const g = make(data, { locale: 'tr-TR' });
    expect(g.exportCSV({ bom: false })).toBe('Ürün;Tutar\r\nVida;1234,5\r\nPul;2469');
    expect(g.exportCSV({ bom: false, delimiter: ',', decimalSeparator: '.' }).split('\r\n')[1]).toBe('Vida,1234.5');
    const parts = xlsxParts([g.toExportSheet()]);
    const sheetXml = parts.find((p) => p.path === 'xl/worksheets/sheet1.xml')!;
    const xml = new TextDecoder().decode(sheetXml.data);
    expect(xml).toContain('<f>B2*2</f>');
  });
});

describe('formatted CSV', () => {
  it('writes numbers as displayed on request, plain by default', () => {
    const g = make([[1234.5, 'x']], { locale: 'tr-TR', columns: [{ type: 'numeric', numericFormat: { style: 'currency', currency: 'TRY' } }] });
    expect(g.exportCSV({ bom: false })).toBe('1234,5;x');
    expect(g.exportCSV({ bom: false, values: 'formatted' })).toMatch(/^.*1\.234,50;x$/);
  });
});
