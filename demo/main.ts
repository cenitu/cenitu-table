import { CenituGrid, dateToSerial, FormulaEngine, readXLSX, trTR, workbookEngine, type AlterAction, type CellMeta, type RawCell } from '../src';

const products = ['Vida M8', 'Somun M8', 'Pul 8mm', 'Profil 40x40', 'Sac 2mm', 'Rulman 6204', 'Kayış A42', 'Motor 0.75kW'];
const ROWS = 5000;
const LAST = ROWS + 1;
const money = { type: 'numeric', numericFormat: { style: 'currency', currency: 'TRY' } } as const satisfies CellMeta;

// ---------- workbook ----------
let engine = FormulaEngine.buildEmpty();
engine.addNamedExpression('KdvOrani', 0.2);

const orders: RawCell[][] = [
  ['Ürün', 'Adet', 'Birim Fiyat', 'Tutar', 'KDV', 'Toplam', 'Sipariş Tarihi', 'Teslim', 'Durum'],
];
const start = dateToSerial(2026, 1, 1);
for (let i = 1; i <= ROWS; i++) {
  const r = i + 1;
  orders.push([
    products[i % products.length],
    ((i * 7) % 50) + 1,
    Math.round(((i * 13) % 400) + 5) / 4,
    `=B${r}*C${r}`,
    `=ROUND(D${r}*KdvOrani, 2)`,
    `=D${r}+E${r}`,
    start + ((i * 11) % 300),
    i % 3 === 0,
    `=IF(H${r}, "Teslim", IF(TODAY()-G${r}>30, "Gecikti", "Açık"))`,
  ]);
}

const summary: RawCell[][] = [
  ['Sipariş Özeti', null, null, null],
  ['Toplam ciro', `=SUM(Siparişler!F2:F${LAST})`, null, null],
  ['Ortalama sipariş', `=AVERAGE(Siparişler!F2:F${LAST})`, null, null],
  ['Teslim edilen', `=COUNTIF(Siparişler!H2:H${LAST}, TRUE)`, null, null],
  ['Geciken', `=COUNTIF(Siparişler!I2:I${LAST}, "Gecikti")`, null, null],
  ['KDV oranı', '=KdvOrani', null, null],
  ['Ay sonu', '=EOMONTH(TODAY(), 0)', null, null],
  [null, null, null, null],
  ['Ürün', 'Adet', 'Ciro', 'Pay', null, 'Benzersiz ürünler (SORT/UNIQUE)'],
  ...products.map((p, i) => {
    const r = 10 + i;
    return [
      p,
      `=SUMIF(Siparişler!$A$2:$A$${LAST}, A${r}, Siparişler!$B$2:$B$${LAST})`,
      `=SUMIF(Siparişler!$A$2:$A$${LAST}, A${r}, Siparişler!$F$2:$F$${LAST})`,
      `=C${r}/$B$2`,
      null,
      r === 10 ? `=SORT(UNIQUE(Siparişler!A2:A${LAST}))` : null,
    ];
  }),
];

// ---------- grids ----------
const t0 = performance.now();
const common = { formulas: engine, locale: 'tr-TR', language: trTR, height: 'calc(100vh - 210px)', contextMenu: true, search: true, formulaBar: true } as const;

const ordersGrid = new CenituGrid(document.getElementById('sheet-orders')!, {
  ...common,
  sheetName: 'Siparişler',
  data: orders,
  fixedRowsTop: 1,
  fixedColumnsStart: 1,
  columnSorting: true,
  filters: true,
  conditionalFormats: [
    { columns: [8], when: { op: 'equals', value: 'Gecikti' }, entireRow: true, style: { color: '#cf222e' } },
    { columns: [8], when: { op: 'equals', value: 'Teslim' }, style: { color: '#1a7f37', bold: true } },
    { columns: [5], when: (v) => typeof v === 'number' && v > 4000, style: { background: '#fff8c5' } },
  ],
  cells: (row) => (row === 0 ? { type: 'text', readOnly: true, validator: undefined, className: 'demo-head' } : undefined),
  columns: [
    { type: 'dropdown', source: products, width: 130 },
    { type: 'numeric', width: 70, validator: (v) => (Number.isInteger(v) && (v as number) > 0) || 'Pozitif tam sayı olmalı' },
    { ...money, width: 110 },
    { ...money, readOnly: true, width: 120 },
    { ...money, readOnly: true, width: 100 },
    { ...money, readOnly: true, width: 120 },
    { type: 'date', width: 110 },
    { type: 'checkbox', width: 70 },
    { readOnly: true, width: 90, className: 'demo-status' },
  ],
});

const summaryGrid = new CenituGrid(document.getElementById('sheet-summary')!, {
  ...common,
  sheetName: 'Özet',
  data: summary,
  minCols: 6,
  colWidths: [150, 140, 150, 90, 40, 220],
  mergeCells: [{ row: 0, col: 0, rowspan: 1, colspan: 4 }],
  cells: (row, col) => {
    if (row === 0) return { className: 'demo-title', readOnly: true };
    if (row === 8) return { className: 'demo-head', readOnly: true, validator: undefined };
    if (col === 1 && (row === 1 || row === 2)) return money;
    if (col === 1 && row === 5) return { type: 'numeric', numericFormat: { style: 'percent' } };
    if (col === 1 && row === 6) return { type: 'date' };
    if (row >= 9 && col === 2) return money;
    if (row >= 9 && col === 3) return { type: 'numeric', numericFormat: { style: 'percent', maximumFractionDigits: 1 } };
    return undefined;
  },
});

