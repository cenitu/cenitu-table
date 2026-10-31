import { cellKey, columnLabel, normalizeRange, toA1, type CellAddress, type CellRange } from '../formula/address';
import { FormulaEngine, type ChangedCell, type RemovalRecord } from '../formula/engine';
import { CellError, isFormula, parseLiteral, type CellValue, type RawCell } from '../formula/values';
import { extendSeries, type FillDirection } from './autofill';
import { Axis } from './axis';
import { isObjectData, ObjectBinding, type DataRow } from './binding';
import { convertInput, editText, formatCell, hasValidation, optionLabel, optionValue, styleClasses, validate, type CellEditorInstance, type CellMeta, type CellStyle, type ConditionalFormat, type DropdownOption } from './cellTypes';
import { openColumnMenu } from './columnMenu';
import { toCSV, type CsvOptions } from '../export/csv';
import { downloadBlob, CSV_MIME } from '../export/download';
import { numberFormatFromMeta } from '../export/numberFormat';
import { toXLSXCompressed, XLSX_MIME } from '../export/xlsx';
import { readXLSX, type ImportOptions, type ImportSheet } from '../export/xlsxRead';
import { metaFromFormat } from '../export/xlsxStyles';
import type { ExportCellFormat, ExportSheet } from '../export/types';
import { parseHtmlTable, tableHtml } from './clipboardHtml';
import { openPopupMenu, type MenuEntry } from './contextMenu';
import { compareForSort, matchesFilter, type ColumnFilter, type SortOrder } from './filters';
import { Merges, type MergeArea } from './merges';
import { enUS, type Messages } from './messages';
import { RowMapper } from './rowMapper';
import { matchSpans, openSearchPanel, replaceSpans, type SearchOptions, type SearchPanel } from './search';
import { DEFAULT_PAGE_SIZES, initialQuery, Pager, type QueryChangeReason, type ServerFilter, type ServerQuery } from './serverMode';
import { injectStyles } from './styles';
import { parseTSV, toTSV } from './tsv';

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
  /** Column widths, order and visibility to start with, from `getColumnLayout`. */
  columnLayout?: ColumnLayout;
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

interface HookMap {
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
  /** Server mode: fetch the rows for `query`. */
  afterQueryChange: (query: ServerQuery, reason: QueryChangeReason) => void;
  /** Server mode: a paste did not fit the loaded rows; `lost` rows were not pasted. */
  afterPasteClipped: (lost: number) => void;
  afterFilter: (filters: Map<number, ColumnFilter>) => void;
  afterAutofill: (source: CellRange, target: CellRange) => void;
  afterValidate: (row: number, col: number, error: string | undefined) => void;
  afterStyle: (range: CellRange, style: CellStyle | null) => void;
  afterColumnMove: (start: number, count: number, target: number) => void;
}
export type HookName = keyof HookMap;

interface Snapshot {
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
}

type MetaChange = { key: number; before?: CellMeta; after?: CellMeta };

/**
 * A structural entry holds the state to go back to; replaying it swaps in the current state,
 * so only one full snapshot is taken per step (stack order guarantees the current state is the
 * other side of the step).
 */
type UndoEntry =
  | { kind: 'cells'; changes: CellChange[] }
  | { kind: 'meta'; changes: MetaChange[] }
  | { kind: 'structure'; state: Snapshot; ops: EngineOp[] }
  | { kind: 'group'; entries: UndoEntry[] };

/**
 * A structural operation applied to the engine. Undo runs the inverse (a removal is restored from
 * its record, which also brings back formulas on other sheets that it turned into #REF!).
 */
interface EngineOp {
  axis: 'row' | 'col';
  index: number;
  count: number;
  remove: boolean;
  record?: RemovalRecord;
  /** Set for a move: insertion index of the block (pre-move coordinates). */
  target?: number;
}

interface Pane {
  el: HTMLDivElement;
  frozenRows: boolean;
  frozenCols: boolean;
  cells: Map<number, HTMLDivElement>;
  pool: HTMLDivElement[];
  colHeads: HTMLDivElement[];
  rowHeads: HTMLDivElement[];
  rangeBox: HTMLDivElement;
  fillBox: HTMLDivElement;
  activeBox: HTMLDivElement;
  handle: HTMLDivElement;
}

type Span = [number, number];

const HEADER_HEIGHT = 26;
const ROW_HEADER_WIDTH = 50;
const OVERSCAN = 4;
/** Larger copies carry no HTML: building it would stall the browser for a format few apps need there. */
const MAX_HTML_CELLS = 50000;
/** Pause after typing before `loadOptions` runs. */
const OPTIONS_DELAY = 200;

/**
 * Spreadsheet-like data grid. Only the visible window of cells is in the DOM and cell elements
 * are recycled while scrolling. The view is split into four panes (frozen corner, frozen top,
 * frozen left, scrolling body). Rows have a visual order (sorting/filtering) mapped onto
 * physical data rows; formulas always use physical rows, which is also what row headers show.
 */
export class CenituGrid {
  readonly root: HTMLDivElement;
  private data: RawCell[][] = [];
  private binding?: ObjectBinding;
  /** Set while undo replays engine operations: rows and objects are out of step until restored. */
  private bindingPaused = false;
  private rows: Axis;
  private cols: Axis;
  private mapper: RowMapper;
  private merges = new Merges();
  private engine?: FormulaEngine;
  private ownsEngine = false;
  private sheet = 0;
  private opts: GridOptions;
  private messages: Messages;
  private readonly headerH: number;
  private readonly rowHeaderW: number;
  private frozenRows: number;
  private frozenCols: number;

  private columnMeta: (CellMeta | undefined)[] = [];
  private cellMeta = new Map<number, CellMeta>();
  private labels: string[] | undefined;
  private filters = new Map<number, ColumnFilter>();
  private sortKeys: SortKey[] = [];
  private invalid = new Map<number, string>();
  /** Custom row heights by physical row. */
  private rowHeights = new Map<number, number>();
  private rowsCustomized = false;
  /** Hidden columns and the width to restore when shown. */
  private hiddenCols = new Map<number, number>();
  private announcer!: HTMLDivElement;
  private announceTimer = 0;

  private canvas!: HTMLDivElement;
  private topBand!: HTMLDivElement;
  private bodyBand!: HTMLDivElement;
  private panes!: { corner: Pane; top: Pane; left: Pane; main: Pane };
  private cornerHead!: HTMLDivElement;
  /** Always-focused textarea: invisible while idle, becomes the cell editor on input. */
  private input!: HTMLTextAreaElement;
  private editing = false;
  private editorEnterMode = false;
  private dropdown?: { el: HTMLDivElement; items: DropdownOption[]; active: number; request?: AbortController; timer?: number };
  /** Choice made in the dropdown; wins over the text, which may be a label shared by two choices. */
  private picked?: { value: RawCell };
  /** Labels of values chosen from `loadOptions`, by column and value. */
  private loadedLabels = new Map<string, string>();
  private customEditor?: { el: HTMLDivElement; instance: CellEditorInstance | void };
  private closeMenu?: () => void;

  private anchor: CellAddress | null = null;
  /** Other corner of the selection (the anchor is the active cell). */
  private selEnd: CellAddress | null = null;
  private dragging: 'cells' | 'rows' | 'cols' | 'fill' | 'move' | null = null;
  private moveDrop: { start: number; count: number; target: number } | null = null;
  private fillTarget: { range: CellRange; direction: FillDirection } | null = null;

  private hooks = new Map<HookName, Set<(...args: never[]) => unknown>>();
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private clipboard: { text: string; raws: RawCell[][]; rows: number[]; col: number; styles: (CellStyle | undefined)[][]; html?: string } | null = null;
  private searchPanel?: SearchPanel;
  private searchQuery = '';
  private searchOptions: SearchOptions = {};
  /** Matches shown highlighted while the search box is open (physical cell keys). */
  private searchHits = new Set<number>();
  private bar?: { el: HTMLDivElement; address: HTMLDivElement; input: HTMLTextAreaElement };
  private server?: { query: ServerQuery; total: number; pager?: Pager; status?: HTMLDivElement };
  private frame = 0;
  private cleanup: (() => void)[] = [];

  constructor(container: HTMLElement, options: GridOptions = {}) {
    this.opts = options;
    this.messages = { ...enUS, ...options.language };
    this.headerH = options.colHeaders === false ? 0 : HEADER_HEIGHT;
    this.rowHeaderW = options.rowHeaders === false ? 0 : ROW_HEADER_WIDTH;
    this.labels = Array.isArray(options.colHeaders) ? [...options.colHeaders] : undefined;
    this.columnMeta = [...(options.columns ?? [])];

    const doc = container.ownerDocument;
    injectStyles(doc);
    this.root = doc.createElement('div');
    this.root.className = 'ct-root';
    this.root.setAttribute('role', 'grid');
    this.root.setAttribute('aria-multiselectable', 'true');
    this.root.style.height = typeof options.height === 'number' ? `${options.height}px` : options.height ?? '400px';
    this.buildDom();
    container.appendChild(this.root);
    if (options.formulaBar) this.buildFormulaBar();
    if (options.dataMode === 'server') this.buildServerMode();
    this.applyTheme();

    const shared = options.formulas instanceof FormulaEngine ? options.formulas : undefined;
    const existing = shared && options.sheetName !== undefined ? shared.getSheetId(options.sheetName) : shared ? 0 : undefined;
    // A grid on an existing sheet of a shared engine starts from that sheet's content.
    const initial = options.data ?? (shared && existing !== undefined ? shared.getSheetSerialized(existing) : []);
    this.data = this.normalize(this.bind(initial));
    this.frozenRows = Math.min(options.fixedRowsTop ?? 0, this.data.length);
    this.frozenCols = Math.min(options.fixedColumnsStart ?? 0, this.countCols());
    this.mapper = new RowMapper(this.data.length, this.frozenRows);
    this.rows = new Axis(this.data.length, options.rowHeight ?? 24);
    const fallback = typeof options.colWidths === 'number' ? options.colWidths : 100;
    const widths = Array.isArray(options.colWidths)
      ? options.colWidths
      : this.columnMeta.some((m) => m?.width)
        ? Array.from({ length: this.countCols() }, (_, c) => this.columnMeta[c]?.width ?? fallback)
        : options.colWidths;
    this.cols = new Axis(this.countCols(), 100, widths);
    if (options.mergeCells) this.merges.set(options.mergeCells.filter((m) => this.mergeAllowed(m)));
    for (const c of options.hiddenColumns ?? []) this.hiddenCols.set(c, this.cols.size(c));
    for (const c of this.hiddenCols.keys()) this.cols.setSize(c, 0);

    if (shared) {
      this.engine = shared;
      this.sheet = existing ?? shared.addSheet(options.sheetName);
      if (options.data || existing === undefined) shared.setSheetContent(this.data, this.sheet);
    } else if (options.formulas === true || (options.formulas === undefined && !this.server)) {
      this.engine = FormulaEngine.buildFromArray(this.data, options.sheetName);
      this.ownsEngine = true;
    }
    this.engine?.on('valuesUpdated', this.onValuesUpdated);
    this.syncBoundObjects();
    if (options.columnLayout) this.applyColumnLayout(options.columnLayout);

    this.validateAll();
    this.bindEvents();
    this.render();
  }

  // ---------- public API: server mode ----------

  /** Current query (server mode). */
  getQuery(): ServerQuery | undefined {
    return this.server && structuredClone(this.server.query);
  }

  /** Changes the query and asks for new rows. Anything but a page change returns to page 1. */
  setQuery(change: Partial<ServerQuery>, reason: QueryChangeReason = 'filter'): void {
    const s = this.server;
    if (!s) return;
    s.query = { ...s.query, ...change, page: reason === 'page' ? change.page ?? s.query.page : 1 };
    this.render();
    this.run('afterQueryChange', this.getQuery()!, reason);
  }

  /**
   * Shows a fetched page. Unlike `loadData`, sort marks, filters, column layout and scroll stay,
   * and the selection follows its row by `rowKey` when the row is still there. Undo history ends
   * here: it refers to rows that are gone.
   */
  setPageRows(rows: RawCell[][] | DataRow[], totalCount?: number): void {
    const s = this.server;
    if (!s) return this.loadData(rows);
    const selectedKey = this.anchor ? this.rowKeyAt(this.mapper.toPhysical(this.anchor.row)) : undefined;
    const selectedCol = this.anchor?.col ?? 0;
    this.data = this.normalize(this.bind(rows));
    this.mapper = new RowMapper(this.data.length, Math.min(this.frozenRows, this.data.length));
    this.syncRows();
    this.cols.resize(this.countCols());
    this.cellMeta.clear();
    this.rowHeights.clear();
    this.rowsCustomized = false;
    this.syncRows();
    this.undoStack = [];
    this.redoStack = [];
    if (this.engine) {
      this.bindingPaused = true;
      this.engine.setSheetContent(this.data, this.sheet);
      this.bindingPaused = false;
    }
    if (totalCount !== undefined) s.total = totalCount;
    if (selectedKey !== undefined) {
      const row = this.data.findIndex((_, p) => this.rowKeyAt(p) === selectedKey);
      if (row >= 0) this.anchor = this.selEnd = { row, col: selectedCol };
    }
    this.clampSelection();
    this.validateAll();
    this.render();
  }

  /** A forced theme is a class on everything the grid draws outside its root, too. */
  private applyTheme(): void {
    const theme = this.opts.theme;
    for (const el of [this.root, this.bar?.el, this.server?.pager?.el, this.floating()]) {
      el?.classList.toggle('ct-light', theme === 'light');
      el?.classList.toggle('ct-dark', theme === 'dark');
    }
  }

  private floating(): HTMLElement | undefined {
    return this.searchPanel ? this.root.ownerDocument.querySelector<HTMLElement>('.ct-search') ?? undefined : undefined;
  }

  private themeClass(): string {
    const theme = this.opts.theme;
    return theme === 'light' || theme === 'dark' ? `ct-${theme}` : '';
  }

  private rowKeyAt(p: number): unknown {
    const key = this.opts.rowKey;
    if (key === undefined) return undefined;
    const row: DataRow | RawCell[] = this.binding?.objects[p] ?? this.data[p];
    return typeof key === 'function' ? key(row) : (row as DataRow)?.[key];
  }

  /** Stable id of a column: `columns[i].id`, then its bound property. */
  getColumnId(col: number): string | undefined {
    return this.columnMeta[col]?.id ?? this.columnMeta[col]?.data ?? this.binding?.fields[col];
  }

  private colOfId(id: string): number {
    for (let c = 0; c < this.countCols(); c++) if (this.getColumnId(c) === id) return c;
    return -1;
  }

  private buildServerMode(): void {
    const o = this.opts;
    const sizes = o.pageSizes ?? DEFAULT_PAGE_SIZES;
    const s: NonNullable<CenituGrid['server']> = { query: initialQuery(o.query, sizes), total: o.totalCount ?? 0 };
    this.server = s;
    if (o.pager !== false) {
      s.pager = new Pager(
        this.root.ownerDocument,
        this.messages,
        sizes,
        (delta) => this.setQuery({ page: s.query.page + delta }, 'page'),
        (pageSize) => this.setQuery({ pageSize }, 'pageSize'),
      );
      o.pagerActions?.(s.pager.actions);
      this.root.after(s.pager.el);
    }
  }

  /** Page bar, busy state and the empty/loading/error message. */
  private renderServerState(): void {
    const s = this.server;
    if (!s) return;
    const o = this.opts;
    s.pager?.update(s.query, s.total);
    this.root.setAttribute('aria-busy', String(!!o.loading));
    const empty = !this.data.length;
    const state = o.loadError ? 'error' : empty ? (o.loading ? 'loading' : 'empty') : null;
    if (!state) {
      s.status?.remove();
      s.status = undefined;
      return;
    }
    // Failed reloads keep the old rows on screen, so the message goes above them.
    if (!s.status) s.status = this.el('ct-status', this.root);
    if (s.status.nextSibling !== this.canvas) this.root.insertBefore(s.status, this.canvas);
    s.status.dataset.state = state;
    s.status.classList.toggle('ct-status-error', state === 'error');
    s.status.setAttribute('role', state === 'error' ? 'alert' : 'status');
    s.status.textContent = '';
    if (o.renderStatus) o.renderStatus(s.status, state);
    else if (state === 'error') s.status.textContent = typeof o.loadError === 'string' ? o.loadError : this.messages.loadError;
    else s.status.textContent = state === 'empty' ? this.messages.noRows : this.messages.loading;
  }

  // ---------- public API: data ----------

  /** Number of visible rows. */
  countRows(): number {
    return this.mapper.count;
  }

  countSourceRows(): number {
    return this.data.length;
  }

  countCols(): number {
    // A server page can be empty, and the headers must stay: they hold the filter to clear.
    return this.data[0]?.length ?? (this.opts.dataMode === 'server' ? this.columnMeta.length : 0);
  }

  getEngine(): FormulaEngine | undefined {
    return this.engine;
  }

  /** Engine sheet id shown by this grid. */
  getSheetId(): number {
    return this.sheet;
  }

  getSheetName(): string | undefined {
    return this.engine?.getSheetName(this.sheet);
  }

  toPhysicalRow(row: number): number {
    return this.mapper.toPhysical(row);
  }

