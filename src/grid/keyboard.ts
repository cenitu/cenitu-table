import type { CellAddress } from '../formula/address';
import type { CellMeta } from './cellTypes';
import type { CenituGrid } from './grid';
import { ARROWS } from './gridUtil';

/** What keys need beyond the public API. */
export interface KeyActions {
  anchor: CellAddress;
  selEnd: CellAddress;
  meta: CellMeta;
  contextMenu: boolean;
  search: boolean;
  /** Rows that fit on a page. */
  pageRows: number;
  moveActive(dr: number, dc: number, extend: boolean): void;
  jump(dr: number, dc: number, extend: boolean): void;
  toggleCheckboxes(): void;
  clear(): void;
}

/** Keyboard use of an idle grid: everything except typing, which goes to the editor. */
export function handleGridKey(g: CenituGrid, a: KeyActions, e: KeyboardEvent): void {
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key;
  const { anchor, selEnd, meta } = a;
  const stop = () => e.preventDefault();

  if (key === 'ContextMenu' || (e.shiftKey && key === 'F10')) {
    if (a.contextMenu) {
      stop();
      g.openContextMenu();
    }
    return;
  }
  if (key in ARROWS) {
    stop();
    const [dr, dc] = ARROWS[key];
    if (e.altKey && key === 'ArrowDown' && meta.type === 'dropdown') return g.openEditor();
    if (ctrl) a.jump(dr, dc, e.shiftKey);
    else a.moveActive(dr, dc, e.shiftKey);
    return;
  }
  if (key === ' ' && ctrl) {
    stop();
    return g.selectCell(0, anchor.col, g.countRows() - 1, selEnd.col);
  }
  if (key === ' ' && e.shiftKey) {
    stop();
    return g.selectCell(anchor.row, 0, selEnd.row, g.countCols() - 1);
  }
  if (ctrl) {
    const k = key.toLowerCase();
    if ((k === 'f' || k === 'h') && a.search) {
      stop();
      g.openSearch(k === 'h');
    } else if (k === 'b' || k === 'i' || k === 'u') {
      stop();
      g.toggleCellStyle(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline');
    } else if (k === 'a') {
      stop();
      g.selectCell(0, 0, g.countRows() - 1, g.countCols() - 1);
    } else if (k === 'z') {
      stop();
      if (e.shiftKey) g.redo();
      else g.undo();
    } else if (k === 'y') {
      stop();
      g.redo();
    } else if (k === 'd') {
      // Fill down from the first row of the selection.
      stop();
      const r = g.getSelectedRange()!;
      if (r.end.row > r.start.row) {
        g.autofill(
          { start: r.start, end: { row: r.start.row, col: r.end.col } },
          { start: { row: r.start.row + 1, col: r.start.col }, end: r.end },
        );
      }
    } else if (key === 'Home') {
      stop();
      g.selectCell(0, 0);
    } else if (key === 'End') {
      stop();
      g.selectCell(g.countRows() - 1, g.countCols() - 1);
    }
    return;
  }
  switch (key) {
    case 'Tab':
      stop();
      a.moveActive(0, e.shiftKey ? -1 : 1, false);
      return;
    case 'Enter':
    case 'F2':
      stop();
      if (meta.type === 'checkbox') a.toggleCheckboxes();
      else g.openEditor();
      return;
    case ' ':
      if (meta.type === 'checkbox') {
        stop();
        a.toggleCheckboxes();
      }
      return;
    case 'Delete':
    case 'Backspace':
      stop();
      a.clear();
      return;
    case 'Home':
      stop();
      a.moveActive(0, -selEnd.col, e.shiftKey);
      return;
    case 'End':
      stop();
      a.moveActive(0, g.countCols(), e.shiftKey);
      return;
    case 'PageDown':
    case 'PageUp':
      stop();
      a.moveActive(key === 'PageDown' ? a.pageRows : -a.pageRows, 0, e.shiftKey);
      return;
  }
}
