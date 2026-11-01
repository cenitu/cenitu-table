import { expect, test } from '@playwright/test';

test('the server demo pages, filters and survives a failure', async ({ page }) => {
  await page.goto('/server.html');
  const pager = page.locator('.ct-pager');
  await expect(pager).toContainText('100000');
  await pager.getByRole('button').last().click();
  await expect(pager).toContainText('2 /');
  await page.locator('.ct-colhead', { hasText: 'Durum' }).hover();
  await page.locator('.ct-colhead', { hasText: 'Durum' }).locator('.ct-menu-btn').click();
  await page.getByLabel('İptal').check();
  await page.getByRole('button', { name: 'Tamam' }).click();
  await expect(pager).toContainText('25000');
  await expect(pager).toContainText('1 /');
  await page.locator('#fail').check();
  await pager.getByRole('button').last().click();
  await expect(page.locator('.ct-status')).toHaveText('Sunucuya ulaşılamadı');
  await expect(page.locator('.ct-cell').first()).toBeVisible();
});

test('Ctrl+click adds a range and Delete clears both', async ({ page }) => {
  await page.goto('/e2e/index.html');
  const result = await page.evaluate(async () => {
    const { CenituGrid } = await import('/src/index.ts' as string);
    const host = document.createElement('div');
    document.body.prepend(host);
    const grid = new CenituGrid(host, { data: [[1, 2, 3], [4, 5, 6], [7, 8, 9]], height: 200 });
    (window as unknown as { g: unknown }).g = grid;
    const box = grid.root.getBoundingClientRect();
    return { x: box.left, y: box.top };
  });
  await page.mouse.click(result.x + 50 + 50, result.y + 26 + 12);
  await page.keyboard.down('Control');
  await page.mouse.click(result.x + 50 + 250, result.y + 26 + 60);
  await page.keyboard.up('Control');
  const selected = await page.evaluate(() => (window as unknown as { g: { getSelected(): unknown } }).g.getSelected());
  expect(selected).toEqual([[0, 0, 0, 0], [2, 2, 2, 2]]);
  await page.keyboard.press('Delete');
  const data = await page.evaluate(() => (window as unknown as { g: { getData(): unknown } }).g.getData());
  expect(data).toEqual([[null, 2, 3], [4, 5, 6], [7, 8, null]]);
});

test('a row group collapses from its mark', async ({ page }) => {
  await page.goto('/e2e/index.html');
  await page.evaluate(async () => {
    const { CenituGrid } = await import('/src/index.ts' as string);
    const host = document.createElement('div');
    document.body.prepend(host);
    (window as unknown as { g: unknown }).g = new CenituGrid(host, { data: [['Grup'], ['a'], ['b'], ['Son']], height: 200, rowGroups: [{ row: 0, count: 2 }] });
  });
  await page.locator('.ct-group').first().click();
  const rows = await page.evaluate(() => (window as unknown as { g: { countRows(): number } }).g.countRows());
  expect(rows).toBe(2);
  await expect(page.locator('.ct-group').first()).toHaveAttribute('aria-expanded', 'false');
});
