import { expect, test, type Page } from '@playwright/test';
import type { GridOptions } from '../src';

/** Real-browser behaviour that jsdom cannot cover: input pipeline, layout, pointer and clipboard. */

async function setup(page: Page, options: GridOptions) {
  await page.goto('/e2e/index.html');
  await page.waitForSelector('body[data-ready]');
  await page.evaluate((o) => window.make(o), options as never);
}

const cell = (page: Page, text: string) => page.locator('.ct-cell', { hasText: new RegExp(`^${text}$`) }).first();
const value = (page: Page, row: number, col: number) => page.evaluate(([r, c]) => window.grid!.getDataAtCell(r, c), [row, col]);
const source = (page: Page, row: number, col: number) => page.evaluate(([r, c]) => window.grid!.getSourceDataAtCell(r, c), [row, col]);

test('typing over a cell edits it, Enter commits and moves down', async ({ page }) => {
  await setup(page, { data: [[1, '=A1*2'], [null, null]] });
  await page.keyboard.type('21');
  await expect(page.locator('.ct-editor:not(.ct-idle)')).toBeVisible();
  await page.keyboard.press('Enter');
  expect(await value(page, 0, 1)).toBe(42);
  expect(await page.evaluate(() => window.grid!.getSelected())).toEqual([[1, 0, 1, 0]]);
});

test('text arriving without key events (IME / dictation) starts editing', async ({ page }) => {
  await setup(page, { data: [[null]] });
  await page.keyboard.insertText('çğüş');
  await page.keyboard.press('Enter');
  expect(await source(page, 0, 0)).toBe('çğüş');
});

test('keyboard copy and paste moves formulas relatively', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Automated key presses do not trigger the native clipboard commands in WebKit');
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await setup(page, { data: [[1, 10, '=A1+B1'], [2, 20, null], [3, 30, null]] });
  await page.evaluate(() => window.grid!.selectCell(0, 2));
  await page.keyboard.press('ControlOrMeta+c');
  await page.evaluate(() => window.grid!.selectCell(1, 2, 2, 2));
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() => source(page, 2, 2)).toBe('=A3+B3');
  expect(await value(page, 2, 2)).toBe(33);
});

test('copy and paste events are handled with real clipboard data', async ({ page, browserName }) => {
  test.skip(browserName === 'firefox', 'Firefox ignores clipboardData on constructed events; the keyboard test covers it');
  await setup(page, { data: [[1, 10, '=A1+B1'], [2, 20, null]] });
  const copied = await page.evaluate(() => {
    window.grid!.selectCell(0, 2);
    const dt = new DataTransfer();
    document.activeElement!.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    window.grid!.selectCell(1, 2);
    const paste = new DataTransfer();
    paste.setData('text/plain', dt.getData('text/plain'));
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: paste, bubbles: true, cancelable: true }));
    return dt.getData('text/plain');
  });
  expect(copied).toBe('11');
  expect(await source(page, 1, 2)).toBe('=A2+B2');
});

test('dragging the fill handle extends a series', async ({ page }) => {
  await setup(page, { data: [[10], [20], [null], [null], [null]] });
  await page.evaluate(() => window.grid!.selectCell(0, 0, 1, 0));
  const handle = page.locator('.ct-fill:visible');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 3, box.y + 3 * 24, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.grid!.getData().map((r) => r[0]))).toEqual([10, 20, 30, 40, 50]);
});

test('column resize by dragging the header edge', async ({ page }) => {
  await setup(page, { data: [[1, 2]] });
  const edge = page.locator('.ct-colhead').first().locator('.ct-resize');
  const box = (await edge.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 5, { steps: 4 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.grid!.getColWidth(0))).toBe(160);
});

test('column menu sorts and filters through the UI', async ({ page }) => {
  await setup(page, {
    data: [['Name', 'Qty'], ['pear', 3], ['apple', 10], ['fig', 1]],
    fixedRowsTop: 1,
    columnSorting: true,
    filters: true,
  });
  const header = page.locator('.ct-colhead').nth(1);
  await header.hover();
  await header.locator('.ct-menu-btn').click();
  await page.locator('.ct-menu').getByText('Sort A → Z').click();
  expect(await page.evaluate(() => window.grid!.getData().map((r) => r[0]))).toEqual(['Name', 'fig', 'pear', 'apple']);
  await header.hover();
  await header.locator('.ct-menu-btn').click();
  await page.locator('.ct-menu select').selectOption('greaterThan');
  await page.locator('.ct-menu input[type=text]').fill('2');
  await page.locator('.ct-menu').getByRole('button', { name: 'OK' }).click();
  expect(await page.evaluate(() => window.grid!.getData().map((r) => r[0]))).toEqual(['Name', 'pear', 'apple']);
});

