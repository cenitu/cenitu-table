import { afterEach, describe, expect, it } from 'vitest';
import { CenituGrid, readXLSX, toXLSX, zipStore, type ExportSheet, type GridOptions } from '../src';

let grid: CenituGrid;
afterEach(() => {
  grid?.destroy();
  document.body.textContent = '';
});

function make(opts: GridOptions) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  grid = new CenituGrid(host, opts);
  return grid;
}

const sheet: ExportSheet = {
  name: 'A',
  data: [['Durum', 'Not'], ['Açık', 'x']],
  notes: [{ row: 1, col: 0, text: 'Kontrol <edildi> & onaylı' }],
  validations: [{ ranges: [{ row: 1, col: 0, rows: 3, cols: 1 }], values: ['Açık', 'Kapalı'] }],
};

describe('notes and lists in files', () => {
  it('round trips through a file', async () => {
    const { sheets } = await readXLSX(toXLSX([sheet]));
    expect(sheets[0].notes).toEqual(sheet.notes);
    expect(sheets[0].validations).toEqual(sheet.validations);
  });

  it('keeps notes on the right sheet of a workbook', async () => {
    const { sheets } = await readXLSX(toXLSX([{ name: 'B', data: [[1]] }, sheet]));
    expect(sheets[0].notes).toEqual([]);
    expect(sheets[1].notes).toHaveLength(1);
  });

  it('leaves out lists a file cannot hold', async () => {
    const { sheets } = await readXLSX(toXLSX([{ name: 'B', data: [['a']], validations: [{ ranges: [{ row: 0, col: 0, rows: 1, cols: 1 }], values: ['a,b'] }] }]));
    expect(sheets[0].validations).toEqual([]);
  });

  it('skips lists that refer to cells', async () => {
    const enc = new TextEncoder();
    const part = (path: string, xml: string) => ({ path, data: enc.encode(xml) });
    const bytes = zipStore([
      part('xl/workbook.xml', '<workbook xmlns:r="r"><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      part('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      part('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><dataValidations><dataValidation type="list" sqref="A1"><formula1>$C$1:$C$9</formula1></dataValidation></dataValidations></worksheet>'),
    ]);
    const { sheets } = await readXLSX(bytes);
    expect(sheets[0].validations).toEqual([]);
  });

  it('reach the grid and leave it again', async () => {
    const g = make({ data: [[]] });
    const { sheets } = await readXLSX(toXLSX([sheet]));
    g.loadSheet(sheets[0]);
    expect(g.getCellNote(1, 0)).toBe(sheet.notes![0].text);
    expect(g.getCellMeta(1, 0).type).toBe('dropdown');
    expect(g.getCellMeta(1, 0).source).toEqual(['Açık', 'Kapalı']);
    const out = g.toExportSheet();
    expect(out.notes).toEqual(sheet.notes);
    expect(out.validations).toEqual([{ values: ['Açık', 'Kapalı'], ranges: [{ row: 1, col: 0, rows: 1, cols: 1 }] }]);
  });

  it('writes dropdown columns as lists', () => {
    const g = make({ data: [['Başlık'], ['a'], ['b']], fixedRowsTop: 1, columns: [{ type: 'dropdown', source: [{ value: 1, label: 'Bir' }, 'iki'] }] });
    expect(g.toExportSheet().validations).toEqual([{ values: ['1', 'iki'], ranges: [{ row: 1, col: 0, rows: 2, cols: 1 }] }]);
  });
});
