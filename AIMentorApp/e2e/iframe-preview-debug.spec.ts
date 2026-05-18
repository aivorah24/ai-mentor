/**
 * Debug test: Verify iframe preview renders ALL tasks
 * Tests the exact scenario: HTML inside srcDoc iframe within a modal
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const API = 'http://localhost:3006';

test.describe('Iframe Preview Debug', () => {
  test.setTimeout(30_000);

  test('srcDoc iframe renders all 6 tasks', async ({ page }) => {
    // Get the quiz HTML from the server
    const quizPath = path.resolve(__dirname, '../../server/data/test-quiz-pyp4-mhle29.json');
    const quizData = JSON.parse(fs.readFileSync(quizPath, 'utf8'));

    const res = await page.request.post(`${API}/quiz/render-preview`, {
      data: { quiz: quizData },
    });
    const html = await res.text();
    console.log(`[debug] HTML length: ${html.length}`);
    console.log(`[debug] Contains Task 3: ${html.includes('Task 3')}`);
    console.log(`[debug] Contains Task 4: ${html.includes('Task 4')}`);
    console.log(`[debug] Contains Task 5: ${html.includes('Task 5')}`);
    console.log(`[debug] Contains Enrichment: ${html.includes('ENRICHMENT')}`);

    // Simulate exactly what the app does: put HTML in srcDoc iframe inside a container
    await page.setContent(`
      <html>
      <body style="margin:0;padding:0;background:#0f1117;height:100vh;">
        <div style="position:relative;width:100%;height:100vh;">
          <div style="height:56px;background:#161b22;display:flex;align-items:center;padding:0 16px;color:#fff;font-family:sans-serif;">
            <span style="font-weight:700">Preview</span>
          </div>
          <div id="iframe-container" style="position:absolute;top:56px;left:0;right:0;bottom:0;overflow:auto;background:#0f1117;">
            <iframe id="quiz-iframe" style="width:100%;height:8000px;border:none;background:#0f1117;display:block;" title="Quiz Preview"></iframe>
          </div>
        </div>
      </body>
      </html>
    `);

    // Set srcDoc via JavaScript (same as React does)
    await page.evaluate((htmlContent) => {
      const iframe = document.getElementById('quiz-iframe') as HTMLIFrameElement;
      iframe.srcdoc = htmlContent;
    }, html);

    // Wait for iframe to load
    await page.waitForTimeout(2000);

    // Now check what's visible inside the iframe
    const iframe = page.frameLocator('#quiz-iframe');

    // Check all task blocks
    const taskBlocks = iframe.locator('.task-block');
    const taskCount = await taskBlocks.count();
    console.log(`[debug] Task blocks in iframe: ${taskCount}`);

    // Check for each tier
    const body = await iframe.locator('body').textContent();
    console.log(`[debug] Has "MUST DO": ${body?.includes('MUST DO')}`);
    console.log(`[debug] Has "COULD DO": ${body?.includes('COULD DO')}`);
    console.log(`[debug] Has "ENRICHMENT": ${body?.includes('ENRICHMENT')}`);
    console.log(`[debug] Body text length: ${body?.length}`);

    // Check scrollable height of iframe content
    const scrollHeight = await page.evaluate(() => {
      const iframe = document.getElementById('quiz-iframe') as HTMLIFrameElement;
      return iframe.contentDocument?.documentElement?.scrollHeight;
    });
    console.log(`[debug] Iframe content scrollHeight: ${scrollHeight}px`);

    // Check container scroll state
    const containerInfo = await page.evaluate(() => {
      const c = document.getElementById('iframe-container');
      return {
        scrollHeight: c?.scrollHeight,
        clientHeight: c?.clientHeight,
        scrollTop: c?.scrollTop,
        overflow: c?.style.overflow,
      };
    });
    console.log(`[debug] Container:`, JSON.stringify(containerInfo));

    expect(taskCount).toBeGreaterThanOrEqual(6);
  });

  test('blob URL iframe renders all 6 tasks', async ({ page }) => {
    const quizPath = path.resolve(__dirname, '../../server/data/test-quiz-pyp4-mhle29.json');
    const quizData = JSON.parse(fs.readFileSync(quizPath, 'utf8'));

    const res = await page.request.post(`${API}/quiz/render-preview`, {
      data: { quiz: quizData },
    });
    const html = await res.text();

    // Create a blob URL and load it in iframe
    await page.setContent(`
      <html>
      <body style="margin:0;padding:0;background:#0f1117;height:100vh;">
        <div style="position:relative;width:100%;height:100vh;">
          <div style="height:56px;background:#161b22;"></div>
          <div id="iframe-container" style="position:absolute;top:56px;left:0;right:0;bottom:0;overflow:auto;">
            <iframe id="quiz-iframe" style="width:100%;height:8000px;border:none;display:block;"></iframe>
          </div>
        </div>
      </body>
      </html>
    `);

    // Use blob URL approach
    await page.evaluate((htmlContent) => {
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      (document.getElementById('quiz-iframe') as HTMLIFrameElement).src = url;
    }, html);

    await page.waitForTimeout(3000);

    const iframe = page.frameLocator('#quiz-iframe');
    const taskBlocks = iframe.locator('.task-block');
    const taskCount = await taskBlocks.count();
    console.log(`[debug-blob] Task blocks in iframe: ${taskCount}`);

    expect(taskCount).toBeGreaterThanOrEqual(6);
  });
});
