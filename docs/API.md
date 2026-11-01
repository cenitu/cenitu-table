# API overview

This page lists what is public. Anything not here, or not exported from the package, may change
without notice.

## Versions before 1.0

Breaking changes land in a minor version and are listed in the changelog under a `Changed` or
`Removed` heading. Patch versions never break. Applications should pin an exact version until 1.0.

## Entry points

| Import | Contents |
| --- | --- |
| `cenitu-table` | Grid, formula engine and file formats |
| `cenitu-table/react` | `CenituTable`, `reactEditor`, `reactRenderer` |
| `cenitu-table/vue` | `CenituTable` |
| `cenitu-table/formula` | Formula engine alone |
| `cenitu-table/export` | CSV and XLSX alone |

## Grid options

| Group | Options |
| --- | --- |
| Data | `data`, `dataSchema`, `bindFormulas`, `minRows`, `minCols`, `formulas`, `sheetName` |
| Layout | `rowHeaders`, `colHeaders`, `colWidths`, `rowHeight`, `height`, `fixedRowsTop`, `fixedColumnsStart`, `mergeCells`, `hiddenColumns`, `columnLayout` |
| Columns | `columns`, `cells`, `conditionalFormats` |
| Behaviour | `readOnly`, `columnSorting`, `filters`, `fillHandle`, `contextMenu`, `search`, `formulaBar` |
| Language and look | `locale`, `language`, `theme` |
| Rows | `rowDetail`, `rowDetailHeight`, `rowGroups`, `summaryValues` |
| Server mode | `dataMode`, `rowKey`, `query`, `totalCount`, `loading`, `loadError`, `maxSortKeys`, `fetchAllRows`, `pageSizes`, `pager`, `pagerActions`, `renderStatus`, `rowActions` |

## Grid methods

| Group | Methods |
| --- | --- |
| Reading | `countRows`, `countCols`, `countSourceRows`, `getDataAtCell`, `getSourceDataAtCell`, `getData`, `getSourceData`, `getBoundRows`, `getSourceObjects`, `getSourceDataAtRow`, `toPhysicalRow`, `toVisualRow`, `propToCol`, `colToProp`, `getColumnId` |
| Writing | `setDataAtCell`, `loadData`, `loadSheet`, `importXLSX`, `paste`, `copy`, `autofill`, `alter`, `undo`, `redo`, `isUndoAvailable`, `isRedoAvailable` |
| Selection | `selectCell`, `deselectCell`, `getSelected`, `getSelectedRange`, `getSelectedRanges`, `focus` |
| Editing | `openEditor`, `closeEditor`, `isEditing` |
| Cells | `getCellMeta`, `setCellMeta`, `setCellStyle`, `getCellStyle`, `toggleCellStyle`, `setCellNote`, `getCellNote`, `getCellError` |
| Rows | `setRowHeight`, `getRowHeight`, `hideRows`, `showRows`, `getHiddenRows`, `toggleRowDetail`, `isRowDetailOpen`, `setRowGroups`, `getRowGroups`, `toggleRowGroup`, `isRowGroupOpen` |
| Columns | `setColWidth`, `getColWidth`, `autoSizeColumns`, `hideColumns`, `showColumns`, `isColumnHidden`, `getHiddenColumns`, `moveColumns`, `canMoveColumns`, `getColumnLayout`, `setColumnLayout` |
| Sorting and filters | `sort`, `sortBy`, `getSortState`, `getSortKeys`, `setFilter`, `clearFilters`, `getFilters`, `applyFilters` |
| Finding | `findCells`, `findNext`, `replaceNext`, `replaceAll`, `openSearch`, `closeSearch` |
| Merging | `mergeCells`, `unmergeCells`, `getMergedCells` |
| Files | `toExportSheet`, `exportCSV`, `downloadCSV`, `downloadXLSX` |
| Server mode | `getQuery`, `setQuery`, `setPageRows`, `appendRows`, `setServerFilter`, `toExportSheetAll`, `exportAllCSV`, `downloadAllCSV`, `downloadAllXLSX` |
| Other | `updateSettings`, `addHook`, `removeHook`, `render`, `destroy`, `openContextMenu`, `getEngine`, `getSheetId`, `getSheetName` |

## Hooks

| Hook | Runs |
| --- | --- |
| `beforeChange` | Before cells change; return false to cancel |
| `afterChange`, `afterValidate`, `afterStyle` | After cells change |
| `afterSelection`, `afterRowClick`, `afterRowDoubleClick` | After pointer and keyboard use; a double click can return false to keep the editor closed |
| `afterSort`, `afterColumnSort`, `afterFilter` | After rows are ordered or filtered |
| `afterAlter`, `afterAutofill`, `afterColumnMove`, `afterColumnLayout` | After structure changes |
| `beforeQueryChange`, `afterQueryChange` | Server mode: around a query change |
| `afterPasteClipped`, `afterReachEnd` | Server mode: a paste did not fit, the last loaded row came into view |

## Limits worth knowing

- Copy and paste work on the active range of a Ctrl+click selection.
- Row groups are physical rows, so they read best without sorting, and they do not reach Excel as
  outline levels. Collapsed rows are written as hidden rows.
- `appendRows` keeps everything on the loaded rows. Undo entries for column moves end there.
- Excel lists that refer to cells and conditional formats are not imported.
- `afterRowDoubleClick` can cancel despite its name. It keeps that name until 1.0 is settled.

## Other frameworks

The grid takes a DOM element, so any framework can host it. In Angular:

```ts
@Component({ selector: 'app-orders', standalone: true, template: '<div #host></div>' })
export class OrdersComponent implements AfterViewInit, OnDestroy {
  @ViewChild('host') host!: ElementRef<HTMLDivElement>;
  private grid?: CenituGrid;

  ngAfterViewInit() {
    this.grid = new CenituGrid(this.host.nativeElement, { data: this.rows });
  }

  ngOnDestroy() {
    this.grid?.destroy();
  }
}
```
