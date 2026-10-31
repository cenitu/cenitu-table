import type { Messages } from './messages';

export interface SearchOptions {
  matchCase?: boolean;
  /** Match only when the whole cell equals the query. */
  wholeCell?: boolean;
  /** 'values' (default) searches what cells display; 'formulas' searches what was entered. */
  lookIn?: 'values' | 'formulas';
}

type Span = [number, number];

/** Lower-cased text with the original index of each unit (case mapping may change the length). */
function fold(text: string, locale?: string): { text: string; map: number[] | null } {
  const whole = text.toLocaleLowerCase(locale);
  if (whole.length === text.length) return { text: whole, map: null };
  let out = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = text[i].toLocaleLowerCase(locale);
    out += f;
    for (let j = 0; j < f.length; j++) map.push(i);
  }
  map.push(text.length);
  return { text: out, map };
}

/** Occurrences of `query` in `text` as [start, end) in `text`'s own indexes. */
export function matchSpans(text: string, query: string, o: SearchOptions = {}, locale?: string): Span[] {
  if (!query) return [];
  const hay = o.matchCase ? { text, map: null } : fold(text, locale);
  const needle = o.matchCase ? query : query.toLocaleLowerCase(locale);
  if (o.wholeCell) return hay.text === needle ? [[0, text.length]] : [];
  const spans: Span[] = [];
  for (let i = hay.text.indexOf(needle); i >= 0; i = hay.text.indexOf(needle, i + needle.length)) {
    const end = i + needle.length;
    spans.push(hay.map ? [hay.map[i], hay.map[end]] : [i, end]);
  }
  return spans;
}

/** `text` with every occurrence of `query` replaced. */
export function replaceSpans(text: string, spans: Span[], replacement: string): string {
  let out = '';
  let last = 0;
  for (const [start, end] of spans) {
    out += text.slice(last, start) + replacement;
    last = end;
  }
  return out + text.slice(last);
}

export interface SearchPanelOptions {
  root: HTMLElement;
  messages: Messages;
  query: string;
  options: SearchOptions;
  /** Shows the replace row; false for read-only grids. */
  replace: boolean;
  /** Re-runs the search; returns the number of matches. */
  onSearch(query: string, options: SearchOptions): number;
  /** Moves to the next match; returns its 1-based position and the total. */
  onNext(backward: boolean): { index: number; total: number };
  onReplace(replacement: string): { index: number; total: number };
  onReplaceAll(replacement: string): number;
  onClose(): void;
}

const SEARCH_DELAY = 150;

export interface SearchPanel {
  close(): void;
  focus(replace: boolean): void;
}

/** Floating find/replace box over the grid's top right corner. */
export function openSearchPanel(o: SearchPanelOptions): SearchPanel {
  const doc = o.root.ownerDocument;
  const m = o.messages;
  const panel = doc.createElement('div');
  panel.className = 'ct-menu ct-search';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', m.find);

  const field = (label: string, value: string) => {
    const input = doc.createElement('input');
    input.type = 'text';
    input.value = value;
    input.placeholder = label;
    input.setAttribute('aria-label', label);
    return input;
  };
  const button = (label: string, title: string, onClick: () => void) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'ct-btn';
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', () => {
      onClick();
      // Safari does not focus clicked buttons; without this, Escape would no longer reach the box.
      if (!closed) query.focus();
    });
    return b;
  };
  const row = (...items: HTMLElement[]) => {
    const r = doc.createElement('div');
    r.className = 'ct-search-row';
    r.append(...items);
    return r;
  };
  const toggle = (label: string, checked: boolean) => {
    const l = doc.createElement('label');
    const cb = doc.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.addEventListener('change', () => refresh());
    l.append(cb, doc.createTextNode(label));
    return [l, cb] as const;
  };

  const query = field(m.find, o.query);
  const replacement = field(m.replaceWith, '');
  const status = doc.createElement('span');
  status.className = 'ct-search-status';
  status.setAttribute('aria-live', 'polite');
  const [caseLabel, matchCase] = toggle(m.matchCase, !!o.options.matchCase);
  const [wholeLabel, wholeCell] = toggle(m.wholeCell, !!o.options.wholeCell);
  const [formulaLabel, inFormulas] = toggle(m.lookInFormulas, o.options.lookIn === 'formulas');

  const count = (n: number) => (status.textContent = query.value ? (n ? m.matchCount.replace('{total}', String(n)) : m.noMatches) : '');
  const position = ({ index, total }: { index: number; total: number }) => {
    if (total) status.textContent = `${index} / ${total}`;
    else count(0);
  };
  const options = (): SearchOptions => ({
    matchCase: matchCase.checked,
    wholeCell: wholeCell.checked,
    lookIn: inFormulas.checked ? 'formulas' : 'values',
  });
  let timer = 0;
  function refresh() {
    clearTimeout(timer);
    timer = 0;
    count(o.onSearch(query.value, options()));
  }
  query.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, SEARCH_DELAY) as unknown as number;
  });
  /** The query may be newer than the last delayed search; scanning twice would be wasted on large grids. */
  const flush = () => {
    if (timer) refresh();
  };
  const next = (backward: boolean) => {
    flush();
    if (query.value) position(o.onNext(backward));
  };

  const replaceOne = () => {
    flush();
    position(o.onReplace(replacement.value));
  };

  const replaceRow = row(
    replacement,
    button(m.replace, m.replace, () => replaceOne()),
    button(m.replaceAll, m.replaceAll, () => {
      flush();
      const n = o.onReplaceAll(replacement.value);
      status.textContent = m.replacedCount.replace('{count}', String(n));
    }),
  );
  replaceRow.hidden = true;
  panel.append(
    row(query, status, button('↑', m.previous, () => next(true)), button('↓', m.next, () => next(false)), button('×', m.close, () => close())),
    replaceRow,
    row(caseLabel, wholeLabel, formulaLabel),
  );

  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Enter' && e.target === query) {
      e.preventDefault();
      next(e.shiftKey);
    } else if (e.key === 'Enter' && e.target === replacement) {
      e.preventDefault();
      replaceOne();
    }
  });

  doc.body.append(panel);
  const rect = o.root.getBoundingClientRect();
  const width = panel.offsetWidth || 340;
  panel.style.left = `${Math.max(8, rect.right - width - 20)}px`;
  panel.style.top = `${rect.top + 30}px`;
  if (query.value) refresh();

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    panel.remove();
    o.onClose();
  }
  const focus = (showReplace: boolean) => {
    if (showReplace && o.replace) replaceRow.hidden = false;
    query.focus();
    query.select();
  };
  focus(o.replace);
  return { close, focus };
}
