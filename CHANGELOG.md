# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.2.0] - Unreleased

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
