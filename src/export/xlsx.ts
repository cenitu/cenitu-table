import { columnLabel, MAX_COLS, MAX_ROWS } from '../formula/address';
import { CellError, isFormula, parseLiteral, type CellValue } from '../formula/values';
import { StyleRegistry } from './styles';
import type { ExportMerge, ExportSheet, ExportValidation } from './types';
import { attrs, escapeXml, XML_DECL } from './xml';
import { zipDeflate, zipStore, type ZipEntry } from './zip';

export interface XlsxOptions {
  /** Author written to docProps/core.xml. */
  creator?: string;
  /** Creation/modification time (default now); fixed values make output reproducible. */
  modified?: Date;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

// Spreadsheet apps reject cells longer than this.
const MAX_CELL_TEXT = 32767;
// Only these codes are valid in t="e" cells; engine-specific codes degrade to #VALUE!.
const FILE_ERRORS = new Set(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A']);

/**
 * Makes sheet names valid (no : \ / ? * [ ], no leading/trailing apostrophe, 1-31 chars) and
 * unique case-insensitively, as spreadsheet apps require.
 */
export function sanitizeSheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw, i) => {
    let base = raw.replace(/[:\\/?*[\]]/g, '_').replace(/^'+|'+$/g, '').trim();
    if (!base) base = `Sheet${i + 1}`;
    base = [...base].slice(0, 31).join('');
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      name = [...base].slice(0, 31 - suffix.length).join('') + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

/** px -> column width in characters of the default font's max digit width (7 px + 5 px padding). */
export const pxToColWidth = (px: number): number => Math.max(0, Math.round(((px - 5) / 7) * 256) / 256);

/** px -> points (96 dpi). */
export const pxToPt = (px: number): number => Math.round(px * 0.75 * 100) / 100;

const ref = (row: number, col: number): string => `${columnLabel(col)}${row + 1}`;
const rangeRef = (row: number, col: number, rows: number, cols: number): string =>
  `${ref(row, col)}:${ref(row + rows - 1, col + cols - 1)}`;

class SharedStrings {
  private readonly index = new Map<string, number>();
  private readonly list: string[] = [];
  count = 0;
  add(s: string): number {
    this.count++;
    let i = this.index.get(s);
    if (i === undefined) {
      i = this.list.push(s) - 1;
      this.index.set(s, i);
    }
    return i;
  }
  toXml(): string {
    const items = this.list.map((s) => `<si>${textEl(s)}</si>`).join('');
    return `${XML_DECL}<sst xmlns="${NS_MAIN}" count="${this.count}" uniqueCount="${this.list.length}">${items}</sst>`;
  }
}

/** <t> element; leading/trailing whitespace and newlines survive only with xml:space. */
const textEl = (s: string): string =>
  `<t${/^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : ''}>${escapeXml(s.slice(0, MAX_CELL_TEXT))}</t>`;

function fileError(e: CellError): string {
  return FILE_ERRORS.has(e.code) ? e.code : '#VALUE!';
}

/** Cell XML for a literal (non-formula) value. */
function literalCell(r: string, s: string, v: CellValue, sst: SharedStrings): string {
  if (v === null) return s ? `<c r="${r}"${s}/>` : '';
  if (typeof v === 'number') {
    return Number.isFinite(v) ? `<c r="${r}"${s}><v>${v}</v></c>` : `<c r="${r}"${s} t="e"><v>#NUM!</v></c>`;
  }
  if (typeof v === 'boolean') return `<c r="${r}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
  if (v instanceof CellError) return `<c r="${r}"${s} t="e"><v>${fileError(v)}</v></c>`;
  return `<c r="${r}"${s} t="s"><v>${sst.add(v.slice(0, MAX_CELL_TEXT))}</v></c>`;
}

/** Cell XML for a formula with its cached result. */
function formulaCell(r: string, s: string, formula: string, v: CellValue | undefined): string {
  const f = `<f>${escapeXml(formula.slice(1))}</f>`;
  if (v === null || v === undefined) return `<c r="${r}"${s}>${f}</c>`;
  if (typeof v === 'number') {
    return Number.isFinite(v) ? `<c r="${r}"${s}>${f}<v>${v}</v></c>` : `<c r="${r}"${s} t="e">${f}<v>#NUM!</v></c>`;
  }
  if (typeof v === 'boolean') return `<c r="${r}"${s} t="b">${f}<v>${v ? 1 : 0}</v></c>`;
  if (v instanceof CellError) return `<c r="${r}"${s} t="e">${f}<v>${fileError(v)}</v></c>`;
  return `<c r="${r}"${s} t="str">${f}<v>${escapeXml(v.slice(0, MAX_CELL_TEXT))}</v></c>`;
}

/** Drops 1x1 and overlapping merges, which would make the file need repair. */
function validMerges(merges: ExportMerge[] | undefined): ExportMerge[] {
  const kept: ExportMerge[] = [];
  for (const m of merges ?? []) {
    if (m.rowspan < 1 || m.colspan < 1 || m.rowspan * m.colspan < 2 || m.row < 0 || m.col < 0) continue;
    const overlaps = kept.some(
      (k) => m.row < k.row + k.rowspan && k.row < m.row + m.rowspan && m.col < k.col + k.colspan && k.col < m.col + m.colspan,
    );
    if (!overlaps) kept.push(m);
  }
  return kept;
}

function sheetXml(sheet: ExportSheet, index: number, styles: StyleRegistry, sst: SharedStrings): string {
  const rows = sheet.data.length;
  let cols = 0;
  for (const row of sheet.data) cols = Math.max(cols, row?.length ?? 0);
  if (rows > MAX_ROWS || cols > MAX_COLS) throw new RangeError(`Sheet "${sheet.name}" exceeds ${MAX_ROWS} rows or ${MAX_COLS} columns`);

  // Element order below is mandated by the CT_Worksheet schema.
  let xml = `${XML_DECL}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}">`;
  xml += `<dimension ref="${rows && cols ? rangeRef(0, 0, rows, cols) : 'A1'}"/>`;

  const fr = Math.max(0, Math.floor(sheet.frozen?.rows ?? 0));
  const fc = Math.max(0, Math.floor(sheet.frozen?.cols ?? 0));
  const tab = index === 0 ? ' tabSelected="1"' : '';
  if (fr || fc) {
    const pane = fr && fc ? 'bottomRight' : fr ? 'bottomLeft' : 'topRight';
    xml +=
      `<sheetViews><sheetView${tab} workbookViewId="0">` +
      `<pane${attrs({ xSplit: fc || undefined, ySplit: fr || undefined, topLeftCell: ref(fr, fc), activePane: pane, state: 'frozen' })}/>` +
      `<selection pane="${pane}" activeCell="${ref(fr, fc)}" sqref="${ref(fr, fc)}"/>` +
      `</sheetView></sheetViews>`;
  } else {
    xml += `<sheetViews><sheetView${tab} workbookViewId="0"/></sheetViews>`;
  }
  xml += '<sheetFormatPr defaultRowHeight="15"/>';

  const widths = sheet.colWidths ?? [];
  const colEls: string[] = [];
  const hiddenCols = new Set(sheet.hiddenColumns);
  const hiddenRows = new Set(sheet.hiddenRows);
  widths.forEach((px, c) => {
    if (typeof px === 'number' && px > 0 && c < MAX_COLS) {
      colEls.push(`<col min="${c + 1}" max="${c + 1}" width="${pxToColWidth(px)}" customWidth="1"${hiddenCols.has(c) ? ' hidden="1"' : ''}/>`);
    }
  });
  if (colEls.length) xml += `<cols>${colEls.join('')}</cols>`;

  const heights = sheet.rowHeights ?? [];
  const rowCount = Math.min(MAX_ROWS, Math.max(rows, heights.length));
  const out: string[] = [];
  for (let r = 0; r < rowCount; r++) {
    const raw = sheet.data[r] ?? [];
    let cells = '';
    for (let c = 0; c < raw.length; c++) {
      const id = styles.styleId(sheet.format?.(r, c));
      const s = id ? ` s="${id}"` : '';
      const cell = raw[c];
      const a = ref(r, c);
      cells += isFormula(cell) ? formulaCell(a, s, cell, sheet.values?.[r]?.[c]) : literalCell(a, s, parseLiteral(cell), sst);
    }
    const ht = heights[r];
    const htAttr = typeof ht === 'number' && ht > 0 ? ` ht="${pxToPt(ht)}" customHeight="1"` : '';
    const hidden = hiddenRows.has(r) ? ' hidden="1"' : '';
    if (cells || htAttr || hidden) out.push(`<row r="${r + 1}"${htAttr}${hidden}>${cells}</row>`);
  }
  xml += out.length ? `<sheetData>${out.join('')}</sheetData>` : '<sheetData/>';

  const af = sheet.autoFilter;
  if (af && af.rows > 0 && af.cols > 0) xml += `<autoFilter ref="${rangeRef(af.row, af.col, af.rows, af.cols)}"/>`;

  const merges = validMerges(sheet.merges);
  if (merges.length) {
    xml += `<mergeCells count="${merges.length}">`;
    for (const m of merges) xml += `<mergeCell ref="${rangeRef(m.row, m.col, m.rowspan, m.colspan)}"/>`;
    xml += '</mergeCells>';
  }
  const lists = writableValidations(sheet);
  if (lists.length) {
    xml += `<dataValidations count="${lists.length}">`;
    for (const v of lists) {
      const sqref = v.ranges.map((r) => rangeRef(r.row, r.col, r.rows, r.cols)).join(' ');
      xml += `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${sqref}"><formula1>${escapeXml(`"${v.values.join(',')}"`)}</formula1></dataValidation>`;
    }
    xml += '</dataValidations>';
  }
  xml += '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>';
  if (sheet.notes?.length) xml += '<legacyDrawing r:id="rId1"/>';
  return xml + '</worksheet>';
}

/** A list written in the file itself is limited in length and cannot hold commas. */
const writableValidations = (sheet: ExportSheet): ExportValidation[] =>
  (sheet.validations ?? []).filter((v) => v.ranges.length && v.values.length && !v.values.some((s) => s.includes(',')) && v.values.join(',').length <= 255);

function commentsXml(sheet: ExportSheet, creator: string): string {
  const comments = sheet.notes!.map((n) => `<comment ref="${ref(n.row, n.col)}" authorId="0"><text><t xml:space="preserve">${escapeXml(n.text)}</t></text></comment>`);
  return `${XML_DECL}<comments xmlns="${NS_MAIN}"><authors><author>${creator}</author></authors><commentList>${comments.join('')}</commentList></comments>`;
}

/** Apps show a note through a shape in this older drawing format, one per comment. */
function notesDrawing(sheet: ExportSheet, index: number): string {
  const shapes = sheet.notes!.map((n, i) =>
    `<v:shape id="_x0000_s${(index + 1) * 1024 + i + 1}" type="#_x0000_t202" style="position:absolute;margin-left:60pt;margin-top:2pt;width:140pt;height:70pt;z-index:${i + 1};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">` +
    '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/>' +
    '<v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>' +
    `<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:AutoFill>False</x:AutoFill><x:Row>${n.row}</x:Row><x:Column>${n.col}</x:Column></x:ClientData></v:shape>`,
  );
  return '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
    `<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${index + 1}"/></o:shapelayout>` +
    '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>' +
    `${shapes.join('')}</xml>`;
}

const isoDate = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Builds all package parts (paths and bytes) of a workbook. */
export function xlsxParts(sheets: ExportSheet[], opts: XlsxOptions = {}): ZipEntry[] {
  if (!sheets.length) throw new Error('A workbook needs at least one sheet');
  const names = sanitizeSheetNames(sheets.map((s) => s.name));
  const styles = new StyleRegistry();
  const sst = new SharedStrings();
  const sheetParts = sheets.map((s, i) => sheetXml(s, i, styles, sst));
  const when = isoDate(opts.modified ?? new Date());
  const noted = sheets.flatMap((s, i) => (s.notes?.length ? [i] : []));

  const contentTypes =
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    (noted.length ? '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>' : '') +
    `<Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/>` +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT}.worksheet+xml"/>`).join('') +
    noted.map((i) => `<Override PartName="/xl/comments${i + 1}.xml" ContentType="${CT}.comments+xml"/>`).join('') +
    `<Override PartName="/xl/styles.xml" ContentType="${CT}.styles+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="${CT}.sharedStrings+xml"/>` +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>';

