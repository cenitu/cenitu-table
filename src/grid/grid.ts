import { cellKey, columnLabel, normalizeRange, type CellAddress, type CellRange } from '../formula/address';
import { FormulaEngine, type ChangedCell, type RemovalRecord } from '../formula/engine';
import { isFormula, parseLiteral, type CellValue, type RawCell } from '../formula/values';
import { extendSeries, type FillDirection } from './autofill';
import { Axis } from './axis';
import { convertInput, editText, formatCell, hasValidation, validate, type CellMeta } from './cellTypes';
import { openColumnMenu } from './columnMenu';
import { compareForSort, matchesFilter, type ColumnFilter, type SortOrder } from './filters';
import { Merges, type MergeArea } from './merges';
import { enUS, type Messages } from './messages';
import { RowMapper } from './rowMapper';
import { injectStyles } from './styles';
import { parseTSV, toTSV } from './tsv';

export interface GridOptions {
  data?: RawCell[][];
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
}

/** Row indexes: `row` is visual (as displayed, -1 if hidden), `physicalRow` is the data row. */
export interface CellChange {
  row: number;
  physicalRow: number;
  col: number;
  oldValue: RawCell;
  newValue: RawCell;
}

export type ChangeSource = 'edit' | 'paste' | 'cut' | 'clear' | 'autofill' | 'undo' | 'redo' | 'api';

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
  afterFilter: (filters: Map<number, ColumnFilter>) => void;
  afterAutofill: (source: CellRange, target: CellRange) => void;
  afterValidate: (row: number, col: number, error: string | undefined) => void;
}
export type HookName = keyof HookMap;

interface Snapshot {
  data: RawCell[][];
  colSizes: number[];
  rows: { order: number[]; hidden: number[] };
  merges: MergeArea[];
  columns: (CellMeta | undefined)[];
  labels: string[] | undefined;
  filters: [number, ColumnFilter][];
  sort: { col: number; order: SortOrder } | null;
}

/**
 * A structural entry holds the state to go back to; replaying it swaps in the current state,
 * so only one full snapshot is taken per step (stack order guarantees the current state is the
 * other side of the step).
 */
type UndoEntry =
  | { kind: 'cells'; changes: CellChange[] }
  | { kind: 'structure'; state: Snapshot; ops: EngineOp[] };

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

/**
 * Spreadsheet-like data grid. Only the visible window of cells is in the DOM and cell elements
 * are recycled while scrolling. The view is split into four panes (frozen corner, frozen top,
 * frozen left, scrolling body). Rows have a visual order (sorting/filtering) mapped onto
 * physical data rows; formulas always use physical rows, which is also what row headers show.
 */
export class CenituGrid {
  readonly root: HTMLDivElement;
  private data: RawCell[][] = [];
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
  private sortState: { col: number; order: SortOrder } | null = null;
  private invalid = new Map<number, string>();

  private canvas!: HTMLDivElement;
  private topBand!: HTMLDivElement;
  private bodyBand!: HTMLDivElement;
  private panes!: { corner: Pane; top: Pane; left: Pane; main: Pane };
  private cornerHead!: HTMLDivElement;
  /** Always-focused textarea: invisible while idle, becomes the cell editor on input. */
  private input!: HTMLTextAreaElement;
  private editing = false;
  private editorEnterMode = false;
  private dropdown?: { el: HTMLDivElement; items: string[]; active: number };
  private closeMenu?: () => void;

  private anchor: CellAddress | null = null;
  private focus: CellAddress | null = null;
  private dragging: 'cells' | 'rows' | 'cols' | 'fill' | null = null;
  private fillTarget: { range: CellRange; direction: FillDirection } | null = null;

  private hooks = new Map<HookName, Set<(...args: never[]) => unknown>>();
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private clipboard: { text: string; raws: RawCell[][]; rows: number[]; col: number } | null = null;
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
    if (options.theme === 'light') this.root.classList.add('ct-light');
    if (options.theme === 'dark') this.root.classList.add('ct-dark');
    this.root.style.height = typeof options.height === 'number' ? `${options.height}px` : options.height ?? '400px';
    this.buildDom();
    container.appendChild(this.root);

