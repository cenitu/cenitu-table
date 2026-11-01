import { dateToSerial } from '../formula/dates';
import type { RawCell } from '../formula/values';

export type DataRow = Record<string, unknown>;

/** True for a non-empty array of plain objects (as opposed to an array of row arrays). */
export const isObjectData = (data: readonly unknown[]): data is DataRow[] =>
  data.length > 0 && data.every((r) => r !== null && typeof r === 'object' && !Array.isArray(r));

function getPath(obj: DataRow, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as DataRow)[part];
  }
  return cur;
}

function setPath(obj: DataRow, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    if (cur[part] === null || typeof cur[part] !== 'object') cur[part] = {};
    cur = cur[part] as DataRow;
  }
  cur[parts[parts.length - 1]] = value;
}

/** Converts an arbitrary property value to something a cell can hold. */
function toRaw(v: unknown): RawCell {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (v instanceof Date) return dateToSerial(v.getFullYear(), v.getMonth() + 1, v.getDate());
  return String(v);
}

/**
 * Binds grid columns to properties of row objects. The grid keeps working on a 2D raw array;
 * this class converts the objects once and writes edits back into the same objects, so the
 * caller's array stays the source of truth.
 */
export class ObjectBinding {
  constructor(
    public objects: DataRow[],
    public fields: (string | undefined)[],
    private readonly schema?: () => DataRow,
  ) {}

  /** Fields come from `columns[i].data`; without any, from the first object's keys. */
  static create(objects: DataRow[], columnFields: (string | undefined)[], schema?: () => DataRow): ObjectBinding {
    const fields = columnFields.some((f) => f !== undefined) ? [...columnFields] : Object.keys(objects[0] ?? schema?.() ?? {});
    return new ObjectBinding(objects, fields, schema);
  }

  toRows(): RawCell[][] {
    return this.objects.map((o) => this.fields.map((f) => (f === undefined ? null : toRaw(getPath(o, f)))));
  }

  /** Adds rows in a new array, leaving the caller's alone, and gives them as raw rows. */
  append(rows: DataRow[]): RawCell[][] {
    this.objects = [...this.objects, ...rows];
    return new ObjectBinding(rows, this.fields).toRows();
  }

  write(row: number, col: number, value: RawCell): void {
    const field = this.fields[col];
    if (field === undefined) return;
    while (this.objects.length <= row) this.objects.push(this.newRow());
    setPath(this.objects[row], field, value);
  }

  insertRows(at: number, count: number): void {
    this.objects.splice(at, 0, ...Array.from({ length: count }, () => this.newRow()));
  }

  removeRows(at: number, count: number): void {
    this.objects.splice(at, count);
  }

  ensureRows(count: number): void {
    while (this.objects.length < count) this.objects.push(this.newRow());
  }

  /** Inserted columns are unbound (their edits are not written back). */
  insertCols(at: number, count: number): void {
    if (at <= this.fields.length) this.fields.splice(at, 0, ...Array<undefined>(count));
  }

  removeCols(at: number, count: number): void {
    this.fields.splice(at, count);
  }

  snapshot(): { objects: DataRow[]; fields: (string | undefined)[] } {
    return { objects: [...this.objects], fields: [...this.fields] };
  }

  /** Restores row identity and order; the objects keep their current property values. */
  restore(s: { objects: DataRow[]; fields: (string | undefined)[] }): void {
    this.objects.splice(0, this.objects.length, ...s.objects);
    this.fields = [...s.fields];
  }

  private newRow(): DataRow {
    return this.schema ? this.schema() : {};
  }
}
