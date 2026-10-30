import { cellKey, keyToAddress, MAX_COLS, parseA1, SHEET_SPAN, type CellAddress, type CellRange } from './address';
import { unparse, visitRefs, type Ast, type RefNode } from './ast';
import { toScalar } from './coerce';
import { getFunction } from './functions';
import { evaluate, readRange, type EvaluationContext } from './interpreter';
import { FormulaSyntaxError } from './lexer';
import { parseFormula } from './parser';
import { AstAdjuster, dropSheetRefs, moveIndex, moveSpan, REMOVED, touchesRemoval, type StructuralChange } from './restructure';
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

  getSheetDimensions(sheet = 0): { width: number; height: number } {
    let width = 0;
    let height = 0;
    for (const rec of this.sheetData[sheet]?.values() ?? []) {
      if (rec.raw === null) continue;
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
    if (rec) {
      this.unlink(rec);
      this.unresolved.delete(rec);
      rec.ast = undefined;
      rec.textDirty = rec.crossSheet = rec.unresolved = false;
    }

    if (raw === null || raw === undefined || raw === '') {
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
  }

  /** Drops an empty cell / undefined name once nothing refers to it any more. */
  private collectPlaceholder(p: CellRecord): void {
    if (p.raw !== null || p.removed || p.dependents?.size) return;
    if (p.key < 0) {
      const upper = p.name!.toUpperCase();
      if (this.names.get(upper) === p) this.names.delete(upper);
    } else {
      const cells = this.sheetData[sheetOf(p.key)];
      if (cells?.get(p.key) === p) cells.delete(p.key);
    }
    p.removed = true;
  }

  private forEachDependent(rec: CellRecord | undefined, key: number, fn: (d: CellRecord) => void): void {
    rec?.dependents?.forEach(fn);
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
   * Collects every formula reachable from the changed cells, orders them topologically
   * (Kahn's algorithm) and evaluates them once. Cells left over are part of, or depend on, a cycle.
   */
  private recalculate(keys: Set<number>, dirty: Set<CellRecord>): ChangedCell[] {
    const indegree = new Map<CellRecord, number>();
    const queue: CellRecord[] = [];
    const visit = (r: CellRecord): void => {
      if (r.removed || indegree.has(r)) return;
      indegree.set(r, 0);
      queue.push(r);
    };
    const seed = (rec: CellRecord | undefined, key: number): void => {
      if (rec?.ast) visit(rec);
      else this.forEachDependent(rec, key, visit);
    };
    for (const k of keys) seed(this.recordAt(k), k);
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
      });
      if (out.length) edges.set(r, out);
    }

    const before = queue.map((r) => r.value);
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
          r.value = this.finalize(evaluate(r.ast!, ctx));
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
    for (const r of queue) if (indegree.get(r) !== -1) r.value = err('#CYCLE!');

    const changes: ChangedCell[] = [];
    for (const k of keys) {
      if (this.sheetData[sheetOf(k)]) changes.push({ address: keyToAddress(k), value: this.recordAt(k)?.value ?? null });
    }
    queue.forEach((r, i) => {
      if (r.key < 0 || keys.has(r.key) || sameValue(before[i], r.value)) return;
      changes.push({ address: keyToAddress(r.key), value: r.value });
    });
    return changes;
  }

  private finalize(v: Value): CellValue {
    const scalar = toScalar(v);
    // A formula pointing at an empty cell shows 0, as in spreadsheets.
    return scalar === null ? 0 : scalar;
  }

  /**
   * Inserts or removes rows/columns incrementally: references are rewritten in place (only formulas
   * whose targets moved get their text regenerated, lazily), records are re-keyed without touching
   * the graph, and only formulas whose meaning changed (#REF!, a range grew or shrank) are relinked
   * and recalculated together with their dependents.
   */
  private restructure(ch: StructuralChange): ChangedCell[] {
    const cells = this.requireSheet(ch.sheet);
    if (ch.count <= 0) return [];
    const isRow = ch.axis === 'row';
    return this.batch(() => {
      const adjuster = new AstAdjuster(ch);
      const relink: CellRecord[] = [];
      const adjust = (rec: CellRecord, homeSheet: number, before: number, after: number): void => {
        rec.ast = adjuster.adjust(rec.ast!, homeSheet, before, after);
        if (adjuster.text) rec.textDirty = true;
        if (adjuster.meaning) relink.push(rec);
      };

      // Other sheets: only formulas with sheet-qualified references can point at the changed sheet.
      this.sheetData.forEach((sheetCells, s) => {
        if (!sheetCells || s === ch.sheet) return;
        for (const rec of sheetCells.values()) {
          if (rec.ast && rec.crossSheet) adjust(rec, s, isRow ? rowOf(rec.key) : colOf(rec.key), isRow ? rowOf(rec.key) : colOf(rec.key));
        }
      });
      for (const rec of this.names.values()) if (rec.ast) adjust(rec, -1, 0, 0);

      // The changed sheet: adjust and re-key in one pass. Records keep their identity, so graph
      // edges between them stay valid without any relinking.
      const moved = new Map<number, CellRecord>();
      const dropped: CellRecord[] = [];
      const sheetBase = ch.sheet * SHEET_SPAN;
      cells.forEach((rec, key) => {
        const local = key - sheetBase;
        const row = Math.floor(local / MAX_COLS);
        const col = local - row * MAX_COLS;
        const before = isRow ? row : col;
        const after = moveIndex(ch, before);
        if (after === REMOVED) {
          rec.removed = true;
          dropped.push(rec);
          return;
        }
        if (rec.ast) adjust(rec, ch.sheet, before, after);
        if (after !== before) rec.key = isRow ? key + (after - before) * MAX_COLS : key + (after - before);
        moved.set(rec.key, rec);
      });
      this.sheetData[ch.sheet] = moved;
      for (const rec of dropped) {
        this.unlink(rec);
        this.unresolved.delete(rec);
      }
      // Shared ranges that merely shifted keep their users; resized or removed ones are dropped
      // and their users (all in `relink`) attach to fresh entries.
      const index = this.rangeIndex[ch.sheet];
      if (index) {
        const next = new Map<string, RangeEntry>();
        for (const e of index.values()) {
          const [lo, hi] = isRow ? [e.r0, e.r1] : [e.c0, e.c1];
          const span = moveSpan(ch, lo, hi);
          if (!span || span[1] - span[0] !== hi - lo) continue;
          if (isRow) [e.r0, e.r1] = span;
          else [e.c0, e.c1] = span;
          e.id = rangeId(e.r0, e.c0, e.r1, e.c1);
          next.set(e.id, e);
        }
        this.rangeIndex[ch.sheet] = next;
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
          if (sheetOf(k) !== ch.sheet) {
            this.pendingKeys.add(k);
            continue;
          }
          const row = rowOf(k);
          const col = colOf(k);
          const n = moveIndex(ch, isRow ? row : col);
          if (n !== REMOVED) this.pendingKeys.add(isRow ? cellKey(n, col, ch.sheet) : cellKey(row, n, ch.sheet));
        }
      }
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
