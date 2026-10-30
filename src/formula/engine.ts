import { cellKey, keyToAddress, MAX_COLS, MAX_ROWS, parseA1, SHEET_SPAN, type CellAddress, type CellRange } from './address';
import { unparse, visitCalls, visitRefs, type Ast, type RefNode } from './ast';
import { toScalar } from './coerce';
import { getFunction } from './functions';
import { evaluate, readRange, type EvaluationContext } from './interpreter';
import { FormulaSyntaxError } from './lexer';
import { parseFormula } from './parser';
import {
  AstAdjuster,
  dropSheetRefs,
  inverseMove,
  MoveMap,
  REMOVED,
  ShiftMap,
  spanReshaped,
  touchesRemoval,
  type AxisMap,
  type StructuralChange,
} from './restructure';
import { err, isFormula, parseLiteral, RangeValue, type CellValue, type RawCell, type Value } from './values';

export interface ChangedCell {
  address: Required<CellAddress>;
  value: CellValue;
}

export type CellType = 'EMPTY' | 'VALUE' | 'FORMULA';

/**
 * Everything a row/column removal destroys — the removed cells and the formulas (on any sheet, or
 * named expressions) whose references it breaks or shrinks — captured by `captureRemoval` before
 * the removal so `restoreRemoval` can undo it exactly.
 */
export interface RemovalRecord {
  sheet: number;
  axis: 'row' | 'col';
  index: number;
  count: number;
  cells: { address: Required<CellAddress>; raw: RawCell }[];
  names: { name: string; raw: RawCell }[];
}

/**
 * One vertex of the dependency graph: a cell, an empty cell that formulas point at (placeholder,
 * `raw === null`), or a named expression (`key === -1`). Edges point at records rather than keys,
 * so moving cells during row/column insertion leaves the graph intact.
 */
interface CellRecord {
  key: number;
  raw: RawCell;
  value: CellValue;
  ast?: Ast;
  /** `raw` is stale after a structural change or sheet rename; regenerated from the AST on read. */
  textDirty?: boolean;
  /** Has sheet-qualified references, so changes on other sheets may affect it. */
  crossSheet?: boolean;
  /** Referenced a sheet that did not exist; re-parsed when sheets are added or renamed. */
  unresolved?: boolean;
  precedents?: CellRecord[];
  rangeDeps?: RangeEntry[];
  dependents?: Set<CellRecord>;
  /** Named expressions only: the name as given. */
  name?: string;
  removed?: boolean;
  /** Uses a volatile function (TODAY, RAND, ...): re-evaluated on every recalculation. */
  volatile?: boolean;
  /** Uses ROW/COLUMN: re-evaluated when structural changes move it or its references. */
  positional?: boolean;
  /** Array formulas: the block their last result needs, whether it could be placed or not. */
  spillArea?: Area;
  /** Array formulas: the cells their result spills into (not the anchor itself). */
  spillCells?: CellRecord[];
  /** Spilled cells: the array formula whose element this cell shows. */
  spillOwner?: CellRecord;
}

/** Absolute block of cells on the sheet of the record that owns it. */
interface Area {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** One shared entry per distinct range, so SUM(A1:A1000) is one edge, not a thousand. */
interface RangeEntry {
  sheet: number;
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  id: string;
  dependents: Set<CellRecord>;
}

type Listener = (changes: ChangedCell[]) => void;

const sheetOf = (key: number): number => Math.floor(key / SHEET_SPAN);
const rowOf = (key: number): number => Math.floor((key % SHEET_SPAN) / MAX_COLS);
const colOf = (key: number): number => key % MAX_COLS;
const rangeId = (r0: number, c0: number, r1: number, c1: number): string => `${r0},${c0}:${r1},${c1}`;
const NAME_RE = /^[\p{L}_][\p{L}\p{N}_.]*$/u;
/** Safety net for spills that keep reshaping each other; real workbooks settle in two or three passes. */
const MAX_SPILL_PASSES = 64;

/**
 * Multi-sheet formula engine. Cells are stored sparsely per sheet; formulas are parsed once into an
 * AST whose relative references are offsets from the formula cell, dependencies are tracked in a
 * graph and only affected cells are recalculated after a change.
 */
export class FormulaEngine {
  /** Indexed by sheet id; ids are never reused, removed sheets leave `undefined`. */
  private sheetNames: (string | undefined)[] = [];
  private sheetIds = new Map<string, number>();
  private sheetData: (Map<number, CellRecord> | undefined)[] = [];
  private rangeIndex: (Map<string, RangeEntry> | undefined)[] = [];
  /** Upper-cased name -> record; also holds placeholders for names used before being defined. */
  private names = new Map<string, CellRecord>();
  private unresolved = new Set<CellRecord>();
  private evaluatingNames = new Set<CellRecord>();
  private listeners = new Set<Listener>();
  private batchDepth = 0;
  private pendingKeys = new Set<number>();
  private dirty = new Set<CellRecord>();
  private volatiles = new Set<CellRecord>();
  /** Records with a `spillArea` (placed or blocked array results). */
  private anchors = new Set<CellRecord>();
  /**
   * During a recalculation: every record evaluated or re-spilled, with its value from before the
   * recalculation, so changes are reported once even when spills need several passes.
   */
  private trace: Map<CellRecord, CellValue> | null = null;
  /** Cells a spill newly covered in this pass; their dependents are evaluated in the next pass. */
  private spillSeeds = new Set<number>();
  /** Array formulas whose blocking cells changed in this pass. */
  private spillDirty = new Set<CellRecord>();

  constructor() {
    this.createSheet('Sheet1');
  }

  static buildEmpty(): FormulaEngine {
    return new FormulaEngine();
  }

  static buildFromArray(data: RawCell[][], sheetName = 'Sheet1'): FormulaEngine {
    const engine = new FormulaEngine();
    if (sheetName !== 'Sheet1') engine.renameSheet(0, sheetName);
    engine.batch(() => engine.setCellContents({ row: 0, col: 0 }, data));
    return engine;
  }

  /** Builds one sheet per entry, in order (ids 0, 1, ...); formulas may refer to any of them. */
  static buildFromSheets(sheets: Record<string, RawCell[][]>): FormulaEngine {
    const engine = new FormulaEngine();
    const names = Object.keys(sheets);
    if (names.length === 0) {
      engine.removeSheet(0);
      return engine;
    }
    engine.renameSheet(0, names[0]);
    names.slice(1).forEach((n) => engine.addSheet(n));
    engine.batch(() => names.forEach((n, sheet) => engine.setCellContents({ row: 0, col: 0, sheet }, sheets[n])));
    return engine;
  }

