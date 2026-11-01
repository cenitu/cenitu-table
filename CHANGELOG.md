# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.4.0-beta.3] - 2026-11-01

### Added
- `queryToParams` and `fetchAllPages` for REST lists, with a step-by-step guide in
  `docs/server-lists.md` and a live server demo.
- `rowActions`: adding and removing rows in server mode through your own requests.
- `appendRows` and `afterReachEnd` for scrolling on without a pager.
- Several selected ranges with Ctrl+click: `getSelectedRanges`; clearing and styling reach all of
  them.
- Range selection on touch: drag on after a long press.
- Row groups: `rowGroups`, `setRowGroups`, `toggleRowGroup`.
- Cell notes and lists of allowed values are read from and written to XLSX files. Dropdown columns
  are written as lists.
- `cenitu-table/vue`, `cenitu-table/formula` and `cenitu-table/export` entry points.
- `docs/API.md` lists the public API and the version policy before 1.0.
- Browser performance budgets for a 100,000 row list.

### Changed
- A long press now opens the context menu when the finger lifts, so that it can also start a
  selection.
- `QueryChangeReason` has a new value, `refresh`.
- The dev server and browser tests follow `PORT`.

## [0.4.0-beta.2] - 2026-11-01

### Added
- `query.requestId` and `dataRequestId`: outdated answers are refused.
- `beforeQueryChange` hook and `onBeforeQueryChange` prop can stop a query change.
- `maxSortKeys` offers sorting by several columns in the server mode column menu.
- `number` server filter with `min` and `max`.
- `rowDetailHeight: 'auto'` follows the content of the expanded area.

### Fixed
- React: a new `data` array with the same rows no longer reloads the page, which closed the open
  editor without saving and ended undo history.
- React: an empty `data` while `loading` no longer clears the rows on screen.
- A page refresh keeps the editor open when its record is still there, and otherwise commits it.
- Changing the query commits an open editor first.

## [0.4.0-beta.1] - 2026-11-01

### Added
- Dropdowns with value and label: `source` takes `{ value, label }`, the cell stores the value.
- Choices searched on a server: `loadOptions` and `resolveLabel`. Older requests are aborted.
- Custom cell editors: `editor` in column settings, `reactEditor` for React components.
- Exporting the full server result: `fetchAllRows`, `toExportSheetAll`, `exportAllCSV`,
  `downloadAllCSV`, `downloadAllXLSX`.
- Live themes through `updateSettings` and the React prop, reaching menus, the page bar and the
  search box.
- Touch: handles follow fingers, long press opens the context menu, the idle editor does not raise
  the keyboard, larger targets on coarse pointers.
- Renderers may return a cleanup function; `reactRenderer` runs React components in cells.
- Footer totals: `summary` in column settings, `summaryValues` from outside.
- Expandable rows: `rowDetail`, `rowDetailHeight`, `toggleRowDetail`.
- Hidden rows: `hideRows`, `showRows`, context menu entries; hidden rows and columns now survive
  XLSX export and import.
- Cell notes (`note`, `setCellNote`) and links (`linkRenderer`, safe protocols only).
- Ctrl+Space selects the column, Shift+Space the row.

### Fixed
- Opening an editor and leaving it unchanged no longer rewrites the value: decimals like 1.234,
  ids behind labels and dates stay as they are.
- Numeric input reads dots as thousands only in locales that write them so, or next to a decimal
  comma.
- Date input follows the cell's `dateFormat`, so day and month cannot swap.
- An editor stays tied to its cell: replacing data discards it, and moving the selection commits
  to the edited cell. `destroy` also closes open editors and pending option searches.
- Server array rows stay under their column ids after columns move.
- Row heights and detail areas stay right through undo, `loadData` and new pages.
- Recycled cell elements no longer show old content or stale links.
- Empty grids keep their columns and hold no selection.
- React: removed props are applied, new function props take effect, inline `columns` keep moved
  columns in place, and `conditionalFormats` is live.
- XLSX import: `_xHHHH_` escapes, empty string cells, ISO dates without time zone shifts, panes of
  custom views and duration formats are read correctly; oversized sheets are refused (`maxCells`).
- Without an engine, text starting with "=" no longer becomes a formula in exported files.
- CSV in `formatted` mode now writes dropdown labels of text values.
- Hidden columns keep their width and stay hidden in XLSX exports.

### Changed
- Scrolling with an open dropdown cancels the edit instead of committing the typed text.

## [0.4.0-beta.0] - 2026-11-01

### Added
- Server mode (`dataMode: 'server'`): the grid leaves paging, sorting and filtering to the
  application and reports them through the `afterQueryChange` hook with stable column ids
  (`onQueryChange` in React). Includes a page bar, `setPageRows`, `rowKey`, text, list, date and
  yes/no filters in the column menu, loading, empty and error states, and `columnId` and `rowKey`
  on change events.