  /** -1 when the row is hidden by a filter. */
  toVisualRow(physicalRow: number): number {
    return this.mapper.toVisual(physicalRow);
  }

  /** Computed value at a visual position (formula result when formulas are enabled). */
  getDataAtCell(row: number, col: number): CellValue {
    return this.valueAt(this.mapper.toPhysical(row), col);
  }

  /** Raw value at a visual position, as entered, e.g. "=SUM(A1:A3)". */
  getSourceDataAtCell(row: number, col: number): RawCell {
    return this.rawAt(this.mapper.toPhysical(row), col);
  }

  /** Computed values of the visible rows, in display order. */
  getData(): CellValue[][] {
    return Array.from({ length: this.countRows() }, (_, r) =>
      Array.from({ length: this.countCols() }, (_, c) => this.getDataAtCell(r, c)),
    );
  }

  /** Raw data in physical order (unaffected by sorting and filtering). */
  getSourceData(): RawCell[][] {
    return this.data.map((r, p) => r.map((_, c) => this.rawAt(p, c)));
  }

  /**
   * Rows as bound properties see them (object mode); compares directly with the source objects.
   * Without object binding, the raw data.
   */
  getBoundRows(): RawCell[][] {
    return this.data.map((r, p) => r.map((_, c) => this.boundValueAt(p, c)));
  }

  /** Object mode: the bound source objects (the same array instances the grid writes edits into). */
  getSourceObjects(): DataRow[] | undefined {
    return this.binding?.objects;
  }

  /** The source object (object mode) or raw row array of a visual row. */
  getSourceDataAtRow(row: number): DataRow | RawCell[] | undefined {
    const p = this.mapper.toPhysical(row);
    return this.binding ? this.binding.objects[p] : this.getSourceData()[p];
  }

  /** Visual column index of a bound property, or -1. */
  propToCol(prop: string): number {
    return this.binding?.fields.indexOf(prop) ?? -1;
  }

  colToProp(col: number): string | undefined {
    return this.binding?.fields[col];
  }

  setDataAtCell(row: number, col: number, value: RawCell, source?: ChangeSource): void;
  setDataAtCell(changes: [number, number, RawCell][], source?: ChangeSource): void;
  setDataAtCell(
    a: number | [number, number, RawCell][],
    b?: number | ChangeSource,
    c?: RawCell,
    d?: ChangeSource,
  ): void {
    const list = typeof a === 'number' ? [[a, b as number, c] as [number, number, RawCell]] : a;
    const source = (typeof a === 'number' ? d : (b as ChangeSource | undefined)) ?? 'api';
    this.applyChanges(list.map(([row, col, v]) => this.change(this.mapper.toPhysical(row), col, v)), source);
  }

  loadData(data: RawCell[][] | DataRow[]): void {
    if (this.server) return this.setPageRows(data);
    this.data = this.normalize(this.bind(data));
    this.frozenRows = Math.min(this.frozenRows, this.data.length);
    this.mapper = new RowMapper(this.data.length, this.frozenRows);
    this.syncRows();
    this.cols.resize(this.countCols());
    this.filters.clear();
    this.sortKeys = [];
    this.cellMeta.clear();
    this.rowHeights.clear();
    this.bindingPaused = true;
    this.engine?.setSheetContent(this.data, this.sheet);
    this.bindingPaused = false;
    this.syncBoundObjects();
    this.undoStack = [];
    this.redoStack = [];
    this.anchor = this.selEnd = null;
    this.validateAll();
    this.render();
  }

  /**
   * Replaces the grid's content with an imported sheet, including its formats, sizes, frozen
   * panes and merges. Hidden rows are shown: the grid only hides rows through filters.
   */
  loadSheet(sheet: ImportSheet): void {
    this.merges.set([]);
    this.hiddenCols.clear();
    this.loadData(sheet.data);
    this.frozenRows = Math.min(sheet.frozen?.rows ?? 0, this.data.length);
    this.frozenCols = Math.min(sheet.frozen?.cols ?? 0, this.countCols());
    this.mapper.setPinned(this.frozenRows);
    const n = this.countCols();
    this.cols = new Axis(n, this.cols.defaultSize, Array.from({ length: n }, (_, c) => sheet.colWidths?.[c] ?? this.cols.defaultSize));
    for (const c of sheet.hiddenColumns) {
      this.hiddenCols.set(c, this.cols.size(c));
      this.cols.setSize(c, 0);
    }
    sheet.rowHeights?.forEach((h, row) => {
      if (row < this.data.length) this.rowHeights.set(row, h);
    });
    this.rowsCustomized = this.rowHeights.size > 0;
    this.syncRows();
    // Files reuse a few formats across many cells, and meta objects are never mutated in place.
    const metas = new Map<object, CellMeta>();
    for (let r = 0; r < this.data.length; r++) {
      for (let c = 0; c < n; c++) {
        const format = sheet.format(r, c);
        if (!format) continue;
        let meta = metas.get(format);
        if (!meta) metas.set(format, (meta = metaFromFormat(format)));
        // A date format on a text cell would mark the text as invalid.
        if (meta.type === 'date' && typeof sheet.values?.[r]?.[c] === 'string') {
          const { type: _type, dateFormat: _format, ...rest } = meta;
          meta = rest;
        }
        this.cellMeta.set(cellKey(r, c), meta);
      }
    }
    this.merges.set((sheet.merges ?? []).filter((m) => this.mergeAllowed(m)));
    this.validateAll();
    this.render();
  }

  /**
   * Reads one sheet of an .xlsx file into this grid (default the first) and adds the workbook's
   * defined names to the engine. References to other sheets need all of them: see `workbookEngine`.
   */
  async importXLSX(file: ArrayBuffer | Uint8Array | Blob, opts: ImportOptions & { sheet?: number | string } = {}): Promise<ImportSheet> {
    const book = await readXLSX(file, opts);
    const { sheet: pick = 0 } = opts;
    const sheet = typeof pick === 'number' ? book.sheets[pick] : book.sheets.find((s) => s.name === pick);
    if (!sheet) throw new Error(`Sheet not found: ${pick}`);
    for (const { name, expression } of book.names) {
      if (this.engine?.isItPossibleToAddNamedExpression(name)) this.engine.addNamedExpression(name, expression);
    }
    this.loadSheet(sheet);
    return sheet;
  }

  // ---------- public API: settings & meta ----------

  /** Effective settings of a cell at a visual position. */
  getCellMeta(row: number, col: number): CellMeta {
    return this.metaAt(this.mapper.toPhysical(row), col);
  }

  setCellMeta(row: number, col: number, meta: CellMeta): void {
    const p = this.mapper.toPhysical(row);
    const key = cellKey(p, col);
    this.cellMeta.set(key, { ...this.cellMeta.get(key), ...meta });
    this.revalidate(p, col);
    this.render();
  }

  /** Updates a subset of options at runtime. */
  updateSettings(
    s: Pick<GridOptions, 'fixedRowsTop' | 'fixedColumnsStart' | 'readOnly' | 'columns' | 'colHeaders' | 'mergeCells' | 'columnSorting' | 'filters' | 'fillHandle' | 'locale' | 'language' | 'contextMenu' | 'conditionalFormats' | 'search' | 'query' | 'totalCount' | 'loading' | 'loadError' | 'theme'>,
  ): void {
    this.opts = { ...this.opts, ...s };
    if (s.theme !== undefined) this.applyTheme();
    if (this.server) {
      // Written directly: a query coming from outside must not ask for rows again.
      if (s.query) this.server.query = { ...this.server.query, ...s.query };
      if (s.totalCount !== undefined) this.server.total = s.totalCount;
    }
    if (s.language) this.messages = { ...enUS, ...s.language };
    if (s.columns) this.columnMeta = [...s.columns];
    if (s.colHeaders !== undefined) this.labels = Array.isArray(s.colHeaders) ? [...s.colHeaders] : undefined;
    if (s.columnSorting !== undefined || s.filters !== undefined) this.resetHeaders();
    if (s.fixedRowsTop !== undefined || s.fixedColumnsStart !== undefined) {
      this.frozenRows = Math.min(s.fixedRowsTop ?? this.frozenRows, this.data.length);
      this.frozenCols = Math.min(s.fixedColumnsStart ?? this.frozenCols, this.countCols());
      this.mapper.setPinned(this.frozenRows);
      this.syncRows();
      this.merges.set(this.merges.list.filter((m) => this.mergeAllowed(m)));
    }
    if (s.mergeCells) this.merges.set(s.mergeCells.filter((m) => this.mergeAllowed(m)));
    if (s.columns) this.validateAll();
    this.render();
  }

  // ---------- public API: selection ----------

  selectCell(row: number, col: number, row2 = row, col2 = col): void {
    const clampR = (r: number) => Math.max(0, Math.min(r, this.countRows() - 1));
    const clampC = (c: number) => Math.max(0, Math.min(c, this.countCols() - 1));
    let anchor = { row: clampR(row), col: clampC(col) };
    let focus = { row: clampR(row2), col: clampC(col2) };
    const area = this.mergeAt(anchor.row, anchor.col);
    if (area && row === row2 && col === col2) {
      anchor = { row: area.row, col: area.col };
      focus = { ...anchor };
    }
    this.anchor = anchor;
    this.selEnd = focus;
    this.scrollIntoView(this.selEnd);
    this.render();
    this.announce();
    this.run('afterSelection', anchor.row, anchor.col, focus.row, focus.col);
  }