  // ---------- sheets ----------

  addSheet(name?: string): number {
    const sheetName = name ?? this.unusedSheetName();
    this.checkSheetName(sheetName);
    const id = this.createSheet(sheetName);
    this.batch(() => this.reresolve());
    return id;
  }

  /** Removes a sheet; references to it from other sheets and names become #REF!. */
  removeSheet(id: number): ChangedCell[] {
    const cells = this.requireSheet(id);
    return this.batch(() => {
      const outside = new Set<CellRecord>();
      for (const rec of cells.values()) {
        rec.removed = true;
        rec.dependents?.forEach((d) => outside.add(d));
      }
      this.rangeIndex[id]?.forEach((e) => e.dependents.forEach((d) => outside.add(d)));
      for (const rec of cells.values()) {
        this.unlink(rec);
        this.unresolved.delete(rec);
        this.anchors.delete(rec);
      }
      this.sheetIds.delete(this.sheetNames[id]!.toUpperCase());
      this.sheetNames[id] = undefined;
      this.sheetData[id] = undefined;
      this.rangeIndex[id] = undefined;
      for (const rec of outside) {
        if (rec.removed || !rec.ast) continue;
        const { ast, changed } = dropSheetRefs(rec.ast, id, this.homeSheet(rec));
        if (!changed) continue;
        this.unlink(rec);
        rec.ast = ast;
        rec.textDirty = true;
        this.link(rec);
        this.dirty.add(rec);
      }
    });
  }

  /** Renames a sheet; formula text referring to it is updated everywhere. */
  renameSheet(id: number, newName: string): void {
    this.requireSheet(id);
    const old = this.sheetNames[id]!;
    if (old === newName) return;
    if (old.toUpperCase() !== newName.toUpperCase()) this.checkSheetName(newName);
    this.sheetIds.delete(old.toUpperCase());
    this.sheetIds.set(newName.toUpperCase(), id);
    this.sheetNames[id] = newName;
    for (const rec of this.formulaRecords()) {
      if (rec.crossSheet && !rec.textDirty && referencesSheet(rec.ast!, id)) rec.textDirty = true;
    }
    this.batch(() => this.reresolve());
  }

  getSheetNames(): string[] {
    return this.sheetNames.filter((n): n is string => n !== undefined);
  }

  getSheetId(name: string): number | undefined {
    return this.sheetIds.get(name.toUpperCase());
  }

  getSheetName(id: number): string | undefined {
    return this.sheetNames[id];
  }

  doesSheetExist(name: string): boolean {
    return this.getSheetId(name) !== undefined;
  }

  countSheets(): number {
    return this.sheetIds.size;
  }

  // ---------- named expressions ----------

  isItPossibleToAddNamedExpression(name: string): boolean {
    return (
      NAME_RE.test(name) &&
      !parseA1(name) &&
      !/^(TRUE|FALSE)$/i.test(name) &&
      !getFunction(name) &&
      !this.isNameDefined(name)
    );
  }

  /** Adds a global name. `expression` is a value or a formula such as '=Sheet1!$A$1:$A$10'. */
  addNamedExpression(name: string, expression: RawCell): ChangedCell[] {
    if (!this.isItPossibleToAddNamedExpression(name)) throw new Error(`Cannot add named expression "${name}"`);
    return this.batch(() => {
      const rec = this.nameRecord(name);
      rec.name = name;
      // A placeholder created by an earlier reference moves to the end: list in definition order.
      this.names.delete(name.toUpperCase());
      this.names.set(name.toUpperCase(), rec);
      this.setNameExpression(rec, expression);
    });
  }

  changeNamedExpression(name: string, expression: RawCell): ChangedCell[] {
    const rec = this.definedName(name);
    return this.batch(() => this.setNameExpression(rec, expression));
  }

  removeNamedExpression(name: string): ChangedCell[] {
    const rec = this.definedName(name);
    return this.batch(() => {
      this.unlink(rec);
      this.unresolved.delete(rec);
      rec.raw = null;
      rec.ast = undefined;
      rec.value = null;
      this.dirty.add(rec);
      this.collectPlaceholder(rec);
    });
  }

  /** Current value; a range-valued name gives a 2D array. Undefined when the name is not defined. */
  getNamedExpressionValue(name: string): CellValue | CellValue[][] | undefined {
    if (!this.isNameDefined(name)) return undefined;
    const v = this.nameValue(name);
    return v instanceof RangeValue ? v.values : this.finalize(v);
  }

  /** The expression as given (formula text reflects later structural changes and renames). */
  getNamedExpressionFormula(name: string): RawCell | undefined {
    const rec = this.names.get(name.toUpperCase());
    return rec && rec.raw !== null ? this.textOf(rec) : undefined;
  }

  listNamedExpressions(): string[] {
    return [...this.names.values()].filter((r) => r.raw !== null).map((r) => r.name!);
  }

  // ---------- reading ----------

  getCellValue({ row, col, sheet = 0 }: CellAddress): CellValue {
    return this.recordAt(cellKey(row, col, sheet))?.value ?? null;
  }

  getCellSerialized({ row, col, sheet = 0 }: CellAddress): RawCell {
    const rec = this.recordAt(cellKey(row, col, sheet));
    return rec ? this.textOf(rec) : null;
  }

  getCellFormula(address: CellAddress): string | undefined {
    const raw = this.getCellSerialized(address);
    return isFormula(raw) ? raw : undefined;
  }

  doesCellHaveFormula(address: CellAddress): boolean {
    return this.getCellFormula(address) !== undefined;
  }

  getCellType({ row, col, sheet = 0 }: CellAddress): CellType {
    const rec = this.recordAt(cellKey(row, col, sheet));
    return !rec || rec.raw === null ? 'EMPTY' : isFormula(rec.raw) ? 'FORMULA' : 'VALUE';
  }

  /**
   * The block an array formula spills into, for its anchor or any cell of the block.
   * Undefined when the cell is not part of a spill (including a blocked #SPILL! anchor).
   */
  getSpillRange({ row, col, sheet = 0 }: CellAddress): CellRange | undefined {
    const rec = this.recordAt(cellKey(row, col, sheet));
    const anchor = rec?.spillOwner ?? rec;
    if (!anchor?.spillArea || !anchor.spillCells?.length) return undefined;
    const { r0, c0, r1, c1 } = anchor.spillArea;
    return { start: publicAddress(sheet, r0, c0), end: publicAddress(sheet, r1, c1) };
  }

