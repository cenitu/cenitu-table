export interface MenuItem {
  key: string;
  name: string;
  /** Keyboard shortcut hint shown on the right, e.g. "Ctrl+C". */
  hint?: string;
  disabled?: boolean;
  run(): void;
}

/** A `'---'` entry renders a separator. */
export type MenuEntry = MenuItem | '---';

/**
 * Small accessible popup menu at a viewport position. Arrow keys move, Enter/Space run,
 * Escape or a click outside closes. Returns a function that closes it.
 */
export function openPopupMenu(doc: Document, entries: MenuEntry[], x: number, y: number, onClose: () => void): () => void {
  const menu = doc.createElement('div');
  menu.className = 'ct-menu ct-context';
  menu.setAttribute('role', 'menu');
  const buttons: HTMLButtonElement[] = [];
  let lastSep = true;
  for (const e of entries) {
    if (e === '---') {
      if (!lastSep) menu.append(Object.assign(doc.createElement('div'), { className: 'ct-menu-sep' }));
      lastSep = true;
      continue;
    }
    lastSep = false;
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'ct-menu-item';
    b.setAttribute('role', 'menuitem');
    b.dataset.key = e.key;
    b.disabled = !!e.disabled;
    const label = doc.createElement('span');
    label.textContent = e.name;
    b.append(label);
    if (e.hint) {
      const hint = doc.createElement('span');
      hint.className = 'ct-menu-hint';
      hint.textContent = e.hint;
      b.append(hint);
    }
    b.addEventListener('click', () => {
      close();
      e.run();
    });
    buttons.push(b);
    menu.append(b);
  }
  doc.body.append(menu);

  // Keep the menu inside the viewport.
  const view = doc.defaultView;
  const w = menu.offsetWidth || 220;
  const h = menu.offsetHeight || 300;
  menu.style.left = `${Math.max(4, Math.min(x, (view?.innerWidth ?? 1024) - w - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, (view?.innerHeight ?? 768) - h - 4))}px`;

  const enabled = () => buttons.filter((b) => !b.disabled);
  enabled()[0]?.focus();

  const onKey = (e: KeyboardEvent) => {
    const list = enabled();
    const i = list.indexOf(doc.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      close();
    }
    e.stopPropagation();
  };
  const onDown = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) close();
  };
  menu.addEventListener('keydown', onKey);
  doc.addEventListener('mousedown', onDown, true);
  view?.addEventListener('blur', close);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    doc.removeEventListener('mousedown', onDown, true);
    view?.removeEventListener('blur', close);
    menu.remove();
    onClose();
  }
  return close;
}
