import { expect, test } from '@playwright/test';

// Budgets are several times what a laptop needs, so they catch regressions rather than slow runners.
const PAGE_SWITCH_MS = 150;
const FIRST_RENDER_MS = 1500;
const SCROLL_FRAME_MS = 50;

test('server mode: page switches of a 100,000 record list stay fast', async ({ page }) => {
  await page.goto('/server.html');
  await expect(page.locator('.ct-cell').first()).toBeVisible();
  const worst = await page.evaluate(async () => {
    const { CenituGrid } = await import('/src/index.ts' as string);
    const host = document.createElement('div');
    document.body.append(host);
    const rows = (start: number) => Array.from({ length: 50 }, (_, i) => ({ id: start + i, name: `Kayıt ${start + i}`, amount: i * 3 }));
    const grid = new CenituGrid(host, {
      dataMode: 'server',
      rowKey: 'id',
      height: 600,
      totalCount: 100000,
      columns: [{ id: 'id', data: 'id' }, { id: 'name', data: 'name' }, { id: 'amount', data: 'amount', type: 'numeric' }],
      data: rows(0),
    });
    let max = 0;
    for (let p = 1; p < 30; p++) {
      const t0 = performance.now();
      grid.setPageRows(rows(p * 50), 100000);
      max = Math.max(max, performance.now() - t0);
    }
    grid.destroy();
    return max;
  });
  console.log(`page switch, worst of 29: ${worst.toFixed(1)} ms`);
  expect(worst).toBeLessThan(PAGE_SWITCH_MS);
});

test('client mode: 100,000 rows open and scroll smoothly', async ({ page }) => {
  await page.goto('/server.html');
  const { build, frame } = await page.evaluate(async () => {
    const { CenituGrid } = await import('/src/index.ts' as string);
    const host = document.createElement('div');
    document.body.append(host);
    const data = Array.from({ length: 100000 }, (_, r) => [r, `Satır ${r}`, r * 2, r % 7]);
    const t0 = performance.now();
    const grid = new CenituGrid(host, { data, height: 600, formulas: false });
    const build = performance.now() - t0;
    let frame = 0;
    for (let i = 1; i <= 40; i++) {
      grid.root.scrollTop = i * 40000;
      const t1 = performance.now();
      grid.render();
      frame = Math.max(frame, performance.now() - t1);
    }
    grid.destroy();
    return { build, frame };
  });
  console.log(`build ${build.toFixed(0)} ms, worst frame ${frame.toFixed(1)} ms`);
  expect(build).toBeLessThan(FIRST_RENDER_MS);
  expect(frame).toBeLessThan(SCROLL_FRAME_MS);
});
