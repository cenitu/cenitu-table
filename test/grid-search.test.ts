import { afterEach, describe, expect, it } from 'vitest';
import { CenituGrid, enUS, type GridOptions } from '../src';
import { matchSpans } from '../src/grid/search';

let grid: CenituGrid;
afterEach(() => grid?.destroy());

function make(opts: GridOptions) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  grid = new CenituGrid(host, opts);
  return grid;
}

describe('matchSpans', () => {
  it('folds case with the locale and maps back to original indexes', () => {
    expect(matchSpans('ISPARTA', 'ısparta', {}, 'tr-TR')).toEqual([[0, 7]]);
    expect(matchSpans('ISPARTA', 'isparta', {}, 'tr-TR')).toEqual([]);
    expect(matchSpans('aİb', 'b', {}, 'en-US')).toEqual([[2, 3]]);
    expect(matchSpans('aXa', 'x', { matchCase: true })).toEqual([]);
    expect(matchSpans('abab', 'ab')).toEqual([[0, 2], [2, 4]]);
    expect(matchSpans('abc', 'ab', { wholeCell: true })).toEqual([]);
    expect(matchSpans('abc', '')).toEqual([]);
  });
});

describe('find', () => {
  const data = [['Vida', 10, '=B1*2'], ['Somun', 20, '=B2*2'], ['vida büyük', 30, '=B3*2']];

  it('finds displayed values in reading order, formulas on request', () => {
    const g = make({ data });
    expect(g.findCells('vida')).toEqual([{ row: 0, col: 0 }, { row: 2, col: 0 }]);
    expect(g.findCells('Vida', { matchCase: true })).toEqual([{ row: 0, col: 0 }]);
    expect(g.findCells('vida', { wholeCell: true })).toEqual([{ row: 0, col: 0 }]);
    expect(g.findCells('40')).toEqual([{ row: 1, col: 2 }]);
    expect(g.findCells('B2')).toEqual([]);
    expect(g.findCells('B2', { lookIn: 'formulas' })).toEqual([{ row: 1, col: 2 }]);
  });

  it('follows the view: sorted order, filters and hidden columns', () => {
    const g = make({ data });
    g.sort(1, 'desc');
    expect(g.findCells('vida').map((h) => h.row)).toEqual([0, 2]);
    g.setFilter(1, { condition: { op: 'lessThan', value: '30' } });
    expect(g.findCells('vida büyük')).toEqual([]);
    g.hideColumns([0]);
    expect(g.findCells('vida')).toEqual([]);
  });

  it('moves through matches and wraps around in both directions', () => {
    const g = make({ data });
    g.selectCell(0, 0);
    expect(g.findNext('vida')).toEqual({ row: 2, col: 0 });
    expect(g.findNext('vida')).toEqual({ row: 0, col: 0 });
    expect(g.findNext('vida', {}, true)).toEqual({ row: 2, col: 0 });
    expect(g.getSelected()).toEqual([[2, 0, 2, 0]]);
    expect(g.findNext('yok')).toBeNull();
  });

  it('skips cells covered by a merge', () => {
    const g = make({ data: [['x', 'x']], mergeCells: [{ row: 0, col: 0, rowspan: 1, colspan: 2 }] });
    expect(g.findCells('x')).toEqual([{ row: 0, col: 0 }]);
  });
});

describe('replace', () => {
  it('replaces all in one undo step, leaving formulas and read-only cells alone', () => {
    const g = make({ data: [['aa', '=A1&"a"', 'a'], ['ba', null, null]], columns: [{}, {}, { readOnly: true }] });
    const seen: string[] = [];
    g.addHook('afterChange', (_, source) => seen.push(source));
    expect(g.replaceAll('a', 'x')).toBe(2);
    expect(g.getSourceData()).toEqual([['xx', '=A1&"a"', 'a'], ['bx', null, null]]);
    expect(seen).toEqual(['replace']);
    g.undo();
    expect(g.getSourceDataAtCell(0, 0)).toBe('aa');
    expect(g.getSourceDataAtCell(1, 0)).toBe('ba');
  });

  it('changes formula text with lookIn: formulas and re-reads numbers', () => {
    const g = make({ data: [[1, 2, '=A1+A1'], [12, null, null]] });
    g.replaceAll('A1', 'B1', { lookIn: 'formulas' });
    expect(g.getSourceDataAtCell(0, 2)).toBe('=B1+B1');
    expect(g.getDataAtCell(0, 2)).toBe(4);
    g.replaceAll('12', '34', { lookIn: 'formulas' });
    expect(g.getSourceDataAtCell(1, 0)).toBe(34);
  });

  it('replaceNext changes the active match and moves on', () => {
    const g = make({ data: [['a'], ['a'], ['b']] });
    g.selectCell(0, 0);
    expect(g.replaceNext('a', 'c')).toEqual({ row: 1, col: 0 });
    expect(g.getSourceData().flat()).toEqual(['c', 'a', 'b']);
    g.selectCell(2, 0);
    g.replaceNext('a', 'c');
    expect(g.getSourceData().flat()).toEqual(['c', 'a', 'b']);
  });
});

describe('search box', () => {
  const key = (k: string, init: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });

  it('opens with Ctrl+F only when enabled', () => {
    const g = make({ data: [['a']] });
    g.selectCell(0, 0);
    g.root.querySelector('textarea')!.dispatchEvent(key('f', { ctrlKey: true }));
    expect(document.querySelector('.ct-search')).toBeNull();
    g.updateSettings({ search: true });
    const e = key('f', { ctrlKey: true });
    g.root.querySelector('textarea')!.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(document.querySelector('.ct-search')).not.toBeNull();
    expect(document.querySelector<HTMLElement>('.ct-search-row:nth-child(2)')!.hidden).toBe(true);
  });

  it('counts, highlights, steps with Enter, replaces and cleans up on Escape', () => {
    const g = make({ data: [['elma'], ['armut'], ['elma']], search: true, language: enUS });
    g.selectCell(1, 0);
    g.openSearch(true);
    const [query, replacement] = document.querySelectorAll<HTMLInputElement>('.ct-search input[type=text]');
    expect(document.activeElement).toBe(query);
    query.value = 'elma';
    query.dispatchEvent(new Event('input', { bubbles: true }));
    query.dispatchEvent(key('Enter'));
    expect(document.querySelector('.ct-search-status')!.textContent).toBe('2 / 2');
    expect(g.getSelected()).toEqual([[2, 0, 2, 0]]);
    expect(g.root.querySelectorAll('.ct-match').length).toBe(2);
    replacement.value = 'kiraz';
    const all = [...document.querySelectorAll<HTMLButtonElement>('.ct-search button')].find((b) => b.textContent === 'Replace all')!;
    all.click();
    expect(g.getSourceData().flat()).toEqual(['kiraz', 'armut', 'kiraz']);
    expect(document.querySelector('.ct-search-status')!.textContent).toBe('2 replaced');
    expect(g.root.querySelectorAll('.ct-match').length).toBe(0);
    query.dispatchEvent(key('Escape'));
    expect(document.querySelector('.ct-search')).toBeNull();
    expect(document.activeElement).toBe(g.root.querySelector('textarea'));
  });

  it('offers no replace row on a read-only grid and closes with the grid', () => {
    const g = make({ data: [['a']], search: true, readOnly: true });
    g.openSearch(true);
    expect(document.querySelector<HTMLElement>('.ct-search-row:nth-child(2)')!.hidden).toBe(true);
    g.destroy();
    expect(document.querySelector('.ct-search')).toBeNull();
  });
});
