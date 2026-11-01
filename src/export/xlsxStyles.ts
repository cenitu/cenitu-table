import type { CellMeta, NumericFormat } from '../grid/cellTypes';
import { isDateFormat } from './numberFormat';
import type { ExportCellFormat } from './types';
import { scanXml, type XmlAttrs } from './xmlReader';

// Built-in format ids (ECMA-376 18.8.30) that files reference without a <numFmt> entry.
const BUILTIN_CODES: Record<number, string> = {
  1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'mm-dd-yy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss',
  22: 'm/d/yy h:mm', 37: '#,##0;(#,##0)', 38: '#,##0;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
};

// Standard indexed palette (ECMA-376 18.8.27), entries 0-7 repeat at 8-15.
const INDEXED = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
];

/** Theme slots in the order cell colors index them (dark/light pairs are swapped in the file). */
const THEME_SLOTS = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];

export function parseThemeColors(xml: string | undefined): string[] {
  const colors = new Map<string, string>();
  if (xml) {
    let slot = '';
    scanXml(xml, {
      open(name, a) {
        if (THEME_SLOTS.includes(name)) slot = name;
        else if (slot && name === 'srgbClr') colors.set(slot, a.val);
        else if (slot && name === 'sysClr') colors.set(slot, a.lastClr ?? '');
      },
      close(name) {
        if (name === slot) slot = '';
      },
    });
  }
  return THEME_SLOTS.map((s) => colors.get(s) ?? '');
}

/** Lightens (tint > 0) or darkens (tint < 0) a channel, close to the HLS rule of the spec. */
function applyTint(rgb: string, tint: number): string {
  const channel = (i: number) => {
    const v = parseInt(rgb.slice(i, i + 2), 16);
    const out = tint < 0 ? v * (1 + tint) : v + (255 - v) * tint;
    return Math.round(Math.max(0, Math.min(255, out))).toString(16).padStart(2, '0');
  };
  return `${channel(0)}${channel(2)}${channel(4)}`.toUpperCase();
}

function colorOf(a: XmlAttrs, theme: string[]): string | undefined {
  let rgb: string | undefined;
  if (a.rgb) rgb = a.rgb.length === 8 ? a.rgb.slice(2) : a.rgb;
  else if (a.theme !== undefined) rgb = theme[Number(a.theme)];
  else if (a.indexed !== undefined) rgb = INDEXED[Number(a.indexed)];
  if (!rgb || !/^[0-9a-f]{6}$/i.test(rgb)) return undefined;
  return `#${(a.tint ? applyTint(rgb, Number(a.tint)) : rgb).toLowerCase()}`;
}

interface Font {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
}

interface Xf {
  numFmtId: number;
  fontId: number;
  fillId: number;
  align?: 'left' | 'center' | 'right';
  wrap?: boolean;
}

const on = (a: XmlAttrs): boolean => a.val !== '0' && a.val !== 'false';

const ALIGN: Record<string, Xf['align']> = { left: 'left', center: 'center', right: 'right', centerContinuous: 'center' };

/** Resolved cell formats of a workbook: cell `s` attribute -> grid-independent format. */
export class XlsxStyles {
  private readonly codes = new Map<number, string>();
  private readonly fonts: Font[] = [];
  private readonly fills: (string | undefined)[] = [];
  private readonly xfs: Xf[] = [];
  private readonly cache = new Map<number, ExportCellFormat | undefined>();

  constructor(xml: string | undefined, private readonly theme: string[]) {
    if (xml) this.parse(xml);
  }

  private parse(xml: string): void {
    let section = '';
    let font: Font | undefined;
    let fill: { solid: boolean; color?: string } | undefined;
    let xf: Xf | undefined;
    scanXml(xml, {
      open: (name, a) => {
        if (name === 'numFmts' || name === 'fonts' || name === 'fills' || name === 'cellXfs' || name === 'dxfs' || name === 'cellStyleXfs') section = name;
        else if (section === 'numFmts' && name === 'numFmt') this.codes.set(Number(a.numFmtId), a.formatCode);
        else if (section === 'fonts') {
          if (name === 'font') font = {};
          else if (font && name === 'b') font.bold = on(a);
          else if (font && name === 'i') font.italic = on(a);
          else if (font && name === 'strike') font.strike = on(a);
          else if (font && name === 'u') font.underline = a.val !== 'none';
          else if (font && name === 'color') font.color = colorOf(a, this.theme);
        } else if (section === 'fills') {
          if (name === 'fill') fill = { solid: false };
          else if (fill && name === 'patternFill') fill.solid = a.patternType === 'solid';
          else if (fill && name === 'fgColor') fill.color = colorOf(a, this.theme);
        } else if (section === 'cellXfs') {
          if (name === 'xf') xf = { numFmtId: Number(a.numFmtId ?? 0), fontId: Number(a.fontId ?? 0), fillId: Number(a.fillId ?? 0) };
          else if (xf && name === 'alignment') {
            xf.align = ALIGN[a.horizontal];
            xf.wrap = a.wrapText === '1' || a.wrapText === 'true';
          }
        }
      },
      close: (name) => {
        if (name === section) section = '';
        else if (name === 'font' && font) (this.fonts.push(font), (font = undefined));
        else if (name === 'fill' && fill) (this.fills.push(fill.solid ? fill.color : undefined), (fill = undefined));
        else if (name === 'xf' && xf) (this.xfs.push(xf), (xf = undefined));
      },
    });
  }

