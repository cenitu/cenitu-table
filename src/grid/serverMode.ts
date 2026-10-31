import type { Messages } from './messages';

/** What a column can be filtered by on the server. */
export type ServerFilterDef =
  | { kind: 'text' }
  | { kind: 'list'; options: { value: string; label?: string }[] }
  | { kind: 'date' }
  | { kind: 'boolean' };

/** A filter value in the query; date bounds are as the date inputs give them (YYYY-MM-DD). */
export type ServerFilter =
  | { kind: 'text'; value: string }
  | { kind: 'list'; values: string[] }
  | { kind: 'date'; from?: string; to?: string }
  | { kind: 'boolean'; value: boolean };

export interface ServerSort {
  field: string;
  desc: boolean;
}

/** Describes the rows the application should fetch. Fields are column ids, never indexes. */
export interface ServerQuery {
  page: number;
  pageSize: number;
  sort: ServerSort[];
  filters: Record<string, ServerFilter>;
  search?: string;
}

export type QueryChangeReason = 'page' | 'pageSize' | 'sort' | 'filter' | 'search';

export const DEFAULT_PAGE_SIZES = [25, 50, 100];

export function initialQuery(q: Partial<ServerQuery> | undefined, pageSizes: number[]): ServerQuery {
  return { page: 1, pageSize: pageSizes[0], sort: [], filters: {}, ...q };
}

export const pageCount = (total: number, pageSize: number): number => Math.max(1, Math.ceil(total / pageSize));

/** The controls for one filter; `read` gives the entered filter, or null when it is empty. */
export function serverFilterSection(
  doc: Document,
  m: Messages,
  def: ServerFilterDef,
  value: ServerFilter | undefined,
): { el: HTMLElement; read(): ServerFilter | null } {
  const el = doc.createElement('div');
  el.className = 'ct-menu-section';
  const title = doc.createElement('div');
  title.className = 'ct-menu-title';
  title.textContent = m.filterByValue;
  el.append(title);
  const input = (type: string, label: string, v: string) => {
    const i = doc.createElement('input');
    i.type = type;
    i.value = v;
    i.setAttribute('aria-label', label);
    return i;
  };

  if (def.kind === 'text') {
    const text = input('text', m.filterByValue, value?.kind === 'text' ? value.value : '');
    el.append(text);
    return { el, read: () => (text.value ? { kind: 'text', value: text.value } : null) };
  }
  if (def.kind === 'date') {
    const range = value?.kind === 'date' ? value : undefined;
    const from = input('date', m.dateFrom, range?.from ?? '');
    const to = input('date', m.dateTo, range?.to ?? '');
    el.append(from, to);
    return {
      el,
      read: () => (from.value || to.value ? { kind: 'date', ...(from.value && { from: from.value }), ...(to.value && { to: to.value }) } : null),
    };
  }
  if (def.kind === 'boolean') {
    const select = doc.createElement('select');
    select.setAttribute('aria-label', m.filterByValue);
    select.append(new Option(m.none, ''), new Option(m.yes, 'true'), new Option(m.no, 'false'));
    select.value = value?.kind === 'boolean' ? String(value.value) : '';
    el.append(select);
    return { el, read: () => (select.value ? { kind: 'boolean', value: select.value === 'true' } : null) };
  }
  const chosen = new Set(value?.kind === 'list' ? value.values : []);
  const list = doc.createElement('div');
  list.className = 'ct-menu-list';
  const boxes = def.options.map((o) => {
    const l = doc.createElement('label');
    const cb = doc.createElement('input');
    cb.type = 'checkbox';
    cb.checked = chosen.has(o.value);
    l.append(cb, doc.createTextNode(o.label ?? o.value));
    list.append(l);
    return [o.value, cb] as const;
  });
  el.append(list);
  return {
    el,
    read: () => {
      const values = boxes.filter(([, cb]) => cb.checked).map(([v]) => v);
      return values.length ? { kind: 'list', values } : null;
    },
  };
}

/** Page bar: custom actions, record range, page size, previous and next. */
export class Pager {
  readonly el: HTMLDivElement;
  /** Slot for application buttons. */
  readonly actions: HTMLDivElement;
  private readonly range: HTMLSpanElement;
  private readonly size: HTMLSelectElement;
  private readonly position: HTMLSpanElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;

  constructor(doc: Document, private readonly m: Messages, pageSizes: number[], onPage: (delta: number) => void, onSize: (size: number) => void) {
    this.el = doc.createElement('div');
    this.el.className = 'ct-pager';
    this.el.setAttribute('role', 'navigation');
    this.actions = doc.createElement('div');
    this.actions.className = 'ct-pager-actions';
    this.range = doc.createElement('span');
    this.range.setAttribute('aria-live', 'polite');
    this.size = doc.createElement('select');
    this.size.setAttribute('aria-label', m.pageSize);
    for (const n of pageSizes) this.size.append(new Option(String(n), String(n)));
    this.size.addEventListener('change', () => onSize(Number(this.size.value)));
    this.position = doc.createElement('span');
    const button = (label: string, title: string, delta: number) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'ct-btn';
      b.textContent = label;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', () => onPage(delta));
      return b;
    };
    this.prev = button('‹', m.previous, -1);
    this.next = button('›', m.next, 1);
    this.el.append(this.actions, this.range, this.size, this.prev, this.position, this.next);
  }

  /** `total` undefined keeps the last figures, so the bar does not flicker while a page loads. */
  update(q: ServerQuery, total: number | undefined): void {
    this.size.value = String(q.pageSize);
    const known = total ?? 0;
    const pages = pageCount(known, q.pageSize);
    const from = known ? (q.page - 1) * q.pageSize + 1 : 0;
    this.range.textContent = this.m.pagerRange
      .replace('{from}', String(from))
      .replace('{to}', String(Math.min(q.page * q.pageSize, known)))
      .replace('{total}', String(known));
    this.position.textContent = `${q.page} / ${pages}`;
    this.prev.disabled = q.page <= 1;
    this.next.disabled = q.page >= pages;
  }
}
