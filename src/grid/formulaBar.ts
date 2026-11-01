import type { Messages } from './messages';

export interface FormulaBarHost {
  editing(): boolean;
  openEditor(text: string): void;
  /** Typing in the bar: the cell editor follows. */
  typed(text: string): void;
  /** Focus left the bar for `next`. */
  left(next: EventTarget | null): void;
  /** Leaves the bar on purpose, optionally moving the selection. */
  leave(dr: number, dc: number, commit: boolean): void;
}

/** Bar above the grid with the active cell's address and content. */
export class FormulaBar {
  readonly el: HTMLDivElement;
  readonly input: HTMLTextAreaElement;
  private readonly address: HTMLDivElement;

  constructor(root: HTMLElement, messages: Messages, private readonly host: FormulaBarHost) {
    const doc = root.ownerDocument;
    this.el = doc.createElement('div');
    this.el.className = 'ct-bar';
    this.address = doc.createElement('div');
    this.address.className = 'ct-bar-address';
    const input = (this.input = doc.createElement('textarea'));
    input.className = 'ct-bar-input';
    input.rows = 1;
    input.spellcheck = false;
    input.setAttribute('aria-label', messages.formulaBar);
    this.el.append(this.address, input);
    root.before(this.el);

    const grow = () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(120, input.scrollHeight)}px`;
    };
    input.addEventListener('focus', grow);
    input.addEventListener('input', () => {
      if (!host.editing()) host.openEditor(input.value);
      if (!host.editing()) return;
      host.typed(input.value);
      grow();
    });
    input.addEventListener('blur', (e) => {
      input.style.height = '';
      host.left(e.relatedTarget);
    });
    input.addEventListener('keydown', (e) => this.onKey(e));
  }

  private onKey(e: KeyboardEvent): void {
    const { input, host } = this;
    const leave = (dr: number, dc: number, commit: boolean) => {
      e.preventDefault();
      host.leave(dr, dc, commit);
    };
    if (e.key === 'Escape') leave(0, 0, false);
    else if (e.key === 'Tab') leave(0, e.shiftKey ? -1 : 1, true);
    else if (e.key === 'Enter' && e.altKey) {
      e.preventDefault();
      input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end');
      input.dispatchEvent(new Event('input'));
    } else if (e.key === 'Enter') leave(e.shiftKey ? -1 : 1, 0, true);
  }

  clear(): void {
    this.address.textContent = '';
    this.input.value = '';
    this.input.disabled = true;
  }

  show(label: string, readOnly: boolean): void {
    if (this.address.textContent !== label) this.address.textContent = label;
    this.input.disabled = false;
    this.input.readOnly = readOnly;
  }

  setText(text: string): void {
    if (this.input.value !== text) this.input.value = text;
  }
}
