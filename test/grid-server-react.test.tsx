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
  { id: 'code', data: 'code', sortable: true },
  { id: 'status', data: 'status', sortable: true, serverFilter: { kind: 'number' } },
];
const rows = (from = 1, n = 2) => Array.from({ length: n }, (_, i) => ({ id: from + i, code: `K${from + i}`, status: 1 }));

function make(opts: GridOptions = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  grid = new CenituGrid(host, { dataMode: 'server', rowKey: 'id', data: rows(), columns, totalCount: 100, language: enUS, ...opts });
  return grid;
}

const type = (g: CenituGrid, text: string) => {
  const ta = g.root.querySelector('textarea')!;
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
};
const openMenu = (g: CenituGrid, col: number) =>
  g.root.querySelectorAll<HTMLElement>('.ct-colhead .ct-menu-btn')[col].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
const menuButton = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.ct-menu button')].find((b) => b.textContent === text)!;

function mount(ui: (bump: () => void) => React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  let force!: () => void;
  function Shell() {
    const [, set] = useState(0);
    force = () => set((n) => n + 1);
    return ui(() => force());
  }
  act(() => root.render(<Shell />));
  return { host, root, rerender: () => act(() => force()) };
}

describe('React: re-renders are not new pages', () => {
  it('keeps an open editor and undo when data is a new array of the same rows', () => {
    const items = rows();
    let g: CenituGrid | null = null;
    const { root, rerender } = mount(() => (
      <CenituTable ref={(r) => void (g = r)} dataMode="server" rowKey="id" data={items.map((x) => ({ ...x }))} columns={columns} language={enUS} />
    ));
    act(() => g!.setDataAtCell(0, 0, 'değişti'));
    act(() => g!.selectCell(1, 0));
    act(() => g!.openEditor());
    type(g!, 'yazılıyor');
    rerender();
    expect(g!.isEditing()).toBe(true);
    expect(g!.isUndoAvailable()).toBe(true);
    expect(g!.getDataAtCell(0, 0)).toBe('değişti');
    act(() => g!.closeEditor(true));
    expect(g!.getDataAtCell(1, 0)).toBe('yazılıyor');
    act(() => root.unmount());
  });

  it('still shows genuinely new rows, also with equal length', () => {
    let setItems!: (r: ReturnType<typeof rows>) => void;
    let g: CenituGrid | null = null;
    function App() {
      const [items, set] = useState(rows());
      setItems = set;
      return <CenituTable ref={(r) => void (g = r)} dataMode="server" rowKey="id" data={items} columns={columns} />;
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<App />));
    act(() => setItems(rows(50)));
    expect(g!.getDataAtCell(0, 0)).toBe('K50');
    act(() => setItems(rows(50).map((r) => ({ ...r, code: 'yeni' }))));
    expect(g!.getDataAtCell(0, 0)).toBe('yeni');
    act(() => root.unmount());
  });

  it('keeps rows while loading with an empty array, and clears them when the result is empty', () => {
    let setState!: (s: { items?: ReturnType<typeof rows>; loading: boolean }) => void;
    let g: CenituGrid | null = null;
    function App() {
      const [s, set] = useState<{ items?: ReturnType<typeof rows>; loading: boolean }>({ items: rows(), loading: false });
      setState = set;
      return <CenituTable ref={(r) => void (g = r)} dataMode="server" rowKey="id" data={s.items ?? []} loading={s.loading} columns={columns} />;
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<App />));
    act(() => setState({ loading: true }));
    expect(g!.countRows()).toBe(2);
    act(() => setState({ items: [], loading: false }));
    expect(g!.countRows()).toBe(0);
    act(() => root.unmount());
  });

  it('ignores an outdated answer through dataRequestId', () => {
    let setData!: (d: { items: ReturnType<typeof rows>; id: number }) => void;
    let g: CenituGrid | null = null;
    function App() {
      const [d, set] = useState({ items: rows(), id: 0 });
      setData = set;
      return <CenituTable ref={(r) => void (g = r)} dataMode="server" rowKey="id" data={d.items} dataRequestId={d.id} columns={columns} />;
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<App />));
    act(() => g!.setQuery({ page: 2 }, 'page'));
    act(() => g!.setQuery({ page: 3 }, 'page'));
    act(() => setData({ items: rows(51), id: 1 }));
    expect(g!.getDataAtCell(0, 0)).toBe('K1');
    act(() => setData({ items: rows(101), id: 2 }));
    expect(g!.getDataAtCell(0, 0)).toBe('K101');
    act(() => root.unmount());
  });

  it('passes onBeforeQueryChange, reading the latest function', () => {
    let allow = false;
    let g: CenituGrid | null = null;
    const asked: number[] = [];
    const { root } = mount(() => (
      <CenituTable ref={(r) => void (g = r)} dataMode="server" data={rows()} columns={columns}
        onBeforeQueryChange={() => allow} onQueryChange={(q) => asked.push(q.page)} />
    ));
    act(() => g!.setQuery({ page: 2 }, 'page'));
    expect(asked).toEqual([]);
    allow = true;
    act(() => g!.setQuery({ page: 2 }, 'page'));
    expect(asked).toEqual([2]);
    act(() => root.unmount());
  });
});

