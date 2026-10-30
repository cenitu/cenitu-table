import { compare } from '../formula/coerce';
import { CellError, parseNumber, type CellValue } from '../formula/values';

export type ConditionOp =
  | 'contains'
  | 'notContains'
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'greaterOrEqual'
  | 'lessThan'
  | 'lessOrEqual'
  | 'isEmpty'
  | 'isNotEmpty';

export interface ColumnFilter {
  condition?: { op: ConditionOp; value?: string };
  /** Allowed display texts; "" stands for blank cells. */
  values?: string[];
}

export type SortOrder = 'asc' | 'desc';

export function matchesFilter(value: CellValue, text: string, filter: ColumnFilter): boolean {
  if (filter.values && !filter.values.includes(text)) return false;
  const c = filter.condition;
  if (!c) return true;
  const empty = value === null || text === '';
  switch (c.op) {
    case 'isEmpty':
      return empty;
    case 'isNotEmpty':
      return !empty;
  }
  const needle = (c.value ?? '').toLowerCase();
  const hay = text.toLowerCase();
  switch (c.op) {
    case 'contains':
      return hay.includes(needle);
    case 'notContains':
      return !hay.includes(needle);
  }
  const operand = parseNumber((c.value ?? '').replace(',', '.'));
  const cmp =
    typeof value === 'number' && operand !== undefined
      ? Math.sign(value - operand)
      : compare(hay, needle);
  switch (c.op) {
    case 'equals':
      return cmp === 0;
    case 'notEquals':
      return cmp !== 0;
    case 'greaterThan':
      return !empty && cmp > 0;
    case 'greaterOrEqual':
      return !empty && cmp >= 0;
    case 'lessThan':
      return !empty && cmp < 0;
    default:
      return !empty && cmp <= 0;
  }
}

const rank = (v: CellValue): number =>
  typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : v instanceof CellError ? 3 : 4;

/** Spreadsheet sort order: numbers, text, booleans, errors; blanks always last. */
export function compareForSort(a: CellValue, b: CellValue, order: SortOrder): number {
  const blankA = a === null || a === '';
  const blankB = b === null || b === '';
  if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1;
  const ra = rank(a);
  const rb = rank(b);
  let d: number;
  if (ra !== rb) d = ra - rb;
  else if (ra === 3) d = 0;
  else if (ra === 1) d = (a as string).localeCompare(b as string, undefined, { sensitivity: 'base', numeric: true });
  else d = compare(a, b);
  return order === 'asc' ? d : -d;
}