  numberFormat(style: number): string | undefined {
    const id = this.xfs[style]?.numFmtId ?? 0;
    return id ? this.codes.get(id) ?? BUILTIN_CODES[id] : undefined;
  }

  isDate(style: number): boolean {
    return isDateFormat(this.numberFormat(style));
  }

  format(style: number): ExportCellFormat | undefined {
    if (this.cache.has(style)) return this.cache.get(style);
    const xf = this.xfs[style];
    let out: ExportCellFormat | undefined;
    if (xf) {
      const f = this.fonts[xf.fontId];
      const f0 = this.fonts[0];
      const fmt: ExportCellFormat = {};
      const code = this.numberFormat(style);
      if (code) fmt.numberFormat = code;
      if (f?.bold) fmt.bold = true;
      if (f?.italic) fmt.italic = true;
      if (f?.underline) fmt.underline = true;
      if (f?.strike) fmt.strike = true;
      // The default font color is left to the grid's theme, so dark mode stays readable.
      if (f?.color && f.color !== f0?.color) fmt.color = f.color;
      const bg = this.fills[xf.fillId];
      if (bg) fmt.background = bg;
      if (xf.align) fmt.align = xf.align;
      if (xf.wrap) fmt.wrap = true;
      if (Object.keys(fmt).length) out = fmt;
    }
    this.cache.set(style, out);
    return out;
  }
}

/** Date pattern for a format code, when every token has a grid equivalent. */
export function patternFromDateCode(code: string): string | undefined {
  if (/\[[hms]+\]/i.test(code)) return undefined;
  const section = code.split(';')[0].replace(/\[[^\]]*\]/g, '').replace(/\\(.)/g, '$1').replace(/"([^"]*)"/g, '$1');
  if (/AM\/PM|A\/P|mmm|ddd|[.]0|_|\*/i.test(section)) return undefined;
  const tokens = /yyyy|yy|mm|m|dd|d|hh|h|ss|s/gi;
  let out = '';
  let last = 0;
  let prev = '';
  const parts = [...section.matchAll(tokens)];
  for (let i = 0; i < parts.length; i++) {
    const m = parts[i];
    const t = m[0].toLowerCase();
    out += section.slice(last, m.index);
    last = m.index + m[0].length;
    if (t[0] === 'y') out += t.length > 2 ? 'YYYY' : 'YY';
    else if (t[0] === 'd') out += t.length > 1 ? 'DD' : 'D';
    else if (t[0] === 'h') out += 'HH';
    else if (t[0] === 's') out += 'ss';
    else {
      // "m" is minutes next to an hour or seconds token, months otherwise.
      const next = parts[i + 1]?.[0][0].toLowerCase();
      const minute = prev === 'h' || next === 's';
      out += minute ? 'mm' : t.length > 1 ? 'MM' : 'M';
    }
    prev = t[0];
  }
  return /[^YMDHms\s\-/.:,]/.test(out + section.slice(last)) ? undefined : out + section.slice(last);
}

const CURRENCIES: Record<string, string> = { '₺': 'TRY', TL: 'TRY', '€': 'EUR', $: 'USD', '£': 'GBP' };

/** Number display settings for a simple format code; complex codes keep the default display. */
export function numericFormatFromCode(code: string): NumericFormat | undefined {
  const section = code.split(';')[0];
  const fraction = /\.([0#]+)/.exec(section)?.[1] ?? '';
  const digits = {
    minimumFractionDigits: fraction.replace(/#/g, '').length,
    maximumFractionDigits: fraction.length,
    useGrouping: /#,##0|0,0/.test(section),
  };
  if (!/[0#]/.test(section) || /E[+-]|\?/i.test(section)) return undefined;
  if (section.includes('%')) return { style: 'percent', ...digits };
  const literal = /"([^"]+)"|\[\$([^\]-]*)/.exec(section);
  const symbol = (literal?.[1] ?? literal?.[2] ?? /[₺€$£]/.exec(section)?.[0] ?? '').trim();
  const currency = CURRENCIES[symbol] ?? (/^[A-Z]{3}$/.test(symbol) ? symbol : undefined);
  return currency ? { style: 'currency', currency, ...digits } : { style: 'decimal', ...digits };
}

/** Cell settings that make the grid display a format like the file does. */
export function metaFromFormat(f: ExportCellFormat): CellMeta {
  const meta: CellMeta = {};
  if (f.numberFormat && f.numberFormat !== '@') {
    meta.formatCode = f.numberFormat;
    // Durations such as [h]:mm count past 24 hours: they are numbers, not dates.
    if (/\[[hms]+\]/i.test(f.numberFormat)) {
      // Shown as the plain number; the code still goes back out on export.
    } else if (isDateFormat(f.numberFormat)) {
      meta.type = 'date';
      // Locale-dependent short date: keep the grid's default for its locale.
      const pattern = f.numberFormat === 'mm-dd-yy' ? undefined : patternFromDateCode(f.numberFormat);
      if (pattern) meta.dateFormat = pattern;
    } else {
      const numeric = numericFormatFromCode(f.numberFormat);
      if (numeric) meta.numericFormat = numeric;
    }
  }
  const { bold, italic, underline, strike, color, background, align, wrap } = f;
  const style = Object.fromEntries(Object.entries({ bold, italic, underline, strike, color, background, align, wrap }).filter(([, v]) => v !== undefined));
  if (Object.keys(style).length) meta.style = style;
  return meta;
}