  private announce(): void {
    if (!this.anchor) return;
    const { row, col } = this.anchor;
    const p = this.mapper.toPhysical(row);
    const text = this.messages.cellAnnouncement
      .replace('{cell}', toA1({ row: p, col }))
      .replace('{value}', this.displayText(p, col) || '—');
    this.input.setAttribute('aria-label', text);
    // Debounced so holding an arrow key does not flood the screen reader.
    clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => (this.announcer.textContent = text), 120) as unknown as number;
  }

  /** Selection as [[row, col, row2, col2]] (visual). */
  getSelected(): [number, number, number, number][] | undefined {
    if (!this.anchor || !this.selEnd) return undefined;
    return [[this.anchor.row, this.anchor.col, this.selEnd.row, this.selEnd.col]];
  }

  /** Selected range, grown to cover merged cells it touches. */
  getSelectedRange(): CellRange | undefined {
    if (!this.anchor || !this.selEnd) return undefined;
    const r = normalizeRange(this.anchor, this.selEnd);
    return this.mergesActive() ? this.merges.expand(r) : r;
  }

  /** Gives keyboard focus to the grid (typing then edits the active cell). */
  focus(): void {
    if (!this.anchor && this.countRows() && this.countCols()) this.selectCell(0, 0);
    this.focusInput();
  }

  deselectCell(): void {
    this.anchor = this.selEnd = null;
    this.render();
  }

  // ---------- public API: formatting & layout ----------

  /** Sets (merges) a style on every cell of a visual range; null removes cell styles. Undoable. */
  setCellStyle(range: CellRange, style: CellStyle | null): void {
    const changes: MetaChange[] = [];
    for (let r = range.start.row; r <= range.end.row; r++) {
      const p = this.mapper.toPhysical(r);
      for (let c = range.start.col; c <= range.end.col; c++) {
        const key = cellKey(p, c);
        const before = this.cellMeta.get(key);
        const after: CellMeta = { ...before };
        if (style) after.style = { ...before?.style, ...style };
        else delete after.style;
        changes.push({ key, before, after: Object.keys(after).length ? after : undefined });
      }
    }
    this.applyMeta(changes, 'after');
    this.undoStack.push({ kind: 'meta', changes });
    this.redoStack = [];
    this.render();
    this.run('afterStyle', range, style);
  }

  /** Effective style of a cell at a visual position (column, cell and conditional styles combined). */
  getCellStyle(row: number, col: number): CellStyle {
    const p = this.mapper.toPhysical(row);
    return { ...this.metaAt(p, col).style, ...this.conditionalStyle(p, col, this.valueAt(p, col)) };
  }

  /** Turns a flag on for the selection, or off when every selected cell already has it (Ctrl+B/I/U). */
  toggleCellStyle(flag: 'bold' | 'italic' | 'underline' | 'strike'): void {
    const r = this.getSelectedRange();
    if (!r || this.opts.readOnly) return;
    let all = true;
    for (let row = r.start.row; row <= r.end.row && all; row++) {
      for (let col = r.start.col; col <= r.end.col && all; col++) all = !!this.getCellStyle(row, col)[flag];
    }
    this.setCellStyle(r, { [flag]: !all });
  }

  setRowHeight(row: number, height: number): void {
    const h = Math.max(12, Math.round(height));
    this.rowHeights.set(this.mapper.toPhysical(row), h);
    this.rowsCustomized = true;
    this.rows.setSize(row, h);
    this.render();
  }

  getRowHeight(row: number): number {
    return this.rows.size(row);
  }

  /** Current widths, order and visibility; store it and give it back with `setColumnLayout`. */
  getColumnLayout(): ColumnLayout {
    const columns: ColumnLayout['columns'] = [];
    for (let c = 0; c < this.countCols(); c++) {
      const id = this.getColumnId(c);
      if (id === undefined) continue;
      const hidden = this.hiddenCols.has(c);
      columns.push({ id, width: hidden ? this.hiddenCols.get(c)! : this.cols.size(c), hidden });
    }
    return { columns };
  }

  /**
   * Restores a saved layout. Ids that no longer exist are skipped and new columns stay after the
   * saved ones, so a layout survives application updates. Clears undo history when columns moved:
   * its entries refer to the old order.
   */
  setColumnLayout(layout: ColumnLayout): void {
    if (this.applyColumnLayout(layout)) {
      this.undoStack = [];
      this.redoStack = [];
    }
    this.validateAll();
    this.render();
  }

  private applyColumnLayout(layout: ColumnLayout): boolean {
    let moved = false;
    let position = 0;
    for (const { id, width, hidden } of layout.columns) {
      const c = this.colOfId(id);
      if (c < 0) continue;
      if (c !== position && this.canMoveColumns(c, 1, position)) {
        this.relocateColumns(c, 1, position, []);
        moved = true;
      }
      const at = this.colOfId(id);
      position = at + 1;
      if (hidden) {
        this.hiddenCols.set(at, width);
        this.cols.setSize(at, 0);
      } else {
        this.hiddenCols.delete(at);
        this.cols.setSize(at, Math.max(24, width));
      }
    }
    return moved;
  }

  private layoutChanged(): void {
    if (this.hooks.get('afterColumnLayout')?.size) this.run('afterColumnLayout', this.getColumnLayout());
  }

  hideColumns(cols: number[]): void {
    for (const c of cols) {
      if (c < 0 || c >= this.countCols() || this.hiddenCols.has(c)) continue;
      this.hiddenCols.set(c, this.cols.size(c));
      this.cols.setSize(c, 0);
    }
    // Keep the active cell on a visible column.
    if (this.anchor && this.hiddenCols.has(this.anchor.col)) this.moveActive(0, 0, false);
    this.render();
    this.layoutChanged();
  }

  /** Shows the given hidden columns, or all of them. */
  showColumns(cols?: number[]): void {
    for (const c of cols ?? [...this.hiddenCols.keys()]) {
      const width = this.hiddenCols.get(c);
      if (width === undefined) continue;
      this.hiddenCols.delete(c);
      this.cols.setSize(c, width || this.cols.defaultSize);
    }
    this.render();
    this.layoutChanged();
  }

  isColumnHidden(col: number): boolean {
    return this.hiddenCols.has(col);
  }

  getHiddenColumns(): number[] {
    return [...this.hiddenCols.keys()].sort((a, b) => a - b);
  }

  // ---------- public API: export ----------

  /**
   * Describes this sheet for the CSV/XLSX exporters: all rows in data order (so formulas stay
   * valid), with formats, styles (including current conditional styles), widths, heights,
   * frozen panes and merges.
   */
  toExportSheet(): ExportSheet {
    const data = this.engine ? this.getSourceData() : this.getSourceData().map((row) => row.map(inertText));
    const values = data.map((row, p) => row.map((_, c) => this.valueAt(p, c)));
    const locale = this.opts.locale;
    const format = (p: number, c: number): ExportCellFormat | undefined => {
      const meta = this.metaAt(p, c);
      const style = { ...meta.style, ...this.conditionalStyle(p, c, values[p]?.[c] ?? null) };
      const out: ExportCellFormat = {};
      const numberFormat = numberFormatFromMeta(meta, locale);
      if (numberFormat) out.numberFormat = numberFormat;
      if (style.bold) out.bold = true;
      if (style.italic) out.italic = true;
      if (style.underline) out.underline = true;
      if (style.strike) out.strike = true;
      if (style.color?.startsWith('#')) out.color = style.color;
      if (style.background?.startsWith('#')) out.background = style.background;
      if (style.align) out.align = style.align;
      if (style.wrap) out.wrap = true;
      return Object.keys(out).length ? out : undefined;
    };
    const heights = this.rowHeights.size
      ? Array.from({ length: data.length }, (_, p) => this.rowHeights.get(p) ?? this.rows.defaultSize)
      : undefined;
    const sheet: ExportSheet = {
      name: this.getSheetName() ?? 'Sheet1',
      data,
      values,
      colWidths: Array.from({ length: this.countCols() }, (_, c) => this.cols.size(c)),
      rowHeights: heights,
      frozen: { rows: this.frozenRows, cols: this.frozenCols },
      merges: this.mapper.isIdentity ? this.getMergedCells() : [],
      format,
      text: (p, c) => this.displayText(p, c, values[p]?.[c] ?? null),
    };
    if (this.opts.filters && this.frozenRows > 0) {
      sheet.autoFilter = { row: this.frozenRows - 1, col: 0, rows: data.length - this.frozenRows + 1, cols: this.countCols() };
    }
    return sheet;
  }

  /** CSV text; tr/de/… locales default to ";" fields and "," decimals as their spreadsheet apps expect. */
  exportCSV(opts: CsvOptions = {}): string {
    const comma = commaDecimalLocale(this.opts.locale);
    return toCSV(this.toExportSheet(), {
      delimiter: comma ? ';' : ',',
      decimalSeparator: comma ? ',' : '.',
      locale: this.opts.locale,
      ...opts,
    });
  }

  downloadCSV(fileName = 'data.csv', opts: CsvOptions = {}): void {
    downloadBlob(this.exportCSV(opts), fileName, CSV_MIME);
  }

  /**
   * Server mode: the sheet for every record matching the query, through `fetchAllRows`. Column
   * settings apply; styles set on single cells do not, since they belong to loaded rows.
   */
  async toExportSheetAll(): Promise<ExportSheet> {
    const fetchAll = this.opts.fetchAllRows;
    if (!this.server || !fetchAll) throw new Error('toExportSheetAll needs server mode and fetchAllRows');
    const rows = await fetchAll(this.getQuery()!);
    const n = this.countCols();
    const fields = Array.from({ length: n }, (_, c) => this.binding?.fields[c] ?? this.columnMeta[c]?.data);
    const raw = isObjectData(rows) ? ObjectBinding.create(rows, fields).toRows() : (rows as RawCell[][]);
    const data = raw.map((row) => row.map(inertText));
    const values = data.map((row) => row.map(parseLiteral));
    const objects = isObjectData(rows) ? rows : undefined;
    const locale = this.opts.locale;
    const meta = (c: number) => this.columnMeta[c] ?? {};
    return {
      name: this.getSheetName() ?? 'Sheet1',
      data,
      values,
      colWidths: Array.from({ length: n }, (_, c) => this.hiddenCols.get(c) ?? this.cols.size(c)),
      frozen: { rows: 0, cols: this.frozenCols },
      format: (_, c) => {
        const numberFormat = numberFormatFromMeta(meta(c), locale);
        return numberFormat ? { numberFormat } : undefined;
      },
      text: (r, c) => {
        const v = values[r]?.[c] ?? null;
        const m = meta(c);
        const label = m.type === 'dropdown' ? m.resolveLabel?.(v, objects?.[r] ?? data[r]) : undefined;
        return label ?? formatCell(v, m, locale).text;
      },
    };
  }

  /** Server mode: CSV of the full result. */
  async exportAllCSV(opts: CsvOptions = {}): Promise<string> {
    const comma = commaDecimalLocale(this.opts.locale);
    return toCSV(await this.toExportSheetAll(), { delimiter: comma ? ';' : ',', decimalSeparator: comma ? ',' : '.', locale: this.opts.locale, ...opts });
  }

  async downloadAllCSV(fileName = 'data.csv', opts: CsvOptions = {}): Promise<void> {
    downloadBlob(await this.exportAllCSV(opts), fileName, CSV_MIME);
  }

  async downloadAllXLSX(fileName = 'data.xlsx'): Promise<void> {
    downloadBlob(await toXLSXCompressed([await this.toExportSheetAll()]), fileName, XLSX_MIME);
  }

  /** Downloads an .xlsx with this grid's sheet followed by the sheets of `others` (e.g. grids sharing an engine). */
  async downloadXLSX(fileName = 'data.xlsx', others: CenituGrid[] = []): Promise<void> {
    const bytes = await toXLSXCompressed([this, ...others].map((g) => g.toExportSheet()));
    downloadBlob(bytes, fileName, XLSX_MIME);
  }

  // ---------- public API: sorting & filtering ----------

  /** Sorts by one column (visual order only; data and formulas are untouched). null restores data order. */
  sort(col: number, order: SortOrder | null): void {
    if (this.server) return this.sortBy(order ? [{ col, order }] : []);
    this.applySort(order ? [{ col, order }] : []);
    this.run('afterColumnSort', col, order);
  }

  /** Sorts by several columns: the first key decides, later keys break ties. Empty restores data order. */
  sortBy(keys: SortKey[]): void {
    if (this.server) {
      const sort = keys.flatMap(({ col, order }) => {
        const field = this.getColumnId(col);
        return field !== undefined && this.columnMeta[col]?.sortable ? [{ field, desc: order === 'desc' }] : [];
      });
      return this.setQuery({ sort }, 'sort');
    }
    this.applySort(keys);
  }

  private applySort(keys: SortKey[]): void {
    if (keys.length) {
      const columns = keys.map(({ col, order }) => ({
        order,
        values: Array.from({ length: this.data.length }, (_, p) => this.valueAt(p, col)),
      }));
      this.mapper.sort((a, b) => {
        for (const { values, order } of columns) {
          const d = compareForSort(values[a], values[b], order, this.opts.locale);
          if (d) return d;
        }
        return 0;
      });
    } else {
      this.mapper.sort(null);
    }
    this.sortKeys = keys.map((k) => ({ ...k }));
    this.afterRowMapping();
    this.run('afterSort', this.getSortKeys());
  }

  /** The primary sort key, or null. */
  getSortState(): SortKey | null {
    return this.getSortKeys()[0] ?? null;
  }

  getSortKeys(): SortKey[] {
    // Server sorts are kept by column id, so hiding or moving columns cannot break them.
    if (this.server) {
      return this.server.query.sort.flatMap(({ field, desc }): SortKey[] => {
        const col = this.colOfId(field);
        return col < 0 ? [] : [{ col, order: desc ? 'desc' : 'asc' }];
      });
    }
    return this.sortKeys.map((k) => ({ ...k }));
  }

  /** Server mode: sets or clears the filter of a column; asks for rows from page 1. */
  setServerFilter(columnId: string, filter: ServerFilter | null): void {
    const s = this.server;
    if (!s) return;
    const filters = { ...s.query.filters };
    if (filter) filters[columnId] = filter;
    else delete filters[columnId];
    this.setQuery({ filters }, 'filter');
  }

  setFilter(col: number, filter: ColumnFilter | null): void {
    if (this.server) return;
    if (filter) this.filters.set(col, filter);
    else this.filters.delete(col);
    this.applyFilters();
  }

  clearFilters(): void {
    this.filters.clear();
    this.applyFilters();
  }

  getFilters(): Map<number, ColumnFilter> {
    return new Map(this.filters);
  }

  /** Re-evaluates the filters against current values (they are not re-applied automatically on edit). */
  applyFilters(): void {
    if (this.server) return;
    const hidden: number[] = [];
    if (this.filters.size) {
      const filters = [...this.filters];
      for (let p = this.mapper.pinnedCount; p < this.data.length; p++) {
        if (!this.passes(p, filters)) hidden.push(p);
      }
    }
    this.mapper.setHidden(hidden);
    this.afterRowMapping();
    this.run('afterFilter', this.getFilters());
  }

  // ---------- public API: find & replace ----------

  /** Visual positions of the cells matching `query`, in reading order; hidden columns are skipped. */
  findCells(query: string, opts: SearchOptions = {}): CellAddress[] {
    const out: CellAddress[] = [];
    if (!query) return out;
    for (let r = 0; r < this.countRows(); r++) {
      const p = this.mapper.toPhysical(r);
      for (let c = 0; c < this.countCols(); c++) {
        if (this.hiddenCols.has(c) || this.metaAt(p, c).type === 'checkbox') continue;
        const m = this.mergeAt(r, c);
        if (m && (m.row !== r || m.col !== c)) continue;
        if (matchSpans(this.searchText(p, c, opts), query, opts, this.opts.locale).length) out.push({ row: r, col: c });
      }
    }
    return out;
  }

  /** Selects the match after (or before) the active cell, wrapping around; null when there is none. */
  findNext(query: string, opts: SearchOptions = {}, backward = false): CellAddress | null {
    const hits = this.findCells(query, opts);
    const hit = hits[this.nextHit(hits, backward)];
    if (hit) this.selectCell(hit.row, hit.col);
    return hit ?? null;
  }

  /**
   * Replaces the match in the active cell (when it is one) and moves to the next. Formula cells
   * change only with `lookIn: 'formulas'`: replacing in their result would delete the formula.
   */
  replaceNext(query: string, replacement: string, opts: SearchOptions = {}): CellAddress | null {
    if (this.anchor) this.replaceIn([this.anchor], query, replacement, opts);
    return this.findNext(query, opts);
  }

  /** Replaces every match in one undo step; returns the number of cells changed. */
  replaceAll(query: string, replacement: string, opts: SearchOptions = {}): number {
    return this.replaceIn(this.findCells(query, opts), query, replacement, opts);
  }

  /** Opens the find box (`search` option), with the replace row when `replace` is true. */
  openSearch(replace = false): void {
    if (this.searchPanel) return this.searchPanel.focus(replace);
    const canReplace = replace && !this.opts.readOnly;
    this.searchPanel = openSearchPanel({
      root: this.root,
      messages: this.messages,
      theme: this.themeClass(),
      query: this.searchQuery,
      options: this.searchOptions,
      replace: canReplace,
      onSearch: (query, options) => {
        this.searchQuery = query;
        this.searchOptions = options;
        return this.highlightHits().length;
      },
      onNext: (backward) => this.stepSearch(backward),
      onReplace: (replacement) => {
        if (this.anchor) this.replaceIn([this.anchor], this.searchQuery, replacement, this.searchOptions);
        return this.stepSearch(false);
      },
      onReplaceAll: (replacement) => {
        const n = this.replaceAll(this.searchQuery, replacement, this.searchOptions);
        this.highlightHits();
        return n;
      },
      onClose: () => {
        this.searchPanel = undefined;
        this.searchHits.clear();
        this.render();
        this.focusInput();
      },
    });
  }

  closeSearch(): void {
    this.searchPanel?.close();
  }

  private searchText(p: number, col: number, opts: SearchOptions): string {
    return opts.lookIn === 'formulas' ? editText(this.rawAt(p, col), this.metaAt(p, col), this.opts.locale) : this.displayText(p, col);
  }

  private nextHit(hits: CellAddress[], backward: boolean): number {
    const a = this.anchor ?? { row: -1, col: -1 };
    const after = (h: CellAddress) => h.row > a.row || (h.row === a.row && h.col > a.col);
    const before = (h: CellAddress) => h.row < a.row || (h.row === a.row && h.col < a.col);
    if (!backward) return Math.max(0, hits.findIndex(after));
    for (let i = hits.length - 1; i >= 0; i--) if (before(hits[i])) return i;
    return hits.length - 1;
  }

  private highlightHits(): CellAddress[] {
    const hits = this.findCells(this.searchQuery, this.searchOptions);
    this.searchHits = new Set(hits.map((h) => cellKey(this.mapper.toPhysical(h.row), h.col)));
    this.render();
    return hits;
  }

  private stepSearch(backward: boolean): { index: number; total: number } {
    const hits = this.highlightHits();
    const i = this.nextHit(hits, backward);
    if (hits[i]) this.selectCell(hits[i].row, hits[i].col);
    return { index: i + 1, total: hits.length };
  }

  private replaceIn(cells: CellAddress[], query: string, replacement: string, opts: SearchOptions): number {
    const changes: CellChange[] = [];
    for (const { row, col } of cells) {
      const p = this.mapper.toPhysical(row);
      const raw = this.rawAt(p, col);
      if ((isFormula(raw) && opts.lookIn !== 'formulas') || this.isReadOnly(p, col)) continue;
      const meta = this.metaAt(p, col);
      const text = editText(raw, meta, this.opts.locale);
      const spans = matchSpans(text, query, opts, this.opts.locale);
      if (spans.length) changes.push(this.change(p, col, convertInput(replaceSpans(text, spans, replacement), meta)));
    }
    this.applyChanges(changes, 'replace');
    return changes.length;
  }

  // ---------- public API: merged cells ----------

  /** Merges an area (visual coordinates). Refused while sorting/filtering is active or across frozen edges. */
  mergeCells(row: number, col: number, rowspan: number, colspan: number): boolean {
    const area = { row, col, rowspan, colspan };
    if (!this.mergeAllowed(area) || !this.merges.add(area)) return false;
    this.render();
    return true;
  }

  unmergeCells(row: number, col: number): boolean {
    const ok = this.merges.removeAt(row, col);
    if (ok) this.render();
    return ok;
  }

  getMergedCells(): MergeArea[] {
    return this.merges.list.map((m) => ({ ...m }));
  }

  // ---------- public API: structure ----------

  alter(action: AlterAction, index?: number, amount = 1): void {
    const sel = this.getSelectedRange();
    const isRow = action.includes('row');
    // Rows belong to the server; a local one would not match the page or the total.
    if (isRow && this.server) return;
    const remove = action.startsWith('remove');
    const below = action === 'insert_row_below' || action === 'insert_col_end';
    const count = isRow ? this.countRows() : this.countCols();
    let at: number;
    if (index !== undefined) at = below ? index + 1 : index;
    else if (isRow) at = below ? (sel?.end.row ?? count - 1) + 1 : sel?.start.row ?? 0;
    else at = below ? (sel?.end.col ?? count - 1) + 1 : sel?.start.col ?? 0;
    at = Math.max(0, Math.min(at, count));
    if (remove) amount = Math.min(amount, count - at);
    if (amount <= 0) return;

    const state = this.snapshot();
    const ops: EngineOp[] = [];
    if (isRow) this.alterRows(at, amount, remove, ops);
    else this.alterCols(at, amount, remove, ops);
    this.undoStack.push({ kind: 'structure', state, ops });
    this.redoStack = [];
    this.validateAll();
    this.clampSelection();
    this.render();
    this.run('afterAlter', action, at, amount);
    if (!isRow) this.layoutChanged();
  }

  /**
   * Moves `count` columns starting at `start` so they are inserted before column `target`
   * (pre-move index; `countCols()` moves them to the end). Data, formats, widths, filters and
   * formula references move with them. Undoable. Returns false, changing nothing, when the move
   * is a no-op, out of range, or would split a merged cell.
   */
  moveColumns(start: number, count: number, target: number): boolean {
    if (!this.canMoveColumns(start, count, target)) return false;
    const state = this.snapshot();
    const ops: EngineOp[] = [];
    this.relocateColumns(start, count, target, ops);
    this.undoStack.push({ kind: 'structure', state, ops });
    this.redoStack = [];
    this.validateAll();
    this.render();
    this.run('afterColumnMove', start, count, target);
    this.layoutChanged();
    return true;
  }

  private relocateColumns(start: number, count: number, target: number, ops: EngineOp[]): void {
    const n = this.countCols();
    const to = (c: number) => moveColumnIndex(c, start, count, target);
    const permute = <T>(arr: T[]): T[] => {
      const out = new Array<T>(arr.length);
      arr.forEach((v, i) => (out[to(i)] = v));
      return out;
    };
    this.data = this.data.map((row) => permute(row));
    if (this.binding) this.binding.fields = permute(this.binding.fields.length < n ? [...this.binding.fields, ...Array<undefined>(n - this.binding.fields.length)] : this.binding.fields);
    const widths = permute(Array.from({ length: n }, (_, c) => this.cols.size(c)));
    this.cols = new Axis(n, this.cols.defaultSize, widths);
    if (this.columnMeta.length) this.columnMeta = permute([...this.columnMeta, ...Array<undefined>(Math.max(0, n - this.columnMeta.length))]);
    if (this.labels) this.labels = permute([...this.labels, ...Array<string>(Math.max(0, n - this.labels.length)).fill('')]);
    this.filters = new Map([...this.filters].map(([c, f]) => [to(c), f]));
    this.sortKeys = this.sortKeys.map((k) => ({ ...k, col: to(k.col) }));
    this.hiddenCols = shiftKeys(this.hiddenCols, to);
    this.cellMeta = shiftKeys(this.cellMeta, (k) => k - (k % 16384) + to(k % 16384));
    this.merges.set(this.merges.list.map((m) => ({ ...m, col: to(m.col) })));
    this.applyEngineOp(pushed(ops, { axis: 'col', index: start, count, remove: false, target }));
    if (this.anchor && this.selEnd) {
      this.anchor = { ...this.anchor, col: to(this.anchor.col) };
      this.selEnd = { ...this.selEnd, col: to(this.selEnd.col) };
    }
  }

  canMoveColumns(start: number, count: number, target: number): boolean {
    const n = this.countCols();
    if (count <= 0 || start < 0 || start + count > n || target < 0 || target > n) return false;
    if (target >= start && target <= start + count) return false;
    const to = (c: number) => moveColumnIndex(c, start, count, target);
    return this.merges.list.every((m) => {
      for (let i = 1; i < m.colspan; i++) if (to(m.col + i) !== to(m.col) + i) return false;
      return true;
    });
  }

  undo(): void {
    this.replay(this.undoStack, this.redoStack, 'undo');
  }

  redo(): void {
    this.replay(this.redoStack, this.undoStack, 'redo');
  }

  isUndoAvailable(): boolean {
    return this.undoStack.length > 0;
  }

  isRedoAvailable(): boolean {
    return this.redoStack.length > 0;
  }

  setColWidth(col: number, width: number): void {
    this.cols.setSize(col, Math.max(24, width));
    this.render();
  }

  getColWidth(col: number): number {
    return this.cols.size(col);
  }

  addHook<K extends HookName>(name: K, fn: HookMap[K]): void {
    let set = this.hooks.get(name);
    if (!set) this.hooks.set(name, (set = new Set()));
    set.add(fn as (...args: never[]) => unknown);
  }

  removeHook<K extends HookName>(name: K, fn: HookMap[K]): void {
    this.hooks.get(name)?.delete(fn as (...args: never[]) => unknown);
  }

  /** Validation message of a cell at a visual position, if invalid. */
  getCellError(row: number, col: number): string | undefined {
    return this.invalid.get(cellKey(this.mapper.toPhysical(row), col));
  }

  // ---------- public API: context menu ----------

  /** Opens the context menu for the current selection at a viewport position (default: active cell). */
  openContextMenu(x?: number, y?: number): void {
    const range = this.getSelectedRange();
    if (!range || !this.opts.contextMenu) return;
    this.closeMenu?.();
    if (x === undefined || y === undefined) {
      const box = this.input.getBoundingClientRect();
      x = box.left + box.width / 2;
      y = box.bottom;
    }
    const defaults = this.contextMenuEntries(range);
    const entries = typeof this.opts.contextMenu === 'function' ? this.opts.contextMenu(defaults, this) : defaults;
    this.closeMenu = openPopupMenu(this.root.ownerDocument, entries, x, y, () => {
      this.closeMenu = undefined;
      this.focusInput();
    }, this.themeClass());
  }

  private contextMenuEntries(r: CellRange): MenuEntry[] {
    const m = this.messages;
    const ro = !!this.opts.readOnly;
    const rows = r.end.row - r.start.row + 1;
    const cols = r.end.col - r.start.col + 1;
    const merged = this.mergeAt(r.start.row, r.start.col);
    const isMerge = !!merged && rows === merged.rowspan && cols === merged.colspan;
    const clip = this.root.ownerDocument.defaultView?.navigator.clipboard;
    const canMerge = this.mergeAllowed({ row: r.start.row, col: r.start.col, rowspan: rows, colspan: cols });
    const rowEntries: (MenuEntry & object)[] = this.server ? [] : [
      { key: 'row_above', name: m.insertRowAbove, disabled: ro, run: () => this.alter('insert_row_above', r.start.row, rows) },
      { key: 'row_below', name: m.insertRowBelow, disabled: ro, run: () => this.alter('insert_row_below', r.end.row, rows) },
      { key: 'remove_row', name: rows > 1 ? m.removeRows : m.removeRow, disabled: ro, run: () => this.alter('remove_row', r.start.row, rows) },
    ];
    return [
      { key: 'cut', name: m.cut, hint: 'Ctrl+X', disabled: ro, run: () => this.writeClipboard(this.copy(true)) },
      { key: 'copy', name: m.copy, hint: 'Ctrl+C', run: () => this.writeClipboard(this.copy()) },
      {
        key: 'paste',
        name: m.paste,
        hint: 'Ctrl+V',
        disabled: ro || (!clip?.readText && !this.clipboard),
        // The async clipboard API may be denied; fall back to what was copied inside the grid.
        run: () => {
          const fallback = () => this.clipboard && this.paste(this.clipboard.text);
          if (clip?.readText) clip.readText().then((t) => (t ? this.paste(t) : fallback()), fallback);
          else fallback();
        },
      },
      '---',
      ...rowEntries,
      ...(rowEntries.length ? (['---'] as const) : []),
      { key: 'col_left', name: m.insertColLeft, disabled: ro, run: () => this.alter('insert_col_start', r.start.col, cols) },
      { key: 'col_right', name: m.insertColRight, disabled: ro, run: () => this.alter('insert_col_end', r.end.col, cols) },
      { key: 'remove_col', name: cols > 1 ? m.removeCols : m.removeCol, disabled: ro, run: () => this.alter('remove_col', r.start.col, cols) },
      {
        key: 'hide_col',
        name: cols > 1 ? m.hideColumns : m.hideColumn,
        disabled: cols >= this.countCols() - this.hiddenCols.size,
        run: () => this.hideColumns(Array.from({ length: cols }, (_, i) => r.start.col + i)),
      },
      ...(this.hiddenCols.size ? [{ key: 'show_cols', name: m.showColumns, run: () => this.showColumns() }] : []),
      '---',
      isMerge
        ? { key: 'unmerge', name: m.unmergeCells, disabled: ro, run: () => this.unmergeCells(r.start.row, r.start.col) }
        : {
            key: 'merge',
            name: m.mergeCells,
            disabled: ro || (rows === 1 && cols === 1) || !canMerge,
            run: () => this.mergeCells(r.start.row, r.start.col, rows, cols),
          },
      { key: 'clear', name: m.clearContents, hint: 'Del', disabled: ro, run: () => this.clearRange(r, 'clear') },
      '---',
      { key: 'undo', name: m.undo, hint: 'Ctrl+Z', disabled: !this.isUndoAvailable(), run: () => this.undo() },
      { key: 'redo', name: m.redo, hint: 'Ctrl+Y', disabled: !this.isRedoAvailable(), run: () => this.redo() },
    ];
  }

  private writeClipboard(text: string | undefined): void {
    if (text === undefined) return;
    const view = this.root.ownerDocument.defaultView;
    const clip = view?.navigator.clipboard;
    const html = this.clipboard?.html;
    const plain = () => clip?.writeText(text).catch(() => undefined);
    if (html && clip?.write && view && 'ClipboardItem' in view) {
      const blob = (type: string, content: string) => new Blob([content], { type });
      clip.write([new view.ClipboardItem({ 'text/plain': blob('text/plain', text), 'text/html': blob('text/html', html) })]).catch(plain);
    } else {
      plain();
    }
  }

  // ---------- public API: clipboard & autofill ----------

  /** Copies the selection to the internal clipboard and returns the text for the system clipboard. */
  copy(cut = false): string | undefined {
    const range = this.getSelectedRange();
    if (!range) return undefined;
    const raws: RawCell[][] = [];
    const texts: string[][] = [];
    const rows: number[] = [];
    const styles: (CellStyle | undefined)[][] = [];
    const shown: (CellStyle | undefined)[][] = [];
    let styled = false;
    for (let r = range.start.row; r <= range.end.row; r++) {
      const p = this.mapper.toPhysical(r);
      rows.push(p);
      const rawRow: RawCell[] = [];
      const textRow: string[] = [];
      const styleRow: (CellStyle | undefined)[] = [];
      const shownRow: (CellStyle | undefined)[] = [];
      for (let c = range.start.col; c <= range.end.col; c++) {
        rawRow.push(this.rawAt(p, c));
        textRow.push(this.displayText(p, c));
        styleRow.push(this.cellMeta.get(cellKey(p, c))?.style);
        const style = this.metaAt(p, c).style;
        shownRow.push(style);
        styled ||= !!style;
      }
      raws.push(rawRow);
      texts.push(textRow);
      styles.push(styleRow);
      shown.push(shownRow);
    }
    const text = toTSV(texts);
    const cells = texts.length * texts[0].length;
    const html = styled && cells <= MAX_HTML_CELLS ? tableHtml(texts, shown) : undefined;
    this.clipboard = { text, raws, rows, col: range.start.col, styles, html };
    if (cut) this.clearRange(range, 'cut');
    return text;
  }

  /**
   * Pastes text at the selection. Text from this grid's own copy keeps formulas, with relative
   * references moved to the new location and its cell styles. `html` is the clipboard's HTML
   * flavour from another app; only the styles of its table are used. A single value fills the
   * whole selection.
   */
  paste(text: string, html?: string): void {
    const range = this.getSelectedRange();
    if (!range || this.opts.readOnly) return;
    const own = this.clipboard && this.clipboard.text === text ? this.clipboard : null;
    const view = this.root.ownerDocument.defaultView;
    const table = !own && html && view ? parseHtmlTable(html, view as Window & typeof globalThis) : null;
    const block: RawCell[][] = own ? own.raws : text ? parseTSV(text) : table?.texts ?? [];
    if (!block.length) return;
    const sameShape = table && table.texts.length === block.length && table.texts.every((row, r) => row.length === block[r].length);
    const pastedStyles = own?.styles ?? (sameShape ? table.styles : undefined);
    const single = block.length === 1 && block[0].length === 1;
    let height = single ? range.end.row - range.start.row + 1 : block.length;
    if (this.server) {
      const room = this.countRows() - range.start.row;
      if (height > room) {
        this.run('afterPasteClipped', height - room);
        height = room;
      }
    }
    const width = single ? range.end.col - range.start.col + 1 : maxOf(block, (r) => r.length);
    this.ensureVisualRows(range.start.row + height);
    const changes: CellChange[] = [];
    const metas: MetaChange[] = [];
    for (let r = 0; r < height; r++) {
      const target = this.mapper.toPhysical(range.start.row + r);
      for (let c = 0; c < width; c++) {
        const col = range.start.col + c;
        const br = single ? 0 : r;
        const bc = single ? 0 : c;
        let value: RawCell = block[br][bc] ?? null;
        if (own) {
          if (isFormula(value) && this.engine) {
            value = this.engine.shiftFormula(value, target - own.rows[br], col - (own.col + bc));
          }
        } else {
          value = convertInput(String(value ?? ''), this.metaAt(target, col));
        }
        changes.push(this.change(target, col, value));
        if (pastedStyles && !this.isReadOnly(target, col)) {
          const key = cellKey(target, col);
          const before = this.cellMeta.get(key);
          const after: CellMeta = { ...before };
          const style = pastedStyles[br]?.[bc];
          if (style) after.style = style;
          else delete after.style;
          if (style || before?.style) metas.push({ key, before, after: Object.keys(after).length ? after : undefined });
        }
      }
    }
    const mark = this.undoStack.length;
    this.applyChanges(changes, 'paste');
    if (metas.length && this.undoStack.length > mark) {
      this.applyMeta(metas, 'after');
      // Values and styles undo together.
      const entries = this.undoStack.splice(mark);
      this.undoStack.push({ kind: 'group', entries: [...entries, { kind: 'meta', changes: metas }] });
    }
    this.selectCell(range.start.row, range.start.col, range.start.row + height - 1, range.start.col + width - 1);
  }

  /** Fills `target` (adjacent to `source`, visual coordinates) by extending the source series. */
  autofill(source: CellRange, target: CellRange): void {
    const direction: FillDirection =
      target.start.row > source.end.row ? 'down'
        : target.end.row < source.start.row ? 'up'
          : target.start.col > source.end.col ? 'right' : 'left';
    const vertical = direction === 'down' || direction === 'up';
    const count = vertical ? target.end.row - target.start.row + 1 : target.end.col - target.start.col + 1;
    if (direction === 'down') this.ensureVisualRows(target.end.row + 1);
    if (direction === 'right') this.ensureSize(this.data.length, target.end.col + 1);

    const changes: CellChange[] = [];
    const [from, to] = vertical ? [source.start.col, source.end.col] : [source.start.row, source.end.row];
    for (let line = from; line <= to; line++) {
      // Positions along the fill direction, in fill order.
      let srcPos: number[] = [];
      for (let i = vertical ? source.start.row : source.start.col; i <= (vertical ? source.end.row : source.end.col); i++) srcPos.push(i);
      if (direction === 'up' || direction === 'left') srcPos = srcPos.reverse();
      const tgtPos = Array.from({ length: count }, (_, i) =>
        direction === 'down' ? source.end.row + 1 + i
          : direction === 'up' ? source.start.row - 1 - i
            : direction === 'right' ? source.end.col + 1 + i : source.start.col - 1 - i,
      );
      const cell = (pos: number) =>
        vertical ? { p: this.mapper.toPhysical(pos), c: line } : { p: this.mapper.toPhysical(line), c: pos };
      const positions = [...srcPos, ...tgtPos];
      const values = extendSeries(
        srcPos.map((pos) => {
          const { p, c } = cell(pos);
          return this.rawAt(p, c);
        }),
        count,
        (raw, i, j) => {
          if (!this.engine) return raw;
          const a = cell(positions[i]);
          const b = cell(positions[j]);
          return this.engine.shiftFormula(raw, b.p - a.p, b.c - a.c);
        },
      );
      tgtPos.forEach((pos, i) => {
        const { p, c } = cell(pos);
        changes.push(this.change(p, c, values[i]));
      });
    }
    this.applyChanges(changes, 'autofill');
    const all = unite(source, target);
    this.selectCell(all.start.row, all.start.col, all.end.row, all.end.col);
    this.run('afterAutofill', source, target);
  }

  render(): void {
    cancelFrame(this.frame);
    this.frame = 0;
    this.layout();
    const v = this.viewport();
    const { corner, top, left, main } = this.panes;
    const fr: Span = [0, this.frozenRows - 1];
    const fc: Span = [0, this.frozenCols - 1];
    this.renderPane(corner, fr, fc);
    this.renderPane(top, fr, [v.c0, v.c1]);
    this.renderPane(left, [v.r0, v.r1], fc);
    this.renderPane(main, [v.r0, v.r1], [v.c0, v.c1]);
    if (!this.editing) this.placeInput();
    this.syncFormulaBar();
    this.renderServerState();
  }

  destroy(): void {
    this.closeMenu?.();
    this.searchPanel?.close();
    this.bar?.el.remove();
    this.server?.pager?.el.remove();
    clearTimeout(this.announceTimer);
    this.cleanup.forEach((fn) => fn());
    this.engine?.off('valuesUpdated', this.onValuesUpdated);
    if (this.ownsEngine) this.engine?.destroy();
    this.root.remove();
  }

  // ---------- data internals ----------

  private valueAt(p: number, col: number): CellValue {
    if (this.engine) return this.engine.getCellValue({ row: p, col, sheet: this.sheet });
    return parseLiteral(this.data[p]?.[col]);
  }

  /** The engine is the source of truth for raw content: it rewrites formulas on sheet renames etc. */
  private rawAt(p: number, col: number): RawCell {
    if (this.engine) return p < this.data.length ? this.engine.getCellSerialized({ row: p, col, sheet: this.sheet }) : null;
    return this.data[p]?.[col] ?? null;
  }

  private metaAt(p: number, col: number): CellMeta {
    const column = this.columnMeta[col];
    const cell = this.opts.cells?.(p, col);
    const own = this.cellMeta.size ? this.cellMeta.get(cellKey(p, col)) : undefined;
    if (!cell && !own) return column ?? {};
    const merged = { ...column, ...cell, ...own };
    // Styles merge property by property, so a cell's bold keeps its column's color.
    if (column?.style || cell?.style || own?.style) merged.style = { ...column?.style, ...cell?.style, ...own?.style };
    return merged;
  }

  private displayText(p: number, col: number, v = this.valueAt(p, col)): string {
    return this.formatAt(p, col, v, this.metaAt(p, col)).text;
  }

  private formatAt(p: number, col: number, v: CellValue, meta: CellMeta): ReturnType<typeof formatCell> {
    const shown = formatCell(v, meta, this.opts.locale);
    if (meta.type !== 'dropdown' || v === null || !(meta.loadOptions || meta.resolveLabel)) return shown;
    const label = this.loadedLabels.get(`${col}|${v}`) ?? meta.resolveLabel?.(v, this.getSourceDataAtRow(this.mapper.toVisual(p)));
    return label === undefined ? shown : { text: label };
  }

  private passes(p: number, filters: [number, ColumnFilter][]): boolean {
    for (const [col, f] of filters) {
      const v = this.valueAt(p, col);
      if (!matchesFilter(v, this.displayText(p, col, v), f, this.opts.locale)) return false;
    }
    return true;
  }

  private change(p: number, col: number, newValue: RawCell): CellChange {
    const prop = this.binding?.fields[col];
    const columnId = this.getColumnId(col);
    const rowKey = this.server ? this.rowKeyAt(p) : undefined;
    return {
      row: this.mapper.toVisual(p), physicalRow: p, col,
      ...(prop ? { prop } : {}), ...(columnId !== undefined ? { columnId } : {}), ...(rowKey !== undefined ? { rowKey } : {}),
      oldValue: this.rawAt(p, col), newValue,
    };
  }

  private isReadOnly(p: number, col: number): boolean {
    return !!this.opts.readOnly || !!this.metaAt(p, col).readOnly;
  }

  private applyChanges(changes: CellChange[], source: ChangeSource, record = true): void {
    if (this.server) changes = changes.filter((c) => c.physicalRow < this.data.length);
    const ui = source !== 'api' && source !== 'undo' && source !== 'redo';
    if (ui) changes = changes.filter((c) => !this.isReadOnly(c.physicalRow, c.col));
    if (!changes.length) return;
    if (this.run('beforeChange', changes, source) === false) return;
    if (ui) {
      changes = changes.filter((c) => {
        const meta = this.metaAt(c.physicalRow, c.col);
        if (meta.allowInvalid !== false || isFormula(c.newValue)) return true;
        return !validate(parseLiteral(c.newValue), c.newValue, meta, c.physicalRow, c.col);
      });
      if (!changes.length) return;
    }
    const maxRow = maxOf(changes, (c) => c.physicalRow);
    const maxCol = maxOf(changes, (c) => c.col);
    this.ensureSize(maxRow + 1, maxCol + 1);
    for (const ch of changes) {
      this.data[ch.physicalRow][ch.col] = ch.newValue ?? null;
      // Formula results reach the object through onValuesUpdated once they are computed.
      if (!(this.computedBinding() && isFormula(ch.newValue))) this.binding?.write(ch.physicalRow, ch.col, ch.newValue ?? null);
    }
    this.engine?.batch(() => {
      for (const ch of changes) this.engine!.setCellContents({ row: ch.physicalRow, col: ch.col, sheet: this.sheet }, ch.newValue ?? null);
    });
    for (const ch of changes) this.revalidate(ch.physicalRow, ch.col);
    if (record) {
      this.undoStack.push({ kind: 'cells', changes });
      this.redoStack = [];
    }
    this.render();
    this.run('afterChange', changes, source);
  }

  private clearRange(range: CellRange, source: ChangeSource): void {
    const changes: CellChange[] = [];
    for (let r = range.start.row; r <= range.end.row; r++) {
      const p = this.mapper.toPhysical(r);
      for (let c = range.start.col; c <= range.end.col; c++) {
        if (!isEmpty(this.rawAt(p, c))) changes.push(this.change(p, c, null));
      }
    }
    this.applyChanges(changes, source);
  }

  private replay(from: UndoEntry[], to: UndoEntry[], source: 'undo' | 'redo'): void {
    const entry = from.pop();
    if (!entry) return;
    this.replayEntry(entry, source);
    to.push(entry);
  }

  private replayEntry(entry: UndoEntry, source: 'undo' | 'redo'): void {
    if (entry.kind === 'group') {
      (source === 'undo' ? [...entry.entries].reverse() : entry.entries).forEach((e) => this.replayEntry(e, source));
    } else if (entry.kind === 'meta') {
      this.applyMeta(entry.changes, source === 'undo' ? 'before' : 'after');
      this.render();
    } else if (entry.kind === 'cells') {
      const changes = entry.changes.map((c) =>
        source === 'undo' ? { ...c, oldValue: c.newValue, newValue: c.oldValue } : { ...c },
      );
      this.applyChanges(changes, source, false);
    } else {
      const current = this.snapshot();
      this.bindingPaused = true;
      if (source === 'undo') [...entry.ops].reverse().forEach((op) => this.undoEngineOp(op));
      else entry.ops.forEach((op) => this.applyEngineOp(op));
      this.bindingPaused = false;
      this.restore(entry.state);
      this.syncBoundObjects();
      entry.state = current;
      this.layoutChanged();
    }
  }

  private applyMeta(changes: MetaChange[], side: 'before' | 'after'): void {
    for (const ch of changes) {
      const m = ch[side];
      if (m) this.cellMeta.set(ch.key, m);
      else this.cellMeta.delete(ch.key);
    }
  }

  private applyEngineOp(op: EngineOp): void {
    const e = this.engine;
    if (!e) return;
    if (op.target !== undefined) {
      e.moveColumns(op.index, op.count, op.target, this.sheet);
    } else if (op.remove) {
      op.record = e.captureRemoval(op.axis, op.index, op.count, this.sheet);
      if (op.axis === 'row') e.removeRows(op.index, op.count, this.sheet);
      else e.removeColumns(op.index, op.count, this.sheet);
    } else if (op.axis === 'row') {
      e.addRows(op.index, op.count, this.sheet);
    } else {
      e.addColumns(op.index, op.count, this.sheet);
    }
  }

  private undoEngineOp(op: EngineOp): void {
    const e = this.engine;
    if (!e) return;
    if (op.target !== undefined) {
      const inv = e.inverseMove(op.index, op.count, op.target);
      e.moveColumns(inv.start, inv.count, inv.target, this.sheet);
    } else if (op.remove) e.restoreRemoval(op.record!);
    else if (op.axis === 'row') e.removeRows(op.index, op.count, this.sheet);
    else e.removeColumns(op.index, op.count, this.sheet);
  }

  private snapshot(): Snapshot {
    return {
      data: this.data.map((r) => [...r]),
      binding: this.binding?.snapshot(),
      colSizes: Array.from({ length: this.cols.count }, (_, i) => this.cols.size(i)),
      rows: this.mapper.snapshot(),
      merges: this.getMergedCells(),
      columns: [...this.columnMeta],
      labels: this.labels && [...this.labels],
      filters: [...this.filters].map(([c, f]) => [c, { ...f }]),
      sort: this.getSortKeys(),
      cellMeta: [...this.cellMeta],
      rowHeights: [...this.rowHeights],
      hidden: [...this.hiddenCols],
    };
  }

  private restore(s: Snapshot): void {
    this.data = s.data.map((r) => [...r]);
    if (s.binding) this.binding?.restore(s.binding);
    this.mapper.restore(s.rows);
    this.syncRows();
    this.cols = new Axis(s.colSizes.length, this.cols.defaultSize, s.colSizes);
    this.merges.set(s.merges);
    this.columnMeta = [...s.columns];
    this.labels = s.labels && [...s.labels];
    this.filters = new Map(s.filters);
    this.sortKeys = s.sort.map((k) => ({ ...k }));
    this.cellMeta = new Map(s.cellMeta);
    this.rowHeights = new Map(s.rowHeights);
    this.hiddenCols = new Map(s.hidden);
    this.syncRows();
    this.frozenCols = Math.min(this.frozenCols, this.countCols());
    this.validateAll();
    this.clampSelection();
    this.render();
  }

  private alterRows(at: number, amount: number, remove: boolean, ops: EngineOp[]): void {
    if (remove) {
      // Visual rows may be scattered physically (sorting); remove from the bottom up.
      const physical = Array.from({ length: amount }, (_, i) => this.mapper.toPhysical(at + i)).sort((a, b) => b - a);
      for (const p of physical) {
        this.data.splice(p, 1);
        this.binding?.removeRows(p, 1);
        this.mapper.remove(p, 1);
        this.shiftRowState(p, -1);
        this.applyEngineOp(pushed(ops, { axis: 'row', index: p, count: 1, remove: true }));
      }
      this.merges.shift('row', at, -amount);
    } else {
      const p = at < this.countRows() ? this.mapper.toPhysical(at) : this.data.length;
      this.data.splice(p, 0, ...Array.from({ length: amount }, () => Array<RawCell>(this.countCols()).fill(null)));
      this.binding?.insertRows(p, amount);
      this.mapper.insert(p, amount, at);
      this.shiftRowState(p, amount);
      this.applyEngineOp(pushed(ops, { axis: 'row', index: p, count: amount, remove: false }));
      this.merges.shift('row', at, amount);
    }
    this.syncRows();
  }

  /** Re-keys per-row state (cell meta, row heights) after physical rows were inserted (n > 0) or removed (n < 0). */
  private shiftRowState(at: number, n: number): void {
    this.cellMeta = shiftKeys(this.cellMeta, (k) => {
      const row = moveIndex(Math.floor(k / 16384), at, n);
      return row < 0 ? -1 : row * 16384 + (k % 16384);
    });
    this.rowHeights = shiftKeys(this.rowHeights, (row) => moveIndex(row, at, n));
  }

  private alterCols(at: number, amount: number, remove: boolean, ops: EngineOp[]): void {
    for (const r of this.data) {
      if (remove) r.splice(at, amount);
      else r.splice(at, 0, ...Array<RawCell>(amount).fill(null));
    }
    if (remove) this.binding?.removeCols(at, amount);
    else this.binding?.insertCols(at, amount);
    if (remove) {
      this.cols.remove(at, amount);
      this.applyEngineOp(pushed(ops, { axis: 'col', index: at, count: amount, remove: true }));
      this.columnMeta.splice(at, amount);
      this.labels?.splice(at, amount);
    } else {
      this.cols.insert(at, amount);
      this.applyEngineOp(pushed(ops, { axis: 'col', index: at, count: amount, remove: false }));
      if (at < this.columnMeta.length) this.columnMeta.splice(at, 0, ...Array<undefined>(amount));
      this.labels?.splice(at, 0, ...Array<string>(amount).fill(''));
    }
    const moveCol = (c: number) =>
      remove ? (c >= at + amount ? c - amount : c >= at ? -1 : c) : c >= at ? c + amount : c;
    this.filters = new Map(
      [...this.filters].map(([c, f]) => [moveCol(c), f] as [number, ColumnFilter]).filter(([c]) => c >= 0),
    );
    this.sortKeys = this.sortKeys.map((k) => ({ ...k, col: moveCol(k.col) })).filter((k) => k.col >= 0);
    this.merges.shift('col', at, remove ? -amount : amount);
    this.frozenCols = Math.min(this.frozenCols, this.countCols());
    const n = remove ? -amount : amount;
    this.cellMeta = shiftKeys(this.cellMeta, (k) => {
      const col = moveIndex(k % 16384, at, n);
      return col < 0 ? -1 : k - (k % 16384) + col;
    });
    this.hiddenCols = shiftKeys(this.hiddenCols, (c) => moveIndex(c, at, n));
  }

  private ensureSize(rows: number, cols: number): void {
    if (this.server) rows = Math.min(rows, this.data.length);
    if (cols > this.countCols()) {
      for (const r of this.data) while (r.length < cols) r.push(null);
      this.cols.resize(cols);
    }
    if (rows > this.data.length) {
      const add = rows - this.data.length;
      for (let i = 0; i < add; i++) this.data.push(Array<RawCell>(this.countCols()).fill(null));
      this.binding?.ensureRows(this.data.length);
      this.mapper.insert(this.data.length - add, add);
      this.syncRows();
    }
  }

  private ensureVisualRows(count: number): void {
    if (count > this.countRows()) this.ensureSize(this.data.length + count - this.countRows(), this.countCols());
  }

  /** Object data is converted to rows once; edits are written back through the binding. */
  private bind(data: RawCell[][] | DataRow[]): RawCell[][] {
    if (!isObjectData(data)) {
      this.binding = undefined;
      return data as RawCell[][];
    }
    this.binding = ObjectBinding.create(data, this.columnMeta.map((m) => m?.data), this.opts.dataSchema);
    return this.binding.toRows();
  }

  private normalize(data: RawCell[][]): RawCell[][] {
    const empty = data.length === 0 && !this.opts.dataMode;
    const rows = Math.max(data.length, this.opts.minRows ?? (empty ? 50 : 0));
    const cols = Math.max(maxOf(data, (r) => r.length), this.opts.minCols ?? (empty ? 26 : 0), this.columnMeta.length, 1);
    return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => data[r]?.[c] ?? null));
  }

  /** Row sizes follow the visual order; rebuilt only once custom heights exist. */
  private syncRows(): void {
    const count = this.mapper.count;
    if (!this.rowsCustomized) {
      this.rows.resize(count);
      return;
    }
    const def = this.rows.defaultSize;
    const sizes = Array.from({ length: count }, (_, v) => this.rowHeights.get(this.mapper.toPhysical(v)) ?? def);
    this.rows = new Axis(count, def, sizes);
    this.rowsCustomized = this.rowHeights.size > 0;
  }

  private afterRowMapping(): void {
    this.syncRows();
    this.clampSelection();
    this.render();
  }

  private revalidate(p: number, col: number): void {
    const meta = this.metaAt(p, col);
    const key = cellKey(p, col);
    const before = this.invalid.get(key);
    const error = hasValidation(meta) ? validate(this.valueAt(p, col), this.rawAt(p, col), meta, p, col) : undefined;
    if (error) this.invalid.set(key, error);
    else this.invalid.delete(key);
    if (error !== before) this.run('afterValidate', this.mapper.toVisual(p), col, error);
  }

  private validateAll(): void {
    this.invalid.clear();
    const cols = Array.from({ length: this.countCols() }, (_, c) => c);
    const checked = this.opts.cells ? cols : cols.filter((c) => this.columnMeta[c] && hasValidation(this.columnMeta[c]!));
    for (let p = 0; p < this.data.length; p++) for (const c of checked) this.revalidate(p, c);
    for (const key of this.cellMeta.keys()) this.revalidate(Math.floor(key / 16384), key % 16384);
  }

  private onValuesUpdated = (changes: ChangedCell[]): void => {
    for (const { address } of changes) {
      if ((address.sheet ?? 0) !== this.sheet || address.row >= this.data.length) continue;
      if (hasValidation(this.metaAt(address.row, address.col))) this.revalidate(address.row, address.col);
      if (!this.bindingPaused) this.writeComputed(address.row, address.col, true);
    }
    this.scheduleRender();
  };

  private computedBinding(): boolean {
    return !!this.binding && !!this.engine && this.opts.bindFormulas !== 'text';
  }

  /** The cell as a bound property sees it: formulas and spilled cells give their computed value. */
  private boundValueAt(p: number, col: number): RawCell {
    const raw = this.rawAt(p, col);
    if (!this.computedBinding() || !(raw === null || isFormula(raw))) return raw;
    const v = this.valueAt(p, col);
    return v instanceof CellError ? null : v;
  }

  /** Copies a computed result to the bound object. `cleared` also writes empties (a spill that retreated). */
  private writeComputed(p: number, col: number, cleared: boolean): void {
    if (!this.computedBinding()) return;
    const value = this.boundValueAt(p, col);
    if (isFormula(this.rawAt(p, col)) || value !== null || (cleared && this.rawAt(p, col) === null)) {
      this.binding!.write(p, col, value);
    }
  }

  /** After a load or undo, when many cells changed at once. */
  private syncBoundObjects(): void {
    if (!this.computedBinding()) return;
    for (let p = 0; p < this.data.length; p++) {
      for (let c = 0; c < this.data[p].length; c++) this.writeComputed(p, c, false);
    }
  }

  private run<K extends HookName>(name: K, ...args: Parameters<HookMap[K]>): boolean {
    let ok = true;
    for (const fn of this.hooks.get(name) ?? []) {
      if ((fn as (...a: unknown[]) => unknown)(...args) === false) ok = false;
    }
    return ok;
  }

  private mergesActive(): boolean {
    return this.merges.list.length > 0 && this.mapper.isIdentity;
  }

  private mergeAt(row: number, col: number): MergeArea | undefined {
    return this.mergesActive() ? this.merges.get(row, col) : undefined;
  }

  private mergeAllowed(m: MergeArea): boolean {
    const crosses = (start: number, span: number, edge: number) => edge > 0 && start < edge && start + span > edge;
    return (
      this.mapper.isIdentity &&
      m.row >= 0 && m.col >= 0 &&
      m.row + m.rowspan <= this.data.length && m.col + m.colspan <= this.countCols() &&
      !crosses(m.row, m.rowspan, this.frozenRows) && !crosses(m.col, m.colspan, this.frozenCols)
    );
  }

  // ---------- DOM ----------

  private el(cls: string, parent: HTMLElement, tag = 'div'): HTMLDivElement {
    const e = this.root.ownerDocument.createElement(tag) as HTMLDivElement;
    e.className = cls;
    parent.appendChild(e);
    return e;
  }

  private makePane(cls: string, parent: HTMLElement, frozenRows: boolean, frozenCols: boolean): Pane {
    const el = this.el(`ct-pane ${cls}`, parent);
    return {
      el, frozenRows, frozenCols,
      cells: new Map(), pool: [], colHeads: [], rowHeads: [],
      rangeBox: this.el('ct-range', el),
      fillBox: this.el('ct-fill-area', el),
      activeBox: this.el('ct-active', el),
      handle: this.el('ct-fill', el),
    };
  }

  private buildDom(): void {
    this.canvas = this.el('ct-canvas', this.root);
    this.topBand = this.el('ct-band ct-band-top', this.canvas);
    this.bodyBand = this.el('ct-band ct-band-body', this.canvas);
    this.panes = {
      corner: this.makePane('ct-pane-corner', this.topBand, true, true),
      top: this.makePane('ct-pane-top', this.topBand, true, false),
      left: this.makePane('ct-pane-left', this.bodyBand, false, true),
      main: this.makePane('ct-pane-main', this.bodyBand, false, false),
    };
    this.cornerHead = this.el('ct-header ct-cornerhead', this.panes.corner.el);
    // Focus stays on the hidden textarea, so the active cell is announced through a live region.
    this.announcer = this.el('ct-sr', this.root);
    this.announcer.setAttribute('aria-live', 'polite');
    this.announcer.setAttribute('aria-atomic', 'true');
    this.input = this.root.ownerDocument.createElement('textarea');
    this.input.className = 'ct-editor ct-idle';
    this.input.setAttribute('aria-label', 'Cell editor');
    this.input.spellcheck = false;
    this.input.addEventListener('keydown', this.onEditorKey);
    this.input.addEventListener('input', this.onInput);
    this.input.addEventListener('compositionstart', () => this.openEditor(''));
    this.input.addEventListener('blur', (e) => {
      if (this.customEditor) return;
      if (!this.bar || e.relatedTarget !== this.bar.input) this.closeEditor(true);
    });
    this.panes.main.el.appendChild(this.input);
  }

  /** Column header elements are built once per pane; rebuild them when their buttons change. */
  private resetHeaders(): void {
    for (const p of Object.values(this.panes)) {
      p.colHeads.forEach((h) => h.remove());
      p.colHeads = [];
    }
  }

  private frozenSize() {
    return { fw: this.cols.offset(this.frozenCols), fh: this.rows.offset(this.frozenRows) };
  }

  private layout(): void {
    const w = this.cols.total;
    const h = this.rows.total;
    const { fw, fh } = this.frozenSize();
    const size = (e: HTMLElement, width: number, height: number) => {
      e.style.width = `${Math.max(0, width)}px`;
      e.style.height = `${Math.max(0, height)}px`;
    };
    size(this.canvas, this.rowHeaderW + w, this.headerH + h);
    size(this.topBand, this.rowHeaderW + w, this.headerH + fh);
    this.topBand.style.display = this.headerH + fh > 0 ? '' : 'none';
    size(this.bodyBand, this.rowHeaderW + w, h - fh);
    size(this.panes.corner.el, this.rowHeaderW + fw, this.headerH + fh);
    size(this.panes.top.el, w - fw, this.headerH + fh);
    size(this.panes.left.el, this.rowHeaderW + fw, h - fh);
    size(this.panes.main.el, w - fw, h - fh);
    this.panes.corner.el.classList.toggle('ct-edge-r', fw > 0);
    this.panes.left.el.classList.toggle('ct-edge-r', fw > 0);
    this.panes.corner.el.classList.toggle('ct-edge-b', fh > 0);
    this.panes.top.el.classList.toggle('ct-edge-b', fh > 0);
    this.root.setAttribute('aria-rowcount', String(this.countRows() + (this.headerH ? 1 : 0)));
    this.root.setAttribute('aria-colcount', String(this.countCols() + (this.rowHeaderW ? 1 : 0)));
    setBox(this.cornerHead, 0, 0, this.rowHeaderW, this.headerH);
    this.cornerHead.style.display = this.rowHeaderW && this.headerH ? '' : 'none';
  }

  private cellX(p: Pane, c: number): number {
    return (p.frozenCols ? this.rowHeaderW : 0) + this.cols.offset(c) - (p.frozenCols ? 0 : this.cols.offset(this.frozenCols));
  }

  private cellY(p: Pane, r: number): number {
    return (p.frozenRows ? this.headerH : 0) + this.rows.offset(r) - (p.frozenRows ? 0 : this.rows.offset(this.frozenRows));
  }

  /** Visible scrolling window including overscan. */
  private viewport() {
    const { fw, fh } = this.frozenSize();
    const top = this.root.scrollTop + fh;
    const left = this.root.scrollLeft + fw;
    // jsdom and hidden containers report 0; fall back to a reasonable window.
    const height = (this.root.clientHeight || 600) - this.headerH - fh;
    const width = (this.root.clientWidth || 1000) - this.rowHeaderW - fw;
    return {
      r0: Math.max(this.frozenRows, this.rows.indexAt(top) - OVERSCAN),
      r1: Math.min(this.countRows() - 1, this.rows.indexAt(top + height) + OVERSCAN),
      c0: Math.max(this.frozenCols, this.cols.indexAt(left) - OVERSCAN),
      c1: Math.min(this.countCols() - 1, this.cols.indexAt(left + width) + OVERSCAN),
    };
  }

  private paneOf(row: number, col: number): Pane {
    const fr = row < this.frozenRows;
    const fc = col < this.frozenCols;
    return fr ? (fc ? this.panes.corner : this.panes.top) : fc ? this.panes.left : this.panes.main;
  }

  private renderPane(p: Pane, [r0, r1]: Span, [c0, c1]: Span): void {
    const want: [number, number, MergeArea | undefined][] = [];
    if (r1 >= r0 && c1 >= c0) {
      const outside = new Set<MergeArea>();
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (this.hiddenCols.size && this.hiddenCols.has(c)) continue;
          const m = this.mergeAt(r, c);
          if (m && (m.row !== r || m.col !== c)) {
            // Covered cell; the merge's top-left may lie outside the window and still must be drawn.
            if (m.row < r0 || m.col < c0) outside.add(m);
            continue;
          }
          want.push([r, c, m]);
        }
      }
      for (const m of outside) want.push([m.row, m.col, m]);
    }
    const keys = new Set(want.map(([r, c]) => cellKey(r, c)));
    for (const [key, el] of p.cells) if (!keys.has(key)) p.pool.push(el);
    const next = new Map<number, HTMLDivElement>();
    for (const [r, c, m] of want) {
      const key = cellKey(r, c);
      const el = p.cells.get(key) ?? p.pool.pop() ?? this.makeCell(p);
      next.set(key, el);
      const w = m ? this.cols.offset(c + m.colspan) - this.cols.offset(c) : this.cols.size(c);
      const h = m ? this.rows.offset(r + m.rowspan) - this.rows.offset(r) : this.rows.size(r);
      this.paintCell(el, r, c);
      setBox(el, this.cellX(p, c), this.cellY(p, r), w, h);
      el.style.display = '';
    }
    for (const el of p.pool) el.style.display = 'none';
    p.cells = next;
    this.renderHeaders(p, [r0, r1], [c0, c1]);
    this.renderSelection(p);
  }

  private makeCell(p: Pane): HTMLDivElement {
    const el = this.el('ct-cell', p.el);
    el.setAttribute('role', 'gridcell');
    return el;
  }

  private paintCell(el: HTMLDivElement, r: number, c: number): void {
    const p = this.mapper.toPhysical(r);
    const meta = this.metaAt(p, c);
    const value = this.valueAt(p, c);
    const { text, kind } = this.formatAt(p, c, value, meta);
    let cls = kind ? `ct-cell ct-${kind}` : 'ct-cell';
    if (meta.type === 'dropdown') cls += ' ct-dd';
    if (meta.readOnly) cls += ' ct-readonly';
    const error = this.invalid.size ? this.invalid.get(cellKey(p, c)) : undefined;
    if (error) cls += ' ct-invalid';
    if (meta.className) cls += ` ${meta.className}`;
    if (this.searchHits.size && this.searchHits.has(cellKey(p, c))) cls += ' ct-match';
    const conditional = this.conditionalStyle(p, c, value);
    const style = conditional ? { ...meta.style, ...conditional } : meta.style;
    if (style) cls += styleClasses(style);
    if (el.className !== cls) el.className = cls;
    const fg = style?.color ?? '';
    if (el.dataset.fg !== fg) {
      el.style.color = fg;
      el.dataset.fg = fg;
    }
    const bg = style?.background ?? '';
    if (el.dataset.bg !== bg) {
      el.style.backgroundColor = bg;
      el.dataset.bg = bg;
    }
    // ARIA positions are 1-based and count the header row/column.
    const ri = String(r + (this.headerH ? 2 : 1));
    const ci = String(c + (this.rowHeaderW ? 2 : 1));
    if (el.getAttribute('aria-rowindex') !== ri) el.setAttribute('aria-rowindex', ri);
    if (el.getAttribute('aria-colindex') !== ci) el.setAttribute('aria-colindex', ci);
    if (kind === 'check') {
      if (el.dataset.check !== text) {
        el.textContent = '';
        this.el('ct-checkbox', el, 'span').textContent = text;
        el.dataset.check = text;
      }
    } else {
      if (el.dataset.check !== undefined) delete el.dataset.check;
      if (el.textContent !== text) el.textContent = text;
    }
    if (error) el.title = error;
    else if (el.title) el.title = '';
    meta.renderer?.(el, value, { row: r, col: c, meta });
  }

  private conditionalStyle(p: number, col: number, value: CellValue): CellStyle | undefined {
    const rules = this.opts.conditionalFormats;
    if (!rules?.length) return undefined;
    let out: CellStyle | undefined;
    for (const rule of rules) {
      if (!rule.entireRow && rule.columns && !rule.columns.includes(col)) continue;
      const tested = rule.entireRow ? rule.columns ?? [] : [col];
      const hit = tested.some((tc) => {
        const v = tc === col ? value : this.valueAt(p, tc);
        return typeof rule.when === 'function'
          ? rule.when(v, this.mapper.toVisual(p), tc)
          : matchesFilter(v, this.displayText(p, tc, v), { condition: rule.when }, this.opts.locale);
      });
      if (hit) out = { ...out, ...rule.style };
    }
    return out;
  }

  private renderHeaders(p: Pane, [r0, r1]: Span, [c0, c1]: Span): void {
    const range = this.getSelectedRange();
    if (p.frozenRows && this.headerH) {
      const keys = this.getSortKeys();
      let i = 0;
      for (let c = c0; c <= c1; c++) {
        if (this.hiddenCols.size && this.hiddenCols.has(c)) continue;
        const el = p.colHeads[i] ?? this.makeColHeader(p, i);
        i++;
        el.classList.toggle('ct-gap-r', this.hiddenCols.has(c + 1));
        el.classList.toggle('ct-gap-l', c > 0 && this.hiddenCols.has(c - 1));
        el.setAttribute('aria-colindex', String(c + (this.rowHeaderW ? 2 : 1)));
        el.dataset.col = String(c);
        const label = this.labels?.[c] || this.columnMeta[c]?.title || this.binding?.fields[c] || columnLabel(c);
        const labelEl = el.children[0] as HTMLElement;
        if (labelEl.textContent !== label) labelEl.textContent = label;
        const key = keys.findIndex((k) => k.col === c);
        // The number shows the priority once several columns sort together.
        const sort = key < 0 ? '' : `${keys[key].order === 'asc' ? '▲' : '▼'}${keys.length > 1 ? key + 1 : ''}`;
        const sortEl = el.children[1] as HTMLElement;
        if (sortEl.textContent !== sort) sortEl.textContent = sort;
        el.classList.toggle('ct-hl', !!range && c >= range.start.col && c <= range.end.col);
        const id = this.getColumnId(c);
        el.classList.toggle('ct-filtered', this.server ? id !== undefined && id in this.server.query.filters : this.filters.has(c));
        if (this.server) {
          const meta = this.columnMeta[c];
          (el.querySelector('.ct-menu-btn') as HTMLElement).hidden = !(id !== undefined && (meta?.sortable || meta?.serverFilter));
        }
        setBox(el, this.cellX(p, c), 0, this.cols.size(c), this.headerH);
        el.style.display = '';
      }
      for (; i < p.colHeads.length; i++) p.colHeads[i].style.display = 'none';
    }
    if (p.frozenCols && this.rowHeaderW) {
      let i = 0;
      for (let r = r0; r <= r1; r++, i++) {
        const el = p.rowHeads[i] ?? this.makeRowHeader(p, i);
        el.dataset.row = String(r);
        const label = String(this.mapper.toPhysical(r) + 1);
        const labelEl = el.children[0] as HTMLElement;
        if (labelEl.textContent !== label) labelEl.textContent = label;
        el.setAttribute('aria-rowindex', String(r + (this.headerH ? 2 : 1)));
        el.classList.toggle('ct-hl', !!range && r >= range.start.row && r <= range.end.row);
        setBox(el, 0, this.cellY(p, r), this.rowHeaderW, this.rows.size(r));
        el.style.display = '';
      }
      for (; i < p.rowHeads.length; i++) p.rowHeads[i].style.display = 'none';
    }
  }

  private makeRowHeader(p: Pane, i: number): HTMLDivElement {
    const el = this.el('ct-header ct-rowhead', p.el);
    el.setAttribute('role', 'rowheader');
    this.el('ct-label', el, 'span');
    this.el('ct-rresize', el);
    p.rowHeads[i] = el;
    return el;
  }

  private makeColHeader(p: Pane, i: number): HTMLDivElement {
    const el = this.el('ct-header ct-colhead', p.el);
    el.setAttribute('role', 'columnheader');
    this.el('ct-label', el, 'span');
    this.el('ct-sort', el, 'span');
    if (this.opts.columnSorting || this.opts.filters || this.opts.dataMode === 'server') {
      const b = this.el('ct-menu-btn', el, 'button') as unknown as HTMLButtonElement;
      b.type = 'button';
      b.tabIndex = -1;
      b.textContent = '▾';
      b.setAttribute('aria-label', this.messages.columnMenu);
    }
    this.el('ct-resize', el);
    p.colHeads[i] = el;
    return el;
  }

  /** Pixel box of the part of `r` that lies in pane `p`, or null. */
  private boxFor(p: Pane, r: CellRange): [number, number, number, number] | null {
    const top = Math.max(r.start.row, p.frozenRows ? 0 : this.frozenRows);
    const bottom = Math.min(r.end.row, p.frozenRows ? this.frozenRows - 1 : this.countRows() - 1);
    const left = Math.max(r.start.col, p.frozenCols ? 0 : this.frozenCols);
    const right = Math.min(r.end.col, p.frozenCols ? this.frozenCols - 1 : this.countCols() - 1);
    if (top > bottom || left > right) return null;
    const x = this.cellX(p, left);
    const y = this.cellY(p, top);
    return [x - 1, y - 1, this.cellX(p, right + 1) - x + 1, this.cellY(p, bottom + 1) - y + 1];
  }

  private renderSelection(p: Pane): void {
    const range = this.getSelectedRange();
    const hide = (...els: HTMLElement[]) => els.forEach((e) => (e.style.display = 'none'));
    if (!range || !this.anchor) {
      hide(p.rangeBox, p.activeBox, p.handle, p.fillBox);
      return;
    }
    const show = (el: HTMLElement, box: [number, number, number, number] | null) => {
      if (!box) return hide(el);
      setBox(el, ...box);
      el.style.display = '';
    };
    const m = this.mergeAt(this.anchor.row, this.anchor.col);
    const active: CellRange = m
      ? { start: { row: m.row, col: m.col }, end: { row: m.row + m.rowspan - 1, col: m.col + m.colspan - 1 } }
      : { start: this.anchor, end: this.anchor };
    const multi = range.start.row !== active.start.row || range.start.col !== active.start.col ||
      range.end.row !== active.end.row || range.end.col !== active.end.col;
    show(p.rangeBox, multi ? this.boxFor(p, range) : null);
    show(p.activeBox, this.boxFor(p, active));
    show(p.fillBox, this.fillTarget ? this.boxFor(p, unite(range, this.fillTarget.range)) : null);
    const canFill = this.opts.fillHandle !== false && !this.opts.readOnly && !this.editing;
    if (canFill && this.paneOf(range.end.row, range.end.col) === p) {
      setBox(p.handle, this.cellX(p, range.end.col + 1) - 4, this.cellY(p, range.end.row + 1) - 4, 7, 7);
      p.handle.style.display = '';
    } else {
      hide(p.handle);
    }
  }

  private scheduleRender(): void {
    if (this.frame) return;
    this.frame = requestFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private scrollIntoView({ row, col }: CellAddress): void {
    const { fw, fh } = this.frozenSize();
    const viewH = this.root.clientHeight - this.headerH;
    const viewW = this.root.clientWidth - this.rowHeaderW;
    if (viewH <= 0 || viewW <= 0) return;
    if (row >= this.frozenRows) {
      const top = this.rows.offset(row);
      const bottom = top + this.rows.size(row);
      if (top - fh < this.root.scrollTop) this.root.scrollTop = top - fh;
      else if (bottom > this.root.scrollTop + viewH) this.root.scrollTop = bottom - viewH;
    }
    if (col >= this.frozenCols) {
      const left = this.cols.offset(col);
      const right = left + this.cols.size(col);
      if (left - fw < this.root.scrollLeft) this.root.scrollLeft = left - fw;
      else if (right > this.root.scrollLeft + viewW) this.root.scrollLeft = right - viewW;
    }
  }

  private clampSelection(): void {
    if (!this.anchor || !this.selEnd) return;
    if (!this.countRows() || !this.countCols()) {
      this.anchor = this.selEnd = null;
      return;
    }
    const clamp = (a: CellAddress) => ({
      row: Math.min(a.row, this.countRows() - 1),
      col: Math.min(a.col, this.countCols() - 1),
    });
    this.anchor = clamp(this.anchor);
    this.selEnd = clamp(this.selEnd);
  }

  /** Cell under a viewport point; works across all panes and outside the grid (clamped). */
  private cellAtClient(clientX: number, clientY: number): CellAddress {
    const rect = this.root.getBoundingClientRect();
    const { fw, fh } = this.frozenSize();
    const x = clientX - rect.left - this.root.clientLeft - this.rowHeaderW;
    const y = clientY - rect.top - this.root.clientTop - this.headerH;
    const offX = x < fw ? Math.max(0, x) : x + this.root.scrollLeft;
    const offY = y < fh ? Math.max(0, y) : y + this.root.scrollTop;
    return { row: this.rows.indexAt(offY), col: this.cols.indexAt(offX) };
  }

  // ---------- editor ----------

  isEditing(): boolean {
    return this.editing;
  }

  /** Opens the cell editor. `initial` replaces the content (typing over a cell). */
  openEditor(initial?: string): void {
    if (!this.anchor || this.editing) return;
    const p = this.mapper.toPhysical(this.anchor.row);
    const meta = this.metaAt(p, this.anchor.col);
    if (this.isReadOnly(p, this.anchor.col) || meta.type === 'checkbox') {
      this.input.value = '';
      return;
    }
    if (meta.editor) return this.openCustomEditor(p, meta, initial);
    const ta = this.input;
    this.editing = true;
    this.editorEnterMode = initial !== undefined;
    ta.value = initial ?? (meta.loadOptions || meta.resolveLabel ? this.displayText(p, this.anchor.col) : editText(this.rawAt(p, this.anchor.col), meta, this.opts.locale));
    ta.classList.remove('ct-idle');
    this.placeInput();
    this.autoSizeInput();
    this.focusInput();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    if (meta.type === 'dropdown' && (meta.source || meta.loadOptions)) this.showDropdown(initial !== undefined ? ta.value : '');
    this.render();
  }

  private openCustomEditor(p: number, meta: CellMeta, initial: string | undefined): void {
    const { row, col } = this.anchor!;
    this.editing = true;
    this.input.value = '';
    const pane = this.paneOf(row, col);
    const el = this.el('ct-custom-editor', pane.el);
    setBox(el, this.cellX(pane, col) - 1, this.cellY(pane, row) - 1, this.cols.size(col) + 2, this.rows.size(row) + 2);
    el.style.width = el.style.minWidth = `${this.cols.size(col) + 2}px`;
    el.style.height = 'auto';
    el.style.minHeight = `${this.rows.size(row) + 2}px`;
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeEditor(false);
      }
    });
    const slot: NonNullable<CenituGrid['customEditor']> = { el, instance: undefined };
    this.customEditor = slot;
    slot.instance = meta.editor!({
      el, row, col, meta, initial,
      value: this.rawAt(p, col),
      rowData: this.getSourceDataAtRow(row),
      commit: (value, move) => {
        if (this.customEditor !== slot) return;
        this.finishCustomEditor();
        this.applyChanges([this.change(p, col, value)], 'edit');
        this.render();
        this.focusInput();
        if (move) this.moveActive(move[0], move[1], false);
      },
      cancel: () => {
        if (this.customEditor !== slot) return;
        this.finishCustomEditor();
        this.render();
        this.focusInput();
      },
    });
    this.render();
  }

  private finishCustomEditor(): void {
    const c = this.customEditor!;
    this.customEditor = undefined;
    this.editing = false;
    c.instance?.destroy?.();
    c.el.remove();
  }

  closeEditor(commit: boolean): void {
    if (!this.editing || !this.anchor) return;
    const p = this.mapper.toPhysical(this.anchor.row);
    const col = this.anchor.col;
    if (this.customEditor) {
      const { instance } = this.customEditor;
      const value = commit && instance?.getValue ? { v: instance.getValue() } : null;
      this.finishCustomEditor();
      if (value && value.v !== this.rawAt(p, col)) this.applyChanges([this.change(p, col, value.v)], 'edit');
      this.render();
      this.focusInput();
      return;
    }
    this.editing = false;
    const picked = this.picked;
    this.picked = undefined;
    this.hideDropdown();
    const text = this.input.value;
    this.input.value = '';
    this.input.classList.add('ct-idle');
    if (commit) {
      const meta = this.metaAt(p, col);
      // With remote choices, text alone identifies nothing: only a picked choice is a new value.
      const remote = !!meta.loadOptions && meta.strict !== false;
      if (picked || !remote) {
        const value = picked ? picked.value : convertInput(text, meta);
        if (value !== this.rawAt(p, col)) this.applyChanges([this.change(p, col, value)], 'edit');
      } else if (text === '') {
        this.applyChanges([this.change(p, col, null)], 'edit');
      }
    }
    this.render();
  }

  private focusInput(): void {
    if (this.barFocused()) return;
    if (this.root.ownerDocument.activeElement !== this.input) this.input.focus({ preventScroll: true });
  }

  private barFocused(): boolean {
    return !!this.bar && this.root.ownerDocument.activeElement === this.bar.input;
  }

  private buildFormulaBar(): void {
    const el = this.root.ownerDocument.createElement('div');
    el.className = 'ct-bar';
    const address = this.el('ct-bar-address', el);
    const input = this.root.ownerDocument.createElement('textarea');
    input.className = 'ct-bar-input';
    input.rows = 1;
    input.spellcheck = false;
    input.setAttribute('aria-label', this.messages.formulaBar);
    el.appendChild(input);
    this.root.before(el);
    this.bar = { el, address, input };

    const grow = () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(120, input.scrollHeight)}px`;
    };
    input.addEventListener('focus', grow);
    input.addEventListener('input', () => {
      if (!this.editing) this.openEditor(input.value);
      if (!this.editing) return;
      this.input.value = input.value;
      this.onInput();
      grow();
    });
    input.addEventListener('blur', (e) => {
      input.style.height = '';
      if (this.editing && e.relatedTarget !== this.input) this.closeEditor(true);
    });
    input.addEventListener('keydown', (e) => this.onBarKey(e));
  }

  private onBarKey(e: KeyboardEvent): void {
    const input = this.bar!.input;
    const leave = (dr: number, dc: number, commit: boolean) => {
      e.preventDefault();
      // Focus first: leaving the bar must not commit a cancelled edit through its blur handler.
      const editing = this.editing;
      this.editing = false;
      this.input.focus({ preventScroll: true });
      this.editing = editing;
      this.closeEditor(commit);
      if (dr || dc) this.moveActive(dr, dc, false);
    };
    if (e.key === 'Escape') leave(0, 0, false);
    else if (e.key === 'Tab') leave(0, e.shiftKey ? -1 : 1, true);
    else if (e.key === 'Enter' && e.altKey) {
      e.preventDefault();
      input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end');
      input.dispatchEvent(new Event('input'));
    } else if (e.key === 'Enter') leave(e.shiftKey ? -1 : 1, 0, true);
  }

  /** Shows the active cell in the bar; while editing, the bar mirrors the editor. */
  private syncFormulaBar(): void {
    const bar = this.bar;
    if (!bar) return;
    const a = this.anchor;
    if (!a) {
      bar.address.textContent = '';
      bar.input.value = '';
      bar.input.disabled = true;
      return;
    }
    const p = this.mapper.toPhysical(a.row);
    const label = toA1({ row: p, col: a.col });
    if (bar.address.textContent !== label) bar.address.textContent = label;
    bar.input.disabled = false;
    bar.input.readOnly = this.isReadOnly(p, a.col) || this.metaAt(p, a.col).type === 'checkbox';
    if (this.barFocused() && this.editing) return;
    const text = this.editing ? this.input.value : editText(this.rawAt(p, a.col), this.metaAt(p, a.col), this.opts.locale);
    if (bar.input.value !== text) bar.input.value = text;
  }


  /** Keeps the textarea over the active cell (in its pane), so IME windows appear in the right place. */
  private placeInput(): void {
    if (!this.anchor) return;
    const { row, col } = this.anchor;
    const pane = this.paneOf(row, col);
    if (this.input.parentElement !== pane.el) {
      const focused = this.root.ownerDocument.activeElement === this.input;
      pane.el.appendChild(this.input);
      if (focused) this.input.focus({ preventScroll: true });
    }
    const m = this.mergeAt(row, col);
    const w = m ? this.cols.offset(col + m.colspan) - this.cols.offset(col) : this.cols.size(col);
    const h = m ? this.rows.offset(row + m.rowspan) - this.rows.offset(row) : this.rows.size(row);
    setBox(this.input, this.cellX(pane, col) - 1, this.cellY(pane, row) - 1, w + 2, h + 2);
    this.input.style.minWidth = this.editing ? `${w + 2}px` : '';
  }

  private autoSizeInput(): void {
    if (!this.editing || !this.anchor) return;
    const ta = this.input;
    const min = this.cols.size(this.anchor.col) + 2;
    ta.style.width = '0';
    ta.style.width = `${Math.max(min, ta.scrollWidth + 4)}px`;
  }

  /** Text typed while idle (keyboard, IME, dictation) starts editing with that text. */
  private onInput = (): void => {
    if (!this.editing) {
      this.openEditor(this.input.value);
      return;
    }
    this.autoSizeInput();
    this.picked = undefined;
    if (this.dropdown) this.filterDropdown(this.input.value);
    if (this.bar && !this.barFocused()) this.bar.input.value = this.input.value;
  };

  private showDropdown(query: string): void {
    this.hideDropdown();
    const el = this.el('ct-dd-list', this.input.parentElement as HTMLElement);
    el.setAttribute('role', 'listbox');
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (!item || !this.dropdown) return;
      this.pick(this.dropdown.items[Number(item.dataset.i)]);
      this.commitAndMove(1, 0);
    });
    this.dropdown = { el, items: [], active: -1 };
    el.style.left = this.input.style.left;
    el.style.top = `${parseFloat(this.input.style.top) + parseFloat(this.input.style.height)}px`;
    el.style.minWidth = this.input.style.width;
    this.filterDropdown(query);
  }

  private pick(option: DropdownOption): void {
    const value = optionValue(option);
    this.picked = { value };
    this.input.value = optionLabel(option);
    if (this.anchor) this.loadedLabels.set(`${this.anchor.col}|${value}`, optionLabel(option));
  }

  private filterDropdown(query: string): void {
    const d = this.dropdown;
    if (!d || !this.anchor) return;
    const meta = this.metaAt(this.mapper.toPhysical(this.anchor.row), this.anchor.col);
    if (meta.loadOptions) return this.requestOptions(meta, query);
    const locale = this.opts.locale;
    const q = query.toLocaleLowerCase(locale);
    this.showOptions((meta.source ?? []).filter((s) => optionLabel(s).toLocaleLowerCase(locale).includes(q)), !!q);
  }

  /** Waits for a typing pause; a newer query aborts the older request, so late answers cannot win. */
  private requestOptions(meta: CellMeta, query: string): void {
    const d = this.dropdown!;
    clearTimeout(d.timer);
    d.request?.abort();
    d.items = [];
    d.active = -1;
    d.el.textContent = '';
    this.el('ct-dd-status', d.el).textContent = this.messages.loading;
    const request = new AbortController();
    d.request = request;
    d.timer = setTimeout(() => {
      meta.loadOptions!(query, request.signal).then(
        (options) => {
          if (!request.signal.aborted && this.dropdown === d) this.showOptions(options, !!query);
        },
        () => {
          if (!request.signal.aborted && this.dropdown === d) {
            d.el.textContent = '';
            this.el('ct-dd-status', d.el).textContent = this.messages.loadError;
          }
        },
      );
    }, OPTIONS_DELAY) as unknown as number;
  }

  private showOptions(items: DropdownOption[], preselect: boolean): void {
    const d = this.dropdown!;
    d.items = items;
    d.active = preselect && items.length ? 0 : -1;
    d.el.textContent = '';
    items.forEach((s, i) => {
      const item = this.el('ct-dd-item', d.el);
      item.dataset.i = String(i);
      item.setAttribute('role', 'option');
      item.textContent = optionLabel(s);
    });
    if (!items.length) this.el('ct-dd-status', d.el).textContent = this.messages.noOptions;
    this.highlightDropdown();
  }

  private highlightDropdown(): void {
    const d = this.dropdown;
    if (!d) return;
    [...d.el.children].forEach((c, i) => c.classList.toggle('ct-on', i === d.active));
    (d.el.children[d.active] as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' });
  }

  private hideDropdown(): void {
    clearTimeout(this.dropdown?.timer);
    this.dropdown?.request?.abort();
    this.dropdown?.el.remove();
    this.dropdown = undefined;
  }

  private commitAndMove(dr: number, dc: number): void {
    this.closeEditor(true);
    this.moveActive(dr, dc, false);
  }

  private onEditorKey = (e: KeyboardEvent): void => {
    if (!this.editing) return;
    e.stopPropagation();
    const d = this.dropdown;
    const moveAfter = (dr: number, dc: number) => {
      e.preventDefault();
      this.commitAndMove(dr, dc);
    };
    if (d && d.items.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      d.active = Math.max(0, Math.min(d.items.length - 1, d.active + (e.key === 'ArrowDown' ? 1 : -1)));
      this.highlightDropdown();
      return;
    }
    switch (e.key) {
      case 'Enter':
        if (e.altKey) {
          e.preventDefault();
          this.input.setRangeText('\n', this.input.selectionStart, this.input.selectionEnd, 'end');
          return;
        }
        if (d && d.active >= 0) this.pick(d.items[d.active]);
        return moveAfter(e.shiftKey ? -1 : 1, 0);
      case 'Tab':
        return moveAfter(0, e.shiftKey ? -1 : 1);
      case 'Escape':
        e.preventDefault();
        this.closeEditor(false);
        return;
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        // Typing over a cell ("enter mode") lets arrows commit and move, like spreadsheets.
        if (this.editorEnterMode) {
          const [dr, dc] = ARROWS[e.key];
          return moveAfter(dr, dc);
        }
    }
  };

  // ---------- events ----------

  private listen<K extends keyof DocumentEventMap>(target: Document | HTMLElement, type: K, fn: (e: DocumentEventMap[K]) => void): void {
    target.addEventListener(type, fn as EventListener);
    this.cleanup.push(() => target.removeEventListener(type, fn as EventListener));
  }

  private bindEvents(): void {
    const doc = this.root.ownerDocument;
    this.listen(this.root, 'scroll', () => {
      if (this.dropdown) this.closeEditor(false);
      this.scheduleRender();
    });
    this.listen(this.root, 'keydown', (e) => this.onKeyDown(e));
    this.listen(this.canvas, 'mousedown', (e) => this.onMouseDown(e));
    this.listen(this.canvas, 'click', (e) => {
      const row = this.rowEventAt(e);
      if (row) this.run('afterRowClick', row);
    });
    this.listen(this.canvas, 'dblclick', (e) => this.onDoubleClick(e));
    this.listen(this.canvas, 'contextmenu', (e) => this.onContextMenu(e));
    this.listen(doc, 'mousemove', (e) => this.onDrag(e));
    this.listen(doc, 'mouseup', () => this.onMouseUp());

    const active = () => this.root.contains(doc.activeElement) && !this.editing;
    const copyLike = (cut: boolean) => (e: ClipboardEvent) => {
      if (!active()) return;
      const text = this.copy(cut);
      if (text !== undefined) {
        e.clipboardData?.setData('text/plain', text);
        if (this.clipboard?.html) e.clipboardData?.setData('text/html', this.clipboard.html);
        e.preventDefault();
      }
    };
    this.listen(doc, 'copy', copyLike(false));
    this.listen(doc, 'cut', copyLike(true));
    this.listen(doc, 'paste', (e) => {
      if (!active()) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const html = e.clipboardData?.getData('text/html');
      if (text || html) {
        e.preventDefault();
        this.paste(text, html);
      }
    });
  }

  private onMouseDown(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (this.editing && t === this.input) return;
    if (t.closest('.ct-dd-list') || t.closest('.ct-custom-editor') || e.button !== 0) return;
    e.preventDefault();
    if (this.editing) this.closeEditor(true);
    this.focusInput();

    const menuBtn = t.closest<HTMLElement>('.ct-menu-btn');
    if (menuBtn) return this.openMenu(Number(menuBtn.parentElement!.dataset.col), menuBtn);
    const resize = t.closest<HTMLElement>('.ct-resize');
    if (resize) return this.startResize(Number(resize.parentElement!.dataset.col), e.clientX);
    const rowResize = t.closest<HTMLElement>('.ct-rresize');
    if (rowResize) return this.startRowResize(Number(rowResize.parentElement!.dataset.row), e.clientY);
    if (t.closest('.ct-fill')) {
      this.dragging = 'fill';
      return;
    }
    if (t.closest('.ct-cornerhead')) return this.selectCell(0, 0, this.countRows() - 1, this.countCols() - 1);
    const colHead = t.closest<HTMLElement>('.ct-colhead');
    if (colHead) {
      const col = Number(colHead.dataset.col);
      const r = this.getSelectedRange();
      const wholeCols = !!r && r.start.row === 0 && r.end.row === this.countRows() - 1;
      if (!e.shiftKey && wholeCols && col >= r!.start.col && col <= r!.end.col && !this.opts.readOnly) {
        // Dragging a selected column header moves the columns.
        this.dragging = 'move';
        this.moveDrop = null;
        return;
      }
      this.selectCell(0, e.shiftKey && this.anchor ? this.anchor.col : col, this.countRows() - 1, col);
      this.dragging = 'cols';
      return;
    }
    const rowHead = t.closest<HTMLElement>('.ct-rowhead');
    if (rowHead) {
      const row = Number(rowHead.dataset.row);
      this.selectCell(e.shiftKey && this.anchor ? this.anchor.row : row, 0, row, this.countCols() - 1);
      this.dragging = 'rows';
      return;
    }
    const cell = this.cellAtClient(e.clientX, e.clientY);
    if (t.closest('.ct-checkbox')) {
      this.selectCell(cell.row, cell.col);
      this.toggleCheckboxes({ start: cell, end: cell });
      return;
    }
    if (e.shiftKey && this.anchor) this.selectCell(this.anchor.row, this.anchor.col, cell.row, cell.col);
    else this.selectCell(cell.row, cell.col);
    this.dragging = 'cells';
  }

  private onContextMenu(e: MouseEvent): void {
    if (!this.opts.contextMenu) return;
    e.preventDefault();
    if (this.editing) this.closeEditor(true);
    const t = e.target as HTMLElement;
    const r = this.getSelectedRange();
    const inside = (row: number, col: number) =>
      !!r && row >= r.start.row && row <= r.end.row && col >= r.start.col && col <= r.end.col;
    // Right-clicking outside the selection first selects what was clicked, like spreadsheets.
    const colHead = t.closest<HTMLElement>('.ct-colhead');
    const rowHead = t.closest<HTMLElement>('.ct-rowhead');
    if (colHead) {
      const col = Number(colHead.dataset.col);
      const whole = !!r && r.start.row === 0 && r.end.row === this.countRows() - 1;
      if (!inside(0, col) || !whole) this.selectCell(0, col, this.countRows() - 1, col);
    } else if (rowHead) {
      const row = Number(rowHead.dataset.row);
      const whole = !!r && r.start.col === 0 && r.end.col === this.countCols() - 1;
      if (!inside(row, 0) || !whole) this.selectCell(row, 0, row, this.countCols() - 1);
    } else if (!t.closest('.ct-cornerhead')) {
      const cell = this.cellAtClient(e.clientX, e.clientY);
      if (!inside(cell.row, cell.col)) this.selectCell(cell.row, cell.col);
    }
    this.focusInput();
    this.openContextMenu(e.clientX, e.clientY);
  }

  private onDoubleClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (t.closest('.ct-fill')) return this.fillToDataEnd();
    if (t.closest('.ct-header') || t.closest('.ct-checkbox') || t.closest('.ct-dd-list') || t.closest('.ct-custom-editor')) return;
    const row = this.rowEventAt(e);
    if (row && this.run('afterRowDoubleClick', row) === false) return;
    if (!this.editing) this.openEditor();
  }

  /** The row a click landed on; null for headers, checkboxes and drags that ended on another cell. */
  private rowEventAt(e: MouseEvent): RowEvent | null {
    const t = e.target as HTMLElement;
    if (!t.closest('.ct-cell') || t.closest('.ct-checkbox')) return null;
    const { row, col } = this.cellAtClient(e.clientX, e.clientY);
    if (row >= this.countRows()) return null;
    const physicalRow = this.mapper.toPhysical(row);
    const columnId = this.getColumnId(col);
    const rowKey = this.rowKeyAt(physicalRow);
    return {
      row, physicalRow, col,
      ...(columnId !== undefined ? { columnId } : {}), ...(rowKey !== undefined ? { rowKey } : {}),
      rowData: this.getSourceDataAtRow(row),
      originalEvent: e,
    };
  }

  private onDrag(e: MouseEvent): void {
    if (!this.dragging || !this.anchor) return;
    const cell = this.cellAtClient(e.clientX, e.clientY);
    if (this.dragging === 'cells') this.selectCell(this.anchor.row, this.anchor.col, cell.row, cell.col);
    else if (this.dragging === 'rows') this.selectCell(this.anchor.row, 0, cell.row, this.countCols() - 1);
    else if (this.dragging === 'cols') this.selectCell(0, this.anchor.col, this.countRows() - 1, cell.col);
    else if (this.dragging === 'move') this.updateMoveDrop(e.clientX);
    else this.updateFillTarget(cell);
  }

  private onMouseUp(): void {
    if (this.dragging === 'move') {
      const drop = this.moveDrop;
      this.moveDrop = null;
      this.dragging = null;
      this.dropLine?.remove();
      this.dropLine = undefined;
      if (drop) this.moveColumns(drop.start, drop.count, drop.target);
      return;
    }
    const target = this.fillTarget;
    this.fillTarget = null;
    if (this.dragging === 'fill' && target) this.autofill(this.getSelectedRange()!, target.range);
    else if (target) this.render();
    this.dragging = null;
  }

  private dropLine?: HTMLDivElement;

  /** Drop position is the column boundary nearest to the pointer; shown as a vertical line. */
  private updateMoveDrop(clientX: number): void {
    const r = this.getSelectedRange()!;
    const rect = this.root.getBoundingClientRect();
    const { fw } = this.frozenSize();
    const x = clientX - rect.left - this.root.clientLeft - this.rowHeaderW;
    const off = x < fw ? Math.max(0, x) : x + this.root.scrollLeft;
    const col = this.cols.indexAt(off);
    const target = off - this.cols.offset(col) > this.cols.size(col) / 2 ? col + 1 : col;
    const count = r.end.col - r.start.col + 1;
    const allowed = this.canMoveColumns(r.start.col, count, target);
    this.moveDrop = allowed ? { start: r.start.col, count, target } : null;
    if (!this.dropLine) this.dropLine = this.el('ct-drop', this.root);
    const lineX = this.rowHeaderW + this.cols.offset(target) - (target >= this.frozenCols ? this.root.scrollLeft : 0);
    this.dropLine.style.display = allowed ? '' : 'none';
    this.dropLine.style.left = `${this.root.scrollLeft + lineX - 1}px`;
    this.dropLine.style.top = `${this.root.scrollTop}px`;
    this.dropLine.style.height = `${this.root.clientHeight}px`;
  }

  private updateFillTarget(cell: CellAddress): void {
    const r = this.getSelectedRange()!;
    const down = cell.row - r.end.row;
    const up = r.start.row - cell.row;
    const right = cell.col - r.end.col;
    const left = r.start.col - cell.col;
    const best = Math.max(down, up, right, left);
    let target: { range: CellRange; direction: FillDirection } | null = null;
    if (best > 0) {
      if (best === down) target = { direction: 'down', range: { start: { row: r.end.row + 1, col: r.start.col }, end: { row: cell.row, col: r.end.col } } };
      else if (best === up) target = { direction: 'up', range: { start: { row: cell.row, col: r.start.col }, end: { row: r.start.row - 1, col: r.end.col } } };
      else if (best === right) target = { direction: 'right', range: { start: { row: r.start.row, col: r.end.col + 1 }, end: { row: r.end.row, col: cell.col } } };
      else target = { direction: 'left', range: { start: { row: r.start.row, col: cell.col }, end: { row: r.end.row, col: r.start.col - 1 } } };
    }
    this.fillTarget = target;
    this.render();
  }

  /** Double-clicking the fill handle fills down as far as the neighbouring column has data. */
  private fillToDataEnd(): void {
    const r = this.getSelectedRange();
    if (!r) return;
    const neighbour = r.start.col > 0 ? r.start.col - 1 : r.end.col + 1;
    if (neighbour >= this.countCols()) return;
    let last = r.end.row;
    while (last + 1 < this.countRows() && !isEmpty(this.getSourceDataAtCell(last + 1, neighbour))) last++;
    if (last > r.end.row) {
      this.autofill(r, { start: { row: r.end.row + 1, col: r.start.col }, end: { row: last, col: r.end.col } });
    }
  }

  private startResize(col: number, startX: number): void {
    const doc = this.root.ownerDocument;
    const startWidth = this.cols.size(col);
    const move = (e: MouseEvent) => this.setColWidth(col, startWidth + e.clientX - startX);
    const up = () => {
      doc.removeEventListener('mousemove', move);
      doc.removeEventListener('mouseup', up);
      if (this.cols.size(col) !== startWidth) this.layoutChanged();
    };
    doc.addEventListener('mousemove', move);
    doc.addEventListener('mouseup', up);
  }

  private startRowResize(row: number, startY: number): void {
    const doc = this.root.ownerDocument;
    const startHeight = this.rows.size(row);
    const move = (e: MouseEvent) => this.setRowHeight(row, startHeight + e.clientY - startY);
    const up = () => {
      doc.removeEventListener('mousemove', move);
      doc.removeEventListener('mouseup', up);
    };
    doc.addEventListener('mousemove', move);
    doc.addEventListener('mouseup', up);
  }

  private openServerMenu(col: number, anchor: HTMLElement): void {
    const field = this.getColumnId(col);
    const meta = this.columnMeta[col];
    const s = this.server!;
    if (field === undefined) return;
    const def = meta?.serverFilter;
    const key = this.getSortKeys().find((k) => k.col === col);
    const others = s.query.sort.filter((k) => k.field !== field);
    this.closeMenu = openColumnMenu({
      anchor,
      messages: this.messages,
      locale: this.opts.locale,
      theme: this.themeClass(),
      sort: key?.order ?? null,
      // Servers commonly take one sort field, so further keys are only offered through `sortBy`.
      sortedElsewhere: false,
      filter: undefined,
      values: [],
      sortable: !!meta?.sortable,
      filterable: false,
      onSort: (order) => this.setQuery({ sort: order ? [{ field, desc: order === 'desc' }] : others }, 'sort'),
      onFilter: () => undefined,
      server: def && { def, value: s.query.filters[field], onFilter: (f) => this.setServerFilter(field, f) },
      onClose: () => {
        this.closeMenu = undefined;
        this.focusInput();
      },
    });
  }

  private openMenu(col: number, anchor: HTMLElement): void {
    this.closeMenu?.();
    if (this.server) return this.openServerMenu(col, anchor);
    // Offer the values of rows that pass the other columns' filters.
    const others = [...this.filters].filter(([c]) => c !== col);
    const values = new Set<string>();
    for (let p = this.mapper.pinnedCount; p < this.data.length; p++) {
      if (this.passes(p, others)) values.add(this.displayText(p, col));
    }
    const sorted = [...values].sort((a, b) =>
      a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, this.opts.locale, { numeric: true, sensitivity: 'base' }),
    );
    this.closeMenu = openColumnMenu({
      anchor,
      messages: this.messages,
      locale: this.opts.locale,
      theme: this.themeClass(),
      sort: this.sortKeys.find((k) => k.col === col)?.order ?? null,
      sortedElsewhere: this.sortKeys.some((k) => k.col !== col),
      filter: this.filters.get(col),
      values: sorted,
      sortable: !!this.opts.columnSorting,
      filterable: !!this.opts.filters,
      onSort: (order, add) => {
        const others = this.sortKeys.filter((k) => k.col !== col);
        if (order === null && others.length) this.applySort(others);
        else if (add && order) this.applySort([...others, { col, order }]);
        else return this.sort(col, order);
        this.run('afterColumnSort', col, order);
      },
      onFilter: (f) => this.setFilter(col, f),
      onClose: () => {
        this.closeMenu = undefined;
        this.focusInput();
      },
    });
  }

  private toggleCheckboxes(range: CellRange): void {
    const changes: CellChange[] = [];
    for (let r = range.start.row; r <= range.end.row; r++) {
      const p = this.mapper.toPhysical(r);
      for (let c = range.start.col; c <= range.end.col; c++) {
        if (this.metaAt(p, c).type === 'checkbox') changes.push(this.change(p, c, this.valueAt(p, c) !== true));
      }
    }
    this.applyChanges(changes, 'edit');
  }

  private moveActive(dr: number, dc: number, extend: boolean): void {
    if (!this.anchor || !this.selEnd) return;
    const base = extend ? this.selEnd : this.anchor;
    let row = base.row;
    let col = base.col;
    const m = this.mergeAt(base.row, base.col);
    if (m && !extend) {
      // Leave a merged area from its far edge.
      if (dr > 0) row = m.row + m.rowspan - 1;
      if (dc > 0) col = m.col + m.colspan - 1;
    }
    row += dr;
    col += dc;
    const step = dc < 0 ? -1 : 1;
    while (this.hiddenCols.has(col) && col + step >= 0 && col + step < this.countCols()) col += step;
    if (this.hiddenCols.has(col)) col = base.col;
    if (extend) this.selectCell(this.anchor.row, this.anchor.col, row, col);
    else this.selectCell(row, col);
  }

  /** Ctrl+arrow: jump to the edge of the current data block, like spreadsheets. */
  private jump(dr: number, dc: number, extend: boolean): void {
    const base = extend ? this.selEnd! : this.anchor!;
    const maxR = this.countRows() - 1;
    const maxC = this.countCols() - 1;
    const filled = (r: number, c: number) => !isEmpty(this.getSourceDataAtCell(r, c));
    const inside = (r: number, c: number) => r >= 0 && c >= 0 && r <= maxR && c <= maxC;
    let r = base.row;
    let c = base.col;
    if (inside(r + dr, c + dc) && filled(r, c) && filled(r + dr, c + dc)) {
      while (inside(r + dr, c + dc) && filled(r + dr, c + dc)) (r += dr), (c += dc);
    } else {
      r += dr;
      c += dc;
      while (inside(r, c) && !filled(r, c) && inside(r + dr, c + dc)) (r += dr), (c += dc);
    }
    r = Math.max(0, Math.min(r, maxR));
    c = Math.max(0, Math.min(c, maxC));
    if (extend) this.selectCell(this.anchor!.row, this.anchor!.col, r, c);
    else this.selectCell(r, c);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.editing || !this.anchor || !this.selEnd) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    const meta = this.metaAt(this.mapper.toPhysical(this.anchor.row), this.anchor.col);

    if (key === 'ContextMenu' || (e.shiftKey && key === 'F10')) {
      if (this.opts.contextMenu) {
        e.preventDefault();
        this.openContextMenu();
      }
      return;
    }
    if (key in ARROWS) {
      e.preventDefault();
      const [dr, dc] = ARROWS[key];
      if (e.altKey && key === 'ArrowDown' && meta.type === 'dropdown') return this.openEditor();
      if (ctrl) this.jump(dr, dc, e.shiftKey);
      else this.moveActive(dr, dc, e.shiftKey);
      return;
    }
    if (ctrl) {
      const k = key.toLowerCase();
      if ((k === 'f' || k === 'h') && this.opts.search) {
        e.preventDefault();
        this.openSearch(k === 'h');
      } else if (k === 'b' || k === 'i' || k === 'u') {
        e.preventDefault();
        this.toggleCellStyle(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline');
      } else if (k === 'a') {
        e.preventDefault();
        this.selectCell(0, 0, this.countRows() - 1, this.countCols() - 1);
      } else if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if (k === 'y') {
        e.preventDefault();
        this.redo();
      } else if (k === 'd') {
        // Fill down from the first row of the selection.
        e.preventDefault();
        const r = this.getSelectedRange()!;
        if (r.end.row > r.start.row) {
          this.autofill(
            { start: r.start, end: { row: r.start.row, col: r.end.col } },
            { start: { row: r.start.row + 1, col: r.start.col }, end: r.end },
          );
        }
      } else if (key === 'Home') {
        e.preventDefault();
        this.selectCell(0, 0);
      } else if (key === 'End') {
        e.preventDefault();
        this.selectCell(this.countRows() - 1, this.countCols() - 1);
      }
      return;
    }
    switch (key) {
      case 'Tab':
        e.preventDefault();
        this.moveActive(0, e.shiftKey ? -1 : 1, false);
        return;
      case 'Enter':
      case 'F2':
        e.preventDefault();
        if (meta.type === 'checkbox') this.toggleCheckboxes(this.getSelectedRange()!);
        else this.openEditor();
        return;
      case ' ':
        if (meta.type === 'checkbox') {
          e.preventDefault();
          this.toggleCheckboxes(this.getSelectedRange()!);
        }
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        this.clearRange(this.getSelectedRange()!, 'clear');
        return;
      case 'Home':
        e.preventDefault();
        this.moveActive(0, -this.selEnd.col, e.shiftKey);
        return;
      case 'End':
        e.preventDefault();
        this.moveActive(0, this.countCols(), e.shiftKey);
        return;
      case 'PageDown':
      case 'PageUp': {
        e.preventDefault();
        const page = Math.max(1, Math.floor((this.root.clientHeight - this.headerH) / this.rows.defaultSize) - 1);
        this.moveActive(key === 'PageDown' ? page : -page, 0, e.shiftKey);
        return;
      }
    }
  }
}

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

const pushed = <T>(list: T[], item: T): T => (list.push(item), item);

/** Max without spreading (spreading 100k+ items overflows the call stack). */
function maxOf<T>(items: readonly T[], pick: (item: T) => number): number {
  let max = -Infinity;
  for (const item of items) max = Math.max(max, pick(item));
  return max;
}

/** Locales whose spreadsheet apps use "," as decimal separator (and therefore ";" in CSV). */
function commaDecimalLocale(locale: string | undefined): boolean {
  if (!locale) return false;
  return new Intl.NumberFormat(locale).format(1.5).includes(',');
}

/** New index of column `c` after moving [start, start + count) before `target`. */
function moveColumnIndex(c: number, start: number, count: number, target: number): number {
  const end = start + count;
  if (c >= start && c < end) return target > start ? c + (target - end) : c - (start - target);
  if (target > end && c >= end && c < target) return c - count;
  if (target < start && c >= target && c < start) return c + count;
  return c;
}

/** New index after inserting (n > 0) or removing (n < 0) items at `at`; -1 when removed. */
const moveIndex = (i: number, at: number, n: number): number =>
  i < at ? i : n > 0 ? i + n : i < at - n ? -1 : i + n;

function shiftKeys<V>(map: Map<number, V>, move: (key: number) => number): Map<number, V> {
  const next = new Map<number, V>();
  for (const [k, v] of map) {
    const nk = move(k);
    if (nk >= 0) next.set(nk, v);
  }
  return next;
}

/** Without an engine "=…" is text; marked as such, it cannot run as a formula in an exported file. */
const inertText = (v: RawCell): RawCell => (isFormula(v) ? `'${v}` : v);

const isEmpty = (v: RawCell): boolean => v === null || v === undefined || v === '';

const unite = (a: CellRange, b: CellRange): CellRange => ({
  start: { row: Math.min(a.start.row, b.start.row), col: Math.min(a.start.col, b.start.col) },
  end: { row: Math.max(a.end.row, b.end.row), col: Math.max(a.end.col, b.end.col) },
});

function setBox(el: HTMLElement, left: number, top: number, width: number, height: number): void {
  const s = el.style;
  s.left = `${left}px`;
  s.top = `${top}px`;
  s.width = `${width}px`;
  s.height = `${height}px`;
}

const requestFrame = (fn: () => void): number =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : (setTimeout(fn, 16) as unknown as number);

const cancelFrame = (id: number): void => {
  if (!id) return;
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
};
