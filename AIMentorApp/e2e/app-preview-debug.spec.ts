/**
 * Debug: Test the ACTUAL app preview at localhost:8081
 * Checks if the iframe in the real React app renders all tasks
 */
import { test, expect } from '@playwright/test';

test.describe('App Preview Debug', () => {
  test.setTimeout(60_000);

  test('Check actual app iframe content', async ({ page }) => {
    await page.goto('http://localhost:8081/teacher/assignments');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Take screenshot of initial state
    await page.screenshot({ path: 'debug-app-1-initial.png', fullPage: true });

    // Check what's on the page
    const pageContent = await page.content();
    console.log(`[app] Page HTML length: ${pageContent.length}`);

    // Check if there's an iframe on the page
    const iframes = page.locator('iframe');
    const iframeCount = await iframes.count();
    console.log(`[app] Iframes on page: ${iframeCount}`);

    if (iframeCount > 0) {
      // Check each iframe
      for (let i = 0; i < iframeCount; i++) {
        const iframe = iframes.nth(i);
        const srcDoc = await iframe.getAttribute('srcdoc');
        const src = await iframe.getAttribute('src');
        const title = await iframe.getAttribute('title');
        const style = await iframe.getAttribute('style');

        console.log(`[app] Iframe ${i}: title="${title}", src="${src?.substring(0, 80)}", srcDoc length=${srcDoc?.length || 0}, style="${style}"`);

        if (srcDoc && srcDoc.length > 100) {
          console.log(`[app] srcDoc contains Task 3: ${srcDoc.includes('Task 3')}`);
          console.log(`[app] srcDoc contains ENRICHMENT: ${srcDoc.includes('ENRICHMENT')}`);
          console.log(`[app] srcDoc first 200: ${srcDoc.substring(0, 200)}`);
          console.log(`[app] srcDoc last 200: ${srcDoc.substring(srcDoc.length - 200)}`);

          // Check task-block count via frameLocator
          const fl = page.frameLocator(`iframe[title="${title}"]`);
          const taskBlocks = fl.locator('.task-block');
          const tc = await taskBlocks.count().catch(() => -1);
          console.log(`[app] Task blocks in iframe: ${tc}`);
        }
      }
    }

    // Check if there's a div with the preview content
    const previewDivs = page.locator('div[style*="absolute"]');
    const pdCount = await previewDivs.count();
    console.log(`[app] Absolute-positioned divs: ${pdCount}`);

    // Check parent containers
    const modalContent = await page.evaluate(() => {
      const allDivs = document.querySelectorAll('div');
      const info: any[] = [];
      allDivs.forEach(d => {
        const s = getComputedStyle(d);
        if (s.overflow === 'hidden' && d.scrollHeight > 200) {
          info.push({
            tag: d.tagName,
            className: d.className?.substring(0, 50),
            overflow: s.overflow,
            height: s.height,
            maxHeight: s.maxHeight,
            scrollHeight: d.scrollHeight,
            clientHeight: d.clientHeight,
          });
        }
      });
      return info;
    });
    console.log(`[app] Divs with overflow:hidden:`, JSON.stringify(modalContent, null, 2));

    await page.screenshot({ path: 'debug-app-2-final.png', fullPage: true });
  });
});
