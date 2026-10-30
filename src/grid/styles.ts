const LIGHT = `
  --ct-bg: #fff;
  --ct-fg: #1f2328;
  --ct-muted: #57606a;
  --ct-grid: #e1e4e8;
  --ct-header-bg: #f6f8fa;
  --ct-header-fg: #57606a;
  --ct-header-hl: #dde7f8;
  --ct-accent: #1a73e8;
  --ct-range: rgba(26, 115, 232, 0.1);
  --ct-error: #cf222e;
  --ct-invalid-bg: #ffebe9;
  --ct-readonly-fg: #6e7781;
  --ct-shadow: rgba(31, 35, 40, .15);`;

const DARK = `
  --ct-bg: #0d1117;
  --ct-fg: #e6edf3;
  --ct-muted: #8b949e;
  --ct-grid: #30363d;
  --ct-header-bg: #161b22;
  --ct-header-fg: #8b949e;
  --ct-header-hl: #1f3a5f;
  --ct-accent: #4c8dff;
  --ct-range: rgba(76, 141, 255, 0.16);
  --ct-error: #ff7b72;
  --ct-invalid-bg: #3d1d1f;
  --ct-readonly-fg: #7d8590;
  --ct-shadow: rgba(0, 0, 0, .5);`;

const CSS = `
.ct-root, .ct-menu {${LIGHT}
}
@media (prefers-color-scheme: dark) {
  .ct-root:not(.ct-light), .ct-menu {${DARK}
  }
}
.ct-root.ct-dark {${DARK}
}
.ct-root {
  position: relative;
  overflow: auto;
  outline: none;
  background: var(--ct-bg);
  color: var(--ct-fg);
  font: 13px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  border: 1px solid var(--ct-grid);
  box-sizing: border-box;
  user-select: none;
}
.ct-canvas { position: relative; }
.ct-band { display: flex; }
.ct-band-top { position: sticky; top: 0; z-index: 3; }
.ct-pane { position: relative; flex: none; }
.ct-pane-corner, .ct-pane-left { position: sticky; left: 0; background: var(--ct-bg); }
.ct-pane-corner { z-index: 4; }
.ct-pane-left { z-index: 2; }
.ct-pane-top { background: var(--ct-bg); }
.ct-edge-r { box-shadow: 2px 0 3px -1px var(--ct-shadow); }
.ct-edge-b { box-shadow: 0 2px 3px -1px var(--ct-shadow); }
.ct-pane-corner.ct-edge-r.ct-edge-b { box-shadow: 2px 2px 3px -1px var(--ct-shadow); }

.ct-cell, .ct-header {
  position: absolute; box-sizing: border-box; padding: 0 6px; overflow: hidden;
  white-space: nowrap; text-overflow: ellipsis; display: flex; align-items: center;
  border-right: 1px solid var(--ct-grid); border-bottom: 1px solid var(--ct-grid);
}
.ct-cell { background: var(--ct-bg); }
.ct-cell.ct-num, .ct-cell.ct-date { justify-content: flex-end; font-variant-numeric: tabular-nums; }
.ct-cell.ct-bool, .ct-cell.ct-check { justify-content: center; }
.ct-cell.ct-err { color: var(--ct-error); justify-content: center; }
.ct-cell.ct-readonly { color: var(--ct-readonly-fg); }
.ct-cell.ct-invalid { background: var(--ct-invalid-bg); box-shadow: inset 0 0 0 1px var(--ct-error); }
.ct-cell.ct-dd { padding-right: 18px; }
.ct-cell.ct-dd::after { content: "▾"; position: absolute; right: 5px; color: var(--ct-muted); font-size: 11px; }
.ct-checkbox { font-size: 15px; cursor: pointer; line-height: 1; }

.ct-header { background: var(--ct-header-bg); color: var(--ct-header-fg); justify-content: center; font-size: 12px; cursor: default; }
.ct-header.ct-hl { background: var(--ct-header-hl); color: var(--ct-fg); font-weight: 600; }
.ct-colhead { gap: 3px; padding: 0 4px; }
.ct-label { overflow: hidden; text-overflow: ellipsis; }
.ct-sort { font-size: 9px; color: var(--ct-accent); }
.ct-sort:empty { display: none; }
.ct-menu-btn {
  margin-left: auto; border: 0; background: transparent; color: var(--ct-muted); cursor: pointer;
  font: inherit; font-size: 11px; padding: 1px 3px; border-radius: 3px; opacity: 0; flex: none;
}
.ct-colhead:hover .ct-menu-btn, .ct-filtered .ct-menu-btn { opacity: 1; }
.ct-menu-btn:hover { background: var(--ct-grid); }
.ct-filtered .ct-menu-btn { color: var(--ct-bg); background: var(--ct-accent); }
.ct-cornerhead { cursor: pointer; }
.ct-resize { position: absolute; top: 0; right: -3px; width: 6px; height: 100%; cursor: col-resize; z-index: 1; }
.ct-resize:hover { background: var(--ct-accent); opacity: .5; }

.ct-range { position: absolute; pointer-events: none; background: var(--ct-range); border: 1px solid var(--ct-accent); box-sizing: border-box; z-index: 1; }
.ct-active { position: absolute; pointer-events: none; border: 2px solid var(--ct-accent); box-sizing: border-box; z-index: 1; }
.ct-fill-area { position: absolute; pointer-events: none; border: 1px dashed var(--ct-accent); box-sizing: border-box; z-index: 1; }
.ct-fill {
  position: absolute; z-index: 2; background: var(--ct-accent); border: 1px solid var(--ct-bg);
  box-sizing: border-box; cursor: crosshair;
}
/* Larger hit area than the visible square. */
.ct-fill::before { content: ""; position: absolute; inset: -4px; }

.ct-editor {
  position: absolute; z-index: 5; box-sizing: border-box; margin: 0; padding: 3px 5px; resize: none; overflow: hidden;
  border: 2px solid var(--ct-accent); outline: none; font: inherit; color: var(--ct-fg); background: var(--ct-bg);
  white-space: pre; box-shadow: 0 2px 8px var(--ct-shadow);
}
.ct-editor.ct-idle { opacity: 0; pointer-events: none; box-shadow: none; z-index: 0; caret-color: transparent; }
.ct-dd-list {
  position: absolute; z-index: 6; max-height: 220px; overflow: auto; background: var(--ct-bg);
  border: 1px solid var(--ct-grid); box-shadow: 0 4px 12px var(--ct-shadow); padding: 2px 0;
}
.ct-dd-item { padding: 4px 8px; cursor: pointer; white-space: nowrap; }
.ct-dd-item:hover { background: var(--ct-range); }
.ct-dd-item.ct-on { background: var(--ct-accent); color: #fff; }

.ct-menu {
  position: fixed; z-index: 1000; width: 240px; box-sizing: border-box; padding: 6px 0;
  background: var(--ct-bg); color: var(--ct-fg); border: 1px solid var(--ct-grid); border-radius: 6px;
  box-shadow: 0 8px 24px var(--ct-shadow); font: 13px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.ct-menu-section { padding: 4px 10px; border-bottom: 1px solid var(--ct-grid); display: flex; flex-direction: column; gap: 4px; }
.ct-menu-title { font-size: 11px; font-weight: 600; color: var(--ct-muted); text-transform: uppercase; letter-spacing: .03em; padding-top: 2px; }
.ct-menu-item { text-align: left; border: 0; background: transparent; color: inherit; font: inherit; padding: 4px 6px; border-radius: 4px; cursor: pointer; }
.ct-menu-item:hover { background: var(--ct-range); }
.ct-menu-item.ct-on { color: var(--ct-accent); font-weight: 600; }
.ct-menu select, .ct-menu input[type=text], .ct-menu input[type=search] {
  font: inherit; padding: 4px 6px; border: 1px solid var(--ct-grid); border-radius: 4px; background: var(--ct-bg); color: inherit;
}
.ct-menu-list { max-height: 180px; overflow: auto; display: flex; flex-direction: column; }
.ct-menu-list label { display: flex; gap: 6px; align-items: center; padding: 2px 0; white-space: nowrap; cursor: pointer; }
.ct-menu-list label[hidden] { display: none; }
.ct-menu-footer { display: flex; gap: 6px; padding: 8px 10px 2px; align-items: center; }
.ct-menu-link { margin-right: auto; border: 0; background: transparent; color: var(--ct-accent); font: inherit; cursor: pointer; padding: 0; }
.ct-btn { font: inherit; padding: 4px 10px; border-radius: 4px; border: 1px solid var(--ct-grid); background: var(--ct-bg); color: inherit; cursor: pointer; }
.ct-btn.ct-primary { background: var(--ct-accent); border-color: var(--ct-accent); color: #fff; }
`;

export function injectStyles(doc: Document): void {
  if (doc.getElementById('ct-styles')) return;
  const style = doc.createElement('style');
  style.id = 'ct-styles';
  style.textContent = CSS;
  doc.head.appendChild(style);
}
