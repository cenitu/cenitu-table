import { afterEach, describe, expect, it } from 'vitest';
import { CenituGrid } from '../src';
import { parseTSV, toTSV } from '../src/grid/tsv';

let grid: CenituGrid;
afterEach(() => grid?.destroy());

function make(data: (string | number | null)[][], opts = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  grid = new CenituGrid(host, { data, ...opts });
  return grid;
}

/** Simulates text arriving through the browser's input pipeline (keyboard, IME, dictation). */
const typeText = (text: string) => {
  const ta = grid.root.querySelector('textarea')!;
  ta.value += text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return ta;
};

const key = (k: string, extra: Partial<KeyboardEventInit> = {}) =>
  grid.root.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));

describe('tsv', () => {
  it('round-trips special characters', () => {
    const rows = [['a', 'b\tc'], ['line\nbreak', 'say "hi"']];
    expect(parseTSV(toTSV(rows))).toEqual(rows);
  });
  it('parses Excel clipboard text with trailing newline', () => {
    expect(parseTSV('1\t2\r\n3\t4\r\n')).toEqual([['1', '2'], ['3', '4']]);
  });
});

describe('CenituGrid', () => {
  it('renders only the visible window of a large sheet', () => {
    const data = Array.from({ length: 10000 }, (_, r) => Array.from({ length: 50 }, (_, c) => r * c));
    const g = make(data, { formulas: false });
    const cells = g.root.querySelectorAll('.ct-cell:not([style*="display: none"])');
    expect(g.countRows()).toBe(10000);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThan(2000);
  });

  it('shows formula results and keeps source formulas', () => {
    const g = make([[1, 2, '=A1+B1']]);
    expect(g.getDataAtCell(0, 2)).toBe(3);
    expect(g.getSourceDataAtCell(0, 2)).toBe('=A1+B1');
    g.setDataAtCell(0, 0, 10);
    expect(g.getDataAtCell(0, 2)).toBe(12);
    expect(g.root.textContent).toContain('12');
  });

  it('runs hooks and lets beforeChange cancel', () => {
    const g = make([[1]]);
    const seen: unknown[] = [];
    g.addHook('afterChange', (changes, source) => seen.push([changes[0].newValue, source]));
    g.setDataAtCell(0, 0, 5);
    g.addHook('beforeChange', () => false);
    g.setDataAtCell(0, 0, 6);
    expect(seen).toEqual([[5, 'api']]);
    expect(g.getDataAtCell(0, 0)).toBe(5);
  });

  it('navigates with the keyboard and extends with shift', () => {
    const g = make([[1, 2, 3], [4, 5, 6]]);
    g.selectCell(0, 0);
    key('ArrowRight');
    key('ArrowDown', { shiftKey: true });
    expect(g.getSelected()).toEqual([[0, 1, 1, 1]]);
    key('ArrowRight', { ctrlKey: true });
    expect(g.getSelected()).toEqual([[0, 2, 0, 2]]);
  });

  it('edits a cell by typing and commits with Enter', () => {
    const g = make([[1, null], [null, null]]);
    g.selectCell(0, 1);
    const editor = typeText('=');
    expect(g.isEditing()).toBe(true);
    expect(editor.value).toBe('=');
    editor.value = '=A1*5';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(g.getDataAtCell(0, 1)).toBe(5);
    expect(g.getSelected()).toEqual([[1, 1, 1, 1]]);
    expect(g.isEditing()).toBe(false);
  });

  it('Escape cancels editing; typed numbers are stored as numbers', () => {
    const g = make([[1]]);
    g.selectCell(0, 0);
    key('Enter');
    const ed = g.root.querySelector('textarea')!;
    ed.value = '99';
    ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(g.getSourceDataAtCell(0, 0)).toBe(1);
    const ed2 = typeText('4');
    ed2.value = '42.5';
    ed2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(g.getSourceDataAtCell(0, 0)).toBe(42.5);
  });

  it('clears the selection with Delete and supports undo/redo', () => {
    const g = make([[1, 2], [3, '=SUM(A1:B1)']]);
    g.selectCell(0, 0, 0, 1);
    key('Delete');
    expect(g.getDataAtCell(1, 1)).toBe(0);
    key('z', { ctrlKey: true });
    expect(g.getDataAtCell(1, 1)).toBe(3);
    key('y', { ctrlKey: true });
    expect(g.getDataAtCell(1, 1)).toBe(0);
  });

  it('copies and pastes inside the grid with relative formula shifting', () => {
    const g = make([[1, 10, '=A1+B1'], [2, 20, null], [3, 30, null]]);
    g.selectCell(0, 2);
    const text = g.copy()!;
    expect(text).toBe('11');
    g.selectCell(1, 2, 2, 2);
    g.paste(text);
    expect(g.getSourceDataAtCell(1, 2)).toBe('=A2+B2');
    expect(g.getSourceDataAtCell(2, 2)).toBe('=A3+B3');
    expect(g.getDataAtCell(2, 2)).toBe(33);
  });

  it('pastes external TSV and grows the grid', () => {
    const g = make([[null]]);
    g.selectCell(0, 0);
    g.paste('a\t1\nb\t2\n');
    expect(g.countRows()).toBe(2);
    expect(g.countCols()).toBe(2);
    expect(g.getSourceDataAtCell(1, 1)).toBe(2);
  });

  it('inserts and removes rows, rewriting formulas, with undo', () => {
    const g = make([[1], [2], ['=SUM(A1:A2)']]);
    g.alter('insert_row_above', 1);
    expect(g.countRows()).toBe(4);
    expect(g.getSourceDataAtCell(3, 0)).toBe('=SUM(A1:A3)');
    g.setDataAtCell(1, 0, 5);
    expect(g.getDataAtCell(3, 0)).toBe(8);
    g.alter('remove_row', 0);
    expect(g.getSourceDataAtCell(2, 0)).toBe('=SUM(A1:A2)');
    expect(g.getDataAtCell(2, 0)).toBe(7);
    g.undo();
    expect(g.countRows()).toBe(4);
    expect(g.getDataAtCell(3, 0)).toBe(8);
  });

  it('inserts columns and resizes them', () => {
    const g = make([[1, '=A1*2']]);
    g.alter('insert_col_start', 0, 2);
    expect(g.getSourceDataAtCell(0, 3)).toBe('=C1*2');
    g.setColWidth(0, 180);
    expect(g.getColWidth(0)).toBe(180);
  });
});
