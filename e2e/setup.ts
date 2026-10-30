import * as lib from '../src';

/** Test page: specs call `window.make(options)` and then drive the grid through the real browser. */
declare global {
  interface Window {
    lib: typeof lib;
    grid?: lib.CenituGrid;
    make(options: lib.GridOptions): void;
  }
}

window.lib = lib;
window.make = (options) => {
  window.grid?.destroy();
  window.grid = new lib.CenituGrid(document.getElementById('host')!, { height: 400, ...options });
  window.grid.selectCell(0, 0);
  window.grid.focus();
};
document.body.dataset.ready = 'true';
