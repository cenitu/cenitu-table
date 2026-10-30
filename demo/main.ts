import { CenituGrid, dateToSerial, FormulaEngine, trTR, toA1, type AlterAction, type CellMeta, type RawCell } from '../src';

const products = ['Vida M8', 'Somun M8', 'Pul 8mm', 'Profil 40x40', 'Sac 2mm', 'Rulman 6204', 'Kayış A42', 'Motor 0.75kW'];
const ROWS = 5000;
const LAST = ROWS + 1;
const money = { type: 'numeric', numericFormat: { style: 'currency', currency: 'TRY' } } as const satisfies CellMeta;

// ---------- workbook ----------
const engine = FormulaEngine.buildEmpty();
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
  ['Ürün', 'Adet', 'Ciro', 'Pay'],
  ...products.map((p, i) => {
    const r = 10 + i;
    return [
      p,
      `=SUMIF(Siparişler!$A$2:$A$${LAST}, A${r}, Siparişler!$B$2:$B$${LAST})`,
      `=SUMIF(Siparişler!$A$2:$A$${LAST}, A${r}, Siparişler!$F$2:$F$${LAST})`,
      `=C${r}/$B$2`,
    ];
  }),
];

// ---------- grids ----------
const t0 = performance.now();
const common = { formulas: engine, locale: 'tr-TR', language: trTR, height: 'calc(100vh - 170px)' } as const;

const ordersGrid = new CenituGrid(document.getElementById('sheet-orders')!, {
  ...common,
  sheetName: 'Siparişler',
  data: orders,
  fixedRowsTop: 1,
  fixedColumnsStart: 1,
  columnSorting: true,
  filters: true,
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
  colWidths: [150, 140, 150, 90, 100, 100],
  mergeCells: [{ row: 0, col: 0, rowspan: 1, colspan: 4 }],
  cells: (row, col) => {
    if (row === 0) return { className: 'demo-title', readOnly: true };
    if (row === 8) return { className: 'demo-head', readOnly: true };
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

// ---------- tabs, formula bar, toolbar ----------
const sheets = { orders: ordersGrid, summary: summaryGrid };
let active: CenituGrid = ordersGrid;
const formulaBar = document.getElementById('formula') as HTMLInputElement;

function showFormula(grid: CenituGrid, row: number, col: number) {
  const raw = grid.getSourceDataAtCell(row, col);
  const error = grid.getCellError(row, col);
  formulaBar.value = `${toA1({ row: grid.toPhysicalRow(row), col })}  ${raw ?? ''}${error ? `   ⚠ ${error}` : ''}`;
}

for (const grid of Object.values(sheets)) {
  grid.addHook('afterSelection', (row, col) => showFormula(grid, row, col));
  grid.addHook('afterChange', (changes, source) => {
    status.textContent = `${changes.length} hücre değişti (${source})`;
  });
}
ordersGrid.addHook('afterFilter', () => (status.textContent = `${ordersGrid.countRows() - 1} satır görünüyor`));

document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((tab) =>
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab as keyof typeof sheets;
    document.querySelectorAll('[data-tab]').forEach((t) => t.classList.toggle('on', t === tab));
    document.querySelectorAll<HTMLElement>('.sheet').forEach((s) => (s.hidden = s.id !== `sheet-${name}`));
    active = sheets[name];
    active.render();
    active.root.querySelector('textarea')?.focus();
  }),
);

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
