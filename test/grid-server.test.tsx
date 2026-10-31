import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { CenituGrid, enUS, type CellMeta, type GridOptions, type ServerQuery } from '../src';
import { CenituTable } from '../src/react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let grid: CenituGrid;
afterEach(() => {
  grid?.destroy();
  document.body.textContent = '';
});

const columns: CellMeta[] = [
  { id: 'code', data: 'code', sortable: true, serverFilter: { kind: 'text' } },
  { id: 'status', data: 'status', sortable: true, serverFilter: { kind: 'list', options: [{ value: 'open', label: 'Açık' }, { value: 'done', label: 'Bitti' }] } },
  { id: 'due', data: 'due', serverFilter: { kind: 'date' } },
  { id: 'paid', data: 'paid', serverFilter: { kind: 'boolean' } },
  { id: 'partner', data: 'partner.name' },
];

const rows = (from = 1, count = 3) =>
  Array.from({ length: count }, (_, i) => ({ id: from + i, code: `K${from + i}`, status: 'open', due: 46000, paid: false, partner: { name: 'Acme' } }));

function make(opts: GridOptions = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  grid = new CenituGrid(host, {
    dataMode: 'server', rowKey: 'id', data: rows(), columns, totalCount: 120,
    query: { pageSize: 25 }, language: enUS, ...opts,
  });
  const queries: [ServerQuery, string][] = [];
  grid.addHook('afterQueryChange', (q, reason) => queries.push([q, reason]));
  return { g: grid, queries };
}

const buttons = (cls: string) => [...document.querySelectorAll<HTMLButtonElement>(`${cls} button`)];
const next = () => buttons('.ct-pager')[1];
const prev = () => buttons('.ct-pager')[0];
const openMenu = (g: CenituGrid, col: number) =>
  g.root.querySelectorAll<HTMLElement>('.ct-colhead .ct-menu-btn')[col].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
const menuButton = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.ct-menu button')].find((b) => b.textContent === text)!;

describe('server queries', () => {
  it('never sorts or filters itself: it only asks', () => {
    const { g, queries } = make();
    g.sort(0, 'desc');
    expect(g.getData().map((r) => r[0])).toEqual(['K1', 'K2', 'K3']);
    expect(queries[0][0].sort).toEqual([{ field: 'code', desc: true }]);
    expect(queries[0][1]).toBe('sort');
    g.setFilter(0, { condition: { op: 'equals', value: 'K1' } });
    expect(g.countRows()).toBe(3);
    expect(queries).toHaveLength(1);
  });

  it('ignores sorting on columns the server cannot sort', () => {
    const { g, queries } = make();
    g.sort(4, 'asc');
    expect(queries[0][0].sort).toEqual([]);
  });

  it('returns to page 1 on sort, filter and page size, not on page changes', () => {
    const { g, queries } = make({ query: { page: 3, pageSize: 25 } });
    g.sort(0, 'asc');
    expect(queries.at(-1)![0].page).toBe(1);
    g.setQuery({ page: 3 }, 'page');
    expect(queries.at(-1)![0].page).toBe(3);
    g.setServerFilter('status', { kind: 'list', values: ['open'] });
    expect(queries.at(-1)![0].page).toBe(1);
    g.setQuery({ page: 2 }, 'page');
    g.setQuery({ pageSize: 50 }, 'pageSize');
    expect(queries.at(-1)![0]).toMatchObject({ page: 1, pageSize: 50 });
    g.setQuery({ search: 'vida' }, 'search');
    expect(queries.at(-1)![1]).toBe('search');
  });

  it('keeps query field ids valid after hiding and moving columns', () => {
    const { g, queries } = make();
    g.sort(1, 'asc');
    g.moveColumns(1, 1, 5);
    g.hideColumns([0]);
    expect(g.getSortKeys()).toEqual([{ col: 4, order: 'asc' }]);
    expect(g.getColumnId(4)).toBe('status');
    g.sort(4, 'desc');
    expect(queries.at(-1)![0].sort).toEqual([{ field: 'status', desc: true }]);
    expect(g.root.querySelectorAll('.ct-sort')[3]?.textContent).toBe('▼');
  });

  it('gives a query set from outside without asking again', () => {
    const { g, queries } = make();
    g.updateSettings({ query: { page: 2, sort: [{ field: 'code', desc: true }] } });
    expect(queries).toEqual([]);
    expect(g.getQuery()).toMatchObject({ page: 2 });
    expect(g.getSortState()).toEqual({ col: 0, order: 'desc' });
  });

  it('hands out copies of the query', () => {
    const { g } = make();
    g.getQuery()!.filters.x = { kind: 'text', value: 'y' };
    expect(g.getQuery()!.filters).toEqual({});
  });
});

