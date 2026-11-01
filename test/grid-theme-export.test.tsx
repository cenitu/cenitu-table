import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { CenituGrid, readXLSX, toXLSX, type CellMeta, type GridOptions } from '../src';
import { CenituTable } from '../src/react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let grid: CenituGrid;
afterEach(() => {
  grid?.destroy();
  document.body.textContent = '';
});

function make(opts: GridOptions) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  grid = new CenituGrid(host, opts);
  return grid;
}

describe('exporting the full result', () => {
  const all = [
    { id: 1, tutar: 10.5, durum: 2, cari: { ad: '=KOTU()' } },
    { id: 2, tutar: 20, durum: 1, cari: { ad: 'Acme' } },
    { id: 3, tutar: 30, durum: 1, cari: { ad: 'Beta' } },
  ];
  const columns: CellMeta[] = [
    { id: 'tutar', data: 'tutar', type: 'numeric', numericFormat: { style: 'currency', currency: 'TRY' } },
    { id: 'durum', data: 'durum', type: 'dropdown', source: [{ value: 1, label: 'Açık' }, { value: 2, label: 'Kapalı' }] },
    { id: 'cari', data: 'cari.ad' },
  ];
  const setup = (seen: unknown[] = []) =>
    make({
      dataMode: 'server', rowKey: 'id', data: all.slice(0, 1), columns, totalCount: 3, locale: 'tr-TR', query: { sort: [{ field: 'tutar', desc: true }] },
      fetchAllRows: async (q) => {
        seen.push(q);
        return all;
      },
    });

  it('asks the application with the current query and exports every row', async () => {
    const seen: unknown[] = [];
    const g = setup(seen);
    const sheet = await g.toExportSheetAll();
    expect(sheet.data).toHaveLength(3);
    expect(sheet.data[1]).toEqual([20, 1, 'Acme']);
    expect(seen).toEqual([g.getQuery()]);
    expect(g.countRows()).toBe(1);
  });

  it('keeps labels and number formats, and protects against formula injection in CSV', async () => {
    const g = setup();
    const csv = await g.exportAllCSV({ values: 'formatted' });
    expect(csv).toContain('Kapalı');
    expect(csv).toContain("'=KOTU()");
    expect(csv).not.toMatch(/;=KOTU/);
    const book = await readXLSX(toXLSX([await g.toExportSheetAll()]));
    expect(book.sheets[0].format(0, 0)?.numberFormat).toContain('₺');
  });

  it('never writes server text as a formula, in the full result or the loaded page', async () => {
    const g = setup();
    const full = await readXLSX(toXLSX([await g.toExportSheetAll()]));
    expect(full.sheets[0].data[0][2]).toBe("'=KOTU()");
    const page = await readXLSX(toXLSX([g.toExportSheet()]));
    expect(page.sheets[0].data[0][2]).toBe("'=KOTU()");
  });

  it('exports array rows too, and fails clearly when it cannot', async () => {
    const g = setup();
    g.destroy();
    const arrays = make({ dataMode: 'server', data: [[1]], columns: [{}], fetchAllRows: async () => [[1], [2]] });
    expect((await arrays.toExportSheetAll()).data).toEqual([[1], [2]]);
    arrays.destroy();
    await expect(make({ data: [[1]] }).toExportSheetAll()).rejects.toThrow('fetchAllRows');
  });

  it('leaves the loaded-page exports as they were', () => {
    const g = setup();
    expect(g.toExportSheet().data).toHaveLength(1);
  });
});

describe('live theme', () => {
  const classes = (s: string) => document.querySelector(s)!.className;

  it('applies to the grid, bar and page bar without rebuilding', () => {
    const g = make({ dataMode: 'server', data: [], columns: [{}], formulaBar: true, theme: 'dark' });
    const root = g.root;
    for (const s of ['.ct-root', '.ct-bar', '.ct-pager']) expect(classes(s)).toContain('ct-dark');
    g.updateSettings({ theme: 'light' });
    expect(g.root).toBe(root);
    for (const s of ['.ct-root', '.ct-bar', '.ct-pager']) {
      expect(classes(s)).toContain('ct-light');
      expect(classes(s)).not.toContain('ct-dark');
    }
    g.updateSettings({ theme: 'auto' });
    expect(classes('.ct-root')).not.toMatch(/ct-(light|dark)/);
  });

  it('reaches menus and an open search box', () => {
    const g = make({ data: [['a']], theme: 'dark', contextMenu: true, search: true });
    g.selectCell(0, 0);
    g.openContextMenu(1, 1);
    expect(classes('.ct-context')).toContain('ct-dark');
    g.openSearch();
    g.updateSettings({ theme: 'light' });
    expect(classes('.ct-search')).toContain('ct-light');
  });

  it('follows the React prop', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<CenituTable data={[[1]]} theme="dark" />));
    expect(classes('.ct-root')).toContain('ct-dark');
    act(() => root.render(<CenituTable data={[[1]]} theme="light" />));
    expect(classes('.ct-root')).toContain('ct-light');
    act(() => root.unmount());
  });
});
