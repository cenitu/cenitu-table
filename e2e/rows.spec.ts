import { expect, test, type Page } from '@playwright/test';

/** Row events and column layout with real pointer input. */

declare global {
  interface Window {
    events: unknown[];
    layouts: unknown[];
  }
}

async function setup(page: Page, cancelEdit = false) {
  await page.goto('/e2e/index.html');
  await page.waitForSelector('body[data-ready]');
  await page.evaluate((cancel) => {
    window.events = [];
    window.layouts = [];
    window.make({
      rowKey: 'id',
      data: [{ id: 7, a: 'x', b: 'y' }, { id: 8, a: 'p', b: 'q' }],
      columns: [{ id: 'a', data: 'a' }, { id: 'b', data: 'b' }],
    });
    const g = window.grid!;
    g.addHook('afterRowClick', (e) => void window.events.push(['click', e.rowKey]));
    g.addHook('afterRowDoubleClick', (e) => {
      window.events.push(['dbl', e.rowKey]);
      return cancel ? false : undefined;
    });
    g.addHook('afterColumnLayout', (l) => void window.layouts.push(l));
  }, cancelEdit);
}

const cell = (page: Page, text: string) => page.locator('.ct-cell:visible', { hasText: new RegExp(`^${text}$`) });
const events = (page: Page) => page.evaluate(() => window.events);

test('a click reports its row; a drag across cells does not', async ({ page }) => {
  await setup(page);
  await cell(page, 'q').click();
  expect(await events(page)).toEqual([['click', 8]]);
  const from = (await cell(page, 'x').boundingBox())!;
  const to = (await cell(page, 'q').boundingBox())!;
  await page.mouse.move(from.x + 5, from.y + 5);
  await page.mouse.down();
  await page.mouse.move(to.x + 5, to.y + 5, { steps: 4 });
  await page.mouse.up();
  expect(await events(page)).toEqual([['click', 8]]);
  expect(await page.evaluate(() => window.grid!.getSelected())).toEqual([[0, 0, 1, 1]]);
});

test('double click fires after two clicks and opens the editor', async ({ page }) => {
  await setup(page);
  await cell(page, 'x').dblclick();
  expect(await events(page)).toEqual([['click', 7], ['click', 7], ['dbl', 7]]);
  await expect(page.locator('.ct-editor:not(.ct-idle)')).toBeVisible();
});

test('double click can open a record instead of the editor', async ({ page }) => {
  await setup(page, true);
  await cell(page, 'x').dblclick();
  await expect(page.locator('.ct-editor:not(.ct-idle)')).toHaveCount(0);
});

test('dragging a column edge reports the layout once, and it restores after a reload', async ({ page }) => {
  await setup(page);
  const edge = page.locator('.ct-colhead').first().locator('.ct-resize');
  const box = (await edge.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 5, { steps: 4 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.layouts.length)).toBe(1);
  const saved = await page.evaluate(() => JSON.stringify(window.grid!.getColumnLayout()));

  await page.reload();
  await page.waitForSelector('body[data-ready]');
  await page.evaluate((json) => {
    window.make({ data: [{ a: 1, b: 2 }], columns: [{ id: 'a', data: 'a' }, { id: 'b', data: 'b' }], columnLayout: JSON.parse(json) });
  }, saved);
  expect(await page.evaluate(() => window.grid!.getColWidth(0))).toBe(160);
});
