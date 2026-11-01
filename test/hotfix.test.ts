import { afterEach, describe, expect, it } from 'vitest';
import { CenituGrid, readXLSX, toXLSX, zipStore, type GridOptions } from '../src';
import { dateToSerial } from '../src/formula/dates';
import { convertInput, parseByPattern } from '../src/grid/cellTypes';

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

const openAndEnter = (g: CenituGrid) => {
  g.selectCell(0, 0);
  g.openEditor();
  g.closeEditor(true);
};

describe('values survive an unchanged editor', () => {
  it('keeps decimals and dates, with nothing to undo', () => {
    const cases: [number, GridOptions['columns']][] = [
      [1.234, [{ type: 'numeric' }]],
      [0.125, [{ type: 'numeric' }]],
      [46000, [{ type: 'date', dateFormat: 'MM/DD/YYYY' }]],
      [46000.75, [{ type: 'date', dateFormat: 'DD.MM.YYYY' }]],
    ];
    for (const [value, columns] of cases) {
      const g = make({ data: [[value]], columns });
      openAndEnter(g);
      expect(g.getSourceDataAtCell(0, 0)).toBe(value);
      expect(g.isUndoAvailable()).toBe(false);
      g.destroy();
    }
  });

  it('reads numbers by locale when the text does change', () => {
    expect(convertInput('1.234', { type: 'numeric' })).toBe(1.234);
    expect(convertInput('1.234', { type: 'numeric' }, 'en-US')).toBe(1.234);
    expect(convertInput('1.234', { type: 'numeric' }, 'tr-TR')).toBe(1234);
    expect(convertInput('1.234,5', { type: 'numeric' })).toBe(1234.5);
    expect(convertInput('4,5', { type: 'numeric' })).toBe(4.5);
  });

  it('reads dates by the cell pattern', () => {
    expect(parseByPattern('02/03/2026', 'MM/DD/YYYY')).toBe(dateToSerial(2026, 2, 3));
    expect(parseByPattern('03.02.26', 'DD.MM.YY')).toBe(dateToSerial(2026, 2, 3));
    expect(parseByPattern('31.13.2026', 'DD.MM.YYYY')).toBeUndefined();
  });
});

describe('an open editor', () => {
  const type = (g: CenituGrid, text: string) => {
    const ta = g.root.querySelector('textarea')!;
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('is discarded when the data is replaced', () => {
    const g = make({ data: [['a'], ['b']] });
    g.selectCell(0, 0);
    g.openEditor();
    type(g, 'zz');
    g.loadData([['x'], ['y']]);
    expect(g.isEditing()).toBe(false);
    expect(g.getData().flat()).toEqual(['x', 'y']);
  });

  it('commits to the edited cell when the selection moves', () => {
    const g = make({ data: [['a'], ['b']] });
    g.selectCell(0, 0);
    g.openEditor();
    type(g, 'yeni');
    g.selectCell(1, 0);
    expect(g.getData().flat()).toEqual(['yeni', 'b']);
  });
});

describe('files', () => {
  const enc = new TextEncoder();
  const part = (path: string, xml: string) => ({ path, data: enc.encode(xml) });

  it('never writes text as a formula when formulas are off', async () => {
    const g = make({ data: [['=KOTU()']], formulas: false });
    const { sheets } = await readXLSX(toXLSX([g.toExportSheet()]));
    expect(sheets[0].data[0][0]).toBe("'=KOTU()");
  });

  it('refuses sheets too large to hold', async () => {
    const bytes = zipStore([
      part('xl/workbook.xml', '<workbook xmlns:r="r"><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      part('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      part('xl/worksheets/sheet1.xml', '<worksheet><sheetData/><mergeCells><mergeCell ref="A1:ZZ30000"/></mergeCells></worksheet>'),
    ]);
    await expect(readXLSX(bytes)).rejects.toThrow('too large');
  });
});
