import type { ExportCellFormat } from './types';
import { attrs, escapeXml, XML_DECL } from './xml';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

// Built-in format ids need no <numFmt> entry; custom ids must start at 164.
const BUILTIN_FORMATS: Record<string, number> = {
  General: 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10, '0.00E+00': 11, '@': 49,
};

/** '#rgb' / '#rrggbb' -> 'FFRRGGBB' (opaque ARGB); anything else is ignored. */
export function toArgb(color: string | undefined): string | undefined {
  if (!color) return undefined;
  let m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (m) return `FF${m[1].toUpperCase()}`;
  m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color.trim());
  return m ? `FF${(m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase()}` : undefined;
}

class Pool {
  readonly items: string[] = [];
  private readonly index = new Map<string, number>();
  constructor(initial: string[]) {
    initial.forEach((x) => this.add(x));
  }
  add(xml: string): number {
    let i = this.index.get(xml);
    if (i === undefined) {
      i = this.items.push(xml) - 1;
      this.index.set(xml, i);
    }
    return i;
  }
}

const fontXml = (b?: boolean, i?: boolean, u?: boolean, rgb?: string, strike?: boolean): string =>
  // Child order follows CT_Font: b, i, strike, ..., u, sz, color, name, family. No theme references,
  // since the package ships no theme part.
  `<font>${b ? '<b/>' : ''}${i ? '<i/>' : ''}${strike ? '<strike/>' : ''}${u ? '<u/>' : ''}<sz val="11"/>` +
  `${rgb ? `<color rgb="${rgb}"/>` : ''}<name val="Calibri"/><family val="2"/></font>`;

/** Collects the distinct formats used by a workbook and assigns each a cellXfs index. */
export class StyleRegistry {
  private readonly fonts = new Pool([fontXml()]);
  // The first two fills are reserved by the spec (none, gray125) regardless of use.
  private readonly fills = new Pool([
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
  ]);
  private readonly numFmts = new Map<string, number>();
  private readonly xfs = new Pool(['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']);

  private numFmtId(code: string): number {
    const builtin = BUILTIN_FORMATS[code];
    if (builtin !== undefined) return builtin;
    let id = this.numFmts.get(code);
    if (id === undefined) this.numFmts.set(code, (id = 164 + this.numFmts.size));
    return id;
  }

  /** Returns the cellXfs index (0 = default) for a format. */
  styleId(f: ExportCellFormat | undefined): number {
    if (!f) return 0;
    const numFmtId = f.numberFormat ? this.numFmtId(f.numberFormat) : 0;
    const rgb = toArgb(f.color);
    const fontId = f.bold || f.italic || f.underline || f.strike || rgb ? this.fonts.add(fontXml(f.bold, f.italic, f.underline, rgb, f.strike)) : 0;
    const bg = toArgb(f.background);
    const fillId = bg
      ? this.fills.add(`<fill><patternFill patternType="solid"><fgColor rgb="${bg}"/><bgColor indexed="64"/></patternFill></fill>`)
      : 0;
    const align = f.align || f.wrap ? `<alignment${attrs({ horizontal: f.align, wrapText: f.wrap })}/>` : '';
    const xf =
      `<xf${attrs({
        numFmtId, fontId, fillId, borderId: 0, xfId: 0,
        applyNumberFormat: numFmtId > 0, applyFont: fontId > 0, applyFill: fillId > 0, applyAlignment: !!align,
      })}` + (align ? `>${align}</xf>` : '/>');
    return this.xfs.add(xf);
  }

  toXml(): string {
    const numFmts = [...this.numFmts]
      .map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`)
      .join('');
    const list = (tag: string, items: string[]) => `<${tag} count="${items.length}">${items.join('')}</${tag}>`;
    return (
      XML_DECL +
      `<styleSheet xmlns="${NS}">` +
      (this.numFmts.size ? `<numFmts count="${this.numFmts.size}">${numFmts}</numFmts>` : '') +
      list('fonts', this.fonts.items) +
      list('fills', this.fills.items) +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      list('cellXfs', this.xfs.items) +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '<dxfs count="0"/><tableStyles count="0"/>' +
      '</styleSheet>'
    );
  }
}
