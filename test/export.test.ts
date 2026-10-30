// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  crc32,
  dateCodeFromPattern,
  formatDateCode,
  isDateFormat,
  numberFormatFromMeta,
  pxToColWidth,
  sanitizeSheetNames,
  toCSV,
  toXLSX,
  toXLSXCompressed,
  type ExportSheet,
} from '../src/export';
import { dateToSerial } from '../src/formula/dates';
import { CellError } from '../src/formula/values';

// The project ships no Node typings, so Node-only modules are loaded untyped.
const load = (name: string): Promise<any> => import(name);
const zlib = await load('node:zlib');
const { JSDOM } = await load('jsdom');
const inflateRawSync: (b: Uint8Array) => Uint8Array = zlib.inflateRawSync;

// ---- minimal ZIP reader (independent of the writer) ----

interface ReadEntry {
  method: number;
  crc: number;
  data: Uint8Array;
}

function readZip(buf: Uint8Array): Map<string, ReadEntry> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = buf.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  expect(eocd).toBe(buf.length - 22); // no archive comment
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  let p = dv.getUint32(eocd + 16, true);
  expect(p + cdSize).toBe(eocd);
  const dec = new TextDecoder();
  const out = new Map<string, ReadEntry>();
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(p, true)).toBe(0x02014b50);
    const flags = dv.getUint16(p + 8, true);
    expect(flags & 0x0800).toBe(0x0800);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
    // Local header must agree with the central directory.
    expect(dv.getUint32(off, true)).toBe(0x04034b50);
    expect(dv.getUint16(off + 8, true)).toBe(method);
    expect(dv.getUint32(off + 14, true)).toBe(crc);
    expect(dv.getUint32(off + 18, true)).toBe(csize);
    expect(dv.getUint32(off + 22, true)).toBe(usize);
    const lnlen = dv.getUint16(off + 26, true);
    const lxlen = dv.getUint16(off + 28, true);
    expect(dec.decode(buf.subarray(off + 30, off + 30 + lnlen))).toBe(name);
    const start = off + 30 + lnlen + lxlen;
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? raw : new Uint8Array(inflateRawSync(raw));
    expect([0, 8]).toContain(method);
    expect(data.length).toBe(usize);
    out.set(name, { method, crc, data });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

const nodeCrc: ((d: Uint8Array) => number) | undefined = zlib.crc32;

function parts(buf: Uint8Array): Record<string, string> {
  const dec = new TextDecoder();
  const res: Record<string, string> = {};
  for (const [name, e] of readZip(buf)) {
    expect(crc32(e.data)).toBe(e.crc);
    if (nodeCrc) expect(nodeCrc(e.data)).toBe(e.crc);
    res[name] = dec.decode(e.data);
  }
  return res;
}

const parser: DOMParser = new new JSDOM('').window.DOMParser();
function xmlDoc(text: string): Document {
  const doc = parser.parseFromString(text, 'application/xml');
  expect(doc.getElementsByTagName('parsererror').length, text.slice(0, 200)).toBe(0);
  return doc;
}
const all = (doc: Document | Element, tag: string): Element[] => Array.from(doc.getElementsByTagName(tag));

// ---- CRC ----

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

// ---- CSV ----

