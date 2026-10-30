// @vitest-environment node
// Optional cross-check: opens our .xlsx with an independent reader (Python openpyxl). Skipped when
// Python or openpyxl is not installed; nothing is installed by this test.
import { describe, expect, it } from 'vitest';
import { toXLSX, toXLSXCompressed, type ExportSheet } from '../src/export';
import { dateToSerial } from '../src/formula/dates';
import { CellError } from '../src/formula/values';

// The project ships no Node typings, so Node-only modules are loaded untyped.
const load = (name: string): Promise<any> => import(name);
const { spawnSync } = await load('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = await load('node:fs');
const { tmpdir } = await load('node:os');
const { join } = await load('node:path');

function findPython(): string | undefined {
  for (const cmd of ['python3', 'python', 'py']) {
    const r = spawnSync(cmd, ['-c', 'import openpyxl'], { encoding: 'utf8' });
    if (r.status === 0) return cmd;
  }
  return undefined;
}
const python = findPython();

const SCRIPT = `
import json, sys, openpyxl
out = {}
for data_only in (False, True):
    wb = openpyxl.load_workbook(sys.argv[1], data_only=data_only)
    key = 'values' if data_only else 'formulas'
    res = {'sheets': wb.sheetnames}
    ws = wb.worksheets[0]
    res['cells'] = [[c.value if not hasattr(c.value, 'isoformat') else c.value.isoformat() for c in row] for row in ws.iter_rows()]
    if not data_only:
        res['freeze'] = ws.freeze_panes
        res['merged'] = [str(r) for r in ws.merged_cells.ranges]
        res['filter'] = ws.auto_filter.ref
        res['widthA'] = ws.column_dimensions['A'].width
        res['height1'] = ws.row_dimensions[1].height
        res['bold'] = ws['A1'].font.b
        res['fill'] = ws['A1'].fill.fgColor.rgb
        res['fmtC2'] = ws['C2'].number_format
        res['fmtD2'] = ws['D2'].number_format
        res['isDate'] = ws['D2'].is_date
        res['creator'] = wb.properties.creator
    out[key] = res
print(json.dumps(out, ensure_ascii=True))
`;

const sheets: ExportSheet[] = [
  {
    name: 'Satışlar',
    data: [
      ['Ürün', 'Adet', 'Fiyat', 'Tarih', 'Toplam'],
      ['Çay', 2, 1.25, dateToSerial(2026, 10, 30), '=B2*C2'],
      ['Kahve <&>', 3, 2, dateToSerial(2026, 1, 2), '=B3*C3'],
      [true, null, '=1/0', '=A2', '=SUM(E2:E3)'],
    ],
    values: [
      ['Ürün', 'Adet', 'Fiyat', 'Tarih', 'Toplam'],
      ['Çay', 2, 1.25, dateToSerial(2026, 10, 30), 2.5],
      ['Kahve <&>', 3, 2, dateToSerial(2026, 1, 2), 6],
      [true, null, new CellError('#DIV/0!'), 'Çay', 8.5],
    ],
    colWidths: [100],
    rowHeights: [28],
    frozen: { rows: 1, cols: 1 },
    merges: [{ row: 3, col: 0, rowspan: 1, colspan: 2 }],
    autoFilter: { row: 0, col: 0, rows: 3, cols: 5 },
    format: (r, c) =>
      r === 0 ? { bold: true, background: '#ddeeff' } : c === 2 ? { numberFormat: '#,##0.00 "₺"' } : c === 3 ? { numberFormat: 'dd.mm.yyyy' } : undefined,
  },
  { name: 'Satışlar', data: [['second']] },
];

describe.skipIf(!python)('openpyxl round trip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cenitu-xlsx-'));

  const load = (bytes: Uint8Array) => {
    const file = join(dir, `t${Math.random().toString(36).slice(2)}.xlsx`);
    writeFileSync(file, bytes);
    const r = spawnSync(python!, ['-I', '-c', SCRIPT, file], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  };

  const check = (out: any) => {
    const f = out.formulas;
    expect(f.sheets).toEqual(['Satışlar', 'Satışlar (2)']);
    expect(f.cells[1]).toEqual(['Çay', 2, 1.25, '2026-10-30T00:00:00', '=B2*C2']);
    expect(f.cells[2][0]).toBe('Kahve <&>');
    expect(f.cells[3][2]).toBe('=1/0');
    expect(f.freeze).toBe('B2');
    expect(f.merged).toEqual(['A4:B4']);
    expect(f.filter).toBe('A1:E3');
    expect(f.widthA).toBeCloseTo(13.57, 1);
    expect(f.height1).toBe(21);
    expect(f.bold).toBe(true);
    expect(f.fill).toBe('FFDDEEFF');
    expect(f.fmtC2).toBe('#,##0.00 "₺"');
    expect(f.fmtD2).toBe('dd.mm.yyyy');
    expect(f.isDate).toBe(true);
    expect(f.creator).toBe('Test');
    const v = out.values;
    expect(v.cells[1][4]).toBe(2.5);
    expect(v.cells[3]).toEqual([true, null, '#DIV/0!', 'Çay', 8.5]);
  };

  it('opens the STORE package', () => {
    check(load(toXLSX(sheets, { creator: 'Test' })));
  });

  it('opens the DEFLATE package', async () => {
    check(load(await toXLSXCompressed(sheets, { creator: 'Test' })));
    rmSync(dir, { recursive: true, force: true });
  });
});
