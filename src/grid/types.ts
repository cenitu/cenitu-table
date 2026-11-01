import type { CellRange } from '../formula/address';
import type { FormulaEngine, RemovalRecord } from '../formula/engine';
import type { CellValue, RawCell } from '../formula/values';
import type { DataRow, ObjectBinding } from './binding';
import type { CellMeta, CellStyle, ConditionalFormat } from './cellTypes';
import type { MenuEntry } from './contextMenu';
import type { ColumnFilter, SortOrder } from './filters';
import type { CenituGrid } from './grid';
import type { MergeArea } from './merges';
import type { RowGroup } from './rowGroups';
import type { Messages } from './messages';
import type { QueryChangeReason, ServerQuery } from './serverMode';

export interface GridOptions {
  /** Rows as arrays, or as objects bound to columns through `columns[i].data` (edits are written back). */
  data?: RawCell[][] | DataRow[];
  /** Creates the object for a new row in object mode (default `{}`). */
  dataSchema?: () => DataRow;
  /**
   * What a formula cell writes into its bound property: 'value' (default) keeps the property a
   * plain computed value and refreshes it on recalculation (errors become null); 'text' stores
   * the formula itself, so it survives a reload.
   */
  bindFormulas?: 'value' | 'text';
  /** Minimum size of the grid; extra rows/columns are empty. Defaults to 50 x 26 for empty data. */
  minRows?: number;
  minCols?: number;
  rowHeaders?: boolean;
  /** true: A, B, C…; an array gives custom titles (also settable via `columns[i].title`). */
  colHeaders?: boolean | string[];
  colWidths?: number | number[];
  rowHeight?: number;
  height?: number | string;
  /** true creates an internal engine; pass an engine to share it between grids (one grid per sheet). */
  formulas?: boolean | FormulaEngine;
  /** Sheet shown by this grid; created in a shared engine when missing. Default "Sheet1". */
  sheetName?: string;
  readOnly?: boolean;
  /** Force a color scheme instead of following the OS. */
  theme?: 'light' | 'dark' | 'auto';
  /** Per-column cell settings: type, format, validator… */
  columns?: CellMeta[];
  /** Per-cell settings (row is the physical/data row), merged over `columns`. */
  cells?: (row: number, col: number) => CellMeta | undefined;
  /** Frozen rows at the top; they are also excluded from sorting and filtering (header rows). */
  fixedRowsTop?: number;
  fixedColumnsStart?: number;
  mergeCells?: MergeArea[];
  columnSorting?: boolean;
  filters?: boolean;
  /** Drag handle at the corner of the selection that fills series and formulas. Default true. */
  fillHandle?: boolean;
  /** BCP 47 locale for number and date formatting, e.g. "tr-TR". */
  locale?: string;
  /** UI texts; see `trTR` for a complete Turkish set. */
  language?: Partial<Messages>;
  /**
   * Right-click menu (also Shift+F10 / the Menu key). true shows the default entries; a function
   * receives them and returns the entries to show (add, remove or reorder). Default off.
   */
  contextMenu?: boolean | ((entries: MenuEntry[], grid: CenituGrid) => MenuEntry[]);
  conditionalFormats?: ConditionalFormat[];
  /** Columns hidden initially. */
  hiddenColumns?: number[];
  /** Ctrl+F / Ctrl+H open a find and replace box (they stay the browser's shortcuts otherwise). */
  search?: boolean;
  /** Shows a bar above the grid with the active cell's address and content; editable. */
  formulaBar?: boolean;
  /**
   * 'server': the application fetches pages; the grid never sorts or filters itself and reports
   * what it needs through the `afterQueryChange` hook. Formulas are off unless `formulas` is set,
   * and rows cannot be added locally. Default 'client'.
   */
  dataMode?: 'client' | 'server';
  /** Server mode: object property (or function) identifying a row across pages. */
  rowKey?: string | ((row: DataRow | RawCell[]) => unknown);
  /** Server mode: page, sort and filters. Set again to change them from outside. */
  query?: Partial<ServerQuery>;
  /** Server mode: records matching the query, for the page bar. */
  totalCount?: number;
  /** Server mode: old rows stay visible, dimmed, until new ones arrive. */
  loading?: boolean;
  /** Server mode: true shows the default message, a string shows that message. */
  loadError?: boolean | string;
  /** Server mode: columns the column menu lets users sort by at once. Default 1. */
  maxSortKeys?: number;
  /** Server mode: every record matching the query, for exporting the full result. */
  fetchAllRows?: (query: ServerQuery) => Promise<RawCell[][] | DataRow[]>;
  /** Server mode: page sizes offered (default 25, 50, 100). */
  pageSizes?: number[];
  /** Server mode: page bar below the grid. Default true. */
  pager?: boolean;
  /** Server mode: fills the page bar's slot for application buttons. */
  pagerActions?: (slot: HTMLElement) => void;
  /** Server mode: replaces the content of the empty, loading and error messages. */
  renderStatus?: (el: HTMLElement, state: 'empty' | 'loading' | 'error') => void;
  /** Footer values by column id, e.g. totals computed by the server. */
  summaryValues?: Record<string, CellValue>;
  /** Fills the area that opens under a row; adds an expand mark to row headers. May return a cleanup. */
  rowDetail?: (el: HTMLElement, rowData: DataRow | RawCell[] | undefined, row: number) => void | (() => void);
  /** Height of the area under an expanded row in px, or 'auto' to follow its content. Default 160. */
  rowDetailHeight?: number | 'auto';
  /** Server mode: requests behind adding and removing rows. Without them rows cannot change. */
  rowActions?: RowActions;
  /** Rows that collapse under a header row; kept when `loadData` brings new rows. Not available in server mode. */
  rowGroups?: RowGroup[];
  /** Column widths, order and visibility to start with, from `getColumnLayout`. */
  columnLayout?: ColumnLayout;
}

