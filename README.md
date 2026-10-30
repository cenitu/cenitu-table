# CenituTable

[![CI](https://github.com/cenitu/cenitu-table/actions/workflows/ci.yml/badge.svg)](https://github.com/cenitu/cenitu-table/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A spreadsheet-like data grid with a built-in, multi-sheet formula engine. Written in TypeScript with **zero runtime dependencies**; an optional React component is included.

**[Live demo](https://cenitu.github.io/cenitu-table/)** · [Türkçe](README.tr.md) · [Design notes](docs/SPEC.md)

## Features

- **Grid:** virtual scrolling (only visible cells are in the DOM), keyboard navigation (Ctrl+arrows jump to data edges), spreadsheet-compatible copy/cut/paste (TSV), undo/redo, column and row resizing, row/column insert and delete, right-click context menu.
- **Sorting and filtering:** a column menu with condition and value filters. Only the view changes; data and formulas stay where they are.
- **Autofill:** drag the fill handle to continue number and text series and to copy formulas with relative references; double-click to fill down; Ctrl+D.
- **Cell types:** numeric (Intl formats: currency, percent), date, checkbox, dropdown; validators, read-only cells, custom renderers.
- **Formatting:** bold, italic, underline, strike-through, colors, alignment, wrapping (Ctrl+B / I / U), conditional formatting for cells or whole rows.
- **Layout:** frozen rows and columns, merged cells, hidden columns, column drag-and-drop.
- **Formula engine:** 100+ functions (SUM, IF, XLOOKUP, SUMIFS, TEXT, date functions…), dynamic arrays that spill (FILTER, SORT, UNIQUE, SEQUENCE), cross-sheet references (`'Other sheet'!A1`), named expressions, incremental recalculation, cycle detection.
- **Data binding:** rows as arrays or as objects bound to columns by property path; edits are written back to your objects.
- **Export:** CSV (with protection against formula injection) and XLSX (formulas, formats, styles, frozen panes, merges) without any library.
- **Accessibility:** ARIA grid roles and an announced active cell for screen readers.
- **React:** `<CenituTable />` from `cenitu-table/react`.

## Install

```bash
npm install cenitu-table
```

## Usage

```ts
import { CenituGrid } from 'cenitu-table';

const grid = new CenituGrid(document.getElementById('grid')!, {
  data: [
    ['Product', 'Qty', 'Price', 'Total'],
    ['Screw', 10, 2.5, '=B2*C2'],
    ['Nut', 20, 1.25, '=B3*C3'],
  ],
  fixedRowsTop: 1,
  columnSorting: true,
  filters: true,
  contextMenu: true,
  columns: [
    { type: 'dropdown', source: ['Screw', 'Nut', 'Washer'] },
    { type: 'numeric', validator: (v) => Number(v) > 0 || 'Must be positive' },
    { type: 'numeric', numericFormat: { style: 'currency', currency: 'EUR' } },
    { type: 'numeric', numericFormat: { style: 'currency', currency: 'EUR' }, readOnly: true },
  ],
  height: 400,
});

grid.addHook('afterChange', (changes, source) => console.log(changes, source));
grid.getDataAtCell(1, 3);       // 25 (computed value)
grid.getSourceDataAtCell(1, 3); // "=B2*C2"
```

### Objects instead of arrays

```ts
const orders = [{ product: 'Screw', qty: 10, customer: { name: 'Acme' } }];

new CenituGrid(el, {
  data: orders,
  columns: [{ data: 'product' }, { data: 'qty', type: 'numeric' }, { data: 'customer.name', title: 'Customer' }],
  dataSchema: () => ({ product: '', qty: 0, customer: { name: '' } }),
});
// Edits are written back: orders[0].qty changes when the cell changes.
```

Formula cells write their computed value into the object and keep it current, so your properties stay plain values. Set `bindFormulas: 'text'` to store the formula text instead.

### Several sheets

Give one engine to several grids — one grid per sheet:

```ts
import { CenituGrid, FormulaEngine } from 'cenitu-table';

const engine = FormulaEngine.buildEmpty();
engine.addNamedExpression('VatRate', 0.2);
new CenituGrid(el1, { formulas: engine, sheetName: 'Orders', data: orders });
new CenituGrid(el2, { formulas: engine, sheetName: 'Summary', data: [['=SUM(Orders!F2:F100)*(1+VatRate)']] });
```

### Export

```ts
grid.downloadCSV('orders.csv');                      // ";" fields and "," decimals for decimal-comma locales
await grid.downloadXLSX('book.xlsx', [summaryGrid]); // several sheets in one workbook
```

### React

```tsx
import { CenituTable } from 'cenitu-table/react';

<CenituTable ref={gridRef} data={data} fixedRowsTop={1} onChange={(changes) => save(changes)} />;
```

### Formula engine on its own

```ts
import { FormulaEngine, registerFunction } from 'cenitu-table';

const engine = FormulaEngine.buildFromArray([[1, 2, '=A1+B1']]);
engine.setCellContents({ row: 0, col: 0 }, 10); // returns the changed cells
engine.getCellValue({ row: 0, col: 2 });         // 12
registerFunction('DOUBLE', { minArgs: 1, maxArgs: 1, impl: ([x]) => (x as number) * 2 });
```

### Localization

```ts
import { trTR } from 'cenitu-table';

new CenituGrid(el, { locale: 'tr-TR', language: trTR, data });
```

`locale` drives number and date formatting; `language` holds the UI texts (English by default, Turkish included).

## Development

```bash
npm install
npm run dev        # demo at http://localhost:5180
npm test           # unit tests (vitest + jsdom)
npm run test:e2e   # browser tests (Playwright: Chromium, Firefox, WebKit)
npm run build      # type check, ESM/CJS bundles and .d.ts in dist/
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Notable changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
