// @vitest-environment node
// Optional cross-check: reads a workbook written by an independent writer (Python openpyxl). Skipped
// when Python or openpyxl is not installed; nothing is installed by this test.
import { describe, expect, it } from 'vitest';
import { readXLSX } from '../src/export';
import { FormulaEngine } from '../src/formula/engine';

// The project ships no Node typings, so Node-only modules are loaded untyped.
const load = (name: string): Promise<any> => import(name);
const { spawnSync } = await load('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = await load('node:fs');
const { tmpdir } = await load('node:os');
const { join } = await load('node:path');

function findPython(): string | undefined {
  for (const cmd of ['python3', 'python', 'py']) {
    if (spawnSync(cmd, ['-c', 'import openpyxl'], { encoding: 'utf8' }).status === 0) return cmd;
  }
  return undefined;
}
const python = findPython();

const SCRIPT = `
import sys, datetime, openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.styles.colors import Color
wb = openpyxl.Workbook()
ws = wb.active
ws.title = 'Satış Özeti'
ws.append(['Ürün', 'Adet', 'Fiyat', 'Tarih', 'Tutar'])
ws.append(['Çay', 3, 12.5, datetime.date(2026, 10, 30), '=B2*C2'])
ws.append(['Kahve', 2, 20, datetime.datetime(2026, 1, 2, 13, 30), '=B3*C3'])
ws.append(['Toplam', None, None, None, '=SUM(E2:E3)'])
ws['A1'].font = Font(bold=True, italic=True, strike=True, color='FFCC0000')
ws['A1'].fill = PatternFill('solid', fgColor=Color(theme=4, tint=0.4))
ws['B1'].alignment = Alignment(horizontal='center', wrap_text=True)
ws['C2'].number_format = '#,##0.00'
ws['D2'].number_format = 'dd.mm.yyyy'
ws['D3'].number_format = 'yyyy-mm-dd hh:mm'
ws['E2'].number_format = '0.00%'
ws.freeze_panes = 'B2'
ws.merge_cells('A4:D4')
ws.column_dimensions['A'].width = 30
ws.column_dimensions['C'].hidden = True
ws.row_dimensions[1].height = 30
other = wb.create_sheet('Diğer')
other['A1'] = "='Satış Özeti'!E4*2"
wb.create_sheet('Gizli').sheet_state = 'hidden'
wb.defined_names['Oran'] = openpyxl.workbook.defined_name.DefinedName('Oran', attr_text="'Satış Özeti'!$B$2")
wb.save(sys.argv[1])
`;

describe.skipIf(!python)('reading an openpyxl workbook', () => {
  it('gets content, formats and layout right', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cenitu-import-'));
    const file = join(dir, 'book.xlsx');
    const r = spawnSync(python!, ['-I', '-c', SCRIPT, file], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    const bytes = new Uint8Array(readFileSync(file));
    rmSync(dir, { recursive: true, force: true });

    const book = await readXLSX(bytes);
    expect(book.sheets.map((s) => [s.name, s.hidden])).toEqual([['Satış Özeti', false], ['Diğer', false], ['Gizli', true]]);
    expect(book.names).toEqual([{ name: 'Oran', expression: "='Satış Özeti'!$B$2" }]);
    const s = book.sheets[0];
    expect(s.data[0]).toEqual(['Ürün', 'Adet', 'Fiyat', 'Tarih', 'Tutar']);
    expect(s.data[1].slice(0, 3)).toEqual(['Çay', 3, 12.5]);
    expect(s.data[1][3]).toBe(46325);
    expect(s.data[2][3]).toBeCloseTo(46024.5625, 6);
    expect(s.data[3][4]).toBe('=SUM(E2:E3)');
    expect(s.frozen).toEqual({ rows: 1, cols: 1 });
    expect(s.merges).toEqual([{ row: 3, col: 0, rowspan: 1, colspan: 4 }]);
    expect(s.hiddenColumns).toEqual([2]);
    expect(s.colWidths![0]).toBe(215);
    expect(s.rowHeights![0]).toBe(40);
    expect(s.format(0, 0)).toMatchObject({ bold: true, italic: true, strike: true, color: '#cc0000' });
    expect(s.format(0, 0)!.background).toMatch(/^#[0-9a-f]{6}$/);
    expect(s.format(0, 1)).toEqual({ align: 'center', wrap: true });
    expect(s.format(1, 2)).toEqual({ numberFormat: '#,##0.00' });
    expect(s.format(1, 3)).toEqual({ numberFormat: 'dd.mm.yyyy' });
    expect(s.format(2, 3)).toEqual({ numberFormat: 'yyyy-mm-dd hh:mm' });

    const engine = FormulaEngine.buildFromSheets({ 'Satış Özeti': s.data, Diğer: book.sheets[1].data });
    expect(engine.getCellValue({ row: 0, col: 0, sheet: 1 })).toBe(155);
  });
});
