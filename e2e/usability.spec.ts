import { expect, test, type Page } from '@playwright/test';
import type { GridOptions } from '../src';

/** Find, formula bar, styled clipboard and import in a real browser. */

async function setup(page: Page, options: GridOptions) {
  await page.goto('/e2e/index.html');
  await page.waitForSelector('body[data-ready]');
  await page.evaluate((o) => window.make(o), options as never);
}

const source = (page: Page, row: number, col: number) => page.evaluate(([r, c]) => window.grid!.getSourceDataAtCell(r, c), [row, col]);

test('Ctrl+F opens the box, Enter jumps to a match far outside the viewport', async ({ page }) => {
  const data = Array.from({ length: 5000 }, (_, r) => [r === 4000 ? 'iğne' : `satır ${r}`]);
  await setup(page, { data, search: true, formulas: false });
  await page.keyboard.press('ControlOrMeta+f');
  const box = page.locator('.ct-search input[type=text]').first();
  await expect(box).toBeFocused();
  await box.fill('iğne');
  await page.keyboard.press('Enter');
  await expect(page.locator('.ct-search-status')).toHaveText('1 / 1');
  await expect(page.locator('.ct-cell.ct-match')).toHaveText('iğne');
  await page.keyboard.press('Escape');
  await expect(page.locator('.ct-search')).toHaveCount(0);
  expect(await page.evaluate(() => window.grid!.getSelected())).toEqual([[4000, 0, 4000, 0]]);
  await page.keyboard.type('x');
  await page.keyboard.press('Enter');
  expect(await source(page, 4000, 0)).toBe('x');
});

test('Ctrl+H replaces all, and one undo brings everything back', async ({ page }) => {
  await setup(page, { data: [['elma'], ['elma'], ['armut']], search: true });
  await page.keyboard.press('ControlOrMeta+h');
  await page.locator('.ct-search input[type=text]').nth(0).fill('elma');
  await page.locator('.ct-search input[type=text]').nth(1).fill('kiraz');
  await page.locator('.ct-search').getByRole('button', { name: 'Replace all' }).click();
  await expect(page.locator('.ct-search-status')).toHaveText('2 replaced');
  expect(await source(page, 1, 0)).toBe('kiraz');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await source(page, 0, 0)).toBe('elma');
  expect(await source(page, 1, 0)).toBe('elma');
});

test('editing in the formula bar with real focus changes', async ({ page }) => {
  await setup(page, { data: [[null, null], [null, null]], formulaBar: true });
  const bar = page.locator('.ct-bar-input');
  await bar.click();
  await page.keyboard.type('=5*5');
  await expect(page.locator('.ct-editor:not(.ct-idle)')).toHaveValue('=5*5');
  await page.keyboard.press('Enter');
  expect(await source(page, 0, 0)).toBe('=5*5');
  expect(await page.evaluate(() => window.grid!.getSelected())).toEqual([[1, 0, 1, 0]]);
  // Typing continues in the grid right after leaving the bar.
  await page.keyboard.type('7');
  await expect(bar).toHaveValue('7');
  await bar.click();
  await page.keyboard.type('8');
  await expect(page.locator('.ct-editor:not(.ct-idle)')).toHaveValue('78');
  await page.locator('.ct-cell').nth(1).click();
  expect(await source(page, 1, 0)).toBe(78);
  await expect(page.locator('.ct-editor:not(.ct-idle)')).toHaveCount(0);
});

test('Escape in the formula bar keeps the old value', async ({ page }) => {
  await setup(page, { data: [['eski']], formulaBar: true });
  await page.locator('.ct-bar-input').fill('yeni');
  await page.keyboard.press('Escape');
  expect(await source(page, 0, 0)).toBe('eski');
  await expect(page.locator('.ct-bar-input')).toHaveValue('eski');
  await page.keyboard.type('z');
  await page.keyboard.press('Enter');
  expect(await source(page, 0, 0)).toBe('z');
});

test('styled paste from HTML clipboard data', async ({ page, browserName }) => {
  test.skip(browserName === 'firefox', 'Firefox ignores clipboardData on constructed events');
  await setup(page, { data: [[null, null]] });
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '5\tx');
    dt.setData('text/html', '<style>.a{background:#ffff00}</style><table><tr><td class="a">5</td><td style="font-weight:700">x</td></tr></table>');
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  expect(await source(page, 0, 0)).toBe(5);
  await expect(page.locator('.ct-cell').first()).toHaveCSS('background-color', 'rgb(255, 255, 0)');
  await expect(page.locator('.ct-cell', { hasText: 'x' })).toHaveCSS('font-weight', '700');
});

test('copy offers HTML for styled cells', async ({ page, browserName }) => {
  test.skip(browserName === 'firefox', 'Firefox ignores clipboardData on constructed events');
  await setup(page, { data: [['a']] });
  await page.keyboard.press('ControlOrMeta+b');
  const html = await page.evaluate(() => {
    const dt = new DataTransfer();
    document.activeElement!.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    return dt.getData('text/html');
  });
  expect(html).toContain('font-weight:700');
});

test('imports a compressed workbook from a Blob, as a file input gives it', async ({ page }) => {
  await setup(page, { data: [[null]], formulaBar: true });
  await page.evaluate(async () => {
    const { toXLSXCompressed } = window.lib;
    const bytes = await toXLSXCompressed([{
      name: 'Veri',
      data: [['Başlık', 2], ['=B1*21', null]],
      frozen: { rows: 1, cols: 0 },
      format: (r) => (r === 0 ? { bold: true } : undefined),
    }]);
    await window.grid!.importXLSX(new Blob([bytes as BlobPart]));
  });
  await expect(page.locator('.ct-cell:visible', { hasText: 'Başlık' })).toHaveCSS('font-weight', '700');
  await expect(page.locator('.ct-cell:visible', { hasText: /^42$/ })).toBeVisible();
});

test('multi-column sort from the column menu shows priorities', async ({ page }) => {
  await setup(page, { data: [['Ad', 'N'], ['b', 2], ['a', 2], ['c', 1]], fixedRowsTop: 1, columnSorting: true });
  const header = (i: number) => page.locator('.ct-colhead').nth(i);
  await header(1).hover();
  await header(1).locator('.ct-menu-btn').click();
  await page.locator('.ct-menu').getByText('Sort Z → A').click();
  await header(0).hover();
  await header(0).locator('.ct-menu-btn').click();
  await page.locator('.ct-menu').getByText('Then sort A → Z').click();
  expect(await page.evaluate(() => window.grid!.getData().map((r) => r[0]))).toEqual(['Ad', 'a', 'b', 'c']);
  await expect(header(1).locator('.ct-sort')).toHaveText('▼1');
  await expect(header(0).locator('.ct-sort')).toHaveText('▲2');
});
