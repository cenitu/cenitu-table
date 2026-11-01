const LONG_PRESS = 500;
/** Finger travel that makes a press a scroll or a drag. */
const SLOP = 10;
const DOUBLE_TAP = 350;

export interface TouchHost {
  /** What lifting a long press does at a point, or undefined when it does nothing. */
  longPress(): ((x: number, y: number) => void) | undefined;
  /** A long press on a cell selects it; moving on from there extends the selection. */
  dragSelect: { start(x: number, y: number): void; move(x: number, y: number): void };
}

/**
 * Tapping and scrolling work through the browser's own emulation. Handles need more: a finger on
 * one would scroll the page, so the gesture is replayed as mouse events. A long press selects by
 * dragging, or opens the context menu when the finger lifts in place, which iOS does not do by
 * itself.
 */
export function bindTouch(canvas: HTMLElement, host: TouchHost): () => void {
  const doc = canvas.ownerDocument;
  const mouse = (target: EventTarget, type: string, t: Touch) =>
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: t.clientX, clientY: t.clientY }));
  let press = 0;
  let origin: { x: number; y: number } | null = null;
  let tapped = 0;
  const cancelPress = () => {
    clearTimeout(press);
    origin = null;
  };
  /** Follows one finger until it lifts, keeping the page from scrolling under it. */
  const follow = (onMove: (t: Touch) => void, onEnd: (t: Touch | undefined, cancelled: boolean) => void) => {
    const move = (ev: TouchEvent) => {
      if (ev.cancelable) ev.preventDefault();
      if (ev.touches[0]) onMove(ev.touches[0]);
    };
    const end = (ev: TouchEvent) => {
      doc.removeEventListener('touchmove', move);
      doc.removeEventListener('touchend', end);
      doc.removeEventListener('touchcancel', end);
      onEnd(ev.changedTouches[0], ev.type === 'touchcancel');
    };
    doc.addEventListener('touchmove', move, { passive: false });
    doc.addEventListener('touchend', end);
    doc.addEventListener('touchcancel', end);
  };
  const held = (x: number, y: number, onCell: boolean) => {
    origin = null;
    const menu = host.longPress();
    if (!onCell) return menu?.(x, y);
    host.dragSelect.start(x, y);
    let dragged = false;
    follow(
      (t) => {
        dragged ||= Math.hypot(t.clientX - x, t.clientY - y) > SLOP;
        if (dragged) host.dragSelect.move(t.clientX, t.clientY);
      },
      (t, cancelled) => {
        if (t && !cancelled && !dragged) menu?.(x, y);
      },
    );
  };
  const start = (e: TouchEvent) => {
    const target = e.target as HTMLElement;
    const touch = e.touches[0];
    cancelPress();
    if (!touch || e.touches.length > 1) return;
    if (target.closest('.ct-fill, .ct-resize, .ct-rresize')) {
      e.preventDefault();
      mouse(target, 'mousedown', touch);
      follow(
        (t) => mouse(doc, 'mousemove', t),
        (t, cancelled) => {
          if (!t) return;
          mouse(doc, 'mouseup', t);
          if (cancelled || !target.closest('.ct-resize') || Math.hypot(t.clientX - touch.clientX, t.clientY - touch.clientY) > SLOP) return;
          // preventDefault above keeps the browser from reporting double taps itself.
          const now = Date.now();
          if (now - tapped < DOUBLE_TAP) mouse(target, 'dblclick', t);
          tapped = now - tapped < DOUBLE_TAP ? 0 : now;
        },
      );
      return;
    }
    const { clientX: x, clientY: y } = touch;
    origin = { x, y };
    const onCell = !!target.closest('.ct-cell');
    press = setTimeout(() => held(x, y, onCell), LONG_PRESS) as unknown as number;
  };
  const moved = (e: TouchEvent) => {
    const t = e.touches[0];
    if (origin && t && Math.hypot(t.clientX - origin.x, t.clientY - origin.y) > SLOP) cancelPress();
  };
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', moved, { passive: true });
  canvas.addEventListener('touchend', cancelPress);
  canvas.addEventListener('touchcancel', cancelPress);
  return () => {
    cancelPress();
    canvas.removeEventListener('touchstart', start);
  };
}
