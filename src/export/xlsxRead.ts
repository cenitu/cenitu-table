import { columnIndex, MAX_COLS, MAX_ROWS } from '../formula/address';
import { FormulaEngine } from '../formula/engine';
import { CellError, ERROR_CODES, parseLiteral, type CellValue, type ErrorCode, type RawCell } from '../formula/values';
import type { ExportCellFormat, ExportMerge, ExportSheet } from './types';
import { ZipReader, type UnzipOptions } from './unzip';
import { parseThemeColors, XlsxStyles } from './xlsxStyles';
import { scanXml, type XmlAttrs } from './xmlReader';

export interface ImportOptions extends UnzipOptions {
  /** 'keep' (default) imports formulas; 'values' replaces them with the results stored in the file. */
  formulas?: 'keep' | 'values';
}

/** One worksheet of a file; the same shape the exporters take, plus what only applies to imports. */
export interface ImportSheet extends ExportSheet {
  hiddenColumns: number[];
  /** Sheet is hidden in the file. */
  hidden: boolean;
  format: (row: number, col: number) => ExportCellFormat | undefined;
}

export interface ImportWorkbook {
  sheets: ImportSheet[];
  /** Workbook-level defined names: name -> expression (`=Sheet1!$A$1`). */
  names: { name: string; expression: string }[];
}

type Binary = ArrayBuffer | Uint8Array | Blob;

const CELL_REF = /^([A-Z]+)(\d+)$/;

function parseRef(ref: string): { row: number; col: number } | undefined {
  const m = CELL_REF.exec(ref.replace(/\$/g, ''));
  return m ? { row: Number(m[2]) - 1, col: columnIndex(m[1]) } : undefined;
}

function parseRange(ref: string): { start: { row: number; col: number }; end: { row: number; col: number } } | undefined {
  const [a, b = a] = ref.split(':');
  const start = parseRef(a);
  const end = parseRef(b);
  return start && end ? { start, end } : undefined;
}

/** Text the grid would read as something else is stored with the apostrophe prefix. */
function textCell(s: string): RawCell {
  if (s === '') return null;
  return s[0] === '=' || s[0] === "'" || typeof parseLiteral(s) !== 'string' ? `'${s}` : s;
}

/** Function prefixes files use for newer functions, e.g. `_xlfn.XLOOKUP`. */
const stripPrefixes = (formula: string): string => formula.replace(/_xlfn\.(_xlws\.)?|_xlws\.|_xludf\./gi, '');

const px = {
  fromColWidth: (w: number) => Math.round(w * 7 + 5),
  fromPt: (pt: number) => Math.round(pt / 0.75),
};

