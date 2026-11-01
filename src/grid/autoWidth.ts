/** Rows read per column. Longer lists are sampled at even steps to keep a double click instant. */
export const MAX_FIT_ROWS = 20000;
/** Room for the larger checkbox glyph and the cell's padding. */
export const CHECK_WIDTH = 32;

export interface TextMeter {
  /** Width of a cell showing `text`, padding and border included. */
  cell(text: string, bold: boolean, italic: boolean, dropdown: boolean): number;
}

const px = (v: string) => parseFloat(v) || 0;
/** Fonts differ by less than this between the canvas and the page. */
const ROUNDING = 1;

/** Measures on a canvas, so that thousands of cells cost no page layout. */
export function textMeter(parent: HTMLElement): TextMeter {
  const doc = parent.ownerDocument;
  const probe = doc.createElement('div');
  probe.className = 'ct-cell';
  probe.style.visibility = 'hidden';
  parent.appendChild(probe);
  const style = doc.defaultView!.getComputedStyle(probe);
  const edges = () => px(style.paddingLeft) + px(style.paddingRight) + px(style.borderRightWidth) + ROUNDING;
  const plain = edges();
  const size = px(style.fontSize) || 13;
  const family = style.fontFamily || 'sans-serif';
  probe.classList.add('ct-dd');
  const dropdownEdges = edges();
  probe.remove();

  const ctx = doc.createElement('canvas').getContext('2d');
  let font = '';
  const measure = (text: string, bold: boolean, italic: boolean) => {
    if (!ctx) return text.length * size * 0.6;
    const wanted = `${italic ? 'italic ' : ''}${bold ? '700 ' : ''}${size}px ${family}`;
    if (wanted !== font) ctx.font = font = wanted;
    return ctx.measureText(text).width;
  };
  return {
    // Cells collapse white space and show line breaks as spaces.
    cell: (text, bold, italic, dropdown) => measure(text.replace(/\s+/g, ' '), bold, italic) + (dropdown ? dropdownEdges : plain),
  };
}

/** Width an element takes when nothing limits it. */
export function naturalWidth(el: HTMLElement): number {
  const before = el.style.width;
  el.style.width = 'max-content';
  const width = el.offsetWidth;
  el.style.width = before;
  return width;
}
