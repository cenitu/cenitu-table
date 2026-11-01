# CenituTable

[![CI](https://github.com/cenitu/cenitu-table/actions/workflows/ci.yml/badge.svg)](https://github.com/cenitu/cenitu-table/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/cenitu-table.svg)](https://www.npmjs.com/package/cenitu-table)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A spreadsheet-like data grid with a built-in, multi-sheet formula engine. Written in TypeScript with **zero runtime dependencies**; an optional React component is included.

**[Live demo](https://cenitu.github.io/cenitu-table/)** · [Türkçe](README.tr.md) · [Design notes](docs/SPEC.md)

## Features

- **Grid:** virtual scrolling (only visible cells are in the DOM), keyboard navigation (Ctrl+arrows jump to data edges), spreadsheet-compatible copy/cut/paste with styles, undo/redo, column and row resizing, double-click a column edge to fit its content, row/column insert and delete, right-click context menu.
- **Sorting and filtering:** sort by several columns, filter by condition or value from the column menu. Only the view changes; data and formulas stay where they are.
- **Find and replace:** Ctrl+F / Ctrl+H, also through rows outside the viewport, in displayed values or in formulas.
- **Formula bar:** the active cell's address and content above the grid, editable.
- **Autofill:** drag the fill handle to continue number and text series and to copy formulas with relative references; double-click to fill down; Ctrl+D.
- **Cell types:** numeric (Intl formats: currency, percent), date, checkbox, dropdown; validators, read-only cells, custom renderers.
- **Formatting:** bold, italic, underline, strike-through, colors, alignment, wrapping (Ctrl+B / I / U), conditional formatting for cells or whole rows.
- **Layout:** frozen rows and columns, merged cells, hidden columns, column drag-and-drop.
- **Formula engine:** 100+ functions (SUM, IF, XLOOKUP, SUMIFS, TEXT, date functions…), dynamic arrays that spill (FILTER, SORT, UNIQUE, SEQUENCE), cross-sheet references (`'Other sheet'!A1`), named expressions, incremental recalculation, cycle detection.
- **Server mode:** paging, sorting and filtering on your backend, with a page bar and text, list, date and yes/no filters.
- **Editing:** dropdowns that store an id and show a label, choices searched on your server, custom editors, also as React components.
- **Rows:** expandable detail areas, hidden rows, row click events, footer totals, notes and links.
- **Touch:** handles follow fingers, long press opens the context menu.
- **Data binding:** rows as arrays or as objects bound to columns by property path; edits are written back to your objects.
- **Import and export:** read and write XLSX (formulas, formats, styles, frozen panes, merges), export CSV with protection against formula injection, all without any library.
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

### Import

```ts
await grid.importXLSX(file, { sheet: 'Orders' }); // a File, Blob or bytes; default is the first sheet
```

To load a whole workbook, give all grids one engine, so formulas can reach the other sheets:

```ts
import { CenituGrid, readXLSX, workbookEngine } from 'cenitu-table';

const book = await readXLSX(file);
const engine = workbookEngine(book);
book.sheets.forEach((sheet, i) => {
  new CenituGrid(hosts[i], { formulas: engine, sheetName: sheet.name }).loadSheet(sheet);
});
```

Read: values, formulas, number formats, fonts, fills, alignment, column widths, row heights, hidden rows and columns, frozen panes, merges and defined names. Cell notes and lists of allowed values are read too. Not read: charts, images and conditional formats. Pass `formulas: 'values'` to take the results stored in the file instead of formulas, for example when a file uses functions the engine does not have.

### Server mode

For lists too large to load, the grid describes the rows it needs and your application fetches them. It never sorts or filters on its own.

```tsx
<CenituTable
  dataMode="server"
  rowKey="id"
  data={page.items}
  totalCount={page.totalCount}
  loading={isFetching}
  loadError={isError}
  query={query}
  onQueryChange={setQuery}
  columns={[
    { id: 'orderDate', data: 'orderDate', sortable: true, serverFilter: { kind: 'date' } },
    { id: 'status', data: 'status', serverFilter: { kind: 'list', options: statusOptions } },
    { id: 'partner', data: 'partner.name' },
  ]}
/>
```

`query` holds `page`, `pageSize`, `sort: [{ field, desc }]`, `filters` and `search`, always with column ids, so hiding or moving columns cannot break it. Filters are `text`, `list`, `date` (`from`, `to`), `number` (`min`, `max`) or `boolean`. Without React, listen to the `afterQueryChange` hook and pass rows to `grid.setPageRows(rows, total)`.

Rules worth knowing:

- Only columns with `sortable` or `serverFilter` get a menu.
- Sort, filter and page size changes return to page 1.
- New rows keep the sort marks, filters, column layout, scroll position and, by `rowKey`, the selection.
- To refuse outdated responses, give `query.requestId` back: `dataRequestId` in React, `setPageRows(rows, total, { requestId })` otherwise.
- A new array with the same rows is not a new page. While `loading` is true, an empty `data` keeps the old rows.
- `onBeforeQueryChange` (`beforeQueryChange` hook) can stop a change by returning false, e.g. for unsaved edits. An open editor commits first.
- `maxSortKeys: 2` offers "Then sort" in the column menu, with priority numbers in the headers.
- Change events carry `rowKey` and `columnId`; saving edits, also before a page change, is up to the application.
- Undo history ends with each new page.
- Formulas are off unless `formulas` is set, and they then see only the loaded page.
- Select all, find and replace, and `downloadCSV`/`downloadXLSX` cover the loaded page only; `downloadAllCSV`/`downloadAllXLSX` cover the full result through `fetchAllRows`.
- Rows cannot be added or removed locally. A paste that does not fit is cut off and reported by `afterPasteClipped`.

### Row events and saved column layout

```tsx
<CenituTable
  rowKey="id"
  columnLayout={saved}
  onColumnLayoutChange={(layout) => localStorage.setItem('orders', JSON.stringify(layout))}
  onRowDoubleClick={({ rowKey }) => {
    openOrder(rowKey);
    return false; // keeps the cell editor closed
  }}
/>
```

Layouts need column ids (`columns[i].id` or `data`). Removed columns are skipped when restoring, and new ones stay after the saved ones. A double click also fires two row clicks, as in the browser. `setColumnLayout` clears undo history when it moves columns.

### Editors and dropdowns

```tsx
import { reactEditor, reactRenderer } from 'cenitu-table/react';

const columns = [
  // Stores the id, shows the label; typed and pasted labels become ids.
  { data: 'statusId', type: 'dropdown', source: [{ value: 1, label: 'Open' }, { value: 2, label: 'Closed' }] },
  // Searches on the server. Older requests are aborted through `signal`.
  {
    data: 'partnerId',
    type: 'dropdown',
    loadOptions: (query, signal) => api.partners(query, { signal }),
    resolveLabel: (id, row) => row.partner?.name,
  },
  { data: 'color', editor: reactEditor(ColorPicker) }, // props: value, commit, cancel, row, col…
  { data: 'state', renderer: reactRenderer(StateBadge) }, // props: value, context
];
```

Without React, an editor is a function: `editor: ({ el, value, commit, cancel }) => ({ getValue, destroy })`. It renders into `el` and finishes with `commit(value)` or `cancel()`. A click elsewhere stores `getValue()` when given, and `destroy` runs once however it closes. With `loadOptions`, text alone changes nothing: a choice must be picked, or the cell emptied (`strict: false` allows free text).

A `renderer` may return a cleanup function, called when the cell element is recycled while scrolling.

### Rows, totals, notes and links

```ts
import { linkRenderer } from 'cenitu-table';

new CenituGrid(el, {
  data,
  rowDetail: (host, row) => void (host.textContent = row.notes), // expand mark in row headers
  rowDetailHeight: 'auto', // or a height in px
  columns: [
    { data: 'total', summary: 'sum' }, // sum, avg, count, min, max or a function
    { data: 'site', renderer: linkRenderer((v) => String(v)) }, // http, https, mailto and tel only
  ],
});

grid.hideRows([3]);
grid.setCellNote(0, 1, 'Check this');
```

In server mode, totals come from `summaryValues: { total: 1234 }`, because the page cannot know them. To export the full result there, give `fetchAllRows: (query) => api.all(query)` and call `downloadAllXLSX()` or `downloadAllCSV()`.

### Theming

`theme: 'light' | 'dark' | 'auto'` can change at runtime through `updateSettings` or the React prop. Colors are CSS variables on `.ct-root`, `.ct-menu`, `.ct-bar` and `.ct-pager`: `--ct-bg`, `--ct-fg`, `--ct-muted`, `--ct-grid`, `--ct-header-bg`, `--ct-header-fg`, `--ct-header-hl`, `--ct-accent`, `--ct-range`, `--ct-error`, `--ct-invalid-bg`, `--ct-readonly-fg`, `--ct-shadow`, `--ct-match`, `--ct-note`.

### Find, formula bar, sorting by several columns

```ts
new CenituGrid(el, { data, search: true, formulaBar: true, columnSorting: true });

grid.openSearch(true);                             // or Ctrl+F / Ctrl+H with `search: true`
grid.findNext('screw', { matchCase: false });
grid.replaceAll('A1', 'B1', { lookIn: 'formulas' }); // one undo step; returns the cells changed
grid.sortBy([{ col: 2, order: 'desc' }, { col: 0, order: 'asc' }]);
```

Without `lookIn: 'formulas'`, replacing leaves formula cells alone. `formulaBar` adds a row above the grid, on top of its `height`. The column menu offers "Then sort" once another column is sorted.

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

Connecting an existing list screen is covered step by step in [docs/server-lists.md](docs/server-lists.md). [docs/API.md](docs/API.md) lists the public API and the version policy, and `cenitu-table/vue` holds a Vue component. The engine and the file formats can also be imported alone, from `cenitu-table/formula` and `cenitu-table/export`.

See [CONTRIBUTING.md](CONTRIBUTING.md). Notable changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
