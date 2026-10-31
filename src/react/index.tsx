import { createRoot, type Root } from 'react-dom/client';
import { createElement, forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, type ComponentType, type CSSProperties } from 'react';
import type { RawCell } from '../formula/values';
import type { CellEditor, CellEditorContext, CellRenderContext, CellRenderer } from '../grid/cellTypes';
import type { CellValue } from '../formula/values';
import { isObjectData, ObjectBinding, type DataRow } from '../grid/binding';
import type { ColumnFilter, SortOrder } from '../grid/filters';
import { CenituGrid, type CellChange, type ChangeSource, type ColumnLayout, type GridOptions, type RowEvent } from '../grid/grid';
import type { QueryChangeReason, ServerQuery } from '../grid/serverMode';

export interface CenituTableProps extends GridOptions {
  className?: string;
  style?: CSSProperties;
  onChange?(changes: CellChange[], source: ChangeSource): void;
  onSelection?(row: number, col: number, row2: number, col2: number): void;
  onSort?(col: number, order: SortOrder | null): void;
  onFilter?(filters: Map<number, ColumnFilter>): void;
  onRowClick?(event: RowEvent): void;
  /** Return false to keep the cell editor closed. */
  onRowDoubleClick?(event: RowEvent): boolean | void;
  onColumnLayoutChange?(layout: ColumnLayout): void;
  /** Server mode: fetch the rows for `query`. */
  onQueryChange?(query: ServerQuery, reason: QueryChangeReason): void;
}

/** Options that `updateSettings` can apply without recreating the grid. */
const LIVE_SETTINGS = [
  'fixedRowsTop', 'fixedColumnsStart', 'readOnly', 'columns', 'colHeaders', 'mergeCells',
  'columnSorting', 'filters', 'fillHandle', 'locale', 'language', 'contextMenu', 'search',
  'query', 'totalCount', 'loading', 'loadError', 'theme',
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
    const { className: _c, style: _s, onChange: _o, onSelection: _se, onSort: _so, onFilter: _f, onQueryChange: _q, onRowClick: _rc, onRowDoubleClick: _rd, onColumnLayoutChange: _cl, ...options } = latest.current;
    const g = new CenituGrid(host.current!, options);
    g.addHook('afterChange', (changes, source) => latest.current.onChange?.(changes, source));
    g.addHook('afterSelection', (r, c, r2, c2) => latest.current.onSelection?.(r, c, r2, c2));
    g.addHook('afterColumnSort', (col, order) => latest.current.onSort?.(col, order));
    g.addHook('afterFilter', (filters) => latest.current.onFilter?.(filters));
    g.addHook('afterQueryChange', (query, reason) => latest.current.onQueryChange?.(query, reason));
    g.addHook('afterRowClick', (e) => latest.current.onRowClick?.(e));
    g.addHook('afterRowDoubleClick', (e) => latest.current.onRowDoubleClick?.(e));
    g.addHook('afterColumnLayout', (layout) => latest.current.onColumnLayoutChange?.(layout));
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
    if (!g || !props.data) return;
    // Server pages always load: equal rows may still be a new page, and setPageRows keeps the view.
    if (props.dataMode === 'server') g.setPageRows(props.data, props.totalCount);
    else if (!sameContent(g, props.data)) g.loadData(props.data);
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

/** Whether `data` already matches the grid, so feeding edits back as props does not reload it. */
function sameContent(g: CenituGrid, data: RawCell[][] | DataRow[]): boolean {
  if (!isObjectData(data)) return sameData(g.getSourceData(), data as RawCell[][]);
  if (g.getSourceObjects() === data) return true;
  const fields = Array.from({ length: g.countCols() }, (_, c) => g.colToProp(c));
  return sameData(g.getBoundRows(), ObjectBinding.create(data, fields).toRows());
}

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

/** Props of a React cell editor: everything `CellEditorContext` has except the host element. */
export type ReactEditorProps = Omit<CellEditorContext, 'el'>;

/** Wraps a React component as a cell editor; it mounts on open and unmounts on close. */
export function reactEditor(Component: ComponentType<ReactEditorProps>): CellEditor {
  return ({ el, ...props }) => {
    const root = createRoot(el);
    root.render(createElement(Component, props));
    // React refuses to unmount a root during its own render, which a commit from an effect could be.
    return { destroy: () => void Promise.resolve().then(() => root.unmount()) };
  };
}

export interface ReactCellProps {
  value: CellValue;
  context: CellRenderContext;
}

/**
 * Wraps a React component as a cell renderer. Scrolling recycles cell elements, so each one keeps
 * a root that re-renders with new props and unmounts when its cell goes away.
 */
export function reactRenderer(Component: ComponentType<ReactCellProps>): CellRenderer {
  const roots = new WeakMap<HTMLElement, { root: Root; host: HTMLElement }>();
  const renderer: CellRenderer = (el, value, context) => {
    let entry = roots.get(el);
    if (!entry) {
      const host = el.ownerDocument.createElement('div');
      host.style.width = '100%';
      el.append(host);
      roots.set(el, (entry = { root: createRoot(host), host }));
    }
    entry.root.render(createElement(Component, { value, context }));
    return () => {
      const current = roots.get(el);
      if (!current) return;
      roots.delete(el);
      current.host.remove();
      void Promise.resolve().then(() => current.root.unmount());
    };
  };
  renderer.ownsContent = true;
  return renderer;
}

export { CenituGrid };
export type { CellChange, ChangeSource, GridOptions };