  /** Spilled cells count: they show values even though they hold no content. */
  getSheetDimensions(sheet = 0): { width: number; height: number } {
    let width = 0;
    let height = 0;
    for (const rec of this.sheetData[sheet]?.values() ?? []) {
      if (rec.raw === null && !rec.spillOwner) continue;
      height = Math.max(height, rowOf(rec.key) + 1);
      width = Math.max(width, colOf(rec.key) + 1);
    }
    return { width, height };
  }

  getSheetValues(sheet = 0): CellValue[][] {
    return this.dump(sheet, (rec) => rec?.value ?? null);
  }

  getSheetSerialized(sheet = 0): RawCell[][] {
    return this.dump(sheet, (rec) => (rec ? this.textOf(rec) : null));
  }

  /** Cells and ranges the formula reads. Addresses carry `sheet` only when it is not 0. */
  getCellPrecedents({ row, col, sheet = 0 }: CellAddress): (CellAddress | CellRange)[] {
    const rec = this.recordAt(cellKey(row, col, sheet));
    if (!rec?.ast) return [];
    const out: (CellAddress | CellRange)[] = [];
    visitRefs(rec.ast, (node) => {
      if (node.type === 'ref') {
        out.push(publicAddress(node.sheet ?? sheet, absRow(node, row), absCol(node, col)));
      } else if (node.type === 'range') {
        const s = node.start.sheet ?? sheet;
        const [r0, r1] = minMax(absRow(node.start, row), absRow(node.end, row));
        const [c0, c1] = minMax(absCol(node.start, col), absCol(node.end, col));
        out.push({ start: publicAddress(s, r0, c0), end: publicAddress(s, r1, c1) });
      }
    });
    return out;
  }

  /** Formula cells that read this cell directly (through a named expression counts as directly). */
  getCellDependents({ row, col, sheet = 0 }: CellAddress): CellAddress[] {
    const key = cellKey(row, col, sheet);
    const found = new Set<CellRecord>();
    const add = (d: CellRecord): void => {
      if (found.has(d)) return;
      found.add(d);
      if (d.key < 0) d.dependents?.forEach(add);
    };
    this.forEachDependent(this.recordAt(key), key, add);
    return [...found].filter((d) => d.key >= 0).map((d) => publicAddress(sheetOf(d.key), rowOf(d.key), colOf(d.key)));
  }

  /** Evaluates a formula without storing it; relative references are read as absolute on `sheet`. */
  calculateFormula(formula: string, sheet = 0): CellValue {
    try {
      const ast = this.parse(stripEquals(formula), 0, 0);
      return this.finalize(evaluate(ast, { ...this.ctx, sheet, row: 0, col: 0 }));
    } catch (e) {
      if (e instanceof FormulaSyntaxError) return err('#ERROR!', e.message);
      throw e;
    }
  }

  validateFormula(formula: string): boolean {
    try {
      this.parse(stripEquals(formula), 0, 0);
      return true;
    } catch {
      return false;
    }
  }

  // ---------- writing ----------

  /** Sets one value, or a 2D block whose top-left corner is `address`. Returns the changed values. */
  setCellContents(address: CellAddress, content: RawCell | RawCell[][]): ChangedCell[] {
    const sheet = address.sheet ?? 0;
    this.requireSheet(sheet);
    return this.batch(() => {
      if (Array.isArray(content)) {
        content.forEach((rowData, r) =>
          rowData.forEach((raw, c) => this.writeCell(sheet, address.row + r, address.col + c, raw)),
        );
      } else {
        this.writeCell(sheet, address.row, address.col, content);
      }
    });
  }

  /** Replaces the whole content of a sheet. */
  setSheetContent(data: RawCell[][], sheet = 0): ChangedCell[] {
    const cells = this.requireSheet(sheet);
    return this.batch(() => {
      for (const rec of [...cells.values()]) {
        if (rec.raw !== null) this.writeCell(sheet, rowOf(rec.key), colOf(rec.key), null);
      }
      this.setCellContents({ row: 0, col: 0, sheet }, data);
    });
  }

  /** Groups several operations into one recalculation. */
  batch(fn: () => void): ChangedCell[] {
    this.batchDepth++;
    try {
      fn();
    } finally {
      this.batchDepth--;
    }
    if (this.batchDepth > 0) return [];
    const keys = this.pendingKeys;
    const dirty = this.dirty;
    this.pendingKeys = new Set();
    this.dirty = new Set();
    const changes = this.recalculate(keys, dirty);
    if (changes.length) this.listeners.forEach((l) => l(changes));
    return changes;
  }

  addRows(index: number, count: number, sheet = 0): ChangedCell[] {
    return this.restructure({ sheet, axis: 'row', index, count, remove: false });
  }

  removeRows(index: number, count: number, sheet = 0): ChangedCell[] {
    return this.restructure({ sheet, axis: 'row', index, count, remove: true });
  }

  addColumns(index: number, count: number, sheet = 0): ChangedCell[] {
    return this.restructure({ sheet, axis: 'col', index, count, remove: false });
  }

  removeColumns(index: number, count: number, sheet = 0): ChangedCell[] {
    return this.restructure({ sheet, axis: 'col', index, count, remove: true });
  }

  /**
   * Moves `count` rows starting at `start` so they are inserted before row `target` (an index in
   * pre-move coordinates; a `target` inside the block is a no-op). References follow the moved
   * cells; a range keeps its first and last cells, wherever they went.
   * Undo with the inverse move: `inverseMove(start, count, target)`.
   */
  moveRows(start: number, count: number, target: number, sheet = 0): ChangedCell[] {
    return this.move('row', start, count, target, sheet);
  }

  /** Column counterpart of `moveRows`. */
  moveColumns(start: number, count: number, target: number, sheet = 0): ChangedCell[] {
    return this.move('col', start, count, target, sheet);
  }

  /** Parameters `{ start, count, target }` of the move that undoes `move(start, count, target)` (either axis). */
  inverseMove(start: number, count: number, target: number): { start: number; count: number; target: number } {
    return inverseMove(start, count, target);
  }

  /**
   * Re-evaluates volatile formulas (TODAY, NOW, RAND, RANDBETWEEN) and their dependents, e.g. from
   * a host timer. Every other recalculation refreshes them too. Emits `valuesUpdated`.
   */
  recalculateVolatile(): ChangedCell[] {
    return this.batch(() => {});
  }