function resolvePath(base: string, target: string): string {
  if (target[0] === '/') return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function parseRels(xml: string | undefined): Map<string, string> {
  const rels = new Map<string, string>();
  if (xml) {
    scanXml(xml, {
      open(name, a) {
        if (name === 'Relationship' && a.TargetMode !== 'External') rels.set(a.Id, a.Target);
      },
    });
  }
  return rels;
}

function parseSharedStrings(xml: string | undefined): string[] {
  const out: string[] = [];
  if (!xml) return out;
  let current = '';
  let inText = false;
  let phonetic = 0;
  scanXml(xml, {
    open(name) {
      if (name === 'si') current = '';
      else if (name === 'rPh') phonetic++;
      else if (name === 't') inText = phonetic === 0;
    },
    close(name) {
      if (name === 'si') out.push(current);
      else if (name === 'rPh') phonetic--;
      else if (name === 't') inText = false;
    },
    text(t) {
      if (inText) current += t;
    },
  });
  return out;
}

interface SheetContext {
  strings: string[];
  styles: XlsxStyles;
  date1904: boolean;
  values: boolean;
  shifter: FormulaEngine;
}

interface PendingCell {
  ref: string;
  type: string;
  style: number;
  formula: string;
  formulaAttrs: XmlAttrs | null;
  value: string;
  inline: string;
}

function parseSheet(xml: string, name: string, hidden: boolean, ctx: SheetContext): ImportSheet {
  const data: RawCell[][] = [];
  const values: CellValue[][] = [];
  const styleIds = new Map<number, number>();
  const shared = new Map<string, { formula: string; row: number; col: number }>();
  const spilled: { start: { row: number; col: number }; end: { row: number; col: number } }[] = [];
  const merges: ExportMerge[] = [];
  const colWidths: number[] = [];
  const hiddenColumns: number[] = [];
  const rowHeights: number[] = [];
  const frozen = { rows: 0, cols: 0 };
  let autoFilter: ExportSheet['autoFilter'];
  let cell: PendingCell | null = null;
  let capture: 'f' | 'v' | 't' | null = null;
  let nextRow = 0;
  let nextCol = 0;
  let lastRow = -1;
  let lastCol = -1;

  const put = (row: number, col: number, raw: RawCell, value: CellValue) => {
    while (data.length <= row) {
      data.push([]);
      values.push([]);
    }
    data[row][col] = raw;
    values[row][col] = value;
    lastRow = Math.max(lastRow, row);
    lastCol = Math.max(lastCol, col);
  };

  const literal = (c: PendingCell, code: number | undefined): { raw: RawCell; value: CellValue } => {
    const v = c.value;
    switch (c.type) {
      case 's': {
        const s = ctx.strings[Number(v)] ?? '';
        return { raw: textCell(s), value: s || null };
      }
      case 'inlineStr':
        return { raw: textCell(c.inline), value: c.inline || null };
      case 'str':
        return { raw: textCell(v), value: v || null };
      case 'b':
        return { raw: v === '1', value: v === '1' };
      case 'e':
        return { raw: `'${v}`, value: ERROR_CODES.includes(v as ErrorCode) ? new CellError(v as ErrorCode) : v };
      case 'd': {
        const ms = Date.parse(v);
        const serial = Number.isNaN(ms) ? null : ms / 86400000 + 25569;
        return { raw: serial, value: serial };
      }
    }
    if (v === '') return { raw: null, value: null };
    const n = Number(v) + (ctx.date1904 && code !== undefined ? 1462 : 0);
    return Number.isNaN(n) ? { raw: textCell(v), value: v } : { raw: n, value: n };
  };

  const formulaOf = (c: PendingCell, row: number, col: number): string | undefined => {
    const a = c.formulaAttrs;
    if (!a) return undefined;
    if (a.t === 'shared' && a.si !== undefined) {
      if (c.formula) {
        shared.set(a.si, { formula: c.formula, row, col });
        return c.formula;
      }
      const base = shared.get(a.si);
      return base && ctx.shifter.shiftFormula(`=${base.formula}`, row - base.row, col - base.col).slice(1);
    }
    if (a.t === 'array' && a.ref) {
      const r = parseRange(a.ref);
      if (r && (r.start.row !== r.end.row || r.start.col !== r.end.col)) spilled.push(r);
    }
    return c.formula || undefined;
  };

  const finishCell = (c: PendingCell) => {
    const pos = parseRef(c.ref) ?? { row: nextRow, col: nextCol };
    nextCol = pos.col + 1;
    if (pos.row >= MAX_ROWS || pos.col >= MAX_COLS) return;
    if (c.style) styleIds.set(pos.row * 16384 + pos.col, c.style);
    const dateCode = c.style && ctx.styles.isDate(c.style) ? 1 : undefined;
    const { raw, value } = literal(c, dateCode);
    const formula = ctx.values ? undefined : formulaOf(c, pos.row, pos.col);
    if (formula) put(pos.row, pos.col, `=${stripPrefixes(formula)}`, value);
    else if (raw !== null) put(pos.row, pos.col, raw, value);
  };

  scanXml(xml, {
    open(tag, a, selfClosing) {
      switch (tag) {
        case 'pane':
          if (a.state === 'frozen' || a.state === 'frozenSplit') {
            frozen.rows = Number(a.ySplit ?? 0);
            frozen.cols = Number(a.xSplit ?? 0);
          }
          break;
        case 'col': {
          const min = Number(a.min) - 1;
          const max = Math.min(Number(a.max) - 1, MAX_COLS - 1);
          for (let c = min; c <= max && c < min + 1024; c++) {
            if (a.width && a.customWidth !== '0') colWidths[c] = px.fromColWidth(Number(a.width));
            if (a.hidden === '1' || a.hidden === 'true') hiddenColumns.push(c);
          }
          break;
        }
        case 'row':
          nextRow = a.r ? Number(a.r) - 1 : nextRow;
          nextCol = 0;
          if (a.ht && a.customHeight && a.customHeight !== '0' && nextRow < MAX_ROWS) rowHeights[nextRow] = px.fromPt(Number(a.ht));
          break;
        case 'c':
          cell = { ref: a.r ?? '', type: a.t ?? 'n', style: Number(a.s ?? 0), formula: '', formulaAttrs: null, value: '', inline: '' };
          if (selfClosing) {
            finishCell(cell);
            cell = null;
          }
          break;
        case 'f':
          if (cell) {
            cell.formulaAttrs = a;
            capture = selfClosing ? null : 'f';
          }
          break;
        case 'v':
          if (cell) capture = selfClosing ? null : 'v';
          break;
        case 't':
          if (cell) capture = selfClosing ? null : 't';
          break;
        case 'mergeCell': {
          const r = a.ref ? parseRange(a.ref) : undefined;
          if (r) merges.push({ row: r.start.row, col: r.start.col, rowspan: r.end.row - r.start.row + 1, colspan: r.end.col - r.start.col + 1 });
          break;
        }
        case 'autoFilter': {
          const r = a.ref ? parseRange(a.ref) : undefined;
          if (r) autoFilter = { row: r.start.row, col: r.start.col, rows: r.end.row - r.start.row + 1, cols: r.end.col - r.start.col + 1 };
          break;
        }
      }
    },
    close(tag) {
      if (tag === 'c' && cell) {
        finishCell(cell);
        cell = null;
      } else if (tag === 'row') nextRow++;
      else if (tag === 'f' || tag === 'v' || tag === 't') capture = null;
    },
    text(t) {
      if (!cell || !capture) return;
      if (capture === 'f') cell.formula += t;
      else if (capture === 'v') cell.value += t;
      else cell.inline += t;
    },
  });

  // Multi-cell array formulas spill again here, and stored results in their area would block that.
  for (const r of spilled) {
    for (let row = r.start.row; row <= r.end.row; row++) {
      for (let col = r.start.col; col <= r.end.col; col++) {
        if (row === r.start.row && col === r.start.col) continue;
        if (data[row]) data[row][col] = null;
      }
    }
  }

  // Style-only rows and columns reach the sheet's last row in many files; they are not data.
  const rows = Math.max(lastRow + 1, merges.reduce((m, x) => Math.max(m, x.row + x.rowspan), 0));
  const cols = Math.max(lastCol + 1, merges.reduce((m, x) => Math.max(m, x.col + x.colspan), 0));
  const fill = (grid: (RawCell | CellValue)[][]) =>
    Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => grid[r]?.[c] ?? null));

  return {
    name,
    hidden,
    data: fill(data) as RawCell[][],
    values: fill(values) as CellValue[][],
    colWidths: colWidths.slice(0, cols),
    rowHeights: rowHeights.slice(0, rows),
    frozen,
    merges,
    hiddenColumns: hiddenColumns.filter((c) => c < cols),
    autoFilter,
    format: (row, col) => {
      const id = styleIds.get(row * 16384 + col);
      return id ? ctx.styles.format(id) : undefined;
    },
  };
}

