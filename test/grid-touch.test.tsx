import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CenituGrid, type CellRenderer, type GridOptions } from '../src';
import { CenituTable, reactRenderer, type ReactCellProps } from '../src/react';

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
  grid = new CenituGrid(host, opts);
  return grid;
}

function touch(target: EventTarget, type: string, x = 10, y = 10) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & { touches: unknown[]; changedTouches: unknown[] };
  const point = { clientX: x, clientY: y };
  e.touches = type === 'touchend' ? [] : [point];
  e.changedTouches = [point];
  target.dispatchEvent(e);
  return e;
}

describe('touch', () => {
  it('keeps the keyboard down while idle and raises it for editing', () => {
    const g = make({ data: [[1]] });
    const input = g.root.querySelector('textarea')!;
    expect(input.inputMode).toBe('none');
    g.selectCell(0, 0);
    g.openEditor();
    expect(input.inputMode).toBe('text');
    g.closeEditor(false);
    expect(input.inputMode).toBe('none');
  });

  it('re-focuses for the keyboard on touch devices without closing the editor', () => {
    vi.stubGlobal('matchMedia', undefined);
    window.matchMedia = ((q: string) => ({ matches: q.includes('coarse') })) as never;
    const g = make({ data: [['a']] });
    g.selectCell(0, 0);
    g.focus();
    g.openEditor();
    expect(g.isEditing()).toBe(true);
    g.closeEditor(false);
    delete (window as { matchMedia?: unknown }).matchMedia;
    vi.unstubAllGlobals();
  });

  it('resizes a column by dragging its edge with a finger', () => {
    const g = make({ data: [[1, 2]] });
    const edge = g.root.querySelector('.ct-colhead .ct-resize')!;
    const start = touch(edge, 'touchstart', 100, 5);
    expect(start.defaultPrevented).toBe(true);
    touch(document, 'touchmove', 160, 5);
    touch(document, 'touchend', 160, 5);
    expect(g.getColWidth(0)).toBe(160);
    touch(document, 'touchmove', 300, 5);
    expect(g.getColWidth(0)).toBe(160);
  });

  it('leaves ordinary touches to the browser, so scrolling works', () => {
    const g = make({ data: [[1]] });
    expect(touch(g.root.querySelector('.ct-cell')!, 'touchstart').defaultPrevented).toBe(false);
  });

  it('opens the context menu on a long press, not on a short one or a scroll', () => {
    vi.useFakeTimers();
    const g = make({ data: [[1], [2]], contextMenu: true });
    const cell = g.root.querySelector('.ct-cell')!;
    touch(cell, 'touchstart');
    vi.advanceTimersByTime(200);
    touch(cell, 'touchend');
    vi.advanceTimersByTime(600);
    expect(document.querySelector('.ct-context')).toBeNull();
    touch(cell, 'touchstart');
    touch(cell, 'touchmove');
    vi.advanceTimersByTime(600);
    expect(document.querySelector('.ct-context')).toBeNull();
    touch(cell, 'touchstart');
    vi.advanceTimersByTime(600);
    touch(document, 'touchend');
    expect(document.querySelector('.ct-context')).not.toBeNull();
  });

  it('ends a handle drag when the system cancels the touch', () => {
    const g = make({ data: [[1, 2]] });
    const handle = g.root.querySelector('.ct-resize')!;
    const width = g.getColWidth(0);
    touch(handle, 'touchstart', 100, 10);
    touch(document, 'touchcancel', 100, 10);
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 10 }));
    expect(g.getColWidth(0)).toBe(width);
  });

  it('selects a range by dragging on from a long press', () => {
    vi.useFakeTimers();
    const g = make({ data: [[1, 2], [3, 4], [5, 6]], contextMenu: true });
    const cell = g.root.querySelector('.ct-cell')!;
    touch(cell, 'touchstart', 60, 30);
    vi.advanceTimersByTime(600);
    expect(g.getSelected()).toEqual([[0, 0, 0, 0]]);
    const move = touch(document, 'touchmove', 160, 80);
    expect(move.defaultPrevented).toBe(true);
    touch(document, 'touchend', 160, 80);
    expect(g.getSelected()).toEqual([[0, 0, 2, 1]]);
    expect(document.querySelector('.ct-context')).toBeNull();
  });

  it('does not fire a pending long press after the grid is gone', () => {
    vi.useFakeTimers();
    const g = make({ data: [[1]], contextMenu: true });
    touch(g.root.querySelector('.ct-cell')!, 'touchstart');
    g.destroy();
    vi.advanceTimersByTime(600);
    expect(document.querySelector('.ct-context')).toBeNull();
  });
});

describe('custom renderers', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => [i]);

  it('cleans up when a cell is recycled while scrolling and when the grid goes', () => {
    const released: number[] = [];
    const renderer: CellRenderer = (_, value) => () => void released.push(value as number);
    const g = make({ data: rows(2000), height: 200, columns: [{ renderer }], formulas: false });
    g.root.scrollTop = 20000;
    g.root.dispatchEvent(new Event('scroll'));
    g.render();
    expect(released.length).toBeGreaterThan(0);
    const before = released.length;
    g.destroy();
    expect(released.length).toBeGreaterThan(before);
  });

  it('keeps content it owns across a plain repaint', () => {
    let released = 0;
    const renderer: CellRenderer = () => () => void released++;
    renderer.ownsContent = true;
    const g = make({ data: rows(3), columns: [{ renderer }] });
    g.render();
    g.render();
    expect(released).toBe(0);
  });

  it('keeps the default text for renderers that only decorate', () => {
    const g = make({ data: [['a']], columns: [{ renderer: (el) => void el.classList.add('x') }] });
    expect(g.root.querySelector('.ct-cell.x')!.textContent).toBe('a');
  });

  it('runs React components in cells, re-rendering and unmounting them', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const mounted = { count: 0 };
    function Badge({ value, context }: ReactCellProps) {
      return <b data-row={context.row}>{String(value)}!</b>;
    }
    const renderer = reactRenderer((p) => {
      mounted.count++;
      return <Badge {...p} />;
    });
    let g: CenituGrid | null = null;
    await act(async () => root.render(<CenituTable ref={(r) => void (g = r)} data={[['a'], ['b']]} columns={[{ renderer }]} />));
    expect(host.querySelector('b')!.textContent).toBe('a!');
    await act(async () => g!.setDataAtCell(0, 0, 'z'));
    expect(host.querySelectorAll('b')[0].textContent).toBe('z!');
    await act(async () => g!.updateSettings({ columns: [{}] }));
    expect(host.querySelector('b')).toBeNull();
    expect(host.querySelector('.ct-cell')!.textContent).toBe('z');
    await act(async () => root.unmount());
  });
});