  /** Read-only: records what removing `count` rows/columns at `index` would destroy. */
  captureRemoval(axis: 'row' | 'col', index: number, count: number, sheet = 0): RemovalRecord {
    this.requireSheet(sheet);
    const ch: StructuralChange = { sheet, axis, index, count, remove: true };
    const isRow = axis === 'row';
    const record: RemovalRecord = { sheet, axis, index, count, cells: [], names: [] };
    this.sheetData.forEach((cells, s) => {
      if (!cells) return;
      for (const rec of cells.values()) {
        if (rec.raw === null) continue;
        const pos = isRow ? rowOf(rec.key) : colOf(rec.key);
        const inside = s === sheet && pos >= index && pos < index + count;
        const affected = !!rec.ast && (s === sheet || !!rec.crossSheet) && touchesRemoval(ch, rec.ast, s, pos);
        if (inside || affected) {
          record.cells.push({ address: { sheet: s, row: rowOf(rec.key), col: colOf(rec.key) }, raw: this.textOf(rec) });
        }
      }
    });
    for (const rec of this.names.values()) {
      if (rec.ast && rec.raw !== null && touchesRemoval(ch, rec.ast, -1, 0)) {
        record.names.push({ name: rec.name!, raw: this.textOf(rec) });
      }
    }
    return record;
  }

  /** Undoes a removal captured with `captureRemoval`: re-inserts the space and restores the content. */
  restoreRemoval(r: RemovalRecord): ChangedCell[] {
    return this.batch(() => {
      if (r.axis === 'row') this.addRows(r.index, r.count, r.sheet);
      else this.addColumns(r.index, r.count, r.sheet);
      for (const c of r.cells) this.setCellContents(c.address, c.raw);
      for (const n of r.names) this.changeNamedExpression(n.name, n.raw);
    });
  }

  /** Moves the relative references of a formula, as when copying it to another cell. */
  shiftFormula(formula: string, dRow: number, dCol: number): string {
    if (!isFormula(formula)) return formula;
    // Unknown sheet names get temporary ids past the real ones so their text survives.
    const unknown: string[] = [];
    const offset = this.sheetNames.length;
    let ast: Ast;
    try {
      ast = parseFormula(stripEquals(formula), {
        resolveSheet: (name) => this.getSheetId(name) ?? offset + unknown.push(name) - 1,
      });
    } catch {
      return formula;
    }
    const sheetName = (id: number): string | undefined => (id < offset ? this.sheetNames[id] : unknown[id - offset]);
    return '=' + unparse(ast, { base: { row: dRow, col: dCol }, sheetName });
  }

  on(event: 'valuesUpdated', listener: Listener): void {
    if (event === 'valuesUpdated') this.listeners.add(listener);
  }

  off(event: 'valuesUpdated', listener: Listener): void {
    if (event === 'valuesUpdated') this.listeners.delete(listener);
  }

  destroy(): void {
    this.sheetData.forEach((m) => m?.clear());
    this.rangeIndex = [];
    this.names.clear();
    this.unresolved.clear();
    this.listeners.clear();
    this.volatiles.clear();
    this.anchors.clear();
  }

  // ---------- internals ----------

  /** Shared context; the evaluated cell's position is written into it before each evaluation. */
  private ctx: EvaluationContext = {
    sheet: 0,
    row: 0,
    col: 0,
    getCellValue: (sheet, row, col) => this.sheetData[sheet]?.get(cellKey(row, col, sheet))?.value ?? null,
    resolveName: (name) => this.nameValue(name),
    getRange: (sheet, r0, c0, r1, c1) => {
      const cache = this.rangeCache;
      if (!cache) return readRange(this.ctx, sheet, r0, c0, r1, c1);
      const id = `${sheet}!${r0},${c0}:${r1},${c1}`;
      let v = cache.get(id);
      if (!v) cache.set(id, (v = readRange(this.ctx, sheet, r0, c0, r1, c1)));
      return v;
    },
  };

  /**
   * Ranges read during one recalculation pass. Safe because formulas run in topological order: a
   * formula reading a range runs only after every changed cell inside it has its final value.
   * (Functions treat range values as read-only.)
   */
  private rangeCache: Map<string, RangeValue> | null = null;

  private createSheet(name: string): number {
    const id = this.sheetNames.length;
    this.sheetNames.push(name);
    this.sheetIds.set(name.toUpperCase(), id);
    this.sheetData.push(new Map());
    this.rangeIndex.push(undefined);
    return id;
  }

  private checkSheetName(name: string): void {
    if (name.trim() === '') throw new Error('Sheet name cannot be empty');
    if (this.doesSheetExist(name)) throw new Error(`Sheet "${name}" already exists`);
  }

  private unusedSheetName(): string {
    for (let n = this.countSheets() + 1; ; n++) if (!this.doesSheetExist(`Sheet${n}`)) return `Sheet${n}`;
  }

  private requireSheet(id: number): Map<number, CellRecord> {
    const cells = this.sheetData[id];
    if (!cells) throw new Error(`There is no sheet with id ${id}`);
    return cells;
  }

  private recordAt(key: number): CellRecord | undefined {
    return this.sheetData[sheetOf(key)]?.get(key);
  }

  private homeSheet(rec: CellRecord): number {
    return rec.key >= 0 ? sheetOf(rec.key) : -1;
  }

  private *formulaRecords(): IterableIterator<CellRecord> {
    for (const cells of this.sheetData) {
      if (cells) for (const rec of cells.values()) if (rec.ast) yield rec;
    }
    for (const rec of this.names.values()) if (rec.ast) yield rec;
  }

  /** Formula text, regenerated from the AST when references moved or a sheet was renamed. */
  private textOf(rec: CellRecord): RawCell {
    if (rec.textDirty && rec.ast) {
      const base = rec.key >= 0 ? { row: rowOf(rec.key), col: colOf(rec.key) } : undefined;
      rec.raw = '=' + unparse(rec.ast, { base, sheetName: (id) => this.sheetNames[id] });
      rec.textDirty = false;
    }
    return rec.raw;
  }

  private dump<T>(sheet: number, pick: (rec: CellRecord | undefined) => T): T[][] {
    const cells = this.sheetData[sheet];
    const { width, height } = this.getSheetDimensions(sheet);
    return Array.from({ length: height }, (_, r) =>
      Array.from({ length: width }, (_, c) => pick(cells?.get(cellKey(r, c, sheet)))),
    );
  }

