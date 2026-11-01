import type { CellRange } from '../formula/address';
import type { MenuEntry } from './contextMenu';
import type { CenituGrid } from './grid';
import type { Messages } from './messages';

/** What the default entries need beyond the public API. */
export interface MenuContext {
  messages: Messages;
  readOnly: boolean;
  server: boolean;
  /** Always locally, through `rowActions` in server mode. */
  canInsertRows: boolean;
  canRemoveRows: boolean;
  canPaste: boolean;
  canMerge: boolean;
  merged: boolean;
  cut(): void;
  copy(): void;
  paste(): void;
  clear(): void;
}

export function defaultMenuEntries(g: CenituGrid, r: CellRange, x: MenuContext): MenuEntry[] {
  const m = x.messages;
  const ro = x.readOnly;
  const rows = r.end.row - r.start.row + 1;
  const cols = r.end.col - r.start.col + 1;
  const rowEntries: (MenuEntry & object)[] = [
    ...(x.canInsertRows ? [
      { key: 'row_above', name: m.insertRowAbove, disabled: ro, run: () => g.alter('insert_row_above', r.start.row, rows) },
      { key: 'row_below', name: m.insertRowBelow, disabled: ro, run: () => g.alter('insert_row_below', r.end.row, rows) },
    ] : []),
    ...(x.canRemoveRows ? [{ key: 'remove_row', name: rows > 1 ? m.removeRows : m.removeRow, disabled: ro, run: () => g.alter('remove_row', r.start.row, rows) }] : []),
  ];
  return [
    { key: 'cut', name: m.cut, hint: 'Ctrl+X', disabled: ro, run: x.cut },
    { key: 'copy', name: m.copy, hint: 'Ctrl+C', run: x.copy },
    { key: 'paste', name: m.paste, hint: 'Ctrl+V', disabled: ro || !x.canPaste, run: x.paste },
    '---',
    ...rowEntries,
    ...(x.server ? [] : [{ key: 'hide_row', name: rows > 1 ? m.hideRows : m.hideRow, run: () => g.hideRows(Array.from({ length: rows }, (_, i) => r.start.row + i)) }]),
    ...(g.getHiddenRows().length ? [{ key: 'show_rows', name: m.showRows, run: () => g.showRows() }] : []),
    ...(rowEntries.length ? (['---'] as const) : []),
    { key: 'col_left', name: m.insertColLeft, disabled: ro, run: () => g.alter('insert_col_start', r.start.col, cols) },
    { key: 'col_right', name: m.insertColRight, disabled: ro, run: () => g.alter('insert_col_end', r.end.col, cols) },
    { key: 'remove_col', name: cols > 1 ? m.removeCols : m.removeCol, disabled: ro, run: () => g.alter('remove_col', r.start.col, cols) },
    {
      key: 'hide_col',
      name: cols > 1 ? m.hideColumns : m.hideColumn,
      disabled: cols >= g.countCols() - g.getHiddenColumns().length,
      run: () => g.hideColumns(Array.from({ length: cols }, (_, i) => r.start.col + i)),
    },
    ...(g.getHiddenColumns().length ? [{ key: 'show_cols', name: m.showColumns, run: () => g.showColumns() }] : []),
    '---',
    x.merged
      ? { key: 'unmerge', name: m.unmergeCells, disabled: ro, run: () => g.unmergeCells(r.start.row, r.start.col) }
      : {
          key: 'merge',
          name: m.mergeCells,
          disabled: ro || (rows === 1 && cols === 1) || !x.canMerge,
          run: () => g.mergeCells(r.start.row, r.start.col, rows, cols),
        },
    { key: 'clear', name: m.clearContents, hint: 'Del', disabled: ro, run: x.clear },
    '---',
    { key: 'undo', name: m.undo, hint: 'Ctrl+Z', disabled: !g.isUndoAvailable(), run: () => g.undo() },
    { key: 'redo', name: m.redo, hint: 'Ctrl+Y', disabled: !g.isRedoAvailable(), run: () => g.redo() },
  ];
}
