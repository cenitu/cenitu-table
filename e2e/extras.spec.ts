import { expect, test, type Page } from '@playwright/test';
import type { GridOptions } from '../src';

/** Layout-dependent features, which jsdom cannot measure. */

async function setup(page: Page, options: GridOptions) {
  await page.goto('/e2e/index.html');
  await page.waitForSelector('body[data-ready]');
  await page.evaluate((o) => window.make(o), options as never);
}

const manyRows = Array.from({ length: 500 }, (_, r) => [r + 1, `satır ${r + 1}`]);

test('the footer stays at the bottom while scrolling and keeps the last row reachable', async ({ page }) => {
  await setup(page, { data: manyRows, formulas: false, columns: [{ summary: 'sum' }, {}], height: 300 });
  const foot = page.locator('.ct-foot');
  await expect(page.locator('.ct-foot-cell')).toHaveText('125250');
  const root = (await page.locator('.ct-root').boundingBox())!;
  await page.locator('.ct-root').evaluate((el) => (el.scrollTop = 2000));
  const box = (await foot.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(root.y + root.height);
  expect(box.y + box.height).toBeGreaterThan(root.y + root.height - 20);
  await page.evaluate(() => window.grid!.selectCell(499, 0));
  const last = page.locator('.ct-cell:visible', { hasText: /^satır 500$/ });
  await expect(last).toBeVisible();
  const cell = (await last.boundingBox())!;
  const bar = (await foot.boundingBox())!;
  expect(cell.y + cell.height).toBeLessThanOrEqual(bar.y + 1);
});

test('a frozen column total stays put while scrolling sideways', async ({ page }) => {
  const data = [Array.from({ length: 30 }, (_, c) => c)];
  await setup(page, { data, formulas: false, fixedColumnsStart: 1, columns: [{ summary: 'count' }] });
  const cell = page.locator('.ct-foot-cell');
  const before = (await cell.boundingBox())!;
  await page.locator('.ct-root').evaluate((el) => (el.scrollLeft = 900));
  await expect.poll(async () => (await cell.boundingBox())!.x).toBeCloseTo(before.x, 0);
});

test('an expanded row shows its detail between rows and scrolls with them', async ({ page }) => {
  await page.goto('/e2e/index.html');
  await page.waitForSelector('body[data-ready]');
  await page.evaluate(() => {
    window.make({
      data: [{ a: 'bir' }, { a: 'iki' }, { a: 'üç' }],
      columns: [{ data: 'a' }],
      rowDetailHeight: 80,
      rowDetail: (el) => void (el.textContent = 'ayrıntı'),
    });
  });
  await page.locator('.ct-expand').first().click();
  const detail = page.locator('.ct-detail');
  await expect(detail).toHaveText('ayrıntı');
  const first = (await page.locator('.ct-cell:visible', { hasText: 'bir' }).boundingBox())!;
  const area = (await detail.boundingBox())!;
  const second = (await page.locator('.ct-cell:visible', { hasText: 'iki' }).boundingBox())!;
  expect(area.y).toBeCloseTo(first.y + first.height, 0);
  expect(second.y).toBeCloseTo(area.y + area.height, 0);
  await page.locator('.ct-active:visible').first().waitFor();
  const active = (await page.locator('.ct-active:visible').first().boundingBox())!;
  expect(active.height).toBeLessThan(30);
});

test('a dropdown with labels works with real typing', async ({ page }) => {
  await setup(page, { data: [[2]], columns: [{ type: 'dropdown', source: [{ value: 1, label: 'Açık' }, { value: 2, label: 'Kapalı' }] }] });
  await expect(page.locator('.ct-cell:visible').first()).toHaveText('Kapalı');
  await page.keyboard.type('aç');
  await expect(page.locator('.ct-dd-item')).toHaveText(['Açık']);
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.grid!.getSourceDataAtCell(0, 0))).toBe(1);
});

test('a custom editor takes focus and Escape returns to the grid', async ({ page }) => {
  await page.goto('/e2e/index.html');
  await page.waitForSelector('body[data-ready]');
  await page.evaluate(() => {
    window.make({
      data: [[1]],
      columns: [{
        editor: (ctx) => {
          const input = document.createElement('input');
          input.value = String(ctx.value);
          ctx.el.append(input);
          input.focus();
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') ctx.commit(Number(input.value), [1, 0]);
          });
          return { getValue: () => Number(input.value) };
        },
      }],
    });
  });
  await page.keyboard.press('Enter');
  const input = page.locator('.ct-custom-editor input');
  await expect(input).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type('5');
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  expect(await page.evaluate(() => window.grid!.getSourceDataAtCell(0, 0))).toBe(1);
  await page.keyboard.press('Enter');
  await input.fill('42');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.grid!.getSourceDataAtCell(0, 0))).toBe(42);
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });
  test.skip(({ browserName }) => browserName === 'firefox', 'Touch emulation is not available for Firefox');

  test('a tap selects a cell, without raising the keyboard', async ({ page }) => {
    await setup(page, { data: [[1, 2], [3, 4]] });
    await page.locator('.ct-cell:visible', { hasText: /^4$/ }).tap();
    expect(await page.evaluate(() => window.grid!.getSelected())).toEqual([[1, 1, 1, 1]]);
    await expect(page.locator('.ct-editor')).toHaveAttribute('inputmode', 'none');
  });

  test('the column menu opens with a tap', async ({ page }) => {
    await setup(page, { data: [['a'], ['b']], columnSorting: true });
    await page.locator('.ct-menu-btn').first().tap({ force: true });
    await expect(page.locator('.ct-menu')).toBeVisible();
  });
});