const status = document.getElementById('status')!;
status.textContent = `Yüklendi: ${(performance.now() - t0).toFixed(0)} ms · ${ROWS * 5 + 40} formül`;

// ---------- tabs, toolbar ----------
let sheets: Record<string, CenituGrid> = { orders: ordersGrid, summary: summaryGrid };
let active: CenituGrid = ordersGrid;
const tabs = document.querySelector('.tabs')!;
const pages = document.getElementById('sheets')!;

function wire(grid: CenituGrid) {
  grid.addHook('afterSelection', (row, col) => {
    const error = grid.getCellError(row, col);
    if (error) status.textContent = `⚠ ${error}`;
  });
  grid.addHook('afterChange', (changes, source) => {
    status.textContent = `${changes.length} hücre değişti (${source})`;
  });
  grid.addHook('afterFilter', () => (status.textContent = `${grid.countRows()} satır görünüyor`));
}
Object.values(sheets).forEach(wire);

function showSheet(name: string) {
  document.querySelectorAll<HTMLElement>('[data-tab]').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  document.querySelectorAll<HTMLElement>('.sheet').forEach((s) => (s.hidden = s.id !== `sheet-${name}`));
  active = sheets[name];
  active.render();
  active.root.querySelector('textarea')?.focus();
}

tabs.addEventListener('click', (e) => {
  const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
  if (tab) showSheet(tab.dataset.tab!);
});

/** Replaces the workbook: one tab per visible sheet, all on one engine so formulas reach each other. */
async function openWorkbook(file: File) {
  const book = await readXLSX(file);
  const visible = book.sheets.filter((s) => !s.hidden);
  if (!visible.length) throw new Error('Görünür sayfa yok');
  Object.values(sheets).forEach((g) => g.destroy());
  engine.destroy();
  engine = workbookEngine(book);
  // Hidden sheets have no tab, but formulas may still read them.
  for (const s of book.sheets) if (s.hidden) engine.setSheetContent(s.data, engine.getSheetId(s.name)!);
  pages.textContent = '';
  tabs.textContent = '';
  sheets = {};
  visible.forEach((sheet, i) => {
    const page = document.createElement('div');
    page.id = `sheet-${i}`;
    page.className = 'sheet';
    pages.append(page);
    const grid = new CenituGrid(page, { ...common, formulas: engine, sheetName: sheet.name, columnSorting: true, filters: true });
    grid.loadSheet(sheet);
    wire(grid);
    sheets[i] = grid;
    const tab = document.createElement('button');
    tab.dataset.tab = String(i);
    tab.textContent = sheet.name;
    tabs.append(tab);
  });
  showSheet('0');
  status.textContent = `${file.name}: ${visible.length} sayfa`;
}

document.querySelectorAll<HTMLButtonElement>('button[data-style]').forEach((b) =>
  b.addEventListener('click', () => {
    active.toggleCellStyle(b.dataset.style as 'bold' | 'italic' | 'underline');
    active.root.querySelector('textarea')?.focus();
  }),
);
document.querySelectorAll<HTMLInputElement>('input[data-color]').forEach((input) =>
  input.addEventListener('change', () => {
    const range = active.getSelectedRange();
    if (range) active.setCellStyle(range, { [input.dataset.color!]: input.value });
    active.root.querySelector('textarea')?.focus();
  }),
);
document.getElementById('csv')!.addEventListener('click', () => active.downloadCSV(`${active.getSheetName()}.csv`));
document.getElementById('xlsx')!.addEventListener('click', () =>
  Object.values(sheets)[0].downloadXLSX('cenitu-demo.xlsx', Object.values(sheets).slice(1)),
);
document.getElementById('open')!.addEventListener('click', () => (document.getElementById('file') as HTMLInputElement).click());
document.getElementById('file')!.addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    await openWorkbook(file);
  } catch (err) {
    status.textContent = `Açılamadı: ${(err as Error).message}`;
  }
});
document.getElementById('find')!.addEventListener('click', () => active.openSearch(true));
// TODAY()/NOW() refresh themselves once a minute.
setInterval(() => engine.recalculateVolatile(), 60_000);

document.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) =>
  b.addEventListener('click', () => {
    const act = b.dataset.act!;
    const range = active.getSelectedRange();
    if (act === 'undo') active.undo();
    else if (act === 'redo') active.redo();
    else if (act === 'merge' && range) {
      active.mergeCells(range.start.row, range.start.col, range.end.row - range.start.row + 1, range.end.col - range.start.col + 1);
    } else if (act === 'unmerge' && range) active.unmergeCells(range.start.row, range.start.col);
    else if (act === 'clear-filters') active.clearFilters();
    else active.alter(act as AlterAction);
    active.root.querySelector('textarea')?.focus();
  }),
);

ordersGrid.selectCell(1, 1);
Object.assign(window, { ordersGrid, summaryGrid, engine });
