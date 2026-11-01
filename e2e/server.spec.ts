import { expect, test, type Page } from '@playwright/test';
import type { ServerQuery } from '../src';

/** Server mode against a fake backend of 1,000 records that answers after a short delay. */

declare global {
  interface Window {
    asked: ServerQuery[];
  }
}

async function setup(page: Page) {
  await page.goto('/e2e/index.html');
  await page.waitForSelector('body[data-ready]');
  await page.evaluate(() => {
    const all = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, code: `K${String(i + 1).padStart(4, '0')}`, status: i % 2 ? 'open' : 'done' }));
    window.asked = [];
    window.make({
      dataMode: 'server',
      rowKey: 'id',
      data: all.slice(0, 25),
      totalCount: 1000,
      height: 300,
      language: window.lib.enUS,
      columns: [
        { id: 'code', data: 'code', sortable: true },
        { id: 'status', data: 'status', serverFilter: { kind: 'list', options: [{ value: 'open' }, { value: 'done' }] } },
      ],
    });
    const g = window.grid!;
    g.addHook('afterQueryChange', (q) => {
      window.asked.push(q);
      g.updateSettings({ loading: true });
      setTimeout(() => {
        const list = q.filters.status?.kind === 'list' ? q.filters.status.values : undefined;
        let rows = all.filter((r) => !list || list.includes(r.status));
        if (q.sort[0]?.desc) rows = [...rows].reverse();
        const start = (q.page - 1) * q.pageSize;
        g.setPageRows(rows.slice(start, start + q.pageSize), rows.length);
        g.updateSettings({ loading: false });
      }, 50);
    });
  });
}

const first = (page: Page) => page.evaluate(() => window.grid!.getDataAtCell(0, 0));
const pager = (page: Page) => page.locator('.ct-pager');

test('pages through records, keeping the page bar and scroll position', async ({ page }) => {
  await setup(page);
  await expect(pager(page)).toContainText('1–25 of 1000');
  await page.locator('.ct-root').evaluate((el) => (el.scrollTop = 100));
  await pager(page).getByRole('button', { name: 'Next' }).click();
  await expect(pager(page)).toContainText('26–50 of 1000');
  await expect(page.locator('.ct-root')).toHaveAttribute('aria-busy', 'false');
  expect(await first(page)).toBe('K0026');
  expect(await page.locator('.ct-root').evaluate((el) => el.scrollTop)).toBe(100);
});

test('sorts across all records, not the loaded page', async ({ page }) => {
  await setup(page);
  const header = page.locator('.ct-colhead').first();
  await header.hover();
  await header.locator('.ct-menu-btn').click();
  await page.locator('.ct-menu').getByText('Sort Z → A').click();
  await expect.poll(() => first(page)).toBe('K1000');
  await expect(header.locator('.ct-sort')).toHaveText('▼');
});

test('filters on the server, updates the total and keeps the mark after new rows', async ({ page }) => {
  await setup(page);
  await pager(page).getByRole('button', { name: 'Next' }).click();
  await expect(pager(page)).toContainText('2 / 40');
  const header = page.locator('.ct-colhead').nth(1);
  await header.hover();
  await header.locator('.ct-menu-btn').click();
  await page.locator('.ct-menu label', { hasText: 'open' }).click();
  await page.locator('.ct-menu').getByRole('button', { name: 'OK' }).click();
  await expect(pager(page)).toContainText('1–25 of 500');
  await expect(header).toHaveClass(/ct-filtered/);
  expect(await page.evaluate(() => window.asked.at(-1)!.page)).toBe(1);
});

test('clicking the page bar with an open editor saves first, with real focus', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    window.asked = [];
    window.grid!.addHook('afterChange', (ch) => void window.asked.push({ saved: ch[0].rowKey, value: ch[0].newValue } as never));
    window.grid!.selectCell(0, 0);
  });
  await page.keyboard.type('yeni');
  await pager(page).getByRole('button', { name: 'Next' }).click();
  await expect(pager(page)).toContainText('26–50 of 1000');
  expect(await page.evaluate(() => window.asked[0])).toEqual({ saved: 1, value: 'yeni' });
});

test('the status message sits above the rows and clicks on an empty grid are harmless', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    window.grid!.setPageRows([], 0);
  });
  await expect(page.locator('.ct-status')).toHaveText('No records');
  await expect(pager(page)).toContainText('0–0 of 0');
  await expect(pager(page).getByRole('button', { name: 'Next' })).toBeDisabled();
  await page.locator('.ct-colhead').first().click();
  await page.keyboard.type('x');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.grid!.countRows())).toBe(0);
  await page.evaluate(() => window.grid!.updateSettings({ loadError: true }));
  await expect(page.locator('.ct-status')).toHaveText('Could not load the data');
});