  /** Parses formula text; `rec` collects whether the formula uses (possibly unknown) sheet names. */
  private parse(text: string, row: number, col: number, rec?: CellRecord): Ast {
    return parseFormula(text, {
      base: { row, col },
      resolveSheet: (name) => {
        const id = this.getSheetId(name);
        if (rec) {
          rec.crossSheet = true;
          if (id === undefined) {
            rec.unresolved = true;
            this.unresolved.add(rec);
          }
        }
        return id;
      },
    });
  }

  private writeCell(sheet: number, row: number, col: number, raw: RawCell): void {
    const cells = this.requireSheet(sheet);
    const key = cellKey(row, col, sheet);
    let rec = cells.get(key);
    const empty = raw === null || raw === undefined || raw === '';
    // A spilled cell has no content of its own, so clearing it changes nothing.
    if (empty && rec?.spillOwner) return;
    if (rec) {
      // Content written into a spill blocks it; the anchor sees the key and re-evaluates.
      rec.spillOwner = undefined;
      if (rec.spillArea) this.dropSpill(rec).forEach((k) => this.pendingKeys.add(k));
      this.unlink(rec);
      this.unresolved.delete(rec);
      rec.ast = undefined;
      rec.textDirty = rec.crossSheet = rec.unresolved = false;
    }

    if (empty) {
      if (rec?.dependents?.size) {
        rec.raw = null; // keep a placeholder: formulas still point at this cell
        rec.value = null;
      } else if (rec) {
        cells.delete(key);
        rec.removed = true;
      }
    } else {
      if (!rec) cells.set(key, (rec = { key, raw, value: null }));
      rec.raw = raw;
      if (isFormula(raw)) this.compile(rec);
      else rec.value = parseLiteral(raw);
    }
    this.pendingKeys.add(key);
  }

  private compile(rec: CellRecord): void {
    rec.value = null;
    try {
      rec.ast = this.parse((rec.raw as string).slice(1), rowOf(rec.key), colOf(rec.key), rec);
      this.link(rec);
    } catch (e) {
      if (!(e instanceof FormulaSyntaxError)) throw e;
      rec.value = err('#ERROR!', e.message);
    }
  }

  private setNameExpression(rec: CellRecord, expression: RawCell): void {
    this.unlink(rec);
    this.unresolved.delete(rec);
    rec.raw = expression ?? null;
    rec.ast = undefined;
    rec.textDirty = rec.unresolved = false;
    rec.value = parseLiteral(expression);
    if (isFormula(expression)) {
      try {
        const ast = this.parse(expression.slice(1), 0, 0, rec);
        // Names are global: unqualified references are bound to the first sheet.
        const sheet = this.sheetNames.findIndex((n) => n !== undefined);
        visitRefs(ast, (n) => {
          const ref = n.type === 'ref' ? n : n.type === 'range' ? n.start : undefined;
          if (!ref || ref.sheet !== undefined) return;
          ref.sheet = sheet;
          if (n.type === 'range') n.end.sheet = sheet;
          rec.textDirty = true;
        });
        rec.ast = ast;
        rec.crossSheet = true;
        rec.value = null;
        this.link(rec);
      } catch (e) {
        if (!(e instanceof FormulaSyntaxError)) throw e;
        rec.value = err('#ERROR!', e.message);
      }
    }
    this.dirty.add(rec);
  }

  /** Re-parses formulas that referenced sheets which did not exist at the time. */
  private reresolve(): void {
    for (const rec of [...this.unresolved]) {
      this.unresolved.delete(rec);
      if (rec.removed) continue;
      const text = this.textOf(rec);
      if (rec.key < 0) {
        this.setNameExpression(rec, text);
      } else {
        this.unlink(rec);
        rec.ast = undefined;
        rec.crossSheet = rec.unresolved = false;
        this.compile(rec);
        this.dirty.add(rec);
      }
    }
  }

  private isNameDefined(name: string): boolean {
    const rec = this.names.get(name.toUpperCase());
    return rec !== undefined && rec.raw !== null;
  }

  private definedName(name: string): CellRecord {
    if (!this.isNameDefined(name)) throw new Error(`Named expression "${name}" does not exist`);
    return this.names.get(name.toUpperCase())!;
  }

  private nameRecord(name: string): CellRecord {
    const upper = name.toUpperCase();
    let rec = this.names.get(upper);
    if (!rec) this.names.set(upper, (rec = { key: -1, raw: null, value: null, name }));
    return rec;
  }

  private nameValue(name: string): Value {
    const rec = this.names.get(name.toUpperCase());
    if (!rec || rec.raw === null) return err('#NAME?', `Unknown name "${name}"`);
    if (!rec.ast) return rec.value;
    if (this.evaluatingNames.has(rec)) return err('#CYCLE!');
    this.evaluatingNames.add(rec);
    try {
      return evaluate(rec.ast, { ...this.ctx, sheet: -1, row: 0, col: 0 });
    } finally {
      this.evaluatingNames.delete(rec);
    }
  }

  private ensureCell(sheet: number, row: number, col: number): CellRecord | undefined {
    const cells = this.sheetData[sheet];
    if (!cells || row < 0 || col < 0) return undefined;
    const key = cellKey(row, col, sheet);
    let rec = cells.get(key);
    if (!rec) cells.set(key, (rec = { key, raw: null, value: null }));
    return rec;
  }

  private rangeEntry(sheet: number, r0: number, c0: number, r1: number, c1: number): RangeEntry {
    const index = (this.rangeIndex[sheet] ??= new Map());
    const id = rangeId(r0, c0, r1, c1);
    let entry = index.get(id);
    if (!entry) index.set(id, (entry = { sheet, r0, c0, r1, c1, id, dependents: new Set() }));
    return entry;
  }

  private link(rec: CellRecord): void {
    if (!rec.ast) return;
    const hs = this.homeSheet(rec);
    const hr = rec.key >= 0 ? rowOf(rec.key) : 0;
    const hc = rec.key >= 0 ? colOf(rec.key) : 0;
    const precedents: CellRecord[] = [];
    const rangeDeps: RangeEntry[] = [];
    const depend = (target: CellRecord | undefined): void => {
      if (!target) return;
      precedents.push(target);
      (target.dependents ??= new Set()).add(rec);
    };
    visitRefs(rec.ast, (node) => {
      if (node.type === 'name') {
        if (node.name !== '') depend(this.nameRecord(node.name));
      } else if (node.type === 'ref') {
        depend(this.ensureCell(node.sheet ?? hs, absRow(node, hr), absCol(node, hc)));
      } else {
        const s = node.start.sheet ?? hs;
        if (!this.sheetData[s]) return;
        const [r0, r1] = minMax(absRow(node.start, hr), absRow(node.end, hr));
        const [c0, c1] = minMax(absCol(node.start, hc), absCol(node.end, hc));
        const entry = this.rangeEntry(s, r0, c0, r1, c1);
        entry.dependents.add(rec);
        rangeDeps.push(entry);
      }
    });
    rec.precedents = precedents.length ? precedents : undefined;
    rec.rangeDeps = rangeDeps.length ? rangeDeps : undefined;
    rec.volatile = rec.positional = false;
    visitCalls(rec.ast, (name) => {
      const fn = getFunction(name);
      if (fn?.volatile) rec.volatile = true;
      if (fn?.positional) rec.positional = true;
    });
    if (rec.volatile) this.volatiles.add(rec);
  }

