import type { CellStyle } from './cellTypes';
import { escapeXml } from '../export/xml';

/**
 * The "text/html" clipboard flavour. Values always travel as tab-separated text; the HTML table
 * only adds styling, which is what spreadsheet apps read from each other.
 */

export function styleToCss(s: CellStyle): string {
  const out: string[] = [];
  if (s.bold) out.push('font-weight:700');
  if (s.italic) out.push('font-style:italic');
  const line = [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ');
  if (line) out.push(`text-decoration:${line}`);
  if (s.color) out.push(`color:${s.color}`);
  if (s.background) out.push(`background-color:${s.background}`);
  if (s.align) out.push(`text-align:${s.align}`);
  if (s.wrap) out.push('white-space:normal');
  return out.join(';');
}

export function tableHtml(texts: string[][], styles: (CellStyle | undefined)[][]): string {
  const cell = (text: string, style: CellStyle | undefined) => {
    const css = style ? styleToCss(style) : '';
    return `<td${css ? ` style="${escapeXml(css)}"` : ''}>${escapeXml(text)}</td>`;
  };
  const rows = texts.map((row, r) => `<tr>${row.map((t, c) => cell(t, styles[r]?.[c])).join('')}</tr>`);
  return `<table>${rows.join('')}</table>`;
}

/** Spans are expanded cell by cell, so a pasted table must not be able to ask for millions. */
const MAX_SPAN = 1000;

const hex = (n: string) => Number(n).toString(16).padStart(2, '0');

const NON_COLORS = ['auto', 'inherit', 'initial', 'unset', 'currentcolor', 'transparent', 'windowtext', 'window', 'none'];

/** Only plain colors are taken; system keywords and the defaults would override the grid's theme. */
function plainColor(value: string | undefined, skip: string[]): string | undefined {
  const v = value?.trim().toLowerCase();
  if (!v) return undefined;
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/.exec(v);
  const color = rgb ? (rgb[4] === '0' ? undefined : `#${hex(rgb[1])}${hex(rgb[2])}${hex(rgb[3])}`) : /^#[0-9a-f]{3,8}$/.test(v) ? v : undefined;
  if (color) return skip.includes(color) ? undefined : color;
  return /^[a-z]+$/.test(v) && !NON_COLORS.includes(v) && !skip.includes(v) ? v : undefined;
}

function parseDeclarations(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of css.split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).replace(/!important/i, '').trim());
  }
  return out;
}

/** `td {…}` and `.class {…}` rules; spreadsheet apps keep cell formats in a <style> block. */
function parseRules(doc: Document): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  doc.querySelectorAll('style').forEach((el) => {
    const css = (el.textContent ?? '').replace(/<!--|-->|\/\*[\s\S]*?\*\//g, ' ');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const selector of m[1].split(',')) rules.set(selector.trim().toLowerCase(), parseDeclarations(m[2]));
    }
  });
  return rules;
}

function declarationsToStyle(d: Map<string, string>): CellStyle | undefined {
  const s: CellStyle = {};
  const weight = d.get('font-weight');
  if (weight === 'bold' || Number(weight) >= 600) s.bold = true;
  if (d.get('font-style') === 'italic') s.italic = true;
  const line = d.get('text-decoration') ?? d.get('text-decoration-line') ?? '';
  if (line.includes('underline')) s.underline = true;
  if (line.includes('line-through')) s.strike = true;
  const color = plainColor(d.get('color'), ['#000', '#000000', 'black']);
  if (color) s.color = color;
  const background = plainColor(d.get('background-color') ?? d.get('background'), ['#fff', '#ffffff', 'white']);
  if (background) s.background = background;
  const align = d.get('text-align');
  if (align === 'left' || align === 'center' || align === 'right') s.align = align;
  const ws = d.get('white-space');
  if (ws === 'normal' || ws === 'pre-wrap') s.wrap = true;
  return Object.keys(s).length ? s : undefined;
}

export interface HtmlTable {
  texts: string[][];
  styles: (CellStyle | undefined)[][];
}

/** First table of a clipboard document, with spans expanded; null when there is none. */
export function parseHtmlTable(html: string, view: Window & typeof globalThis): HtmlTable | null {
  // A parsed document is inert: scripts do not run and nothing loads.
  const doc = new view.DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  const rules = parseRules(doc);
  const texts: string[][] = [];
  const styles: (CellStyle | undefined)[][] = [];
  table.querySelectorAll('tr').forEach((tr, r) => {
    texts[r] ??= [];
    styles[r] ??= [];
    let c = 0;
    for (const td of Array.from(tr.children) as HTMLTableCellElement[]) {
      while (texts[r][c] !== undefined) c++;
      const cascade = new Map([
        ...(rules.get(td.tagName.toLowerCase()) ?? []),
        ...[...td.classList].flatMap((k) => [...(rules.get(`.${k.toLowerCase()}`) ?? [])]),
        ...parseDeclarations(td.getAttribute('style') ?? ''),
      ]);
      const style = declarationsToStyle(cascade);
      const rowspan = Math.min(MAX_SPAN, Math.max(1, td.rowSpan || 1));
      const colspan = Math.min(MAX_SPAN, Math.max(1, td.colSpan || 1));
      for (let i = 0; i < rowspan; i++) {
        for (let j = 0; j < colspan; j++) {
          (texts[r + i] ??= [])[c + j] = i === 0 && j === 0 ? (td.textContent ?? '').trim() : '';
          (styles[r + i] ??= [])[c + j] = style;
        }
      }
      c += colspan;
    }
  });
  return texts.length ? { texts, styles } : null;
}
