import { optionLabel, type CellMeta, type DropdownOption } from './cellTypes';
import type { Messages } from './messages';

/** Pause after typing before `loadOptions` runs. */
const OPTIONS_DELAY = 200;

export interface DropdownHost {
  input: HTMLTextAreaElement;
  make(cls: string, parent: HTMLElement): HTMLDivElement;
  messages(): Messages;
  locale(): string | undefined;
  /** Settings of the cell being edited. */
  meta(): CellMeta | undefined;
  /** An item was clicked. */
  choose(option: DropdownOption): void;
}

/** The list under an open dropdown editor, for fixed choices and for choices from a server. */
export class EditorDropdown {
  readonly el: HTMLDivElement;
  items: DropdownOption[] = [];
  active = -1;
  private request?: AbortController;
  private timer?: number;

  constructor(private readonly host: DropdownHost, query: string) {
    const { input } = host;
    const el = (this.el = host.make('ct-dd-list', input.parentElement as HTMLElement));
    el.setAttribute('role', 'listbox');
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (item) host.choose(this.items[Number(item.dataset.i)]);
    });
    el.style.left = input.style.left;
    el.style.top = `${parseFloat(input.style.top) + parseFloat(input.style.height)}px`;
    el.style.minWidth = input.style.width;
    this.filter(query);
  }

  filter(query: string): void {
    const meta = this.host.meta();
    if (!meta) return;
    if (meta.loadOptions) return this.requestOptions(meta, query);
    const locale = this.host.locale();
    const q = query.toLocaleLowerCase(locale);
    this.show((meta.source ?? []).filter((s) => optionLabel(s).toLocaleLowerCase(locale).includes(q)), !!q);
  }

  /** Waits for a typing pause; a newer query aborts the older request, so late answers cannot win. */
  private requestOptions(meta: CellMeta, query: string): void {
    clearTimeout(this.timer);
    this.request?.abort();
    this.items = [];
    this.active = -1;
    this.status(this.host.messages().loading);
    const request = new AbortController();
    this.request = request;
    this.timer = setTimeout(() => {
      meta.loadOptions!(query, request.signal).then(
        (options) => {
          if (!request.signal.aborted) this.show(options, !!query);
        },
        () => {
          if (!request.signal.aborted) this.status(this.host.messages().loadError);
        },
      );
    }, OPTIONS_DELAY) as unknown as number;
  }

  private status(text: string): void {
    this.el.textContent = '';
    this.host.make('ct-dd-status', this.el).textContent = text;
  }

  private show(items: DropdownOption[], preselect: boolean): void {
    this.items = items;
    this.active = preselect && items.length ? 0 : -1;
    this.el.textContent = '';
    items.forEach((s, i) => {
      const item = this.host.make('ct-dd-item', this.el);
      item.dataset.i = String(i);
      item.setAttribute('role', 'option');
      item.textContent = optionLabel(s);
    });
    if (!items.length) this.host.make('ct-dd-status', this.el).textContent = this.host.messages().noOptions;
    this.highlight();
  }

  move(delta: number): void {
    this.active = Math.max(0, Math.min(this.items.length - 1, this.active + delta));
    this.highlight();
  }

  private highlight(): void {
    const { el, active } = this;
    [...el.children].forEach((c, i) => c.classList.toggle('ct-on', i === active));
    // Only the list scrolls: moving the grid would close the editor.
    const item = el.children[active] as HTMLElement | undefined;
    if (item) {
      if (item.offsetTop < el.scrollTop) el.scrollTop = item.offsetTop;
      else if (item.offsetTop + item.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = item.offsetTop + item.offsetHeight - el.clientHeight;
    }
  }

  close(): void {
    clearTimeout(this.timer);
    this.request?.abort();
    this.el.remove();
  }
}