  private unlink(rec: CellRecord): void {
    if (rec.precedents) {
      for (const p of rec.precedents) {
        p.dependents?.delete(rec);
        this.collectPlaceholder(p);
      }
    }
    if (rec.rangeDeps) {
      for (const e of rec.rangeDeps) {
        e.dependents.delete(rec);
        const index = this.rangeIndex[e.sheet];
        if (e.dependents.size === 0 && index?.get(e.id) === e) index.delete(e.id);
      }
    }
    rec.precedents = rec.rangeDeps = undefined;
    this.volatiles.delete(rec);
  }

  /** Drops an empty cell / undefined name once nothing refers to it any more. */
  private collectPlaceholder(p: CellRecord): void {
    if (p.raw !== null || p.removed || p.dependents?.size || p.spillOwner) return;
    if (p.key < 0) {
      const upper = p.name!.toUpperCase();
      if (this.names.get(upper) === p) this.names.delete(upper);
    } else {
      const cells = this.sheetData[sheetOf(p.key)];
      if (cells?.get(p.key) === p) cells.delete(p.key);
    }
    p.removed = true;
  }

  /**
   * Formulas reading the cell. With `withSpill`, an array formula also counts the readers of the
   * cells it spills into, which orders them after it and exposes cycles through spills.
   */
  private forEachDependent(rec: CellRecord | undefined, key: number, fn: (d: CellRecord) => void, withSpill = false): void {
    rec?.dependents?.forEach(fn);
    if (withSpill && rec?.spillCells?.length) this.forEachSpillDependent(rec, fn);
    if (key < 0) return;
    const index = this.rangeIndex[sheetOf(key)];
    if (!index?.size) return;
    const row = rowOf(key);
    const col = colOf(key);
    for (const e of index.values()) {
      if (row >= e.r0 && row <= e.r1 && col >= e.c0 && col <= e.c1) e.dependents.forEach(fn);
    }
  }

  /**
   * Collects every formula reachable from the changed cells (plus volatile formulas), orders them
   * topologically (Kahn's algorithm) and evaluates them once. A spill that newly covers cells may
   * have readers that were not ordered after it; they are evaluated in a further pass seeded with
   * those cells, until nothing changes shape any more.
   */
  private recalculate(keys: Set<number>, dirty: Set<CellRecord>): ChangedCell[] {
    const trace = (this.trace = new Map());
    let passKeys: Iterable<number> = keys;
    let passDirty: Iterable<CellRecord> = this.volatiles.size ? [...dirty, ...this.volatiles] : dirty;
    try {
      for (let pass = 1; ; pass++) {
        this.spillSeeds = new Set();
        this.spillDirty = new Set();
        this.evaluatePass(passKeys, passDirty);
        if (!this.spillSeeds.size && !this.spillDirty.size) break;
        if (pass === MAX_SPILL_PASSES) {
          // Spills that keep displacing each other never settle: give up on them.
          for (const r of this.spillDirty) {
            this.unspill(r);
            r.value = err('#SPILL!', 'Spill does not settle');
          }
          break;
        }
        passKeys = this.spillSeeds;
        passDirty = this.spillDirty;
      }
    } finally {
      this.trace = null;
    }

    const changes = new Map<number, ChangedCell>();
    for (const k of keys) {
      if (this.sheetData[sheetOf(k)]) changes.set(k, { address: keyToAddress(k), value: this.recordAt(k)?.value ?? null });
    }
    for (const [r, before] of trace) {
      if (r.key < 0 || keys.has(r.key) || !this.sheetData[sheetOf(r.key)] || sameValue(before, r.value)) continue;
      // A vacated spill cell may have been replaced by a new record at the same key: that one reports.
      if (r.removed && this.recordAt(r.key)) continue;
      changes.set(r.key, { address: keyToAddress(r.key), value: r.value });
    }
    return [...changes.values()];
  }

  private evaluatePass(keys: Iterable<number>, dirty: Iterable<CellRecord>): void {
    const trace = this.trace!;
    const indegree = new Map<CellRecord, number>();
    const queue: CellRecord[] = [];
    const visit = (r: CellRecord): void => {
      if (r.removed || indegree.has(r)) return;
      indegree.set(r, 0);
      queue.push(r);
      if (!trace.has(r)) trace.set(r, r.value);
    };
    const seed = (rec: CellRecord | undefined, key: number): void => {
      if (rec?.ast) visit(rec);
      else this.forEachDependent(rec, key, visit);
    };
    for (const k of keys) {
      seed(this.recordAt(k), k);
      // Content appearing or disappearing inside an array formula's block may (un)block it.
      if (this.anchors.size) this.forEachAnchorCovering(k, visit);
    }
    for (const r of dirty) if (!r.removed) seed(r, r.key);

    const edges = new Map<CellRecord, CellRecord[]>();
    for (let i = 0; i < queue.length; i++) {
      const r = queue[i];
      const out: CellRecord[] = [];
      this.forEachDependent(r, r.key, (d) => {
        if (d.removed) return;
        visit(d);
        out.push(d);
        indegree.set(d, indegree.get(d)! + 1);
      }, true);
      if (out.length) edges.set(r, out);
    }

    const ready = queue.filter((r) => indegree.get(r) === 0);
    const ctx = this.ctx;
    this.rangeCache = new Map();
    try {
      while (ready.length) {
        const r = ready.pop()!;
        indegree.set(r, -1);
        // Named expressions are evaluated where they are used; their vertex only orders the graph.
        if (r.key >= 0) {
          ctx.sheet = sheetOf(r.key);
          ctx.row = rowOf(r.key);
          ctx.col = colOf(r.key);
          this.assign(r, evaluate(r.ast!, ctx));
        }
        for (const d of edges.get(r) ?? []) {
          const n = indegree.get(d)! - 1;
          indegree.set(d, n);
          if (n === 0) ready.push(d);
        }
      }
    } finally {
      this.rangeCache = null;
    }
    for (const r of queue) {
      if (indegree.get(r) === -1) continue;
      // Readers of the spilled cells are downstream of the cycle too, so the emptied cells need no new pass.
      if (r.spillArea) this.unspill(r, false);
      r.value = err('#CYCLE!');
    }
  }

