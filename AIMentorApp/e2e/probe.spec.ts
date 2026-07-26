import { test } from '@playwright/test';

test('probe landing', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await page.waitForTimeout(6000);
  const html = await page.content();
  require('fs').writeFileSync('e2e/screenshots/dump.html', html);
  const frames = page.frames().map(f => f.url());
  console.log('=== FRAMES ===');
  console.log(JSON.stringify(frames));
  await page.screenshot({ path: 'e2e/screenshots/probe.png' });
});
