import type { ColumnFilter, ConditionOp, SortOrder } from './filters';
import type { Messages } from './messages';

export interface ColumnMenuOptions {
  anchor: HTMLElement;
  messages: Messages;
  locale?: string;
  sort: SortOrder | null;
  /** Another column is sorted, so this one can be added as a further key. */
  sortedElsewhere: boolean;
  filter: ColumnFilter | undefined;
  /** Distinct display texts of the column ("" = blanks), already sorted. */
  values: string[];
  sortable: boolean;
  filterable: boolean;
  onSort(order: SortOrder | null, add?: boolean): void;
  onFilter(filter: ColumnFilter | null): void;
  onClose(): void;
}

const OPS: ConditionOp[] = [
  'contains', 'notContains', 'equals', 'notEquals', 'greaterThan', 'greaterOrEqual',
  'lessThan', 'lessOrEqual', 'isEmpty', 'isNotEmpty',
];
const MAX_VALUES = 1000;

/** Excel-like column dropdown: sort buttons, a condition filter and a value checklist. */
export function openColumnMenu(o: ColumnMenuOptions): () => void {
  const doc = o.anchor.ownerDocument;
  const m = o.messages;
  const menu = doc.createElement('div');
  menu.className = 'ct-menu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', m.columnMenu);

  const button = (label: string, cls: string, onClick: () => void) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };

  if (o.sortable) {
    const sortBox = doc.createElement('div');
    sortBox.className = 'ct-menu-section';
    sortBox.append(
      button(m.sortAsc, `ct-menu-item${o.sort === 'asc' ? ' ct-on' : ''}`, () => (o.onSort('asc'), close())),
      button(m.sortDesc, `ct-menu-item${o.sort === 'desc' ? ' ct-on' : ''}`, () => (o.onSort('desc'), close())),
    );
    if (o.sortedElsewhere) {
      sortBox.append(
        button(m.sortThenAsc, 'ct-menu-item', () => (o.onSort('asc', true), close())),
        button(m.sortThenDesc, 'ct-menu-item', () => (o.onSort('desc', true), close())),
      );
    }
    if (o.sort) sortBox.append(button(m.sortClear, 'ct-menu-item', () => (o.onSort(null), close())));
    menu.append(sortBox);
  }

  let apply = () => {};
  if (o.filterable) {
    const cond = doc.createElement('div');
    cond.className = 'ct-menu-section';
    const title = doc.createElement('div');
    title.className = 'ct-menu-title';
    title.textContent = m.filterByCondition;
    const select = doc.createElement('select');
    select.append(new Option(m.none, ''));
    for (const op of OPS) select.append(new Option(m[op], op));
    select.value = o.filter?.condition?.op ?? '';
    const input = doc.createElement('input');
    input.type = 'text';
    input.value = o.filter?.condition?.value ?? '';
    const syncInput = () => {
      input.hidden = !select.value || select.value === 'isEmpty' || select.value === 'isNotEmpty';
    };
    select.addEventListener('change', syncInput);
    syncInput();
    cond.append(title, select, input);

    const vals = doc.createElement('div');
    vals.className = 'ct-menu-section';
    const vTitle = doc.createElement('div');
    vTitle.className = 'ct-menu-title';
    vTitle.textContent = m.filterByValue;
    const search = doc.createElement('input');
    search.type = 'search';
    search.placeholder = m.search;
    const list = doc.createElement('div');
    list.className = 'ct-menu-list';
    const allowed = new Set(o.filter?.values ?? o.values);
    const shown = o.values.slice(0, MAX_VALUES);
    const boxes: [string, HTMLInputElement, HTMLLabelElement][] = [];
    const checkbox = (label: string, checked: boolean) => {
      const l = doc.createElement('label');
      const cb = doc.createElement('input');
      cb.type = 'checkbox';
      cb.checked = checked;
      l.append(cb, doc.createTextNode(label));
      return [l, cb] as const;
    };
    const [allLabel, all] = checkbox(m.selectAll, shown.every((v) => allowed.has(v)));
    all.addEventListener('change', () => boxes.forEach(([, cb, l]) => !l.hidden && (cb.checked = all.checked)));
    list.append(allLabel);
    for (const v of shown) {
      const [l, cb] = checkbox(v === '' ? m.blanks : v, allowed.has(v));
      boxes.push([v, cb, l]);
      list.append(l);
    }
    search.addEventListener('input', () => {
      const q = search.value.toLocaleLowerCase(o.locale);
      boxes.forEach(([v, , l]) => (l.hidden = !v.toLocaleLowerCase(o.locale).includes(q)));
    });
    vals.append(vTitle, search, list);
    menu.append(cond, vals);

    apply = () => {
      const filter: ColumnFilter = {};
      if (select.value) filter.condition = { op: select.value as ConditionOp, value: input.value };
      const checked = boxes.filter(([, cb]) => cb.checked).map(([v]) => v);
      // Values beyond the displayed list stay allowed.
      if (checked.length < boxes.length) filter.values = [...checked, ...o.values.slice(MAX_VALUES)];
      o.onFilter(filter.condition || filter.values ? filter : null);
      close();
    };

    const footer = doc.createElement('div');
    footer.className = 'ct-menu-footer';
    footer.append(
      button(m.clearFilter, 'ct-menu-link', () => (o.onFilter(null), close())),
      button(m.cancel, 'ct-btn', () => close()),
      button(m.ok, 'ct-btn ct-primary', () => apply()),
    );
    menu.append(footer);
  }

  doc.body.append(menu);
  const rect = o.anchor.getBoundingClientRect();
  const width = menu.offsetWidth || 240;
  const left = Math.max(8, Math.min(rect.right - width, (doc.defaultView?.innerWidth ?? 1024) - width - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${rect.bottom + 2}px`;

  const onDown = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Enter' && o.filterable && (e.target as HTMLElement).tagName !== 'BUTTON') {
      apply();
    }
  };
  doc.addEventListener('mousedown', onDown, true);
  menu.addEventListener('keydown', onKey);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    doc.removeEventListener('mousedown', onDown, true);
    menu.remove();
    o.onClose();
  }
  return close;
}