test('frozen rows and columns stay in place while scrolling', async ({ page }) => {
  const data = Array.from({ length: 300 }, (_, r) => Array.from({ length: 30 }, (_, c) => `${r}:${c}`));
  await setup(page, { data, fixedRowsTop: 1, fixedColumnsStart: 1, formulas: false });
  const before = (await cell(page, '0:0').boundingBox())!;
  await page.locator('.ct-root').evaluate((el) => {
    el.scrollTop = 3000;
    el.scrollLeft = 800;
  });
  await expect(cell(page, '130:12')).toBeVisible();
  const after = (await cell(page, '0:0').boundingBox())!;
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  const frozenLeft = (await cell(page, '130:0').boundingBox())!;
  expect(frozenLeft.x).toBeCloseTo(before.x, 0);
});

test('virtual scrolling reaches the end of 100,000 rows', async ({ page }) => {
  await setup(page, { data: [], minRows: 100000, minCols: 5, formulas: false });
  await page.evaluate(() => window.grid!.setDataAtCell(99999, 0, 'last'));
  await page.locator('.ct-root').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(cell(page, 'last')).toBeVisible();
  const cells = await page.locator('.ct-cell:visible').count();
  expect(cells).toBeLessThan(400);
});

test('right-click opens the context menu and inserts a row', async ({ page }) => {
  await setup(page, { data: [[1], [2]], contextMenu: true });
  await cell(page, '2').click({ button: 'right' });
  await expect(page.locator('.ct-context')).toBeVisible();
  await page.locator('.ct-context [data-key="row_above"]').click();
  expect(await page.evaluate(() => window.grid!.getData().map((r) => r[0]))).toEqual([1, null, 2]);
});

test('dropdown editor filters choices and commits with Enter', async ({ page }) => {
  await setup(page, { data: [['Red']], columns: [{ type: 'dropdown', source: ['Red', 'Green', 'Blue'] }] });
  await page.keyboard.type('bl');
  await expect(page.locator('.ct-dd-item')).toHaveText(['Blue']);
  await page.keyboard.press('Enter');
  expect(await source(page, 0, 0)).toBe('Blue');
});

test('checkbox toggles on click', async ({ page }) => {
  await setup(page, { data: [[false]], columns: [{ type: 'checkbox' }] });
  await page.locator('.ct-checkbox').click();
  expect(await value(page, 0, 0)).toBe(true);
});

test('Ctrl+B makes the selection bold', async ({ page }) => {
  await setup(page, { data: [['x']] });
  await page.keyboard.press('ControlOrMeta+b');
  await expect(cell(page, 'x')).toHaveCSS('font-weight', '700');
});

test('dragging a selected column header moves the column', async ({ page }) => {
  await setup(page, { data: [['a', 'b', 'c', '=A1&B1&C1']] });
  const headers = page.locator('.ct-colhead');
  await headers.nth(0).click();
  const from = (await headers.nth(0).boundingBox())!;
  const to = (await headers.nth(2).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + 5);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width - 5, to.y + 5, { steps: 6 });
  await expect(page.locator('.ct-drop')).toBeVisible();
  await page.mouse.up();
  expect(await page.evaluate(() => window.grid!.getData()[0])).toEqual(['b', 'c', 'a', 'abc']);
  expect(await source(page, 0, 3)).toBe('=C1&A1&B1');
});

test('dynamic array results spill into neighbouring cells', async ({ page }) => {
  await setup(page, { data: [['=SEQUENCE(3,2)', null, null], [null, null, null], [null, null, '=SUM(A1:B3)']] });
  await expect(cell(page, '6')).toBeVisible();
  expect(await value(page, 2, 2)).toBe(21);
  await page.evaluate(() => window.grid!.setDataAtCell(1, 1, 'x'));
  expect(await page.evaluate(() => String(window.grid!.getDataAtCell(0, 0)))).toBe('#SPILL!');
});