- Row events: `afterRowClick` and `afterRowDoubleClick` hooks (`onRowClick`, `onRowDoubleClick` in
  React). Returning false from a double click keeps the editor closed.
- Column layout: `getColumnLayout`, `setColumnLayout`, the `columnLayout` option and the
  `afterColumnLayout` hook save and restore widths, order and visibility by column id.

## [0.3.1] - 2026-11-01

Maintenance release from `maintenance/0.3.x`. Every fix below is also in 0.4.0-beta.1.

### Fixed
- Opening an editor and leaving it unchanged no longer rewrites the value: decimals like 1.234 and
  dates stay as they are.
- Numeric input reads dots as thousands only in locales that write them so, or next to a decimal
  comma.
- Date input follows the cell's `dateFormat`, so day and month cannot swap.
- Replacing data discards an open editor, and moving the selection commits to the edited cell.
- Without an engine, text starting with "=" no longer becomes a formula in exported files.
- XLSX import refuses sheets too large to hold in memory (`maxCells`).

## [0.3.0] - 2026-10-31

### Fixed
- Filtering, sorting, the column menu search, dropdown lists and conditional formats now follow
  `locale`: with `tr-TR`, `istanbul` finds `İSTANBUL`.

### Added
- XLSX import without dependencies: `readXLSX`, `workbookEngine`, `grid.importXLSX`, `grid.loadSheet`.
  Reads values, formulas (including shared and array formulas), number formats, fonts, fills
  (theme and indexed colors too), alignment, sizes, hidden columns, frozen panes, merges and
  defined names. Archives are size-limited and XML entities are not expanded.
- Find and replace: `search` option with a box on Ctrl+F / Ctrl+H, `findCells`, `findNext`,
  `replaceNext`, `replaceAll`, `openSearch`. Case folding follows `locale`, so Turkish I/ı match
  correctly. Formula cells change only with `lookIn: 'formulas'`.
- Formula bar: `formulaBar` option; edits there and in the cell stay in step.
- Styled copy and paste: selections with styles also go to the clipboard as HTML, and styles are
  read from what other spreadsheet apps paste. Values and styles undo in one step.
- Sorting by several columns: `sortBy`, `getSortKeys`, the `afterSort` hook, "Then sort" entries
  in the column menu and priority numbers in the headers.
- React 19 is tested in CI next to React 18.
- `CellMeta.formatCode` keeps a file's number format for the next export; strike-through is now
  exported to XLSX.

## [0.2.0] - 2026-10-30

### Added
- Rows bound to objects: `data` may be an array of objects, columns bind to property paths
  (`columns[i].data`, nested `a.b`), edits are written back, `dataSchema` creates new rows.
  Formula cells write their computed value and stay up to date (`bindFormulas: 'text'` stores
  the formula instead).
- Right-click context menu (`contextMenu: true` or a function to customize entries), also on
  Shift+F10 / the Menu key.
- Cell styles (`setCellStyle`, `toggleCellStyle`, Ctrl+B/I/U) and conditional formatting
  (`conditionalFormats`), both exported to XLSX.
- Row height resizing, hiding/showing columns, moving columns by dragging their headers.
- CSV and XLSX export without dependencies (`exportCSV`, `downloadCSV`, `downloadXLSX`,
  `toCSV`, `toXLSX`), with CSV formula-injection protection.
- Formula engine: SUMIFS/COUNTIFS/AVERAGEIFS/MAXIFS/MINIFS, XLOOKUP, TEXT, text and math
  functions, dynamic arrays that spill (FILTER, SORT, UNIQUE, SEQUENCE, TRANSPOSE),
  volatile functions refreshed with `recalculateVolatile()`, `moveRows`/`moveColumns`.
- Accessibility: ARIA grid roles and positions, active cell announced through a live region.
- English README, browser tests with Playwright (Chromium, Firefox, WebKit), demo deployment to
  GitHub Pages.

### Changed
- Array arithmetic now spills: `=A1:A3*2` and `=LEN(A1:A3)` fill neighbouring cells instead of
  returning `#VALUE!`.
- Cell settings (`setCellMeta`), styles and row heights now move with their rows/columns on
  insert and remove instead of being cleared.

### Fixed
- Very large data sets (100k+ rows) no longer risk a stack overflow while loading.

## [0.1.0] - 2026-10-30

First public version: virtual-scrolling grid, sorting and filtering, autofill, cell types and
validation, frozen panes, merged cells, multi-sheet formula engine with named expressions and
date functions, structural undo across sheets, React wrapper.
