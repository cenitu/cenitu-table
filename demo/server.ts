import { CenituGrid, fetchAllPages, queryToParams, trTR, type CellMeta, type ServerQuery } from '../src';

type Order = {
  id: number;
  date: string;
  partner: string;
  status: string;
  amount: number;
};

const TOTAL = 100_000;
const partners = ['Akın Metal', 'Bora Makina', 'Çelik Yapı', 'Deniz Lojistik', 'Ege Plastik', 'Işık Elektrik', 'İstanbul Kablo', 'Özgür Döküm'];
const statuses = ['Açık', 'Onaylı', 'Sevk edildi', 'İptal'];

// Stands in for a database: everything below `fetchPage` is what a real backend would do.
const table: Order[] = Array.from({ length: TOTAL }, (_, i) => ({
  id: i + 1,
  date: new Date(Date.UTC(2026, 0, 1 + (i % 300))).toISOString().slice(0, 10),
  partner: partners[(i * 7) % partners.length],
  status: statuses[(i * 3) % statuses.length],
  amount: ((i * 37) % 100000) / 10,
}));

function answer(params: URLSearchParams): { items: Order[]; totalCount: number } {
  const status = params.getAll('status');
  const from = params.get('dateFrom');
  const to = params.get('dateTo');
  const partner = params.get('partner')?.toLocaleLowerCase('tr-TR');
  const min = params.get('amountMin');
  const max = params.get('amountMax');
  let rows = table.filter(
    (o) =>
      (!status.length || status.includes(o.status)) &&
      (!from || o.date >= from) &&
      (!to || o.date <= to) &&
      (!partner || o.partner.toLocaleLowerCase('tr-TR').includes(partner)) &&
      (min === null || o.amount >= Number(min)) &&
      (max === null || o.amount <= Number(max)),
  );
  const by = params.get('sortBy') as keyof Order | null;
  if (by) {
    const sign = params.get('sortDescending') === 'true' ? -1 : 1;
    rows = [...rows].sort((a, b) => sign * (a[by] < b[by] ? -1 : a[by] > b[by] ? 1 : 0));
  }
  const page = Number(params.get('page'));
  const size = Number(params.get('pageSize'));
  return { items: rows.slice((page - 1) * size, page * size), totalCount: rows.length };
}

const failNext = document.getElementById('fail') as HTMLInputElement;

async function fetchPage(query: ServerQuery) {
  await new Promise((done) => setTimeout(done, 250 + Math.random() * 350));
  if (failNext.checked) throw new Error('Sunucuya ulaşılamadı');
  return answer(queryToParams(query));
}

const columns: CellMeta[] = [
  { id: 'id', data: 'id', title: 'No', width: 80, readOnly: true, sortable: true },
  { id: 'date', data: 'date', title: 'Tarih', width: 120, readOnly: true, sortable: true, serverFilter: { kind: 'date' } },
  { id: 'partner', data: 'partner', title: 'Firma', width: 200, sortable: true, serverFilter: { kind: 'text' } },
  { id: 'status', data: 'status', title: 'Durum', width: 130, sortable: true, serverFilter: { kind: 'list', options: statuses.map((value) => ({ value })) } },
  { id: 'amount', data: 'amount', title: 'Tutar', width: 130, type: 'numeric', numericFormat: { style: 'currency', currency: 'TRY' }, sortable: true, serverFilter: { kind: 'number' } },
];

const status = document.getElementById('status')!;
const grid = new CenituGrid(document.getElementById('grid')!, {
  dataMode: 'server',
  rowKey: 'id',
  columns,
  locale: 'tr-TR',
  language: trTR,
  height: 'calc(100vh - 150px)',
  maxSortKeys: 1,
  loading: true,
  contextMenu: true,
  fetchAllRows: (q) => fetchAllPages(fetchPage, q, 5000),
});

async function load(query: ServerQuery) {
  grid.updateSettings({ loading: true, loadError: false });
  const t0 = performance.now();
  try {
    const { items, totalCount } = await fetchPage(query);
    if (grid.setPageRows(items, totalCount, { requestId: query.requestId })) {
      status.textContent = `${Math.round(performance.now() - t0)} ms`;
      grid.updateSettings({ loading: false });
    }
  } catch (e) {
    if (query.requestId === grid.getQuery()?.requestId) grid.updateSettings({ loading: false, loadError: (e as Error).message });
  }
}

grid.addHook('afterQueryChange', load);
grid.addHook('afterChange', (changes) => {
  status.textContent = changes.map((c) => `Kayıt ${c.rowKey}: ${c.columnId} = ${c.newValue}`).join(', ');
});
load(grid.getQuery()!);

document.getElementById('xlsx')!.addEventListener('click', () => {
  status.textContent = 'Tüm sonuç hazırlanıyor…';
  grid.downloadAllXLSX('siparisler.xlsx').then(() => (status.textContent = ''));
});