    const shared = options.formulas instanceof FormulaEngine ? options.formulas : undefined;
    const existing = shared && options.sheetName !== undefined ? shared.getSheetId(options.sheetName) : shared ? 0 : undefined;
    // A grid on an existing sheet of a shared engine starts from that sheet's content.
    const initial = options.data ?? (shared && existing !== undefined ? shared.getSheetSerialized(existing) : []);
    this.data = this.normalize(initial);
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

    if (shared) {
      this.engine = shared;
      this.sheet = existing ?? shared.addSheet(options.sheetName);
      if (options.data || existing === undefined) shared.setSheetContent(this.data, this.sheet);
    } else if (options.formulas !== false) {
      this.engine = FormulaEngine.buildFromArray(this.data, options.sheetName);
      this.ownsEngine = true;
    }
    this.engine?.on('valuesUpdated', this.onValuesUpdated);

    this.validateAll();
    this.bindEvents();
    this.render();
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
    return this.data[0]?.length ?? 0;
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

  loadData(data: RawCell[][]): void {
    this.data = this.normalize(data);
    this.frozenRows = Math.min(this.frozenRows, this.data.length);
    this.mapper = new RowMapper(this.data.length, this.frozenRows);
    this.rows.resize(this.mapper.count);
    this.cols.resize(this.countCols());
    this.filters.clear();
    this.sortState = null;
    this.cellMeta.clear();
    this.engine?.setSheetContent(this.data, this.sheet);
    this.undoStack = [];
    this.redoStack = [];
    this.anchor = this.focus = null;
    this.validateAll();
    this.render();
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
    s: Pick<GridOptions, 'fixedRowsTop' | 'fixedColumnsStart' | 'readOnly' | 'columns' | 'colHeaders' | 'mergeCells' | 'columnSorting' | 'filters' | 'fillHandle' | 'locale' | 'language'>,
  ): void {
    this.opts = { ...this.opts, ...s };
    if (s.language) this.messages = { ...enUS, ...s.language };
    if (s.columns) this.columnMeta = [...s.columns];
    if (s.colHeaders !== undefined) this.labels = Array.isArray(s.colHeaders) ? [...s.colHeaders] : undefined;
    if (s.columnSorting !== undefined || s.filters !== undefined) this.resetHeaders();
    if (s.fixedRowsTop !== undefined || s.fixedColumnsStart !== undefined) {
      this.frozenRows = Math.min(s.fixedRowsTop ?? this.frozenRows, this.data.length);
      this.frozenCols = Math.min(s.fixedColumnsStart ?? this.frozenCols, this.countCols());
      this.mapper.setPinned(this.frozenRows);
      this.rows.resize(this.mapper.count);
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
    this.focus = focus;
    this.scrollIntoView(this.focus);
    this.render();
    this.run('afterSelection', anchor.row, anchor.col, focus.row, focus.col);
  }

  /** Selection as [[row, col, row2, col2]] (visual). */
  getSelected(): [number, number, number, number][] | undefined {
    if (!this.anchor || !this.focus) return undefined;
    return [[this.anchor.row, this.anchor.col, this.focus.row, this.focus.col]];
  }

  /** Selected range, grown to cover merged cells it touches. */
  getSelectedRange(): CellRange | undefined {
    if (!this.anchor || !this.focus) return undefined;
    const r = normalizeRange(this.anchor, this.focus);
    return this.mergesActive() ? this.merges.expand(r) : r;
  }

  deselectCell(): void {
    this.anchor = this.focus = null;
    this.render();
  }

  // ---------- public API: sorting & filtering ----------

  /** Sorts by one column (visual order only; data and formulas are untouched). null restores data order. */
  sort(col: number, order: SortOrder | null): void {
    if (order === null) {
      this.mapper.sort(null);
      this.sortState = null;
    } else {
      const values = Array.from({ length: this.data.length }, (_, p) => this.valueAt(p, col));
      this.mapper.sort((a, b) => compareForSort(values[a], values[b], order));
      this.sortState = { col, order };
    }
    this.afterRowMapping();
    this.run('afterColumnSort', col, order);
  }

  getSortState(): { col: number; order: SortOrder } | null {
    return this.sortState && { ...this.sortState };
  }

  setFilter(col: number, filter: ColumnFilter | null): void {
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

  // ---------- public API: clipboard & autofill ----------

  /** Copies the selection to the internal clipboard and returns the text for the system clipboard. */
  copy(cut = false): string | undefined {
    const range = this.getSelectedRange();
    if (!range) return undefined;
    const raws: RawCell[][] = [];
    const texts: string[][] = [];
    const rows: number[] = [];
    for (let r = range.start.row; r <= range.end.row; r++) {
      const p = this.mapper.toPhysical(r);
      rows.push(p);
      const rawRow: RawCell[] = [];
      const textRow: string[] = [];
      for (let c = range.start.col; c <= range.end.col; c++) {
        rawRow.push(this.rawAt(p, c));
        textRow.push(this.displayText(p, c));
      }
      raws.push(rawRow);
      texts.push(textRow);
    }
    const text = toTSV(texts);
    this.clipboard = { text, raws, rows, col: range.start.col };
    if (cut) this.clearRange(range, 'cut');
    return text;
  }

  /**
   * Pastes text at the selection. Text from this grid's own copy keeps formulas, with relative
   * references moved to the new location. A single value fills the whole selection.
   */
  paste(text: string): void {
    const range = this.getSelectedRange();
    if (!range || this.opts.readOnly) return;
    const own = this.clipboard && this.clipboard.text === text ? this.clipboard : null;
    const block: RawCell[][] = own ? own.raws : parseTSV(text);
    const single = block.length === 1 && block[0].length === 1;
    const height = single ? range.end.row - range.start.row + 1 : block.length;
    const width = single ? range.end.col - range.start.col + 1 : Math.max(...block.map((r) => r.length));
    this.ensureVisualRows(range.start.row + height);
    const changes: CellChange[] = [];
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
      }
    }
    this.applyChanges(changes, 'paste');
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
  }