describe('page refreshes and open editors', () => {
  it('keeps editing the same record when it moved within the page', () => {
    const g = make();
    g.selectCell(1, 0);
    g.openEditor();
    type(g, 'yazı');
    g.setPageRows([...rows()].reverse());
    expect(g.isEditing()).toBe(true);
    g.closeEditor(true);
    expect(g.getDataAtCell(0, 0)).toBe('yazı');
    expect(g.getDataAtCell(1, 0)).toBe('K1');
  });

  it('commits to its own record when that record is gone', () => {
    const g = make();
    const seen: unknown[] = [];
    g.addHook('afterChange', (ch) => seen.push([ch[0].rowKey, ch[0].newValue]));
    g.selectCell(0, 0);
    g.openEditor();
    type(g, 'kaydet');
    g.setPageRows(rows(50));
    expect(g.isEditing()).toBe(false);
    expect(seen).toEqual([[1, 'kaydet']]);
    expect(g.getDataAtCell(0, 0)).toBe('K50');
  });

  it('commits before asking for another page', () => {
    const g = make();
    const order: string[] = [];
    g.addHook('afterChange', () => void order.push('change'));
    g.addHook('afterQueryChange', () => void order.push('query'));
    g.selectCell(0, 0);
    g.openEditor();
    type(g, 'x');
    g.setQuery({ page: 2 }, 'page');
    expect(order).toEqual(['change', 'query']);
  });
});

describe('requestId', () => {
  it('grows with every change and refuses older answers', () => {
    const g = make();
    expect(g.getQuery()!.requestId).toBeUndefined();
    g.setQuery({ page: 2 }, 'page');
    const first = g.getQuery()!.requestId!;
    g.setQuery({ page: 3 }, 'page');
    expect(g.setPageRows(rows(51), 100, { requestId: first })).toBe(false);
    expect(g.getDataAtCell(0, 0)).toBe('K1');
    expect(g.setPageRows(rows(101), 100, { requestId: first + 1 })).toBe(true);
    expect(g.getDataAtCell(0, 0)).toBe('K101');
  });

  it('stays optional', () => {
    const g = make();
    g.setQuery({ page: 2 }, 'page');
    expect(g.setPageRows(rows(51))).toBe(true);
  });
});

describe('beforeQueryChange', () => {
  it('can stop a change, leaving query and controls as they were', () => {
    const g = make();
    const seen: unknown[] = [];
    const asked: unknown[] = [];
    g.addHook('beforeQueryChange', (next, reason) => (seen.push([next.pageSize, reason]), false));
    g.addHook('afterQueryChange', (q) => void asked.push(q));
    const select = document.querySelector<HTMLSelectElement>('.ct-pager select')!;
    select.value = '100';
    select.dispatchEvent(new Event('change'));
    expect(seen).toEqual([[100, 'pageSize']]);
    expect(asked).toEqual([]);
    expect(select.value).toBe('25');
    expect(g.getQuery()!.pageSize).toBe(25);
  });
});

describe('sorting by several columns on the server', () => {
  it('stays single unless opted in', () => {
    const g = make();
    g.sort(1, 'asc');
    openMenu(g, 0);
    expect(document.querySelector('.ct-menu')!.textContent).not.toContain('Then sort');
  });

  it('adds keys from the menu up to the limit, with priorities in the headers', () => {
    const g = make({ maxSortKeys: 2 });
    let query!: ServerQuery;
    g.addHook('afterQueryChange', (q) => void (query = q));
    g.sort(1, 'desc');
    openMenu(g, 0);
    menuButton('Then sort A → Z').click();
    expect(query.sort).toEqual([{ field: 'status', desc: true }, { field: 'code', desc: false }]);
    expect([...g.root.querySelectorAll('.ct-colhead .ct-sort')].map((e) => e.textContent)).toEqual(['▲2', '▼1']);
    expect(query.page).toBe(1);
    g.sortBy([{ col: 0, order: 'asc' }, { col: 1, order: 'asc' }]);
    expect(query.sort).toHaveLength(2);
  });

  it('does not offer a key beyond the limit, and trims API calls to it', () => {
    const g = make({ maxSortKeys: 1 });
    g.sortBy([{ col: 0, order: 'asc' }, { col: 1, order: 'asc' }]);
    expect(g.getQuery()!.sort).toHaveLength(1);
    openMenu(g, 1);
    expect(document.querySelector('.ct-menu')!.textContent).not.toContain('Then sort');
  });
});

describe('number filter', () => {
  it('sends a range, shows it again and clears', () => {
    const g = make({ query: { filters: { status: { kind: 'number', min: 5 } } } });
    let query!: ServerQuery;
    g.addHook('afterQueryChange', (q) => void (query = q));
    openMenu(g, 1);
    const [min, max] = document.querySelectorAll<HTMLInputElement>('.ct-menu input[type=number]');
    expect(min.value).toBe('5');
    max.value = '0';
    menuButton('OK').click();
    expect(query.filters.status).toEqual({ kind: 'number', min: 5, max: 0 });
    openMenu(g, 1);
    menuButton('Clear filter').click();
    expect(query.filters).toEqual({});
  });
});

describe('automatic row detail height', () => {
  it('follows the measured content', () => {
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList.contains('ct-detail-body') ? 90 : 0; } });
    try {
      const host = document.createElement('div');
      document.body.appendChild(host);
      grid = new CenituGrid(host, { data: [['a'], ['b']], rowDetail: (el) => void (el.textContent = 'x'), rowDetailHeight: 'auto' });
      grid.toggleRowDetail(0);
      grid.render();
      expect(grid.root.querySelector<HTMLElement>('.ct-detail')!.style.height).toBe('90px');
      expect(grid.getRowHeight(0)).toBe(24);
      expect([...grid.root.querySelectorAll<HTMLElement>('.ct-cell')][1].style.top).toBe('114px');
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height!);
    }
  });
});
