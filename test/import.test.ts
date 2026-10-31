// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readXLSX, toXLSX, toXLSXCompressed, workbookEngine, zipDeflate, zipStore, ZipReader, type ExportSheet } from '../src/export';
import { dateToSerial } from '../src/formula/dates';
import { patternFromDateCode, numericFormatFromCode, metaFromFormat } from '../src/export/xlsxStyles';
import { scanXml } from '../src/export/xmlReader';

const enc = new TextEncoder();
const part = (path: string, xml: string) => ({ path, data: enc.encode(xml) });
const MAIN = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** Minimal package, written the way spreadsheet apps do it, for features our exporter does not emit. */
function pack(sheetXml: string, extra: { path: string; data: Uint8Array }[] = [], workbookExtra = '') {
  return zipStore([
    part('_rels/.rels', '<Relationships><Relationship Id="rId1" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    part('xl/workbook.xml', `<workbook ${MAIN}>${workbookExtra}<sheets><sheet name="Veri" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    part('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    part('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet ${MAIN}>${sheetXml}</worksheet>`),
    ...extra,
  ]);
}

const sheet: ExportSheet = {
  name: 'Satışlar',
  data: [
    ['Ürün', 'Adet', 'Tarih', 'Toplam'],
    ['Çay <&>', 2, dateToSerial(2026, 10, 30), '=B2*3'],
    ['Kahve', true, null, '=SUM(B2:B2)'],
  ],
  values: [
    ['Ürün', 'Adet', 'Tarih', 'Toplam'],
    ['Çay <&>', 2, dateToSerial(2026, 10, 30), 6],
    ['Kahve', true, null, 2],
  ],
  colWidths: [120, 80],
  rowHeights: [32],
  frozen: { rows: 1, cols: 1 },
  merges: [{ row: 2, col: 2, rowspan: 1, colspan: 2 }],
  format: (r, c) =>
    r === 0
      ? { bold: true, strike: true, background: '#ddeeff', color: '#cf222e', align: 'center', wrap: true }
      : c === 2 ? { numberFormat: 'dd.mm.yyyy' } : undefined,
};

describe('readXLSX', () => {
  it('round-trips our own export, compressed or not', async () => {
    for (const bytes of [toXLSX([sheet]), await toXLSXCompressed([sheet])]) {
      const { sheets } = await readXLSX(bytes);
      const s = sheets[0];
      expect(s.name).toBe('Satışlar');
      expect(s.data[1][0]).toBe('Çay <&>');
      expect(s.data[1][3]).toBe('=B2*3');
      expect(s.values![1][3]).toBe(6);
      expect(s.data[2][1]).toBe(true);
      expect(s.frozen).toEqual({ rows: 1, cols: 1 });
      expect(s.merges).toEqual([{ row: 2, col: 2, rowspan: 1, colspan: 2 }]);
      expect(s.colWidths).toEqual([120, 80]);
      expect(s.rowHeights![0]).toBe(32);
      expect(s.format(0, 0)).toEqual({ bold: true, strike: true, background: '#ddeeff', color: '#cf222e', align: 'center', wrap: true });
      expect(s.format(1, 2)).toEqual({ numberFormat: 'dd.mm.yyyy' });
    }
  });

  it('keeps text that looks like something else as text', async () => {
    const xml = '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>00123</t></is></c><c r="B1" t="inlineStr"><is><t>=1+1</t></is></c><c r="C1" t="inlineStr"><is><t>TRUE</t></is></c></row></sheetData>';
    const { sheets: [s] } = await readXLSX(pack(xml));
    expect(s.data[0]).toEqual(["'00123", "'=1+1", "'TRUE"]);
  });

  it('expands shared formulas, strips function prefixes and leaves array areas free to spill', async () => {
    const xml = `<sheetData>
      <row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="shared" ref="B1:B3" si="0">A1*2+$A$1</f><v>3</v></c><c r="C1"><f>_xlfn.XLOOKUP(1,A1:A3,A1:A3)</f><v>1</v></c></row>
      <row r="2"><c r="A2"><v>2</v></c><c r="B2"><f t="shared" si="0"/><v>5</v></c></row>
      <row r="3"><c r="A3"><v>3</v></c><c r="B3"><f t="shared" si="0"/><v>7</v></c></row>
      <row r="4"><c r="A4"><f t="array" ref="A4:B4">_xlfn._xlws.SORT(A1:B1)</f><v>1</v></c><c r="B4"><v>3</v></c></row>
    </sheetData>`;
    const { sheets: [s] } = await readXLSX(pack(xml));
    expect(s.data[1][1]).toBe('=A2*2+$A$1');
    expect(s.data[2][1]).toBe('=A3*2+$A$1');
    expect(s.data[0][2]).toBe('=XLOOKUP(1,A1:A3,A1:A3)');
    expect(s.data[3][0]).toBe('=SORT(A1:B1)');
    expect(s.data[3][1]).toBeNull();
    const values = await readXLSX(pack(xml), { formulas: 'values' });
    expect(values.sheets[0].data[1][1]).toBe(5);
  });

  it('reads shared strings with rich text and ignores phonetic runs', async () => {
    const sst = part('xl/sharedStrings.xml', '<sst><si><r><t>Mer</t></r><r><t xml:space="preserve">haba </t></r><rPh><t>x</t></rPh></si></sst>');
    const { sheets: [s] } = await readXLSX(pack('<sheetData><row r="1"><c r="B1" t="s"><v>0</v></c></row></sheetData>', [sst]));
    expect(s.data[0][1]).toBe('Merhaba ');
  });

  it('resolves theme, tinted and indexed colors, and leaves the default font color to the grid', async () => {
    const theme = part('xl/theme/theme1.xml', '<a:theme xmlns:a="x"><a:themeElements><a:clrScheme><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme></a:themeElements></a:theme>');
    const styles = part('xl/styles.xml', `<styleSheet>
      <fonts><font><color theme="1"/></font><font><b/><color indexed="10"/></font></fonts>
      <fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor theme="4" tint="0.5"/></patternFill></fill></fills>
      <cellXfs><xf numFmtId="0" fontId="0" fillId="0"/><xf numFmtId="14" fontId="1" fillId="2"><alignment horizontal="right"/></xf></cellXfs>
    </styleSheet>`);
    const { sheets: [s] } = await readXLSX(pack('<sheetData><row r="1"><c r="A1" s="1"><v>46000</v></c><c r="B1"><v>1</v></c></row></sheetData>', [theme, styles]));
    expect(s.format(0, 0)).toEqual({ numberFormat: 'mm-dd-yy', bold: true, color: '#ff0000', background: '#a2b9e2', align: 'right' });
    expect(s.format(0, 1)).toBeUndefined();
  });

  it('handles 1904 dates, hidden columns and defined names, and skips style-only rows', async () => {
    const styles = part('xl/styles.xml', '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>');
    const xml = '<cols><col min="2" max="3" width="20" customWidth="1" hidden="1"/></cols><sheetData><row r="1"><c r="A1" s="1"><v>100</v></c><c r="C1"><v>1</v></c></row><row r="1000000"><c r="A1000000" s="1"/></row></sheetData>';
    const names = '<workbookPr date1904="1"/><definedNames><definedName name="Oran">Veri!$A$1</definedName><definedName name="_xlnm.Print_Area" localSheetId="0">Veri!$A$1</definedName></definedNames>';
    const book = await readXLSX(pack(xml, [styles], names));
    expect(book.sheets[0].data).toEqual([[1562, null, 1]]);
    expect(book.sheets[0].hiddenColumns).toEqual([1, 2]);
    expect(book.names).toEqual([{ name: 'Oran', expression: '=Veri!$A$1' }]);
  });

  it('rejects what is not a workbook and limits the unpacked size', async () => {
    await expect(readXLSX(enc.encode('hello'))).rejects.toThrow();
    await expect(readXLSX(zipStore([part('a.txt', 'x')]))).rejects.toThrow('Not an .xlsx workbook');
    const big = await zipDeflate([part('xl/workbook.xml', 'x'.repeat(100000))]);
    await expect(new ZipReader(big, { maxSize: 1000 }).read('xl/workbook.xml')).rejects.toThrow('too large');
  });

  it('detects a corrupted entry', async () => {
    const bytes = zipStore([part('a.txt', 'hello')]);
    bytes[bytes.indexOf(0x68)] = 0x6a;
    await expect(new ZipReader(bytes).read('a.txt')).rejects.toThrow('checksum');
  });

  it('builds an engine where sheets see each other in any order', async () => {
    const book = await readXLSX(toXLSX([{ name: 'A', data: [['=B!A1+Oran']] }, { name: 'B', data: [[41]] }]));
    book.names.push({ name: 'Oran', expression: '=1' });
    const engine = workbookEngine(book);
    engine.setSheetContent(book.sheets[0].data, 0);
    engine.setSheetContent(book.sheets[1].data, 1);
    expect(engine.getCellValue({ row: 0, col: 0, sheet: 0 })).toBe(42);
  });
});

describe('format mapping', () => {
  it('maps date codes to grid patterns where it can', () => {
    expect(patternFromDateCode('dd.mm.yyyy')).toBe('DD.MM.YYYY');
    expect(patternFromDateCode('yyyy-mm-dd hh:mm:ss')).toBe('YYYY-MM-DD HH:mm:ss');
    expect(patternFromDateCode('[$-41F]d/m/yy')).toBe('D/M/YY');
    expect(patternFromDateCode('h:mm AM/PM')).toBeUndefined();
    expect(patternFromDateCode('d mmmm yyyy')).toBeUndefined();
  });

  it('maps number codes to display settings', () => {
    expect(numericFormatFromCode('#,##0.00')).toEqual({ style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });
    expect(numericFormatFromCode('0%')).toMatchObject({ style: 'percent', maximumFractionDigits: 0 });
    expect(numericFormatFromCode('#,##0.00 "₺"')).toMatchObject({ style: 'currency', currency: 'TRY' });
    expect(numericFormatFromCode('[$€-407] #,##0.00')).toMatchObject({ style: 'currency', currency: 'EUR' });
    expect(numericFormatFromCode('0.00E+00')).toBeUndefined();
    expect(numericFormatFromCode('General')).toBeUndefined();
  });

  it('keeps the original code for export', () => {
    expect(metaFromFormat({ numberFormat: '0.0"kg"' }).formatCode).toBe('0.0"kg"');
    expect(metaFromFormat({ numberFormat: '@' })).toEqual({});
  });
});

describe('scanXml', () => {
  it('skips DOCTYPE, does not expand custom entities and rejects truncated markup', () => {
    let text = '';
    scanXml('<!DOCTYPE a [<!ENTITY x "boom">]><a b="1>2">&x;&amp;<![CDATA[<c>]]>&#x41;</a>', { text: (t) => (text += t) });
    expect(text).toBe('&x;&<c>A');
    expect(() => scanXml('<a b="', {})).toThrow('Malformed');
  });
});