  const rootRels =
    `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/>` +
    `<Relationship Id="rId2" Type="${NS_PKG_REL}/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId3" Type="${NS_R}/extended-properties" Target="docProps/app.xml"/>` +
    '</Relationships>';

  const creator = escapeXml(opts.creator ?? 'CenituTable');
  const core =
    `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:creator>${creator}</dc:creator><cp:lastModifiedBy>${creator}</cp:lastModifiedBy>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified>` +
    '</cp:coreProperties>';

  const app =
    `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ` +
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    '<Application>CenituTable</Application>' +
    `<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>` +
    `<vt:variant><vt:i4>${names.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>` +
    `<TitlesOfParts><vt:vector size="${names.length}" baseType="lpstr">` +
    names.map((n) => `<vt:lpstr>${escapeXml(n)}</vt:lpstr>`).join('') +
    '</vt:vector></TitlesOfParts></Properties>';

  // The hidden _FilterDatabase name is what apps create alongside an AutoFilter.
  const definedNames = sheets
    .map((s, i) => {
      const af = s.autoFilter;
      if (!af || af.rows < 1 || af.cols < 1) return '';
      const abs = (row: number, col: number) => `$${columnLabel(col)}$${row + 1}`;
      const target = `'${names[i].replace(/'/g, "''")}'!${abs(af.row, af.col)}:${abs(af.row + af.rows - 1, af.col + af.cols - 1)}`;
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${escapeXml(target)}</definedName>`;
    })
    .join('');

  const workbook =
    `${XML_DECL}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}">` +
    '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
    names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets>' +
    (definedNames ? `<definedNames>${definedNames}</definedNames>` : '') +
    // Cached values come from our engine; ask the app to recalculate with its own on open.
    '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>';

  const n = sheets.length;
  const workbookRels =
    `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${n + 1}" Type="${NS_R}/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${n + 2}" Type="${NS_R}/sharedStrings" Target="sharedStrings.xml"/>` +
    '</Relationships>';

  const enc = new TextEncoder();
  const part = (path: string, xml: string): ZipEntry => ({ path, data: enc.encode(xml) });
  return [
    part('[Content_Types].xml', contentTypes),
    part('_rels/.rels', rootRels),
    part('docProps/core.xml', core),
    part('docProps/app.xml', app),
    part('xl/workbook.xml', workbook),
    part('xl/_rels/workbook.xml.rels', workbookRels),
    part('xl/styles.xml', styles.toXml()),
    part('xl/sharedStrings.xml', sst.toXml()),
    ...sheetParts.map((xml, i) => part(`xl/worksheets/sheet${i + 1}.xml`, xml)),
    ...noted.flatMap((i) => [
      part(`xl/comments${i + 1}.xml`, commentsXml(sheets[i], creator)),
      part(`xl/drawings/vmlDrawing${i + 1}.vml`, notesDrawing(sheets[i], i)),
      part(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">` +
        `<Relationship Id="rId1" Type="${NS_R}/vmlDrawing" Target="../drawings/vmlDrawing${i + 1}.vml"/>` +
        `<Relationship Id="rId2" Type="${NS_R}/comments" Target="../comments${i + 1}.xml"/></Relationships>`),
    ]),
  ];
}

/** Workbook as an uncompressed (STORE) .xlsx package; synchronous. */
export function toXLSX(sheets: ExportSheet[], opts: XlsxOptions = {}): Uint8Array {
  return zipStore(xlsxParts(sheets, opts), opts.modified);
}

/** Workbook as a DEFLATE-compressed .xlsx (falls back to STORE where CompressionStream is missing). */
export function toXLSXCompressed(sheets: ExportSheet[], opts: XlsxOptions = {}): Promise<Uint8Array> {
  return zipDeflate(xlsxParts(sheets, opts), opts.modified);
}
