import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties } from 'react';
import type { RawCell } from '../formula/values';
import type { ColumnFilter, SortOrder } from '../grid/filters';
import { CenituGrid, type CellChange, type ChangeSource, type GridOptions } from '../grid/grid';

export interface CenituTableProps extends GridOptions {
  className?: string;
  style?: CSSProperties;
  onChange?(changes: CellChange[], source: ChangeSource): void;
  onSelection?(row: number, col: number, row2: number, col2: number): void;
  onSort?(col: number, order: SortOrder | null): void;
  onFilter?(filters: Map<number, ColumnFilter>): void;
}

/** Options that `updateSettings` can apply without recreating the grid. */
const LIVE_SETTINGS = [
  'fixedRowsTop', 'fixedColumnsStart', 'readOnly', 'columns', 'colHeaders', 'mergeCells',
  'columnSorting', 'filters', 'fillHandle', 'locale', 'language',
] as const;

/**
 * React component around CenituGrid. The ref exposes the grid instance for imperative calls.
 * `data` seeds the grid; passing a new array that differs from the grid's content reloads it,
 * so feeding `onChange` results back into state does not reset selection or undo history.
 */
export const CenituTable = forwardRef<CenituGrid, CenituTableProps>(function CenituTable(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const grid = useRef<CenituGrid | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useLayoutEffect(() => {
    // Remaining props are grid options; callbacks are read through `latest` so they may change freely.
    const { className: _c, style: _s, onChange: _o, onSelection: _se, onSort: _so, onFilter: _f, ...options } = latest.current;
    const g = new CenituGrid(host.current!, options);
    g.addHook('afterChange', (changes, source) => latest.current.onChange?.(changes, source));
    g.addHook('afterSelection', (r, c, r2, c2) => latest.current.onSelection?.(r, c, r2, c2));
    g.addHook('afterColumnSort', (col, order) => latest.current.onSort?.(col, order));
    g.addHook('afterFilter', (filters) => latest.current.onFilter?.(filters));
    grid.current = g;
    return () => {
      g.destroy();
      grid.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => grid.current!, []);

  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) return;
    const g = grid.current;
    if (g && props.data && !sameData(g.getSourceData(), props.data)) g.loadData(props.data);
  }, [props.data]);

  const live = LIVE_SETTINGS.map((k) => props[k]);
  useEffect(() => {
    if (!mounted.current) return;
    const settings: Record<string, unknown> = {};
    LIVE_SETTINGS.forEach((k) => props[k] !== undefined && (settings[k] = props[k]));
    grid.current?.updateSettings(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, live);

  useEffect(() => {
    mounted.current = true;
  }, []);

  return <div ref={host} className={props.className} style={props.style} />;
});

/** Cell-by-cell comparison; missing cells count as empty. */
function sameData(a: RawCell[][], b: RawCell[][]): boolean {
  const rows = Math.max(a.length, b.length);
  for (let r = 0; r < rows; r++) {
    const x = a[r] ?? [];
    const y = b[r] ?? [];
    const cols = Math.max(x.length, y.length);
    for (let c = 0; c < cols; c++) if ((x[c] ?? null) !== (y[c] ?? null)) return false;
  }
  return true;
}

export { CenituGrid };
export type { CellChange, ChangeSource, GridOptions };