describe('toCSV', () => {
  const sheet: ExportSheet = {
    name: 'S',
    data: [
      ['Name', 'Note', 'Amount'],
      ['a,b', 'say "hi"', 1.5],
      ['line\nbreak', ' padded', '=C2*2'],
      [true, null, '=1/0'],
    ],
    values: [
      ['Name', 'Note', 'Amount'],
      ['a,b', 'say "hi"', 1.5],
      ['line\nbreak', ' padded', 3],
      [true, null, new CellError('#DIV/0!')],
    ],
  };

  it('quotes per RFC 4180 and adds a BOM by default', () => {
    const csv = toCSV(sheet);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Name,Note,Amount',
      '"a,b","say ""hi""",1.5',
      '"line\nbreak"," padded",3',
      'TRUE,,#DIV/0!',
    ]);
  });

  it('supports delimiter, line ending, decimal comma and no BOM', () => {
    const csv = toCSV(sheet, { delimiter: ';', lineEnding: '\n', bom: false, decimalSeparator: ',' });
    expect(csv.split('\n')[1]).toBe('a,b;"say ""hi""";1,5');
    expect(csv.startsWith('Name;')).toBe(true);
  });

  it('quotes fields containing a decimal comma when the delimiter is a comma', () => {
    expect(toCSV({ name: 'x', data: [[1.5]] }, { bom: false, decimalSeparator: ',' })).toBe('"1,5"');
  });

  it('writes raw input with values: "raw"', () => {
    const csv = toCSV(sheet, { values: 'raw', bom: false });
    expect(csv.split('\r\n')[2]).toBe('"line\nbreak"," padded",=C2*2');
  });

  it('falls back to formula text / literals without computed values and pads ragged rows', () => {
    const csv = toCSV({ name: 'x', data: [['=A2', 'x'], ['5']] }, { bom: false });
    expect(csv).toBe('=A2,x\r\n5,');
  });

  it('formats dates as text when a date format applies', () => {
    const serial = dateToSerial(2026, 3, 7);
    const s: ExportSheet = {
      name: 'd',
      data: [[serial, serial + 0.5, serial]],
      format: (_r, c) => ({ numberFormat: ['dd.mm.yyyy', 'yyyy-mm-dd hh:mm', '0.00'][c] }),
    };
    expect(toCSV(s, { bom: false })).toBe(`07.03.2026,2026-03-07 12:00,${serial}`);
  });
});

// ---- format codes ----