describe('page bar', () => {
  it('shows the range and moves between pages', () => {
    const { g, queries } = make();
    const bar = document.querySelector('.ct-pager')!;
    expect(bar.textContent).toContain('1–25 of 120');
    expect(bar.textContent).toContain('1 / 5');
    expect(prev().disabled).toBe(true);
    next().click();
    expect(queries[0][0].page).toBe(2);
    expect(queries[0][1]).toBe('page');
    expect(bar.textContent).toContain('26–50 of 120');
    expect(prev().disabled).toBe(false);
    g.updateSettings({ query: { page: 5 } });
    expect(next().disabled).toBe(true);
    expect(bar.textContent).toContain('101–120 of 120');
  });

  it('changes the page size and offers the configured sizes', () => {
    const { queries } = make({ pageSizes: [10, 50], query: { pageSize: 10 } });
    const select = document.querySelector<HTMLSelectElement>('.ct-pager select')!;
    expect([...select.options].map((o) => o.value)).toEqual(['10', '50']);
    select.value = '50';
    select.dispatchEvent(new Event('change'));
    expect(queries[0]).toMatchObject([{ pageSize: 50, page: 1 }, 'pageSize']);
  });

  it('has a slot for actions, can be turned off, and leaves with the grid', () => {
    const { g } = make({ pagerActions: (slot) => (slot.textContent = 'Dışa aktar') });
    expect(document.querySelector('.ct-pager-actions')!.textContent).toBe('Dışa aktar');
    g.destroy();
    expect(document.querySelector('.ct-pager')).toBeNull();
    make({ pager: false });
    expect(document.querySelector('.ct-pager')).toBeNull();
  });

  it('does not exist in client mode', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    grid = new CenituGrid(host, { data: [[1]] });
    expect(document.querySelector('.ct-pager')).toBeNull();
    expect(grid.getQuery()).toBeUndefined();
  });
});

describe('column menu', () => {
  it('appears only on columns the server supports', () => {
    const { g } = make();
    const hidden = [...g.root.querySelectorAll<HTMLElement>('.ct-colhead .ct-menu-btn')].map((b) => b.hidden);
    expect(hidden).toEqual([false, false, false, false, true]);
  });

  it('sorts without offering "then sort"', () => {
    const { g, queries } = make();
    g.sort(1, 'asc');
    openMenu(g, 0);
    expect(document.querySelector('.ct-menu')!.textContent).not.toContain('Then sort');
    menuButton('Sort Z → A').click();
    expect(queries.at(-1)![0].sort).toEqual([{ field: 'code', desc: true }]);
  });

  it('filters by text', () => {
    const { g, queries } = make();
    openMenu(g, 0);
    document.querySelector<HTMLInputElement>('.ct-menu input[type=text]')!.value = 'K1';
    menuButton('OK').click();
    expect(queries[0][0].filters).toEqual({ code: { kind: 'text', value: 'K1' } });
    expect(g.root.querySelector('.ct-colhead')!.className).toContain('ct-filtered');
  });

  it('filters by list with labels from outside, not from the loaded rows', () => {
    const { g, queries } = make();
    openMenu(g, 1);
    const labels = [...document.querySelectorAll('.ct-menu-list label')];
    expect(labels.map((l) => l.textContent)).toEqual(['Açık', 'Bitti']);
    labels[1].querySelector('input')!.checked = true;
    menuButton('OK').click();
    expect(queries[0][0].filters.status).toEqual({ kind: 'list', values: ['done'] });
  });

  it('filters by date range and yes/no, shows current values and clears', () => {
    const { g, queries } = make({ query: { filters: { due: { kind: 'date', from: '2026-01-01' } } } });
    openMenu(g, 2);
    const [from, to] = document.querySelectorAll<HTMLInputElement>('.ct-menu input[type=date]');
    expect(from.value).toBe('2026-01-01');
    to.value = '2026-02-01';
    menuButton('OK').click();
    expect(queries[0][0].filters.due).toEqual({ kind: 'date', from: '2026-01-01', to: '2026-02-01' });
    openMenu(g, 3);
    const select = document.querySelector<HTMLSelectElement>('.ct-menu select')!;
    select.value = 'false';
    menuButton('OK').click();
    expect(queries[1][0].filters.paid).toEqual({ kind: 'boolean', value: false });
    openMenu(g, 2);
    menuButton('Clear filter').click();
    expect(queries[2][0].filters).toEqual({ paid: { kind: 'boolean', value: false } });
  });
});