/**
 * Server mode: what adding and removing rows do on the server. The page is asked for again once
 * the returned promise resolves; a rejection shows as a load error.
 */
export interface RowActions {
  /** `at` is the row the new one should follow or precede, when the server keeps an order. */
  create?: (at: { row: DataRow | RawCell[] | undefined; rowKey?: unknown; position: 'above' | 'below' }) => unknown;
  /** The rows to remove and their `rowKey` values. */
  remove?: (rows: (DataRow | RawCell[])[], keys: unknown[]) => unknown;
}

/** Saved column arrangement. Only columns with an id (`columns[i].id` or `data`) are included. */
export interface ColumnLayout {
  columns: { id: string; width: number; hidden: boolean }[];
}

export interface RowEvent {
  /** Visual row. */
  row: number;
  physicalRow: number;
  col: number;
  columnId?: string;
  /** Needs the `rowKey` option. */
  rowKey?: unknown;
  /** The source object (object mode) or raw row. */
  rowData: DataRow | RawCell[] | undefined;
  originalEvent: MouseEvent;
}

export interface SortKey {
  col: number;
  order: SortOrder;
}

/** Row indexes: `row` is visual (as displayed, -1 if hidden), `physicalRow` is the data row. */
export interface CellChange {
  row: number;
  physicalRow: number;
  col: number;
  /** Bound property in object mode. */
  prop?: string;
  /** Column id, when the column has one. */
  columnId?: string;
  /** Server mode: `rowKey` value of the row; indexes change between pages, this does not. */
  rowKey?: unknown;
  oldValue: RawCell;
  newValue: RawCell;
}

export type ChangeSource = 'edit' | 'paste' | 'cut' | 'clear' | 'autofill' | 'replace' | 'undo' | 'redo' | 'api';

export type AlterAction =
  | 'insert_row_above'
  | 'insert_row_below'
  | 'remove_row'
  | 'insert_col_start'
  | 'insert_col_end'
  | 'remove_col';