  destroy(): void {
    this.closeMenu?.();
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
    return { ...column, ...cell, ...own };
  }

  private displayText(p: number, col: number, v = this.valueAt(p, col)): string {
    return formatCell(v, this.metaAt(p, col), this.opts.locale).text;
  }

  private passes(p: number, filters: [number, ColumnFilter][]): boolean {
    for (const [col, f] of filters) {
      const v = this.valueAt(p, col);
      if (!matchesFilter(v, this.displayText(p, col, v), f)) return false;
    }
    return true;
  }

  private change(p: number, col: number, newValue: RawCell): CellChange {
    return { row: this.mapper.toVisual(p), physicalRow: p, col, oldValue: this.rawAt(p, col), newValue };
  }

  private isReadOnly(p: number, col: number): boolean {
    return !!this.opts.readOnly || !!this.metaAt(p, col).readOnly;
  }

  private applyChanges(changes: CellChange[], source: ChangeSource, record = true): void {
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
    const maxRow = Math.max(...changes.map((c) => c.physicalRow));
    const maxCol = Math.max(...changes.map((c) => c.col));
    this.ensureSize(maxRow + 1, maxCol + 1);
    for (const ch of changes) this.data[ch.physicalRow][ch.col] = ch.newValue ?? null;
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
    if (entry.kind === 'cells') {
      const changes = entry.changes.map((c) =>
        source === 'undo' ? { ...c, oldValue: c.newValue, newValue: c.oldValue } : { ...c },
      );
      this.applyChanges(changes, source, false);
    } else {
      const current = this.snapshot();
      if (source === 'undo') [...entry.ops].reverse().forEach((op) => this.undoEngineOp(op));
      else entry.ops.forEach((op) => this.applyEngineOp(op));
      this.restore(entry.state);
      entry.state = current;
    }
    to.push(entry);
  }

