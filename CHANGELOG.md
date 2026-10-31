# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Server mode (`dataMode: 'server'`): the grid leaves paging, sorting and filtering to the
  application and reports them through the `afterQueryChange` hook with stable column ids
  (`onQueryChange` in React). Includes a page bar, `setPageRows`, `rowKey`, text, list, date and
  yes/no filters in the column menu, loading, empty and error states, and `columnId` and `rowKey`
  on change events.

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
