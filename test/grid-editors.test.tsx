import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CenituGrid, enUS, type CellEditorContext, type GridOptions } from '../src';
import { CenituTable, reactEditor, type ReactEditorProps } from '../src/react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let grid: CenituGrid;
afterEach(() => {
  grid?.destroy();
  document.body.textContent = '';
  vi.useRealTimers();
});

function make(opts: GridOptions) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  grid = new CenituGrid(host, { language: enUS, ...opts });
  grid.selectCell(0, 0);
  return grid;
}

const editor = (g: CenituGrid) => g.root.querySelector('textarea')!;
const key = (g: CenituGrid, k: string) => editor(g).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const type = (g: CenituGrid, text: string) => {
  editor(g).value = text;
  editor(g).dispatchEvent(new Event('input', { bubbles: true }));
};
const items = (g: CenituGrid) => [...g.root.querySelectorAll('.ct-dd-item')].map((e) => e.textContent);

describe('dropdown with value and label', () => {
  const statuses = [{ value: 1, label: 'Açık' }, { value: 2, label: 'Kapalı' }];
  const col = { type: 'dropdown', source: statuses } as const;

  it('stores the value and shows the label', () => {
    const g = make({ data: [[2]], columns: [col] });
    expect(g.getDataAtCell(0, 0)).toBe(2);
    expect(g.root.querySelector('.ct-cell')!.textContent).toBe('Kapalı');
    expect(g.getCellError(0, 0)).toBeUndefined();
  });

  it('picks by label and writes the value', () => {
    const g = make({ data: [[2]], columns: [col] });
    g.openEditor();
    expect(editor(g).value).toBe('Kapalı');
    expect(items(g)).toEqual(['Açık', 'Kapalı']);
    type(g, 'aç');
    expect(items(g)).toEqual(['Açık']);
    key(g, 'Enter');
    expect(g.getSourceDataAtCell(0, 0)).toBe(1);
  });

  it('keeps apart choices with the same label', () => {
    const g = make({ data: [[null]], columns: [{ type: 'dropdown', source: [{ value: 'a', label: 'Ali' }, { value: 'b', label: 'Ali' }] }] });
    g.openEditor();
    g.root.querySelectorAll('.ct-dd-item')[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(g.getSourceDataAtCell(0, 0)).toBe('b');
  });

  it('turns typed and pasted labels into values, flags unknown ones', () => {
    const g = make({ data: [[1], [1]], columns: [col] });
    g.selectCell(0, 0);
    g.paste('kapalı\nyok');
    expect(g.getSourceDataAtCell(0, 0)).toBe(2);
    expect(g.getCellError(1, 0)).toBe('Not in list');
  });

  it('searches, filters and exports by label', () => {
    const g = make({ data: [[1], [2]], columns: [col], filters: true });
    expect(g.findCells('Kapalı')).toEqual([{ row: 1, col: 0 }]);
    g.setFilter(0, { condition: { op: 'contains', value: 'açı' } });
    expect(g.countRows()).toBe(1);
    expect(g.exportCSV({ values: 'formatted' })).toContain('Açık');
  });

  it('still takes plain strings', () => {
    const g = make({ data: [['Red']], columns: [{ type: 'dropdown', source: ['Red', 'Blue'] }] });
    g.openEditor();
    type(g, 'bl');
    key(g, 'Enter');
    expect(g.getSourceDataAtCell(0, 0)).toBe('Blue');
  });
});

describe('dropdown searching a server', () => {
  const answer = (q: string) => [{ value: 10, label: `Acme ${q}` }, { value: 11, label: 'Beta' }];
  const setup = (loadOptions: (q: string, s: AbortSignal) => Promise<{ value: number; label: string }[]>, opts: GridOptions = {}) => {
    vi.useFakeTimers();
    return make({
      data: [{ partnerId: 5, partner: { name: 'Eski Cari' } }],
      columns: [{ data: 'partnerId', type: 'dropdown', loadOptions, resolveLabel: (_, row) => (row as { partner: { name: string } }).partner.name }],
      ...opts,
    });
  };

  it('shows the row label, loads while typing and stores the chosen id', async () => {
    const load = vi.fn(async (q: string) => answer(q));
    const g = setup(load);
    expect(g.root.querySelector('.ct-cell')!.textContent).toBe('Eski Cari');
    g.openEditor();
    expect(editor(g).value).toBe('Eski Cari');
    expect(g.root.querySelector('.ct-dd-status')!.textContent).toBe('Loading…');
    type(g, 'ac');
    await vi.advanceTimersByTimeAsync(250);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toBe('ac');
    expect(items(g)).toEqual(['Acme ac', 'Beta']);
    key(g, 'Enter');
    expect(g.getSourceDataAtCell(0, 0)).toBe(10);
    expect(g.root.querySelector('.ct-cell')!.textContent).toBe('Acme ac');
  });

  it('ignores an answer that arrives after a newer query', async () => {
    const pending: ((v: { value: number; label: string }[]) => void)[] = [];
    const g = setup((q) => new Promise((resolve) => pending.push((v) => resolve(v.map((o) => ({ ...o, label: `${q}:${o.label}` }))))));
    g.openEditor();
    await vi.advanceTimersByTimeAsync(250);
    type(g, 'yeni');
    await vi.advanceTimersByTimeAsync(250);
    pending[1]([{ value: 2, label: 'iki' }]);
    await vi.advanceTimersByTimeAsync(0);
    pending[0]([{ value: 1, label: 'bir' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(items(g)).toEqual(['yeni:iki']);
  });

  it('keeps the old value when text matches no choice, clears it when emptied', async () => {
    const g = setup(async () => []);
    g.openEditor();
    type(g, 'olmayan');
    await vi.advanceTimersByTimeAsync(250);
    expect(g.root.querySelector('.ct-dd-status')!.textContent).toBe('No results');
    key(g, 'Enter');
    expect(g.getSourceDataAtCell(0, 0)).toBe(5);
    g.selectCell(0, 0);
    g.openEditor();
    type(g, '');
    key(g, 'Enter');
    expect(g.getSourceDataAtCell(0, 0)).toBeNull();
  });

  it('reports a failed search', async () => {
    const g = setup(async () => {
      throw new Error('x');
    });
    g.openEditor();
    await vi.advanceTimersByTimeAsync(250);
    expect(g.root.querySelector('.ct-dd-status')!.textContent).toBe('Could not load the data');
  });

  it('aborts the request when the editor closes', async () => {
    let signal: AbortSignal | undefined;
    const g = setup((_, s) => {
      signal = s;
      return new Promise(() => undefined);
    });
    g.openEditor();
    await vi.advanceTimersByTimeAsync(250);
    key(g, 'Escape');
    expect(signal!.aborted).toBe(true);
  });
});

describe('custom editors', () => {
  const stepper = (log: string[] = []) => (ctx: CellEditorContext) => {
    log.push('open');
    const input = document.createElement('input');
    input.value = ctx.initial ?? String(ctx.value ?? '');
    ctx.el.append(input);
    return { getValue: () => Number(input.value), destroy: () => void log.push('destroy') };
  };

  it('opens over the cell with its context and commits', () => {
    let ctx!: CellEditorContext;
    const g = make({ data: [{ qty: 3 }], columns: [{ data: 'qty', editor: (c) => void (ctx = c) }, {}] });
    g.openEditor();
    expect(g.isEditing()).toBe(true);
    expect(g.root.querySelector('.ct-custom-editor')).toBe(ctx.el);
    expect(ctx.value).toBe(3);
    expect(ctx.rowData).toEqual({ qty: 3 });
    ctx.commit(8, [0, 1]);
    expect(g.isEditing()).toBe(false);
    expect(g.root.querySelector('.ct-custom-editor')).toBeNull();
    expect(g.getSourceDataAtCell(0, 0)).toBe(8);
    expect(g.getSelected()).toEqual([[0, 1, 0, 1]]);
    g.undo();
    expect(g.getSourceDataAtCell(0, 0)).toBe(3);
  });

  it('stores getValue on a click elsewhere, discards on Escape, destroys once either way', () => {
    const log: string[] = [];
    const g = make({ data: [[1, 2]], columns: [{ editor: stepper(log) }] });
    g.openEditor();
    g.root.querySelector<HTMLInputElement>('.ct-custom-editor input')!.value = '9';
    g.closeEditor(true);
    expect(g.getSourceDataAtCell(0, 0)).toBe(9);
    g.openEditor();
    const input = g.root.querySelector<HTMLInputElement>('.ct-custom-editor input')!;
    input.value = '5';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(g.getSourceDataAtCell(0, 0)).toBe(9);
    expect(log).toEqual(['open', 'destroy', 'open', 'destroy']);
  });

  it('passes typed text and ignores a commit after closing', () => {
    let ctx!: CellEditorContext;
    const g = make({ data: [[1]], columns: [{ editor: (c) => void (ctx = c) }] });
    g.openEditor('7');
    expect(ctx.initial).toBe('7');
    ctx.cancel();
    ctx.commit(99);
    expect(g.getSourceDataAtCell(0, 0)).toBe(1);
  });

  it('does not open on read-only cells', () => {
    const g = make({ data: [[1]], columns: [{ readOnly: true, editor: stepper() }] });
    g.openEditor();
    expect(g.isEditing()).toBe(false);
  });

  it('keeps clicks inside the editor to itself', () => {
    const g = make({ data: [[1]], columns: [{ editor: stepper() }] });
    g.openEditor();
    g.root.querySelector('.ct-custom-editor input')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(g.isEditing()).toBe(true);
  });
});

describe('React editors', () => {
  it('mounts a component, commits and unmounts it', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const log: string[] = [];
    function Stepper({ value, commit }: ReactEditorProps) {
      useEffect(() => {
        log.push('mount');
        return () => void log.push('unmount');
      }, []);
      return <button onClick={() => commit(Number(value) + 1)}>artır</button>;
    }
    const editorOption = reactEditor(Stepper);
    let g: CenituGrid | null = null;
    act(() => root.render(<CenituTable ref={(r) => void (g = r)} data={[[1]]} columns={[{ editor: editorOption }]} />));
    await act(async () => {
      g!.selectCell(0, 0);
      g!.openEditor();
    });
    expect(log).toEqual(['mount']);
    await act(async () => host.querySelector<HTMLButtonElement>('.ct-custom-editor button')!.click());
    expect(g!.getSourceDataAtCell(0, 0)).toBe(2);
    expect(log).toEqual(['mount', 'unmount']);
    act(() => root.unmount());
  });
});
