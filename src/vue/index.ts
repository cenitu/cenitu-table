import { defineComponent, h, onBeforeUnmount, onMounted, ref, shallowRef, watch, type PropType } from 'vue';
import type { RawCell } from '../formula/values';
import type { DataRow } from '../grid/binding';
import { CenituGrid, type GridOptions } from '../grid/grid';

/** Options that `updateSettings` can apply without recreating the grid. */
const LIVE_SETTINGS = [
  'fixedRowsTop', 'fixedColumnsStart', 'readOnly', 'columns', 'colHeaders', 'mergeCells',
  'columnSorting', 'filters', 'fillHandle', 'locale', 'language', 'contextMenu', 'search',
  'query', 'totalCount', 'loading', 'loadError', 'theme', 'summaryValues', 'conditionalFormats',
] as const;

/**
 * Vue component around CenituGrid. `options` are the grid's options, `data` its rows; a new `data`
 * array replaces them, or shows a new page in server mode. The instance is available through
 * `getGrid()` on a template ref.
 */
export const CenituTable = defineComponent({
  name: 'CenituTable',
  props: {
    options: { type: Object as PropType<GridOptions>, default: () => ({}) },
    data: { type: Array as PropType<RawCell[][] | DataRow[]>, default: undefined },
    /** Server mode: `requestId` of the query `data` answers; outdated answers are ignored. */
    dataRequestId: { type: Number, default: undefined },
  },
  emits: ['change', 'selection', 'sort', 'filter', 'queryChange', 'rowClick', 'rowDoubleClick', 'columnLayoutChange'],
  setup(props, { emit, expose }) {
    const host = ref<HTMLDivElement>();
    const grid = shallowRef<CenituGrid>();
    expose({ getGrid: () => grid.value });

    onMounted(() => {
      const g = new CenituGrid(host.value!, { ...props.options, ...(props.data && { data: props.data }) });
      g.addHook('afterChange', (changes, source) => emit('change', changes, source));
      g.addHook('afterSelection', (r, c, r2, c2) => emit('selection', r, c, r2, c2));
      g.addHook('afterColumnSort', (col, order) => emit('sort', col, order));
      g.addHook('afterFilter', (filters) => emit('filter', filters));
      g.addHook('afterQueryChange', (query, reason) => emit('queryChange', query, reason));
      g.addHook('afterRowClick', (e) => emit('rowClick', e));
      g.addHook('afterRowDoubleClick', (e) => emit('rowDoubleClick', e));
      g.addHook('afterColumnLayout', (layout) => emit('columnLayoutChange', layout));
      grid.value = g;
    });

    watch(
      () => props.data,
      (data) => {
        const g = grid.value;
        if (!g || !data) return;
        if (props.options.dataMode === 'server') g.setPageRows(data, props.options.totalCount, { requestId: props.dataRequestId });
        else g.loadData(data);
      },
    );

    watch(
      () => LIVE_SETTINGS.map((k) => props.options[k]),
      () => {
        const settings: Record<string, unknown> = {};
        for (const k of LIVE_SETTINGS) if (props.options[k] !== undefined) settings[k] = props.options[k];
        grid.value?.updateSettings(settings);
      },
    );

    onBeforeUnmount(() => {
      grid.value?.destroy();
      grid.value = undefined;
    });

    return () => h('div', { ref: host });
  },
});
