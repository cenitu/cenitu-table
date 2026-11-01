const LONG_PRESS = 500;
/** Finger travel that makes a press a scroll or a drag. */
const SLOP = 10;

export interface TouchHost {
  /** What a long press does at a point, or undefined when it does nothing. */
  longPress(): ((x: number, y: number) => void) | undefined;
  /** Touch selection: a long press on a cell, or a drag from the selection's corner, extends it. */
  dragSelect?: { start(x: number, y: number): boolean; move(x: number, y: number): void };
}

/**
 * Tapping and scrolling work through the browser's own emulation. Handles need more: a finger on
 * one would scroll the page, so the gesture is replayed as mouse events. Long press opens the
 * context menu, which iOS does not do by itself.
 */
export function bindTouch(canvas: HTMLElement, host: TouchHost): () => void {
  const doc = canvas.ownerDocument;
  const mouse = (target: EventTarget, type: string, t: Touch) =>
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: t.clientX, clientY: t.clientY }));
  let press = 0;
  const cancelPress = () => clearTimeout(press);
  /** Follows one finger until it lifts, keeping the page from scrolling under it. */
  const follow = (onMove: (t: Touch) => void, onEnd: (t: Touch | undefined) => void) => {
    const move = (ev: TouchEvent) => {
      ev.preventDefault();
      if (ev.touches[0]) onMove(ev.touches[0]);
    };
    const end = (ev: TouchEvent) => {
      doc.removeEventListener('touchmove', move);
      doc.removeEventListener('touchend', end);
      doc.removeEventListener('touchcancel', end);
      onEnd(ev.changedTouches[0]);
    };
    doc.addEventListener('touchmove', move, { passive: false });
    doc.addEventListener('touchend', end);
    doc.addEventListener('touchcancel', end);
  };
  const start = (e: TouchEvent) => {
    const target = e.target as HTMLElement;
    const touch = e.touches[0];
    if (!touch || e.touches.length > 1) return cancelPress();
    if (target.closest('.ct-fill, .ct-resize, .ct-rresize')) {
      e.preventDefault();
      mouse(target, 'mousedown', touch);
      follow(
        (t) => mouse(doc, 'mousemove', t),
        (t) => {
          if (t) mouse(doc, 'mouseup', t);
        },
      );
      return;
    }
    const { clientX, clientY } = touch;
    const run = host.longPress();
    if (!run) return;
    press = setTimeout(() => run(clientX, clientY), LONG_PRESS) as unknown as number;
  };
  const moved = (e: TouchEvent) => {
    void e;
    cancelPress();
  };
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', moved, { passive: true });
  canvas.addEventListener('touchend', cancelPress);
  canvas.addEventListener('touchcancel', cancelPress);
  void SLOP;
  return () => {
    cancelPress();
    canvas.removeEventListener('touchstart', start);
  };
}