export interface HookMap {
  /** Return false to cancel; changes may be modified in place. */
  beforeChange: (changes: CellChange[], source: ChangeSource) => boolean | void;
  afterChange: (changes: CellChange[], source: ChangeSource) => void;
  afterSelection: (row: number, col: number, row2: number, col2: number) => void;
  afterAlter: (action: AlterAction, index: number, amount: number) => void;
  afterColumnSort: (col: number, order: SortOrder | null) => void;
  afterSort: (keys: SortKey[]) => void;
  afterRowClick: (e: RowEvent) => void;
  /** Return false to keep the cell editor closed, e.g. when double click opens the record. */
  afterRowDoubleClick: (e: RowEvent) => boolean | void;
  /** Columns were resized, moved, hidden or shown; save the layout here. */
  afterColumnLayout: (layout: ColumnLayout) => void;
  /** Server mode: runs before a query change. Return false to stop it, e.g. for unsaved edits. */
  beforeQueryChange: (next: ServerQuery, reason: QueryChangeReason) => boolean | void;
  /** Server mode: fetch the rows for `query`. */
  afterQueryChange: (query: ServerQuery, reason: QueryChangeReason) => void;
  /** Server mode without a pager: the last loaded row came into view; ask for more. */
  afterReachEnd: (loaded: number) => void;
  /** Server mode: a paste did not fit the loaded rows; `lost` rows were not pasted. */
  afterPasteClipped: (lost: number) => void;
  afterFilter: (filters: Map<number, ColumnFilter>) => void;
  afterAutofill: (source: CellRange, target: CellRange) => void;
  afterValidate: (row: number, col: number, error: string | undefined) => void;
  afterStyle: (range: CellRange, style: CellStyle | null) => void;
  afterColumnMove: (start: number, count: number, target: number) => void;
}
export type HookName = keyof HookMap;

export interface Snapshot {
  data: RawCell[][];
  binding?: ReturnType<ObjectBinding['snapshot']>;
  colSizes: number[];
  rows: { order: number[]; hidden: number[] };
  merges: MergeArea[];
  columns: (CellMeta | undefined)[];
  labels: string[] | undefined;
  filters: [number, ColumnFilter][];
  sort: SortKey[];
  cellMeta: [number, CellMeta][];
  rowHeights: [number, number][];
  hidden: [number, number][];
  hiddenRows: number[];
  details: number[];
  groups: RowGroup[];
  sourceCols?: number[];
}

export type MetaChange = { key: number; before?: CellMeta; after?: CellMeta };

/**
 * A structural entry holds the state to go back to; replaying it swaps in the current state,
 * so only one full snapshot is taken per step (stack order guarantees the current state is the
 * other side of the step).
 */
export type UndoEntry =
  | { kind: 'cells'; changes: CellChange[] }
  | { kind: 'meta'; changes: MetaChange[] }
  | { kind: 'structure'; state: Snapshot; ops: EngineOp[] }
  | { kind: 'group'; entries: UndoEntry[] };

/**
 * A structural operation applied to the engine. Undo runs the inverse (a removal is restored from
 * its record, which also brings back formulas on other sheets that it turned into #REF!).
 */
export interface EngineOp {
  axis: 'row' | 'col';
  index: number;
  count: number;
  remove: boolean;
  record?: RemovalRecord;
  /** Set for a move: insertion index of the block (pre-move coordinates). */
  target?: number;
}

export interface Pane {
  el: HTMLDivElement;
  frozenRows: boolean;
  frozenCols: boolean;
  cells: Map<number, HTMLDivElement>;
  pool: HTMLDivElement[];
  colHeads: HTMLDivElement[];
  rowHeads: HTMLDivElement[];
  rangeBox: HTMLDivElement;
  /** Further ranges of a Ctrl+click selection. */
  extraBoxes: HTMLDivElement[];
  fillBox: HTMLDivElement;
  activeBox: HTMLDivElement;
  handle: HTMLDivElement;
}

export type Span = [number, number];
