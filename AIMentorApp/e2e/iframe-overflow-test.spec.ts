/**
 * Test: Verify position:fixed escapes overflow:hidden parents
 * This simulates exactly what React Native Web does
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const API = 'http://localhost:3006';

test('position:fixed iframe inside overflow:hidden parent shows ALL tasks', async ({ page }) => {
  const quizPath = path.resolve(__dirname, '../../server/data/test-quiz-pyp4-mhle29.json');
  const quizData = JSON.parse(fs.readFileSync(quizPath, 'utf8'));
  const res = await page.request.post(`${API}/quiz/render-preview`, { data: { quiz: quizData } });
  const html = await res.text();

  // Simulate React Native Web: parent View has overflow:hidden (the ROOT CAUSE)
  await page.setContent(`
    <html><body style="margin:0;height:100vh;background:#0f1117;">
      <!-- This simulates React Native Web Modal > View (overflow:hidden!) -->
      <div style="position:relative;width:100%;height:100vh;overflow:hidden;">
        <div style="height:56px;background:#161b22;color:#fff;display:flex;align-items:center;padding:0 16px;">
          <span>Preview header</span>
        </div>
        <!-- position:fixed escapes the overflow:hidden parent -->
        <div id="iframe-container" style="position:fixed;top:56px;left:0;right:0;bottom:0;overflow:auto;background:#0f1117;z-index:9999;">
          <iframe id="quiz-iframe" srcdoc='${html.replace(/'/g, "&#39;")}' style="width:100%;height:8000px;border:none;display:block;"></iframe>
        </div>
      </div>
    </body></html>
  `);

  await page.waitForTimeout(2000);

  const iframe = page.frameLocator('#quiz-iframe');
  const taskBlocks = iframe.locator('.task-block');
  const taskCount = await taskBlocks.count();
  console.log(`[fixed] Task blocks: ${taskCount}`);

  // Verify scrolling works
  const containerScroll = await page.evaluate(() => {
    const c = document.getElementById('iframe-container')!;
    return { scrollHeight: c.scrollHeight, clientHeight: c.clientHeight, canScroll: c.scrollHeight > c.clientHeight };
  });
  console.log(`[fixed] Container can scroll: ${containerScroll.canScroll} (${containerScroll.scrollHeight} > ${containerScroll.clientHeight})`);

  expect(taskCount).toBeGreaterThanOrEqual(6);
  expect(containerScroll.canScroll).toBe(true);
});