  private finalize(v: Value): CellValue {
    if (v instanceof RangeValue && (v.height === 0 || v.width === 0)) return err('#CALC!', 'The result is an empty array');
    const scalar = toScalar(v);
    // A formula pointing at an empty cell shows 0, as in spreadsheets.
    return scalar === null ? 0 : scalar;
  }

  // ---------- spills ----------

  /** Stores a formula result; a multi-cell array spills into the cells right of and below the formula. */
  private assign(r: CellRecord, v: Value): void {
    if (v instanceof RangeValue && v.height > 0 && v.width > 0 && (v.height > 1 || v.width > 1)) {
      this.spill(r, v);
      return;
    }
    if (r.spillArea) this.unspill(r);
    r.value = this.finalize(v);
  }

  private spill(r: CellRecord, v: RangeValue): void {
    const sheet = sheetOf(r.key);
    const row = rowOf(r.key);
    const col = colOf(r.key);
    const area: Area = { r0: row, c0: col, r1: row + v.height - 1, c1: col + v.width - 1 };
    r.spillArea = area;
    this.anchors.add(r);
    const cells = this.sheetData[sheet]!;
    if (area.r1 >= MAX_ROWS || area.c1 >= MAX_COLS || this.isBlocked(r, area, cells)) {
      this.touchAnchors(this.clearSpill(r), r);
      r.value = err('#SPILL!', 'The spill range is not empty');
      return;
    }
    const previous = new Set(r.spillCells);
    const owned: CellRecord[] = [];
    const touched: number[] = [];
    for (let i = 0; i < v.height; i++) {
      for (let j = 0; j < v.width; j++) {
        if (i === 0 && j === 0) continue;
        const key = cellKey(row + i, col + j, sheet);
        let c = cells.get(key);
        if (!c) cells.set(key, (c = { key, raw: null, value: null }));
        const value = this.finalize(v.values[i][j]);
        if (c.spillOwner === r) {
          previous.delete(c);
          if (sameValue(c.value, value)) {
            owned.push(c);
            continue;
          }
        } else {
          c.spillOwner = r;
          touched.push(key);
          this.spillSeeds.add(key);
        }
        this.noteBefore(c);
        c.value = value;
        owned.push(c);
      }
    }
    for (const c of previous) {
      if (c.spillOwner !== r || c.removed) continue;
      this.vacate(c);
      touched.push(c.key);
    }
    r.spillCells = owned;
    this.touchAnchors(touched, r);
    // Ranges read earlier in this pass may include cells whose value just changed.
    this.rangeCache = new Map();
    r.value = this.finalize(v.values[0][0]);
  }

  /** Content (or another spill) in the block, other than the anchor itself, blocks the spill. */
  private isBlocked(r: CellRecord, a: Area, cells: Map<number, CellRecord>): boolean {
    const sheet = sheetOf(r.key);
    for (let row = a.r0; row <= a.r1; row++) {
      for (let col = a.c0; col <= a.c1; col++) {
        const c = cells.get(cellKey(row, col, sheet));
        if (c && c !== r && (c.raw !== null || (c.spillOwner && c.spillOwner !== r))) return true;
      }
    }
    return false;
  }

  /** The formula no longer spills (scalar result, cycle): empties its block. */
  private unspill(r: CellRecord, notify = true): void {
    const vacated = this.clearSpill(r);
    if (notify) this.touchAnchors(vacated, r);
    this.anchors.delete(r);
    r.spillArea = undefined;
  }

  /** Outside a recalculation (the anchor was overwritten or removed): returns the emptied keys. */
  private dropSpill(r: CellRecord): number[] {
    const vacated = this.clearSpill(r);
    this.anchors.delete(r);
    r.spillArea = undefined;
    return vacated;
  }

  /** Empties the cells `r` spills into; returns their keys. */
  private clearSpill(r: CellRecord): number[] {
    const keys: number[] = [];
    for (const c of r.spillCells ?? []) {
      if (c.spillOwner !== r || c.removed) continue;
      this.vacate(c);
      keys.push(c.key);
    }
    r.spillCells = undefined;
    return keys;
  }

  private vacate(c: CellRecord): void {
    this.noteBefore(c);
    c.spillOwner = undefined;
    c.value = null;
    this.collectPlaceholder(c);
  }

  private noteBefore(c: CellRecord): void {
    if (this.trace && !this.trace.has(c)) this.trace.set(c, c.value);
  }

  /** Other array formulas whose block contains a cell that just filled or emptied re-evaluate. */
  private touchAnchors(keys: number[], except: CellRecord): void {
    if (this.anchors.size < 2 || keys.length === 0) return;
    for (const k of keys) {
      this.forEachAnchorCovering(k, (a) => {
        if (a !== except) this.spillDirty.add(a);
      });
    }
  }

  private forEachAnchorCovering(key: number, fn: (anchor: CellRecord) => void): void {
    const sheet = sheetOf(key);
    const row = rowOf(key);
    const col = colOf(key);
    for (const a of this.anchors) {
      const s = a.spillArea!;
      if (a.key !== key && sheetOf(a.key) === sheet && row >= s.r0 && row <= s.r1 && col >= s.c0 && col <= s.c1) fn(a);
    }
  }

  /** Readers of the cells an array formula spills into: direct references and overlapping ranges. */
  private forEachSpillDependent(anchor: CellRecord, fn: (d: CellRecord) => void): void {
    let r0 = Infinity;
    let c0 = Infinity;
    let r1 = -1;
    let c1 = -1;
    for (const c of anchor.spillCells!) {
      if (c.spillOwner !== anchor || c.removed) continue;
      c.dependents?.forEach(fn);
      const row = rowOf(c.key);
      const col = colOf(c.key);
      if (row < r0) r0 = row;
      if (row > r1) r1 = row;
      if (col < c0) c0 = col;
      if (col > c1) c1 = col;
    }
    const index = this.rangeIndex[sheetOf(anchor.key)];
    if (r1 < 0 || !index?.size) return;
    for (const e of index.values()) {
      if (e.r0 <= r1 && e.r1 >= r0 && e.c0 <= c1 && e.c1 >= c0) e.dependents.forEach(fn);
    }
  }