async function toBytes(file: Binary): Promise<Uint8Array> {
  if (file instanceof Uint8Array) return file;
  if (file instanceof ArrayBuffer) return new Uint8Array(file);
  return new Uint8Array(await file.arrayBuffer());
}

/**
 * Reads an .xlsx file: values, formulas, number formats, fonts, fills, alignment, column widths,
 * row heights, frozen panes, merges and defined names. Charts, images, comments, conditional
 * formats and data validation are not read.
 */
export async function readXLSX(file: Binary, opts: ImportOptions = {}): Promise<ImportWorkbook> {
  const zip = new ZipReader(await toBytes(file), opts);
  const root = parseRels(await zip.readText('_rels/.rels'));
  const rootTarget = [...root.values()].find((t) => /workbook[^/]*\.xml$/i.test(t)) ?? 'xl/workbook.xml';
  const workbookPath = resolvePath('', rootTarget);
  const workbookXml = await zip.readText(workbookPath);
  if (!workbookXml) throw new Error('Not an .xlsx workbook');

  const relsPath = resolvePath(workbookPath, `_rels/${workbookPath.split('/').pop()}.rels`);
  const rels = parseRels(await zip.readText(relsPath));
  const sheetRefs: { name: string; id: string; hidden: boolean }[] = [];
  const names: ImportWorkbook['names'] = [];
  let date1904 = false;
  let defined: { name: string; text: string; local: boolean } | null = null;
  scanXml(workbookXml, {
    open(name, a) {
      if (name === 'sheet') sheetRefs.push({ name: a.name, id: a.id, hidden: a.state === 'hidden' || a.state === 'veryHidden' });
      else if (name === 'workbookPr') date1904 = a.date1904 === '1' || a.date1904 === 'true';
      else if (name === 'definedName') defined = { name: a.name, text: '', local: a.localSheetId !== undefined };
    },
    text(t) {
      if (defined) defined.text += t;
    },
    close(name) {
      if (name !== 'definedName' || !defined) return;
      // Built-in names (print areas, filter ranges) and sheet-scoped names have no global meaning.
      if (!defined.local && !defined.name.startsWith('_xlnm.')) names.push({ name: defined.name, expression: `=${defined.text}` });
      defined = null;
    },
  });

  const path = (type: string) => zip.paths.find((p) => p.toLowerCase() === type);
  const theme = parseThemeColors(await zip.readText(path('xl/theme/theme1.xml') ?? ''));
  const ctx: SheetContext = {
    strings: parseSharedStrings(await zip.readText(path('xl/sharedstrings.xml') ?? '')),
    styles: new XlsxStyles(await zip.readText(path('xl/styles.xml') ?? ''), theme),
    date1904,
    values: opts.formulas === 'values',
    shifter: FormulaEngine.buildEmpty(),
  };

  const sheets: ImportSheet[] = [];
  for (const ref of sheetRefs) {
    const target = rels.get(ref.id);
    const xml = target ? await zip.readText(resolvePath(workbookPath, target)) : undefined;
    if (xml) sheets.push(parseSheet(xml, ref.name, ref.hidden, ctx));
  }
  ctx.shifter.destroy();
  return { sheets, names };
}

/**
 * Engine holding all sheets of a workbook (still empty) and its defined names. Create one grid per
 * sheet on it and call `loadSheet`, so cross-sheet formulas find each other in any order.
 */
export function workbookEngine(workbook: ImportWorkbook): FormulaEngine {
  const engine = FormulaEngine.buildEmpty();
  workbook.sheets.forEach((s, i) => {
    if (i === 0) engine.renameSheet(0, s.name);
    else engine.addSheet(s.name);
  });
  for (const { name, expression } of workbook.names) {
    if (engine.isItPossibleToAddNamedExpression(name)) engine.addNamedExpression(name, expression);
  }
  return engine;
}