describe('number formats', () => {
  it('detects date codes', () => {
    expect(isDateFormat('dd.mm.yyyy')).toBe(true);
    expect(isDateFormat('[h]:mm')).toBe(true);
    expect(isDateFormat('#,##0.00 "₺"')).toBe(false);
    expect(isDateFormat('[$-41F]0.00')).toBe(false);
    expect(isDateFormat('General')).toBe(false);
    expect(isDateFormat('0%')).toBe(false);
  });

  it('formats date codes, telling minutes from months', () => {
    const s = dateToSerial(2026, 1, 9) + (13 * 3600 + 5 * 60 + 7) / 86400;
    expect(formatDateCode(s, 'd/m/yy h:mm:ss')).toBe('9/1/26 13:05:07');
    expect(formatDateCode(s, 'hh:mm AM/PM')).toBe('01:05 PM');
    expect(formatDateCode(s, 'mmm yyyy', 'en-US')).toBe('Jan 2026');
    expect(formatDateCode(s, '"Day "dd\\!')).toBe('Day 09!');
  });

  it('maps grid metadata to format codes', () => {
    expect(numberFormatFromMeta({ type: 'date' }, 'tr-TR')).toBe('dd.mm.yyyy');
    expect(numberFormatFromMeta({ type: 'date' }, 'en-US')).toBe('yyyy-mm-dd');
    expect(dateCodeFromPattern('DD/MM/YYYY HH:mm')).toBe('dd/mm/yyyy hh:mm');
    expect(numberFormatFromMeta({ numericFormat: { style: 'percent' } })).toBe('#,##0%');
    expect(numberFormatFromMeta({ numericFormat: { style: 'percent', minimumFractionDigits: 1, useGrouping: false } })).toBe('0.0%');
    expect(numberFormatFromMeta({ numericFormat: { minimumFractionDigits: 2 } })).toBe('#,##0.00');
    expect(numberFormatFromMeta({ numericFormat: { minimumFractionDigits: 0, maximumFractionDigits: 2 } })).toBe('#,##0.##');
    expect(numberFormatFromMeta({ numericFormat: {} })).toBeUndefined();
    expect(numberFormatFromMeta({})).toBeUndefined();
    const tl = numberFormatFromMeta({ numericFormat: { style: 'currency', currency: 'TRY' } }, 'tr-TR')!;
    expect(tl).toMatch(/#,##0\.00/);
    expect(tl).toContain('"₺"');
    const eur = numberFormatFromMeta({ numericFormat: { style: 'currency', currency: 'EUR' } }, 'de-DE')!;
    expect(eur).toBe('#,##0.00 "€"');
    expect(numberFormatFromMeta({ numericFormat: { style: 'currency', currency: 'USD' } }, 'en-US')).toBe('"$"#,##0.00');
  });
});

// ---- XLSX ----

describe('sheet names', () => {
  it('sanitizes, truncates to 31 chars and de-duplicates case-insensitively', () => {
    const names = sanitizeSheetNames(['Q1/Q2: [draft]?', "'quoted'", '', 'Data', 'data', 'x'.repeat(40), 'x'.repeat(40)]);
    expect(names[0]).toBe('Q1_Q2_ _draft__');
    expect(names[1]).toBe('quoted');
    expect(names[2]).toBe('Sheet3');
    expect(names[3]).toBe('Data');
    expect(names[4]).toBe('data (2)');
    expect(names[5]).toBe('x'.repeat(31));
    expect(names[6]).toBe('x'.repeat(27) + ' (2)');
    for (const n of names) expect([...n].length).toBeLessThanOrEqual(31);
  });
});

describe('toXLSX', () => {
  const date = dateToSerial(2026, 10, 30);
  const sheets: ExportSheet[] = [
    {
      name: 'Sales & <Co>',
      data: [
        ['Item', 'Qty', 'Price', 'Total', 'When'],
        ['Tea "green"', 2, 1.25, '=B2*C2', date],
        [' lead space', 3, 2, '=B3*C3', null],
        [true, '=1/0', '=A2', '=B2>1', '=Z99'],
        ['Item', "'007", '', '=CYCLE()', 'a\u0001b'],
      ],
      values: [
        ['Item', 'Qty', 'Price', 'Total', 'When'],
        ['Tea "green"', 2, 1.25, 2.5, date],
        [' lead space', 3, 2, 6, null],
        [true, new CellError('#DIV/0!'), 'Tea "green"', true, null],
        ['Item', '007', null, new CellError('#CYCLE!'), 'a\u0001b'],
      ],
      colWidths: [120, 60],
      rowHeights: [30, undefined as unknown as number, 0, 0, 0, 40],
      frozen: { rows: 1, cols: 1 },
      merges: [
        { row: 0, col: 3, rowspan: 1, colspan: 2 },
        { row: 0, col: 4, rowspan: 2, colspan: 1 }, // overlaps the first -> dropped
        { row: 5, col: 0, rowspan: 1, colspan: 1 }, // 1x1 -> dropped
      ],
      autoFilter: { row: 0, col: 0, rows: 5, cols: 5 },
      format: (r, c) => {
        if (r === 0) return { bold: true, background: '#ffeeaa', align: 'center' };
        if (c === 2) return { numberFormat: '#,##0.00 "₺"' };
        if (c === 3) return { numberFormat: '#,##0.00 "₺"', color: '#c00' };
        if (c === 4) return { numberFormat: 'dd.mm.yyyy', wrap: true };
        return undefined;
      },
    },
    { name: 'Sales & <Co>', data: [['only rows frozen']], frozen: { rows: 2, cols: 0 } },
    { name: 'x'.repeat(40), data: [] },
  ];
  const file = toXLSX(sheets, { creator: 'Ada & Co', modified: new Date('2026-10-30T12:00:00Z') });
  const p = parts(file);

  it('contains every required package part, all well-formed', () => {
    expect(Object.keys(p).sort()).toEqual(
      [
        '[Content_Types].xml',
        '_rels/.rels',
        'docProps/app.xml',
        'docProps/core.xml',
        'xl/_rels/workbook.xml.rels',
        'xl/sharedStrings.xml',
        'xl/styles.xml',
        'xl/workbook.xml',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/sheet2.xml',
        'xl/worksheets/sheet3.xml',
      ].sort(),
    );
    for (const text of Object.values(p)) xmlDoc(text);
    expect(Object.keys(p)[0]).toBe('[Content_Types].xml');
  });

  it('declares content types and relationships that resolve', () => {
    const ct = xmlDoc(p['[Content_Types].xml']);
    const overrides = all(ct, 'Override').map((o) => o.getAttribute('PartName')!.slice(1));
    for (const name of Object.keys(p)) if (!name.endsWith('.rels') && name !== '[Content_Types].xml') expect(overrides).toContain(name);
    const rels = all(xmlDoc(p['xl/_rels/workbook.xml.rels']), 'Relationship');
    for (const r of rels) expect(p['xl/' + r.getAttribute('Target')]).toBeDefined();
    const wbSheets = all(xmlDoc(p['xl/workbook.xml']), 'sheet');
    const ids = rels.map((r) => r.getAttribute('Id'));
    for (const s of wbSheets) expect(ids).toContain(s.getAttribute('r:id'));
    for (const r of all(xmlDoc(p['_rels/.rels']), 'Relationship')) expect(p[r.getAttribute('Target')!]).toBeDefined();
  });

  it('writes sanitized, unique sheet names and the filter database name', () => {
    const wb = xmlDoc(p['xl/workbook.xml']);
    expect(all(wb, 'sheet').map((s) => s.getAttribute('name'))).toEqual(['Sales & <Co>', 'Sales & <Co> (2)', 'x'.repeat(31)]);
    expect(p['xl/workbook.xml']).toContain('name="Sales &amp; &lt;Co&gt;"');
    const dn = all(wb, 'definedName');
    expect(dn).toHaveLength(1);
    expect(dn[0].getAttribute('name')).toBe('_xlnm._FilterDatabase');
    expect(dn[0].textContent).toBe("'Sales & <Co>'!$A$1:$E$5");
  });

  it('writes core properties with escaped creator', () => {
    expect(p['docProps/core.xml']).toContain('<dc:creator>Ada &amp; Co</dc:creator>');
    expect(p['docProps/core.xml']).toContain('2026-10-30T12:00:00Z');
    expect(p['docProps/app.xml']).toContain('<vt:i4>3</vt:i4>');
  });

  const s1 = () => xmlDoc(p['xl/worksheets/sheet1.xml']);
  const cell = (doc: Document, r: string) => all(doc, 'c').find((c) => c.getAttribute('r') === r);

  it('writes formulas without "=" and cached values with the right types', () => {
    const d = s1();
    const d2 = cell(d, 'D2')!;
    expect(d2.getElementsByTagName('f')[0].textContent).toBe('B2*C2');
    expect(d2.getElementsByTagName('v')[0].textContent).toBe('2.5');
    expect(d2.getAttribute('t')).toBeNull();
    const b4 = cell(d, 'B4')!;
    expect([b4.getAttribute('t'), b4.textContent]).toEqual(['e', '1/0#DIV/0!']);
    const c4 = cell(d, 'C4')!;
    expect(c4.getAttribute('t')).toBe('str');
    expect(c4.getElementsByTagName('v')[0].textContent).toBe('Tea "green"');
    expect(cell(d, 'D4')!.getAttribute('t')).toBe('b');
    expect(cell(d, 'D4')!.getElementsByTagName('v')[0].textContent).toBe('1');
    // Formula without a computed value keeps only <f>.
    expect(cell(d, 'E4')!.getElementsByTagName('v')).toHaveLength(0);
    // Engine-only error codes degrade to a code the file format knows.
    expect(cell(d, 'D5')!.getElementsByTagName('v')[0].textContent).toBe('#VALUE!');
    expect(p['xl/worksheets/sheet1.xml']).toContain('<f>B2&gt;1</f>');
  });

  it('writes literals: numbers, booleans, dates as serials, shared strings', () => {
    const d = s1();
    expect(cell(d, 'B2')!.textContent).toBe('2');
    expect(cell(d, 'E2')!.textContent).toBe(String(date));
    expect([cell(d, 'A4')!.getAttribute('t'), cell(d, 'A4')!.textContent]).toEqual(['b', '1']);
    const sst = xmlDoc(p['xl/sharedStrings.xml']);
    const strings = all(sst, 'si').map((si) => si.textContent);
    const at = (r: string) => strings[Number(cell(d, r)!.textContent)];
    expect(cell(d, 'A1')!.getAttribute('t')).toBe('s');
    expect(at('A2')).toBe('Tea "green"');
    expect(at('A3')).toBe(' lead space');
    expect(at('B5')).toBe('007'); // apostrophe prefix forces text
    expect(at('E5')).toBe('ab'); // invalid XML control char dropped
    expect(p['xl/sharedStrings.xml']).toContain('<t xml:space="preserve"> lead space</t>');
    // "Item" appears twice (A1, A5) and once on no other sheet; sheet2 adds one string.
    const root = sst.documentElement;
    expect(Number(root.getAttribute('uniqueCount'))).toBe(strings.length);
    expect(new Set(strings).size).toBe(strings.length);
    expect(Number(root.getAttribute('count'))).toBe(strings.length + 1);
  });

  it('writes frozen panes, column widths, row heights, merges and autofilter in schema order', () => {
    const xml = p['xl/worksheets/sheet1.xml'];
    const order = ['<dimension', '<sheetViews', '<sheetFormatPr', '<cols', '<sheetData', '<autoFilter', '<mergeCells', '<pageMargins'];
    const idx = order.map((t) => xml.indexOf(t));
    expect(idx.every((i) => i > 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    const d = s1();
    expect(d.getElementsByTagName('dimension')[0].getAttribute('ref')).toBe('A1:E5');
    const pane = d.getElementsByTagName('pane')[0];
    expect([pane.getAttribute('xSplit'), pane.getAttribute('ySplit'), pane.getAttribute('topLeftCell'), pane.getAttribute('state'), pane.getAttribute('activePane')]).toEqual(['1', '1', 'B2', 'frozen', 'bottomRight']);
    const cols = all(d, 'col');
    expect(cols.map((c) => c.getAttribute('width'))).toEqual([String(pxToColWidth(120)), String(pxToColWidth(60))]);
    expect(pxToColWidth(68)).toBe(9);
    const rows = all(d, 'row');
    expect(rows[0].getAttribute('ht')).toBe('22.5');
    expect(rows[1].getAttribute('ht')).toBeNull();
    expect(rows.at(-1)!.getAttribute('r')).toBe('6'); // height-only row beyond the data
    expect(rows.at(-1)!.getAttribute('ht')).toBe('30');
    expect(all(d, 'mergeCell').map((m) => m.getAttribute('ref'))).toEqual(['D1:E1']);
    expect(d.getElementsByTagName('mergeCells')[0].getAttribute('count')).toBe('1');
    expect(d.getElementsByTagName('autoFilter')[0].getAttribute('ref')).toBe('A1:E5');
    expect(d.getElementsByTagName('sheetView')[0].getAttribute('tabSelected')).toBe('1');

    const d2 = xmlDoc(p['xl/worksheets/sheet2.xml']);
    const pane2 = d2.getElementsByTagName('pane')[0];
    expect([pane2.getAttribute('xSplit'), pane2.getAttribute('ySplit'), pane2.getAttribute('activePane'), pane2.getAttribute('topLeftCell')]).toEqual([null, '2', 'bottomLeft', 'A3']);
    const d3 = xmlDoc(p['xl/worksheets/sheet3.xml']);
    expect(d3.getElementsByTagName('dimension')[0].getAttribute('ref')).toBe('A1');
  });

  it('writes deduplicated styles with the mandatory defaults', () => {
    const st = xmlDoc(p['xl/styles.xml']);
    const numFmts = all(st, 'numFmt');
    expect(numFmts.map((n) => [n.getAttribute('numFmtId'), n.getAttribute('formatCode')])).toEqual([
      ['164', '#,##0.00 "₺"'],
      ['165', 'dd.mm.yyyy'],
    ]);
    expect(st.getElementsByTagName('numFmts')[0].getAttribute('count')).toBe('2');
    const fills = all(st, 'patternFill').map((f) => f.getAttribute('patternType'));
    expect(fills).toEqual(['none', 'gray125', 'solid']);
    expect(st.getElementsByTagName('fgColor')[0].getAttribute('rgb')).toBe('FFFFEEAA');
    const fonts = all(st, 'font');
    expect(fonts).toHaveLength(3); // default, bold header, red
    expect(st.getElementsByTagName('fonts')[0].getAttribute('count')).toBe('3');
    expect(st.getElementsByTagName('color')[0].getAttribute('rgb')).toBe('FFCC0000');
    expect(all(st, 'border')).toHaveLength(1);
    expect(all(st.getElementsByTagName('cellStyleXfs')[0], 'xf')).toHaveLength(1);
    const xfs = all(st.getElementsByTagName('cellXfs')[0], 'xf');
    // default, header, price, total, date
    expect(xfs).toHaveLength(5);
    expect(st.getElementsByTagName('cellXfs')[0].getAttribute('count')).toBe('5');
    expect(new Set(xfs.map((x) => x.outerHTML)).size).toBe(5);
    const d = s1();
    const xfOf = (r: string) => xfs[Number(cell(d, r)!.getAttribute('s') ?? 0)];
    expect(xfOf('A1').getElementsByTagName('alignment')[0].getAttribute('horizontal')).toBe('center');
    expect(xfOf('E2').getAttribute('numFmtId')).toBe('165');
    expect(xfOf('E2').getElementsByTagName('alignment')[0].getAttribute('wrapText')).toBe('1');
    expect(cell(d, 'C2')!.getAttribute('s')).toBe(cell(d, 'C3')!.getAttribute('s'));
    expect(cell(d, 'B2')!.getAttribute('s')).toBeNull();
    // A styled but empty cell is still written so its format survives.
    expect(cell(d, 'E3')!.getAttribute('s')).toBe(cell(d, 'E2')!.getAttribute('s'));
    expect(p['xl/styles.xml']).toContain('formatCode="#,##0.00 &quot;₺&quot;"');
  });

  it('maps built-in format codes to built-in ids', () => {
    const q = parts(toXLSX([{ name: 'p', data: [[0.5, 1]], format: (_r, c) => ({ numberFormat: c ? '#,##0.00' : '0%' }) }]));
    const st = xmlDoc(q['xl/styles.xml']);
    expect(st.getElementsByTagName('numFmts')).toHaveLength(0);
    expect(all(st.getElementsByTagName('cellXfs')[0], 'xf').map((x) => x.getAttribute('numFmtId'))).toEqual(['0', '9', '4']);
  });

  it('rejects an empty workbook', () => {
    expect(() => toXLSX([])).toThrow();
  });

  it('produces a DEFLATE variant with identical parts', async () => {
    const z = await toXLSXCompressed(sheets, { creator: 'Ada & Co', modified: new Date('2026-10-30T12:00:00Z') });
    expect(z.length).toBeLessThan(file.length);
    const methods = [...readZip(z).values()].map((e) => e.method);
    expect(methods).toContain(8);
    expect(parts(z)).toEqual(p);
  });
});

describe('CSV injection protection', () => {
  it('prefixes risky text but leaves numbers and raw formulas alone', async () => {
    const { toCSV } = await import('../src/export');
    const sheet = { name: 'S', data: [['=1+1', '+cmd', -5, '@x', 'ok']], values: [[2, '+cmd', -5, '@x', 'ok']] };
    expect(toCSV(sheet, { bom: false })).toBe("2,'+cmd,-5,'@x,ok");
    expect(toCSV(sheet, { bom: false, values: 'raw' })).toBe("=1+1,'+cmd,-5,'@x,ok");
    expect(toCSV(sheet, { bom: false, escapeFormulas: false })).toBe('2,+cmd,-5,@x,ok');
  });
});