describe('new pages', () => {
  it('keeps query, layout, hidden columns and scroll; resets row state and history', () => {
    const { g } = make();
    g.sort(0, 'desc');
    g.setColWidth(1, 222);
    g.hideColumns([2]);
    g.setDataAtCell(0, 0, 'x');
    g.root.scrollTop = 40;
    g.setPageRows(rows(26, 5), 200);
    expect(g.countRows()).toBe(5);
    expect(g.getDataAtCell(0, 0)).toBe('K26');
    expect(g.getSortState()).toEqual({ col: 0, order: 'desc' });
    expect(g.getColWidth(1)).toBe(222);
    expect(g.getHiddenColumns()).toEqual([2]);
    expect(g.root.scrollTop).toBe(40);
    expect(g.isUndoAvailable()).toBe(false);
    expect(document.querySelector('.ct-pager')!.textContent).toContain('of 200');
  });

  it('selection follows its row by key and otherwise stays in range', () => {
    const { g } = make({ data: rows(1, 5) });
    g.selectCell(4, 1);
    g.setPageRows([...rows(3, 3).reverse()]);
    expect(g.getSelected()).toEqual([[0, 1, 0, 1]]);
    g.selectCell(2, 0);
    g.setPageRows(rows(50, 2));
    expect(g.getSelected()).toEqual([[1, 0, 1, 0]]);
  });

  it('reports edits with row and column ids, which survive a page change', () => {
    const { g } = make();
    const seen: unknown[] = [];
    g.addHook('afterChange', (ch) => seen.push([ch[0].rowKey, ch[0].columnId, ch[0].newValue]));
    g.setDataAtCell(1, 1, 'done');
    expect(seen).toEqual([[2, 'status', 'done']]);
  });

  it('accepts a function as rowKey', () => {
    const { g } = make({ rowKey: (r) => `row-${(r as { id: number }).id}` });
    let key: unknown;
    g.addHook('afterChange', (ch) => (key = ch[0].rowKey));
    g.setDataAtCell(0, 0, 'x');
    expect(key).toBe('row-1');
  });

  it('switches a 50-row page of a large list quickly', () => {
    const { g } = make({ data: rows(1, 50), totalCount: 100000, query: { pageSize: 50 } });
    const page = rows(51, 50);
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) g.setPageRows(page);
    const ms = (performance.now() - t0) / 100;
    console.log(`page switch: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(50);
  });
});

describe('loading, empty and error states', () => {
  const status = () => document.querySelector<HTMLElement>('.ct-status');

  it('keeps old rows dimmed while loading', () => {
    const { g } = make();
    g.updateSettings({ loading: true });
    expect(g.root.getAttribute('aria-busy')).toBe('true');
    expect(g.getDataAtCell(0, 0)).toBe('K1');
    expect(status()).toBeNull();
    expect(document.querySelector('.ct-pager')!.textContent).toContain('of 120');
    g.updateSettings({ loading: false });
    expect(g.root.getAttribute('aria-busy')).toBe('false');
  });

  it('shows loading before the first page, then the empty state', () => {
    const { g } = make({ data: [], totalCount: 0, loading: true });
    expect(g.countRows()).toBe(0);
    expect(status()!.textContent).toBe('Loading…');
    g.updateSettings({ loading: false });
    expect(status()!.textContent).toBe('No records');
    g.setPageRows(rows(), 3);
    expect(status()).toBeNull();
  });

  it('keeps headers and column menus on an empty page, so a filter can be cleared', () => {
    const { g, queries } = make({ query: { filters: { code: { kind: 'text', value: 'yok' } } } });
    g.setPageRows([], 0);
    expect(g.countCols()).toBe(5);
    expect(g.root.querySelectorAll('.ct-colhead').length).toBe(5);
    openMenu(g, 0);
    menuButton('Clear filter').click();
    expect(queries[0][0].filters).toEqual({});
  });

  it('shows errors above the old rows, and custom content', () => {
    const { g } = make();
    g.updateSettings({ loadError: true });
    expect(status()!.textContent).toBe('Could not load the data');
    expect(status()!.getAttribute('role')).toBe('alert');
    expect(g.getDataAtCell(0, 0)).toBe('K1');
    g.updateSettings({ loadError: 'Sunucu yanıt vermedi' });
    expect(status()!.textContent).toBe('Sunucu yanıt vermedi');
    g.updateSettings({ loadError: false });
    expect(status()).toBeNull();
    g.destroy();
    make({ data: [], renderStatus: (el, state) => (el.textContent = `özel ${state}`) });
    expect(status()!.textContent).toBe('özel empty');
  });
});

describe('what only sees the loaded page', () => {
  it('has formulas off unless asked for', () => {
    const { g } = make({ data: [{ code: '=1+1' }] });
    expect(g.getEngine()).toBeUndefined();
    expect(g.getDataAtCell(0, 0)).toBe('=1+1');
  });

  it('refuses local row inserts and removes, also in the context menu', () => {
    const { g } = make({ contextMenu: (entries) => entries });
    g.alter('insert_row_below', 0);
    g.alter('remove_row', 0);
    expect(g.countRows()).toBe(3);
    g.selectCell(0, 0);
    g.openContextMenu(1, 1);
    expect(document.querySelector('.ct-context [data-key="row_above"]')).toBeNull();
    expect(document.querySelector('.ct-context [data-key="col_left"]')).not.toBeNull();
  });

  it('clips a paste to the loaded rows and says how much was lost', () => {
    const { g } = make();
    let lost = 0;
    g.addHook('afterPasteClipped', (n) => (lost = n));
    g.selectCell(2, 0);
    g.paste('a\nb\nc');
    expect(g.countRows()).toBe(3);
    expect(g.getDataAtCell(2, 0)).toBe('a');
    expect(lost).toBe(2);
  });

  it('autofill stops at the loaded rows', () => {
    const { g } = make();
    g.autofill({ start: { row: 0, col: 0 }, end: { row: 0, col: 0 } }, { start: { row: 1, col: 0 }, end: { row: 9, col: 0 } });
    expect(g.countRows()).toBe(3);
  });
});

describe('React', () => {
  it('runs a full server loop: query in state, stale props, rows from the fetch', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let setRows!: (r: ReturnType<typeof rows>) => void;
    const asked: number[] = [];
    function App() {
      const [query, setQuery] = useState<Partial<ServerQuery>>({ page: 1, pageSize: 25 });
      const [data, set] = useState(rows());
      setRows = set;
      return (
        <CenituTable
          dataMode="server" rowKey="id" data={data} columns={columns} query={query} totalCount={120}
          language={enUS}
          onQueryChange={(q) => {
            asked.push(q.page);
            setQuery(q);
          }}
        />
      );
    }
    act(() => root.render(<App />));
    act(() => next().click());
    expect(asked).toEqual([2]);
    expect(document.querySelector('.ct-pager')!.textContent).toContain('2 / 5');
    act(() => setRows(rows(26)));
    expect(host.textContent).toContain('K26');
    expect(document.querySelector('.ct-pager')!.textContent).toContain('2 / 5');
    expect(asked).toEqual([2]);
    act(() => root.unmount());
    expect(document.querySelector('.ct-pager')).toBeNull();
  });
});