  private applyEngineOp(op: EngineOp): void {
    const e = this.engine;
    if (!e) return;
    if (op.remove) {
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
    if (op.remove) e.restoreRemoval(op.record!);
    else if (op.axis === 'row') e.removeRows(op.index, op.count, this.sheet);
    else e.removeColumns(op.index, op.count, this.sheet);
  }

  private snapshot(): Snapshot {
    return {
      data: this.data.map((r) => [...r]),
      colSizes: Array.from({ length: this.cols.count }, (_, i) => this.cols.size(i)),
      rows: this.mapper.snapshot(),
      merges: this.getMergedCells(),
      columns: [...this.columnMeta],
      labels: this.labels && [...this.labels],
      filters: [...this.filters].map(([c, f]) => [c, { ...f }]),
      sort: this.sortState && { ...this.sortState },
    };
  }

  private restore(s: Snapshot): void {
    this.data = s.data.map((r) => [...r]);
    this.mapper.restore(s.rows);
    this.rows.resize(this.mapper.count);
    this.cols = new Axis(s.colSizes.length, this.cols.defaultSize, s.colSizes);
    this.merges.set(s.merges);
    this.columnMeta = [...s.columns];
    this.labels = s.labels && [...s.labels];
    this.filters = new Map(s.filters);
    this.sortState = s.sort;
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
        this.mapper.remove(p, 1);
        this.applyEngineOp(pushed(ops, { axis: 'row', index: p, count: 1, remove: true }));
      }
      this.merges.shift('row', at, -amount);
    } else {
      const p = at < this.countRows() ? this.mapper.toPhysical(at) : this.data.length;
      this.data.splice(p, 0, ...Array.from({ length: amount }, () => Array<RawCell>(this.countCols()).fill(null)));
      this.mapper.insert(p, amount, at);
      this.applyEngineOp(pushed(ops, { axis: 'row', index: p, count: amount, remove: false }));
      this.merges.shift('row', at, amount);
    }
    this.rows.resize(this.mapper.count);
    this.cellMeta.clear();
  }

  private alterCols(at: number, amount: number, remove: boolean, ops: EngineOp[]): void {
    for (const r of this.data) {
      if (remove) r.splice(at, amount);
      else r.splice(at, 0, ...Array<RawCell>(amount).fill(null));
    }
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
    if (this.sortState) {
      const c = moveCol(this.sortState.col);
      this.sortState = c >= 0 ? { ...this.sortState, col: c } : null;
    }
    this.merges.shift('col', at, remove ? -amount : amount);
    this.frozenCols = Math.min(this.frozenCols, this.countCols());
    this.cellMeta.clear();
  }

  private ensureSize(rows: number, cols: number): void {
    if (cols > this.countCols()) {
      for (const r of this.data) while (r.length < cols) r.push(null);
      this.cols.resize(cols);
    }
    if (rows > this.data.length) {
      const add = rows - this.data.length;
      for (let i = 0; i < add; i++) this.data.push(Array<RawCell>(this.countCols()).fill(null));
      this.mapper.insert(this.data.length - add, add);
      this.rows.resize(this.mapper.count);
    }
  }

  private ensureVisualRows(count: number): void {
    if (count > this.countRows()) this.ensureSize(this.data.length + count - this.countRows(), this.countCols());
  }

  private normalize(data: RawCell[][]): RawCell[][] {
    const empty = data.length === 0;
    const rows = Math.max(data.length, this.opts.minRows ?? (empty ? 50 : 0));
    const cols = Math.max(...data.map((r) => r.length), this.opts.minCols ?? (empty ? 26 : 0), this.columnMeta.length, 1);
    return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => data[r]?.[c] ?? null));
  }

  private afterRowMapping(): void {
    this.rows.resize(this.mapper.count);
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
      if ((address.sheet ?? 0) !== this.sheet) continue;
      if (address.row < this.data.length && hasValidation(this.metaAt(address.row, address.col))) {
        this.revalidate(address.row, address.col);
      }
    }
    this.scheduleRender();
  };

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
    this.input = this.root.ownerDocument.createElement('textarea');
    this.input.className = 'ct-editor ct-idle';
    this.input.setAttribute('aria-label', 'Cell editor');
    this.input.spellcheck = false;
    this.input.addEventListener('keydown', this.onEditorKey);
    this.input.addEventListener('input', this.onInput);
    this.input.addEventListener('compositionstart', () => this.openEditor(''));
    this.input.addEventListener('blur', () => this.closeEditor(true));
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
      const el = p.cells.get(key) ?? p.pool.pop() ?? this.el('ct-cell', p.el);
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

  private paintCell(el: HTMLDivElement, r: number, c: number): void {
    const p = this.mapper.toPhysical(r);
    const meta = this.metaAt(p, c);
    const value = this.valueAt(p, c);
    const { text, kind } = formatCell(value, meta, this.opts.locale);
    let cls = kind ? `ct-cell ct-${kind}` : 'ct-cell';
    if (meta.type === 'dropdown') cls += ' ct-dd';
    if (meta.readOnly) cls += ' ct-readonly';
    const error = this.invalid.size ? this.invalid.get(cellKey(p, c)) : undefined;
    if (error) cls += ' ct-invalid';
    if (meta.className) cls += ` ${meta.className}`;
    if (el.className !== cls) el.className = cls;
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

  private renderHeaders(p: Pane, [r0, r1]: Span, [c0, c1]: Span): void {
    const range = this.getSelectedRange();
    if (p.frozenRows && this.headerH) {
      let i = 0;
      for (let c = c0; c <= c1; c++, i++) {
        const el = p.colHeads[i] ?? this.makeColHeader(p, i);
        el.dataset.col = String(c);
        const label = this.labels?.[c] || this.columnMeta[c]?.title || columnLabel(c);
        const labelEl = el.children[0] as HTMLElement;
        if (labelEl.textContent !== label) labelEl.textContent = label;
        const sort = this.sortState?.col === c ? (this.sortState.order === 'asc' ? '▲' : '▼') : '';
        const sortEl = el.children[1] as HTMLElement;
        if (sortEl.textContent !== sort) sortEl.textContent = sort;
        el.classList.toggle('ct-hl', !!range && c >= range.start.col && c <= range.end.col);
        el.classList.toggle('ct-filtered', this.filters.has(c));
        setBox(el, this.cellX(p, c), 0, this.cols.size(c), this.headerH);
        el.style.display = '';
      }
      for (; i < p.colHeads.length; i++) p.colHeads[i].style.display = 'none';
    }
    if (p.frozenCols && this.rowHeaderW) {
      let i = 0;
      for (let r = r0; r <= r1; r++, i++) {
        const el = p.rowHeads[i] ?? (p.rowHeads[i] = this.el('ct-header ct-rowhead', p.el));
        el.dataset.row = String(r);
        const label = String(this.mapper.toPhysical(r) + 1);
        if (el.textContent !== label) el.textContent = label;
        el.classList.toggle('ct-hl', !!range && r >= range.start.row && r <= range.end.row);
        setBox(el, 0, this.cellY(p, r), this.rowHeaderW, this.rows.size(r));
        el.style.display = '';
      }
      for (; i < p.rowHeads.length; i++) p.rowHeads[i].style.display = 'none';
    }
  }

  private makeColHeader(p: Pane, i: number): HTMLDivElement {
    const el = this.el('ct-header ct-colhead', p.el);
    this.el('ct-label', el, 'span');
    this.el('ct-sort', el, 'span');
    if (this.opts.columnSorting || this.opts.filters) {
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
    if (!this.anchor || !this.focus) return;
    if (!this.countRows() || !this.countCols()) {
      this.anchor = this.focus = null;
      return;
    }
    const clamp = (a: CellAddress) => ({
      row: Math.min(a.row, this.countRows() - 1),
      col: Math.min(a.col, this.countCols() - 1),
    });
    this.anchor = clamp(this.anchor);
    this.focus = clamp(this.focus);
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
    const ta = this.input;
    this.editing = true;
    this.editorEnterMode = initial !== undefined;
    ta.value = initial ?? editText(this.rawAt(p, this.anchor.col), meta, this.opts.locale);
    ta.classList.remove('ct-idle');
    this.placeInput();
    this.autoSizeInput();
    this.focusInput();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    if (meta.type === 'dropdown' && meta.source) this.showDropdown(meta.source, initial !== undefined ? ta.value : '');
    this.render();
  }

  closeEditor(commit: boolean): void {
    if (!this.editing || !this.anchor) return;
    this.editing = false;
    this.hideDropdown();
    const p = this.mapper.toPhysical(this.anchor.row);
    const col = this.anchor.col;
    const text = this.input.value;
    this.input.value = '';
    this.input.classList.add('ct-idle');
    if (commit) {
      const value = convertInput(text, this.metaAt(p, col));
      if (value !== this.rawAt(p, col)) this.applyChanges([this.change(p, col, value)], 'edit');
    }
    this.render();
  }

  private focusInput(): void {
    if (this.root.ownerDocument.activeElement !== this.input) this.input.focus({ preventScroll: true });
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
    if (this.dropdown) this.filterDropdown(this.input.value);
  };

  private showDropdown(source: string[], query: string): void {
    this.hideDropdown();
    const el = this.el('ct-dd-list', this.input.parentElement as HTMLElement);
    el.setAttribute('role', 'listbox');
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (!item || !this.dropdown) return;
      this.input.value = this.dropdown.items[Number(item.dataset.i)];
      this.commitAndMove(1, 0);
    });
    this.dropdown = { el, items: [], active: -1 };
    el.style.left = this.input.style.left;
    el.style.top = `${parseFloat(this.input.style.top) + parseFloat(this.input.style.height)}px`;
    el.style.minWidth = this.input.style.width;
    this.filterDropdown(query, source);
  }

  private filterDropdown(query: string, source?: string[]): void {
    const d = this.dropdown;
    if (!d || !this.anchor) return;
    const all = source ?? this.metaAt(this.mapper.toPhysical(this.anchor.row), this.anchor.col).source ?? [];
    const q = query.toLowerCase();
    d.items = all.filter((s) => s.toLowerCase().includes(q));
    d.active = q && d.items.length ? 0 : -1;
    d.el.textContent = '';
    d.items.forEach((s, i) => {
      const item = this.el('ct-dd-item', d.el);
      item.dataset.i = String(i);
      item.setAttribute('role', 'option');
      item.textContent = s;
    });
    this.highlightDropdown();
  }

  private highlightDropdown(): void {
    const d = this.dropdown;
    if (!d) return;
    [...d.el.children].forEach((c, i) => c.classList.toggle('ct-on', i === d.active));
    (d.el.children[d.active] as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' });
  }

  private hideDropdown(): void {
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
        if (d && d.active >= 0) this.input.value = d.items[d.active];
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
      if (this.dropdown) this.closeEditor(true);
      this.scheduleRender();
    });
    this.listen(this.root, 'keydown', (e) => this.onKeyDown(e));
    this.listen(this.canvas, 'mousedown', (e) => this.onMouseDown(e));
    this.listen(this.canvas, 'dblclick', (e) => this.onDoubleClick(e));
    this.listen(doc, 'mousemove', (e) => this.onDrag(e));
    this.listen(doc, 'mouseup', () => this.onMouseUp());

    const active = () => this.root.contains(doc.activeElement) && !this.editing;
    const copyLike = (cut: boolean) => (e: ClipboardEvent) => {
      if (!active()) return;
      const text = this.copy(cut);
      if (text !== undefined) {
        e.clipboardData?.setData('text/plain', text);
        e.preventDefault();
      }
    };
    this.listen(doc, 'copy', copyLike(false));
    this.listen(doc, 'cut', copyLike(true));
    this.listen(doc, 'paste', (e) => {
      if (!active()) return;
      const text = e.clipboardData?.getData('text/plain');
      if (text) {
        e.preventDefault();
        this.paste(text);
      }
    });
  }

  private onMouseDown(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (this.editing && t === this.input) return;
    if (t.closest('.ct-dd-list') || e.button !== 0) return;
    e.preventDefault();
    if (this.editing) this.closeEditor(true);
    this.focusInput();

    const menuBtn = t.closest<HTMLElement>('.ct-menu-btn');
    if (menuBtn) return this.openMenu(Number(menuBtn.parentElement!.dataset.col), menuBtn);
    const resize = t.closest<HTMLElement>('.ct-resize');
    if (resize) return this.startResize(Number(resize.parentElement!.dataset.col), e.clientX);
    if (t.closest('.ct-fill')) {
      this.dragging = 'fill';
      return;
    }
    if (t.closest('.ct-cornerhead')) return this.selectCell(0, 0, this.countRows() - 1, this.countCols() - 1);
    const colHead = t.closest<HTMLElement>('.ct-colhead');
    if (colHead) {
      const col = Number(colHead.dataset.col);
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

  private onDoubleClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (t.closest('.ct-fill')) return this.fillToDataEnd();
    if (t.closest('.ct-header') || t.closest('.ct-checkbox') || t.closest('.ct-dd-list')) return;
    if (!this.editing) this.openEditor();
  }

  private onDrag(e: MouseEvent): void {
    if (!this.dragging || !this.anchor) return;
    const cell = this.cellAtClient(e.clientX, e.clientY);
    if (this.dragging === 'cells') this.selectCell(this.anchor.row, this.anchor.col, cell.row, cell.col);
    else if (this.dragging === 'rows') this.selectCell(this.anchor.row, 0, cell.row, this.countCols() - 1);
    else if (this.dragging === 'cols') this.selectCell(0, this.anchor.col, this.countRows() - 1, cell.col);
    else this.updateFillTarget(cell);
  }

  private onMouseUp(): void {
    const target = this.fillTarget;
    this.fillTarget = null;
    if (this.dragging === 'fill' && target) this.autofill(this.getSelectedRange()!, target.range);
    else if (target) this.render();
    this.dragging = null;
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
    };
    doc.addEventListener('mousemove', move);
    doc.addEventListener('mouseup', up);
  }

  private openMenu(col: number, anchor: HTMLElement): void {
    this.closeMenu?.();
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
      sort: this.sortState?.col === col ? this.sortState.order : null,
      filter: this.filters.get(col),
      values: sorted,
      sortable: !!this.opts.columnSorting,
      filterable: !!this.opts.filters,
      onSort: (order) => this.sort(col, order),
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
    if (!this.anchor || !this.focus) return;
    const base = extend ? this.focus : this.anchor;
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
    if (extend) this.selectCell(this.anchor.row, this.anchor.col, row, col);
    else this.selectCell(row, col);
  }

  /** Ctrl+arrow: jump to the edge of the current data block, like spreadsheets. */
  private jump(dr: number, dc: number, extend: boolean): void {
    const base = extend ? this.focus! : this.anchor!;
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
    if (this.editing || !this.anchor || !this.focus) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    const meta = this.metaAt(this.mapper.toPhysical(this.anchor.row), this.anchor.col);

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
      if (k === 'a') {
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
        this.moveActive(0, -this.focus.col, e.shiftKey);
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
