import { act, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { CenituTable, type CenituGrid } from '../src/react';
import type { RawCell } from '../src';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

describe('CenituTable (React)', () => {
  it('renders, exposes the grid through a ref and reports changes', () => {
    const ref = createRef<CenituGrid>();
    const seen: unknown[] = [];
    mount(<CenituTable ref={ref} data={[[1, '=A1*2']]} onChange={(c) => seen.push(c[0].newValue)} />);
    expect(ref.current).toBeTruthy();
    expect(ref.current!.getDataAtCell(0, 1)).toBe(2);
    act(() => ref.current!.setDataAtCell(0, 0, 5));
    expect(seen).toEqual([5]);
    expect(host.textContent).toContain('10');
  });

  it('keeps history when changes are fed back as data, reloads on foreign data', () => {
    const ref = createRef<CenituGrid>();
    let setData!: (d: RawCell[][]) => void;
    function App() {
      const [data, set] = useState<RawCell[][]>([[1, 2]]);
      setData = set;
      return <CenituTable ref={ref} data={data} onChange={() => set(ref.current!.getSourceData())} />;
    }
    mount(<App />);
    act(() => ref.current!.setDataAtCell(0, 0, 9));
    expect(ref.current!.isUndoAvailable()).toBe(true);
    act(() => setData([[7, 8]]));
    expect(ref.current!.getDataAtCell(0, 0)).toBe(7);
    expect(ref.current!.isUndoAvailable()).toBe(false);
  });

  it('keeps formulas when copied objects are fed back from onChange', () => {
    const ref = createRef<CenituGrid>();
    function App() {
      const [rows, set] = useState<Record<string, unknown>[]>([{ a: 2, b: null }]);
      return (
        <CenituTable
          ref={ref}
          data={rows}
          columns={[{ data: 'a' }, { data: 'b' }]}
          onChange={() => set(ref.current!.getSourceObjects()!.map((o) => ({ ...o })))}
        />
      );
    }
    mount(<App />);
    act(() => ref.current!.setDataAtCell(0, 1, '=A1*2'));
    act(() => ref.current!.setDataAtCell(0, 0, 5));
    expect(ref.current!.getDataAtCell(0, 1)).toBe(10);
    expect(ref.current!.getSourceDataAtCell(0, 1)).toBe('=A1*2');
    expect(ref.current!.isUndoAvailable()).toBe(true);
  });

  it('applies live settings and cleans up on unmount', () => {
    const ref = createRef<CenituGrid>();
    function App({ frozen }: { frozen: number }) {
      return <CenituTable ref={ref} data={[['h'], [2], [1]]} fixedRowsTop={frozen} />;
    }
    mount(<App frozen={0} />);
    act(() => root!.render(<App frozen={1} />));
    act(() => ref.current!.sort(0, 'asc'));
    expect(ref.current!.getData().map((r) => r[0])).toEqual(['h', 1, 2]);
    act(() => root!.unmount());
    root = undefined;
    expect(host.querySelector('.ct-root')).toBeNull();
  });
});
