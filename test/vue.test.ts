import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, shallowReactive } from 'vue';
import type { CenituGrid, GridOptions } from '../src';
import { CenituTable } from '../src/vue';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  document.body.textContent = '';
});

function mount(state: { data?: unknown[]; options: GridOptions }, on: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const table = ref<{ getGrid(): CenituGrid }>();
  const app = createApp({ render: () => h(CenituTable, { ref: table, data: state.data as never, options: state.options, ...on }) });
  app.mount(host);
  unmount = () => app.unmount();
  return () => table.value!.getGrid();
}

describe('Vue component', () => {
  it('shows data and reports edits', () => {
    const onChange = vi.fn();
    const grid = mount({ data: [[1, 2]], options: {} }, { onChange });
    grid().setDataAtCell(0, 0, 5);
    expect(grid().getDataAtCell(0, 0)).toBe(5);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('reloads on a new data array', async () => {
    const state = shallowReactive({ data: [[1]] as unknown[], options: {} as GridOptions });
    const grid = mount(state);
    state.data = [[7], [8]];
    await nextTick();
    expect(grid().countRows()).toBe(2);
  });

  it('applies settings without a new grid', async () => {
    const state = shallowReactive({ data: [[1]] as unknown[], options: { readOnly: false } as GridOptions });
    const grid = mount(state);
    const first = grid();
    state.options = { readOnly: true };
    await nextTick();
    expect(grid()).toBe(first);
    first.selectCell(0, 0);
    first.openEditor();
    expect(first.isEditing()).toBe(false);
  });

  it('passes pages and queries in server mode', async () => {
    const onQueryChange = vi.fn();
    const state = shallowReactive({
      data: [{ id: 1 }] as unknown[],
      options: { dataMode: 'server', rowKey: 'id', columns: [{ id: 'id', data: 'id', sortable: true }], totalCount: 1 } as GridOptions,
    });
    const grid = mount(state, { onQueryChange });
    grid().sort(0, 'asc');
    expect(onQueryChange.mock.calls[0][1]).toBe('sort');
    state.data = [{ id: 2 }];
    await nextTick();
    expect(grid().getDataAtCell(0, 0)).toBe(2);
  });

  it('removes the grid with the component', () => {
    const grid = mount({ data: [[1]], options: {} });
    const { root } = grid();
    unmount!();
    unmount = undefined;
    expect(root.isConnected).toBe(false);
  });
});
