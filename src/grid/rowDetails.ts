import type { RawCell } from '../formula/values';
import type { DataRow } from './binding';
import { setBox } from './gridUtil';

const DETAIL_HEIGHT = 160;

export interface RowDetailsHost {
  root: HTMLElement;
  band(): HTMLElement;
  make(cls: string, parent: HTMLElement): HTMLDivElement;
  render(): ((el: HTMLElement, rowData: DataRow | RawCell[] | undefined, row: number) => void | (() => void)) | undefined;
  height(): number | 'auto' | undefined;
  toPhysical(row: number): number;
  rowData(row: number): DataRow | RawCell[] | undefined;
  /** Top of a detail area of the given height under a visual row. */
  topOf(row: number, height: number): number;
  firstRow(): number;
  /** Heights changed: rows must be laid out again. */
  relayout(): void;
}

/** Areas that open under rows. Only rows on screen have an element. */
export class RowDetails {
  /** Expanded rows (physical). */
  open = new Set<number>();
  private els = new Map<number, { el: HTMLDivElement; cleanup: void | (() => void); observer?: ResizeObserver }>();
  /** Measured heights with `rowDetailHeight: 'auto'` (physical). */
  private sizes = new Map<number, number>();

  constructor(private readonly host: RowDetailsHost) {}

  heightOf(p: number): number {
    if (!this.open.has(p)) return 0;
    const height = this.host.height() ?? DETAIL_HEIGHT;
    return height === 'auto' ? this.sizes.get(p) ?? DETAIL_HEIGHT : height;
  }

  private closeEl(p: number): void {
    const open = this.els.get(p);
    if (!open) return;
    this.els.delete(p);
    open.observer?.disconnect();
    if (typeof open.cleanup === 'function') open.cleanup();
    open.el.remove();
  }

  /** Removes what is on screen; rows stay marked as open. */
  closeAll(): void {
    for (const p of [...this.els.keys()]) this.closeEl(p);
  }

  /** Measured heights belong to rows that may have moved. */
  forgetSizes(): void {
    this.sizes.clear();
    this.closeAll();
  }

  reset(): void {
    this.open.clear();
    this.forgetSizes();
  }

  /** Takes an area's content height; true when it changed and rows must be laid out again. */
  private measure(p: number, body: HTMLElement): boolean {
    const height = body.offsetHeight;
    if (!height || height === this.sizes.get(p)) return false;
    this.sizes.set(p, height);
    return true;
  }

  /** Each area is positioned under its row's cells. */
  render(r0: number, r1: number): void {
    const { host } = this;
    const render = host.render();
    if (!render) return;
    const wanted = new Set<number>();
    let measured = false;
    for (let r = Math.max(r0, host.firstRow()); r <= r1; r++) {
      const p = host.toPhysical(r);
      if (!this.open.has(p)) continue;
      wanted.add(p);
      let open = this.els.get(p);
      if (!open) {
        const el = host.make('ct-detail', host.band());
        const body = host.make('ct-detail-body', el);
        open = { el, cleanup: render(body, host.rowData(r), r) };
        this.els.set(p, open);
        if (host.height() === 'auto') {
          measured = this.measure(p, body) || measured;
          // Content may grow later, e.g. when it finishes loading.
          const view = host.root.ownerDocument.defaultView;
          if (view && 'ResizeObserver' in view) {
            open.observer = new view.ResizeObserver(() => {
              if (this.measure(p, body)) host.relayout();
            });
            open.observer.observe(body);
          }
        }
      }
      const height = this.heightOf(p);
      setBox(open.el, host.root.scrollLeft, host.topOf(r, height), host.root.clientWidth || 800, height);
    }
    for (const p of [...this.els.keys()]) if (!wanted.has(p)) this.closeEl(p);
    if (measured) host.relayout();
  }
}