  // ---------- structural changes ----------

  private restructure(ch: StructuralChange): ChangedCell[] {
    this.requireSheet(ch.sheet);
    if (ch.count <= 0) return [];
    return this.remap(new ShiftMap(ch));
  }

  private move(axis: 'row' | 'col', start: number, count: number, target: number, sheet: number): ChangedCell[] {
    this.requireSheet(sheet);
    const limit = axis === 'row' ? MAX_ROWS : MAX_COLS;
    if (![start, count, target].every(Number.isInteger) || start < 0 || count < 0 || target < 0 || start + count > limit || target > limit) {
      throw new RangeError(`Invalid move of ${count} ${axis === 'row' ? 'rows' : 'columns'} from ${start} to ${target}`);
    }
    if (count === 0 || (target >= start && target <= start + count)) return [];
    return this.remap(new MoveMap(sheet, axis, start, count, target));
  }

  /**
   * Inserts, removes or moves rows/columns incrementally: references are rewritten in place (only
   * formulas whose targets moved get their text regenerated, lazily), records are re-keyed without
   * touching the graph, and only formulas whose meaning changed (#REF!, a range now covers other
   * cells, ROW/COLUMN moved) are relinked or recalculated together with their dependents.
   * Array formulas on the sheet re-evaluate, so their spills are laid out afresh.
   */
  private remap(map: AxisMap): ChangedCell[] {
    const cells = this.requireSheet(map.sheet);
    const isRow = map.axis === 'row';
    return this.batch(() => {
      const adjuster = new AstAdjuster(map);
      const relink: CellRecord[] = [];
      const adjust = (rec: CellRecord, homeSheet: number, before: number, after: number): void => {
        rec.ast = adjuster.adjust(rec.ast!, homeSheet, before, after);
        if (adjuster.text) rec.textDirty = true;
        if (adjuster.meaning) relink.push(rec);
        else if (rec.positional && (adjuster.text || before !== after)) this.dirty.add(rec);
      };

      // Other sheets: only formulas with sheet-qualified references can point at the changed sheet.
      this.sheetData.forEach((sheetCells, s) => {
        if (!sheetCells || s === map.sheet) return;
        for (const rec of sheetCells.values()) {
          if (rec.ast && rec.crossSheet) adjust(rec, s, isRow ? rowOf(rec.key) : colOf(rec.key), isRow ? rowOf(rec.key) : colOf(rec.key));
        }
      });
      for (const rec of this.names.values()) if (rec.ast) adjust(rec, -1, 0, 0);

      // The changed sheet: adjust and re-key in one pass. Records keep their identity, so graph
      // edges between them stay valid without any relinking.
      const moved = new Map<number, CellRecord>();
      const dropped: CellRecord[] = [];
      const sheetBase = map.sheet * SHEET_SPAN;
      cells.forEach((rec, key) => {
        const local = key - sheetBase;
        const row = Math.floor(local / MAX_COLS);
        const col = local - row * MAX_COLS;
        const before = isRow ? row : col;
        const after = map.index(before);
        if (after === REMOVED) {
          rec.removed = true;
          dropped.push(rec);
          return;
        }
        if (rec.ast) adjust(rec, map.sheet, before, after);
        if (after !== before) rec.key = isRow ? key + (after - before) * MAX_COLS : key + (after - before);
        moved.set(rec.key, rec);
      });
      this.sheetData[map.sheet] = moved;
      const vacated: number[] = [];
      for (const rec of dropped) {
        this.unlink(rec);
        this.unresolved.delete(rec);
        if (rec.spillArea) vacated.push(...this.dropSpill(rec));
      }
      // Spilled cells moved with the data; the array formulas lay their blocks out again.
      for (const a of this.anchors) if (sheetOf(a.key) === map.sheet) this.dirty.add(a);

      // Shared ranges that merely shifted keep their users; reshaped or removed ones are dropped
      // and their users (all in `relink`) attach to fresh entries.
      const index = this.rangeIndex[map.sheet];
      if (index) {
        const next = new Map<string, RangeEntry>();
        for (const e of index.values()) {
          const [lo, hi] = isRow ? [e.r0, e.r1] : [e.c0, e.c1];
          const span = map.span(lo, hi);
          if (!span || spanReshaped(map, lo, hi, span)) continue;
          if (isRow) [e.r0, e.r1] = span;
          else [e.c0, e.c1] = span;
          e.id = rangeId(e.r0, e.c0, e.r1, e.c1);
          next.set(e.id, e);
        }
        this.rangeIndex[map.sheet] = next;
      }

      for (const rec of relink) {
        if (rec.removed) continue;
        this.unlink(rec);
        this.link(rec);
        this.dirty.add(rec);
      }

      // Cells written earlier in an enclosing batch move with the data.
      if (this.pendingKeys.size) {
        const keys = this.pendingKeys;
        this.pendingKeys = new Set();
        for (const k of keys) {
          if (sheetOf(k) !== map.sheet) {
            this.pendingKeys.add(k);
            continue;
          }
          const row = rowOf(k);
          const col = colOf(k);
          const n = map.index(isRow ? row : col);
          if (n !== REMOVED) this.pendingKeys.add(isRow ? cellKey(n, col, map.sheet) : cellKey(row, n, map.sheet));
        }
      }
      // Already in post-change coordinates.
      vacated.forEach((k) => this.pendingKeys.add(k));
    });
  }
}

const stripEquals = (formula: string): string => (formula.startsWith('=') ? formula.slice(1) : formula);
const absRow = (r: RefNode, baseRow: number): number => (r.rowAbs ? r.row : r.row + baseRow);
const absCol = (r: RefNode, baseCol: number): number => (r.colAbs ? r.col : r.col + baseCol);
const minMax = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);

/** Public addresses omit `sheet` for sheet 0, matching how callers address that sheet. */
function publicAddress(sheet: number, row: number, col: number): CellAddress {
  return sheet === 0 ? { row, col } : { row, col, sheet };
}

function referencesSheet(ast: Ast, sheet: number): boolean {
  let found = false;
  visitRefs(ast, (n) => {
    if ((n.type === 'ref' && n.sheet === sheet) || (n.type === 'range' && n.start.sheet === sheet)) found = true;
  });
  return found;
}

function sameValue(a: CellValue, b: CellValue): boolean {
  if (a instanceof Object && b instanceof Object) return a.code === b.code;
  return a === b;
}
