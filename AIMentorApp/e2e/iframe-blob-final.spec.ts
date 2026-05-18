/**
 * Test: blob URL iframe inside fixed container with overflow:hidden parent
 * This exactly matches the React Native Web DOM structure
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const API = 'http://localhost:3006';

test('blob URL iframe with JS injection inside RNW-style DOM', async ({ page }) => {
  const quizPath = path.resolve(__dirname, '../../server/data/test-quiz-pyp4-mhle29.json');
  const quizData = JSON.parse(fs.readFileSync(quizPath, 'utf8'));
  const res = await page.request.post(`${API}/quiz/render-preview`, { data: { quiz: quizData } });
  const html = await res.text();

  // Simulate exact React Native Web Modal structure
  // RNW adds overflow:hidden on MULTIPLE parent divs
  await page.setContent(`
    <html><body style="margin:0;height:100vh;overflow:hidden;">
      <div style="position:fixed;inset:0;overflow:hidden;">
        <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
          <div style="overflow:hidden;flex:1;position:relative;">
            <!-- Header -->
            <div style="height:56px;background:#161b22;display:flex;align-items:center;padding:0 16px;color:#fff;z-index:1;">
              <span>Preview</span>
            </div>
            <!-- This is what our code does: ref-based blob URL injection -->
            <div id="preview-mount" style="position:fixed;top:56px;left:0;right:0;bottom:0;overflow-y:auto;background:#0f1117;z-index:9999;"></div>
          </div>
        </div>
      </div>
    </body></html>
  `);

  // Inject iframe via blob URL (same as the ref callback does)
  await page.evaluate((htmlContent) => {
    const el = document.getElementById('preview-mount')!;
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const f = document.createElement('iframe');
    f.src = url;
    f.style.cssText = 'width:100%;height:6000px;border:none;background:#0f1117;display:block;';
    f.title = 'Quiz Preview';
    f.onload = () => {
      try {
        const h = f.contentDocument?.documentElement?.scrollHeight || 5000;
        f.style.height = Math.max(h, 3000) + 'px';
      } catch { f.style.height = '6000px'; }
    };
    el.appendChild(f);
  }, html);

  await page.waitForTimeout(3000);

  // Check iframe content
  const iframe = page.frameLocator('iframe[title="Quiz Preview"]');
  const taskBlocks = iframe.locator('.task-block');
  const taskCount = await taskBlocks.count();
  console.log(`[blob-final] Task blocks: ${taskCount}`);

  // Check enrichment is present
  const bodyText = await iframe.locator('body').textContent();
  console.log(`[blob-final] Has ENRICHMENT: ${bodyText?.includes('ENRICHMENT')}`);
  console.log(`[blob-final] Has Task 5: ${bodyText?.includes('Task 5')}`);

  // Check scroll behavior
  const scroll = await page.evaluate(() => {
    const c = document.getElementById('preview-mount')!;
    const f = c.querySelector('iframe')!;
    return {
      containerH: c.clientHeight,
      containerScrollH: c.scrollHeight,
      iframeH: f.clientHeight,
      canScroll: c.scrollHeight > c.clientHeight
    };
  });
  console.log(`[blob-final] Scroll info:`, JSON.stringify(scroll));

  // Must see ALL 6 tasks
  expect(taskCount).toBeGreaterThanOrEqual(6);
  expect(scroll.canScroll).toBe(true);

  // Take screenshot
  await page.screenshot({ path: 'debug-blob-final.png', fullPage: true });
});
