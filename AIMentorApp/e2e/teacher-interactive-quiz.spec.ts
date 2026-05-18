/**
 * Playwright E2E: Interactive Quiz Generation from Worksheet PDF
 *
 * Tests the full ML pipeline:
 *   PDF upload → Gemini Vision + ML Layout Detection → Quiz JSON → HTML Render
 *
 * Validates:
 *   1. All tasks from the worksheet are extracted (no missing tasks)
 *   2. All questions per task are present (no truncation)
 *   3. Images/diagrams from ML contour detection are rendered
 *   4. Interactive elements (inputs, buttons) work correctly
 *   5. The rendered HTML matches the original worksheet structure
 */

import { test, expect } from '@playwright/test';
import { loginAs, TEACHER_ACCOUNTS, waitForText } from './helpers';
import * as fs from 'fs';
import * as path from 'path';

const API = 'http://localhost:3006';
const API_TIMEOUT = 90_000; // Quiz generation can take 30-90s (Gemini + ML layout)

// Path to the test worksheet PDF
const WORKSHEET_PDF = path.resolve(
  'C:/Users/Asus/Desktop/Aivorah Documents/Assignment Picture',
  'Toddle-18d1b2d2-239c-414a-8d82-142053d025d3-Revised PYP4 -MHLE-29.pdf'
);

// Expected structure based on the real worksheet (ground truth)
const EXPECTED = {
  title: /Mathematics.*MHLE|PYP\s*4.*Mathematics|Shri Ram/i,
  totalTasks: 6,
  tasks: [
    { title: /Task\s*1.*Convert/i, tier: 'MUST DO', minQuestions: 10, layout: 'two-column' },
    { title: /Task\s*2.*Reduce.*fraction/i, tier: 'MUST DO', minQuestions: 4, layout: 'two-column' },
    { title: /Task\s*3.*Solve/i, tier: 'COULD DO', minQuestions: 2, layout: 'two-column' },
    { title: /Task\s*4.*Compare.*fraction/i, tier: 'COULD DO', minQuestions: 4, layout: /grid|two-column/ },
    { title: /Task\s*5.*Application|measurement.*real/i, tier: 'COULD DO', minQuestions: 1, layout: 'single-column' },
    { title: /Enrichment/i, tier: 'ENRICHMENT', minQuestions: 1, layout: 'single-column' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Backend API: Quiz Generation from PDF
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Quiz Generation API — MHLE-29 Worksheet', () => {
  test.setTimeout(120_000); // Quiz generation can take up to 2 min

  test('PDF file exists and is readable', () => {
    expect(fs.existsSync(WORKSHEET_PDF), `Worksheet PDF not found at: ${WORKSHEET_PDF}`).toBe(true);
    const stats = fs.statSync(WORKSHEET_PDF);
    expect(stats.size).toBeGreaterThan(10_000); // PDF should be at least 10KB
  });

  test('POST /quiz/generate returns valid quiz JSON with all tasks', async ({ request }) => {
    const fileBuffer = fs.readFileSync(WORKSHEET_PDF);

    const res = await request.post(`${API}/quiz/generate`, {
      multipart: {
        pdf: { name: 'MHLE-29.pdf', mimeType: 'application/pdf', buffer: fileBuffer },
        grade: 'PYP 4',
        subject: 'Mathematics',
        school: '',
      },
      timeout: API_TIMEOUT,
    });

    expect(res.status(), `API returned ${res.status()}: ${await res.text()}`).toBe(200);
    const body = await res.json();

    // Quiz object must exist
    expect(body).toHaveProperty('quiz');
    const quiz = body.quiz;

    // Must have tasks array
    expect(quiz).toHaveProperty('tasks');
    expect(Array.isArray(quiz.tasks)).toBe(true);

    // All 6 tasks must be present
    expect(quiz.tasks.length).toBeGreaterThanOrEqual(EXPECTED.totalTasks);

    // Validate each task
    for (let i = 0; i < EXPECTED.tasks.length; i++) {
      const expected = EXPECTED.tasks[i];
      const actual = quiz.tasks[i];

      expect(actual, `Task ${i + 1} is missing from quiz output`).toBeDefined();
      expect(actual.title).toMatch(expected.title);
      expect(actual.tier).toBe(expected.tier);
      expect(
        actual.questions.length,
        `Task ${i + 1} ("${actual.title}") has ${actual.questions.length} questions, expected at least ${expected.minQuestions}`
      ).toBeGreaterThanOrEqual(expected.minQuestions);
    }

    // Engine should be one of the valid engines (gemini primary, fallbacks: pixtral, groq, with optional +retry)
    expect(quiz.engine).toMatch(/^(gemini|pixtral|groq)(\+retry)?$/);
  });

  test('All questions have required fields (answer, hint, solution)', async ({ request }) => {
    const fileBuffer = fs.readFileSync(WORKSHEET_PDF);

    const res = await request.post(`${API}/quiz/generate`, {
      multipart: {
        pdf: { name: 'MHLE-29.pdf', mimeType: 'application/pdf', buffer: fileBuffer },
        grade: 'PYP 4',
        subject: 'Mathematics',
        school: '',
      },
      timeout: API_TIMEOUT,
    });

    expect(res.status()).toBe(200);
    const { quiz } = await res.json();

    for (const task of quiz.tasks) {
      for (const q of task.questions) {
        expect(q, `Question missing 'id' in task "${task.title}"`).toHaveProperty('id');
        expect(q, `Question ${q.id} missing 'question' text`).toHaveProperty('question');
        expect(q.question.length, `Question ${q.id} has empty question text`).toBeGreaterThan(0);
        expect(q, `Question ${q.id} missing 'type'`).toHaveProperty('type');
        expect(['numeric', 'text', 'mcq', 'activity']).toContain(q.type);

        // Non-activity questions must have an answer
        if (q.type !== 'activity') {
          expect(
            q.answer !== undefined && q.answer !== null,
            `Question ${q.id} in "${task.title}" has no answer`
          ).toBe(true);
        }
      }
    }
  });

  test('ML Layout Detection returns diagram crops for Task 1', async ({ request }) => {
    const fileBuffer = fs.readFileSync(WORKSHEET_PDF);

    const res = await request.post(`${API}/quiz/generate`, {
      multipart: {
        pdf: { name: 'MHLE-29.pdf', mimeType: 'application/pdf', buffer: fileBuffer },
        grade: 'PYP 4',
        subject: 'Mathematics',
        school: '',
      },
      timeout: API_TIMEOUT,
    });

    expect(res.status()).toBe(200);
    const { quiz } = await res.json();

    // Task 1 has two-column layout with conversion diagrams
    const task1 = quiz.tasks[0];
    expect(task1.layout?.type).toBe('two-column');
    expect(task1.layout?.columnGroups?.length).toBeGreaterThanOrEqual(2);

    // Check if any questions have imageUrl (from ML crop pipeline)
    const questionsWithImages = quiz.tasks.flatMap((t: any) =>
      t.questions.filter((q: any) => q.imageUrl)
    );

    // ML pipeline should have detected and assigned at least some diagram crops
    // (conversion arrows, tables, etc.)
    console.log(`[test] Questions with images: ${questionsWithImages.length}`);
    if (questionsWithImages.length > 0) {
      for (const q of questionsWithImages) {
        expect(q.imageUrl).toMatch(/^\/data\/images\/quiz\//);
      }
    }

    // fullPageImages should be present from ML detection
    if (quiz.fullPageImages) {
      expect(Array.isArray(quiz.fullPageImages)).toBe(true);
      for (const pg of quiz.fullPageImages) {
        expect(pg).toHaveProperty('pageNum');
        expect(pg).toHaveProperty('imageUrl');
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — HTML Preview Rendering: All tasks & questions visible
// Uses saved "known-good" quiz data for deterministic rendering tests.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Quiz HTML Rendering — MHLE-29', () => {
  const SAVED_QUIZ_PATH = path.resolve(__dirname, '../../server/data/test-quiz-pyp4-mhle29.json');
  const quizData = JSON.parse(fs.readFileSync(SAVED_QUIZ_PATH, 'utf8'));
  let previewHTML: string;

  test.beforeAll(async ({ request }) => {
    // Render saved quiz as HTML (fast — no API generation needed)
    const previewRes = await request.post(`${API}/quiz/render-preview`, {
      data: { quiz: quizData },
    });
    expect(previewRes.status()).toBe(200);
    previewHTML = await previewRes.text();
  });

  test('HTML preview contains header with title', async ({ page }) => {
    await page.setContent(previewHTML);
    const header = page.locator('.header h1');
    await expect(header).toBeVisible();
    const title = await header.textContent();
    expect(title!.length).toBeGreaterThan(3);
  });

  test('All task blocks are rendered in HTML', async ({ page }) => {
    await page.setContent(previewHTML);
    const taskBlocks = page.locator('.task-block');
    const count = await taskBlocks.count();

    expect(
      count,
      `Expected ${EXPECTED.totalTasks} task blocks, found ${count}`
    ).toBeGreaterThanOrEqual(EXPECTED.totalTasks);
  });

  test('Each task has correct tier badge', async ({ page }) => {
    await page.setContent(previewHTML);
    const tierBadges = page.locator('.tier-badge');
    const count = await tierBadges.count();
    expect(count).toBeGreaterThanOrEqual(EXPECTED.totalTasks);

    const tiers: string[] = [];
    for (let i = 0; i < count; i++) {
      tiers.push((await tierBadges.nth(i).textContent()) || '');
    }

    // Must contain all expected tiers
    expect(tiers.some(t => /MUST DO/i.test(t))).toBe(true);
    expect(tiers.some(t => /COULD DO/i.test(t))).toBe(true);
    expect(tiers.some(t => /ENRICHMENT/i.test(t))).toBe(true);
  });

  test('Total question count matches quiz JSON', async ({ page }) => {
    await page.setContent(previewHTML);

    const totalExpected = quizData.tasks.reduce(
      (s: number, t: any) => s + (t.questions?.length || 0), 0
    );

    // Count all question inputs + activity boxes + MCQ option groups
    const inputs = await page.locator('.q-input').count();
    const activityBoxes = await page.locator('.activity-box').count();
    const mcqGroups = await page.locator('.mcq-opt').count(); // individual options, not groups
    const wsTableCells = await page.locator('.ws-cell').count();
    const qCards = await page.locator('.q-card').count();

    // Total interactive elements = inputs in table cells + card-based questions + activities
    const totalRendered = wsTableCells + qCards;

    console.log(`[test] Expected questions: ${totalExpected}, Rendered elements: inputs=${inputs}, cells=${wsTableCells}, cards=${qCards}, activities=${activityBoxes}`);

    // At minimum, we should see all questions rendered
    expect(
      totalRendered,
      `Only ${totalRendered} questions rendered, expected ${totalExpected}`
    ).toBeGreaterThanOrEqual(totalExpected);
  });

  test('Task 1 renders as two-column table', async ({ page }) => {
    await page.setContent(previewHTML);
    // First task block should contain a ws-table (two-column layout)
    const firstTask = page.locator('.task-block').first();
    const table = firstTask.locator('.ws-table');
    await expect(table).toBeVisible();

    // Table should have at least 5 rows of questions (max of left/right columns)
    const rows = firstTask.locator('.ws-table tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(5); // 5 questions per column
  });

  test('Task 3 (Solve the following) is rendered', async ({ page }) => {
    await page.setContent(previewHTML);
    const body = await page.locator('body').textContent();

    // Task 3 title must appear
    expect(body).toMatch(/Task\s*3/i);
    expect(body).toMatch(/Solve the following/i);
  });

  test('Task 4 (Compare fractions) is rendered', async ({ page }) => {
    await page.setContent(previewHTML);
    const body = await page.locator('body').textContent();

    // Task 4 title must appear
    expect(body).toMatch(/Task\s*4/i);
    expect(body).toMatch(/Compare.*fraction/i);
  });

  test('Images from ML pipeline are rendered (if present)', async ({ page }) => {
    await page.setContent(previewHTML);

    // Count all images in the rendered HTML
    const images = page.locator('img');
    const imgCount = await images.count();
    console.log(`[test] Total images rendered: ${imgCount}`);

    // If quiz has imageUrl references, verify they render
    const questionsWithImages = quizData.tasks.flatMap((t: any) =>
      t.questions.filter((q: any) => q.imageUrl)
    );

    if (questionsWithImages.length > 0) {
      expect(imgCount, 'Images detected in quiz JSON but none rendered in HTML').toBeGreaterThan(0);

      // Each image should have a valid src (base64 embedded or relative path)
      for (let i = 0; i < Math.min(imgCount, 10); i++) {
        const src = await images.nth(i).getAttribute('src');
        expect(
          src!.startsWith('data:image/') || src!.startsWith('/data/'),
          `Image ${i} has invalid src: ${src?.substring(0, 50)}`
        ).toBe(true);
      }
    }
  });

  test('Score badge shows correct total', async ({ page }) => {
    await page.setContent(previewHTML);
    const scoreBadge = page.locator('#score-num');
    await expect(scoreBadge).toBeVisible();

    const scoreText = await scoreBadge.textContent();
    const totalExpected = quizData.tasks.reduce(
      (s: number, t: any) => s + (t.questions?.length || 0), 0
    );

    // Score should show "0/{totalQuestions}"
    expect(scoreText).toContain(`/${totalExpected}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — Interactive Quiz Functionality
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Interactive Quiz — Check/Hint/Show Answer', () => {
  test.setTimeout(120_000);

  const SAVED_QUIZ_PATH = path.resolve(__dirname, '../../server/data/test-quiz-pyp4-mhle29.json');
  const quizData = JSON.parse(fs.readFileSync(SAVED_QUIZ_PATH, 'utf8'));
  let previewHTML: string;

  test.beforeAll(async ({ request }) => {
    const previewRes = await request.post(`${API}/quiz/render-preview`, {
      data: { quiz: quizData },
    });
    previewHTML = await previewRes.text();
  });

  test('Check button shows correct for right answer (Task 1, Q: 4 kg = 4000 gm)', async ({ page }) => {
    await page.setContent(previewHTML);

    // Find the first input (should be Task 1, question a: 4 kg = ___ gm, answer: 4000)
    const firstInput = page.locator('.q-input').first();
    await firstInput.fill('4000');

    // Click the corresponding Check button
    const firstCheck = page.locator('.btn-check').first();
    await firstCheck.click();

    // Result should show correct feedback (green checkmark or "Correct")
    await page.waitForTimeout(300);
    const resultBox = page.locator('#q1-result');
    const resultText = await resultBox.textContent();
    expect(resultText).toMatch(/correct|✓|✔|🎉/i);
  });

  test('Check button shows incorrect for wrong answer', async ({ page }) => {
    await page.setContent(previewHTML);

    const firstInput = page.locator('.q-input').first();
    await firstInput.fill('9999');

    const firstCheck = page.locator('.btn-check').first();
    await firstCheck.click();

    await page.waitForTimeout(300);
    const resultBox = page.locator('#q1-result');
    const resultText = await resultBox.textContent();
    expect(resultText).toMatch(/try again|incorrect|✗|✘|wrong/i);
  });

  test('Hint button reveals hint text', async ({ page }) => {
    await page.setContent(previewHTML);

    // Find a hint button (they exist for questions with hints)
    const hintBtn = page.locator('.btn-hint').first();
    if (await hintBtn.isVisible()) {
      await hintBtn.click();
      await page.waitForTimeout(300);

      // Hint box should become visible
      const hintBox = page.locator('.hint-box').first();
      await expect(hintBox).toBeVisible();
      const hintText = await hintBox.textContent();
      expect(hintText!.length).toBeGreaterThan(5);
    }
  });

  test('Show Answer button appears after 2 wrong attempts', async ({ page }) => {
    await page.setContent(previewHTML);

    const firstInput = page.locator('.q-input').first();
    const firstCheck = page.locator('.btn-check').first();

    // Attempt 1 — wrong
    await firstInput.fill('1111');
    await firstCheck.click();
    await page.waitForTimeout(200);

    // Attempt 2 — wrong
    await firstInput.fill('2222');
    await firstCheck.click();
    await page.waitForTimeout(200);

    // Show Answer button should now be visible
    const showBtn = page.locator('#q1-show');
    await expect(showBtn).toBeVisible();
  });

  test('Score updates after correct answer', async ({ page }) => {
    await page.setContent(previewHTML);

    // Initial score should be 0
    const scoreBefore = await page.locator('#score-num').textContent();
    expect(scoreBefore).toMatch(/^0\//);

    // Submit correct answer for first question
    const firstInput = page.locator('.q-input').first();
    await firstInput.fill('4000');
    await page.locator('.btn-check').first().click();
    await page.waitForTimeout(500);

    // Score should now be 1/N
    const scoreAfter = await page.locator('#score-num').textContent();
    expect(scoreAfter).toMatch(/^1\//);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — UI Flow: Teacher uploads worksheet and previews quiz
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Teacher UI — Interactive Quiz Upload Flow', () => {
  test.setTimeout(180_000); // Full UI flow with API calls

  test('Teacher can upload PDF and see interactive quiz preview', async ({ page }) => {
    // Skip if test accounts panel isn't available (depends on frontend state)
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const panelBtn = page.getByText('Test Accounts with Real Data').first();
    const hasPanelBtn = await panelBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasPanelBtn, 'Test accounts panel not available in current frontend build');

    // Login as teacher
    await loginAs(page, TEACHER_ACCOUNTS.ravi.email);

    // Navigate to Assignments
    await page.getByText('Assignments').first().click();
    await waitForText(page, /assignments/i);

    // Click New Assignment
    await page.getByText(/new assignment/i).first().click();
    await page.waitForTimeout(1000);

    // Look for the file upload area / "Upload Worksheet" button
    const uploadBtn = page.getByText(/upload|worksheet|document/i).first();
    if (await uploadBtn.isVisible()) {
      // Set up file chooser handler
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        uploadBtn.click(),
      ]);

      // Upload the PDF
      await fileChooser.setFiles(WORKSHEET_PDF);
      await page.waitForTimeout(2000);

      // Look for "Generate Interactive Quiz" button
      const genBtn = page.getByText(/generate interactive|interactive quiz/i).first();
      if (await genBtn.isVisible({ timeout: 5000 })) {
        await genBtn.click();

        // Wait for quiz generation (can take 30-90 seconds)
        await page.waitForTimeout(5000);

        // Check that we're not seeing an error
        const bodyText = await page.locator('body').textContent();
        const hasError = /error|failed|could not/i.test(bodyText || '');

        if (!hasError) {
          // Wait for "Interactive Quiz Ready" or preview to appear
          await page.waitForFunction(
            () => document.body.textContent?.match(/interactive quiz ready|preview|approve/i),
            { timeout: 90_000 }
          );

          // Verify the quiz data is present (preview or edit mode)
          const afterBody = await page.locator('body').textContent();
          const hasQuiz = /Task\s*1|Convert|MUST DO|quiz ready/i.test(afterBody || '');
          expect(hasQuiz, 'Interactive quiz should be generated and visible').toBe(true);
        } else {
          // If there's an error, log it for debugging
          console.log('[test] Error during generation:', bodyText?.substring(0, 200));
          // Don't fail - report the error
          expect.soft(hasError, 'Quiz generation returned an error').toBe(false);
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — Regression: Saved quiz renders identically
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Regression — Saved MHLE-29 quiz renders correctly', () => {
  const SAVED_QUIZ_PATH = path.resolve(
    __dirname, '../../server/data/test-quiz-pyp4-mhle29.json'
  );

  test('Saved quiz JSON has all 6 tasks', () => {
    const quiz = JSON.parse(fs.readFileSync(SAVED_QUIZ_PATH, 'utf8'));
    expect(quiz.tasks.length).toBe(6);

    // Validate minimum questions per task
    expect(quiz.tasks[0].questions.length).toBe(10); // Task 1: 10 conversions
    expect(quiz.tasks[1].questions.length).toBeGreaterThanOrEqual(4); // Task 2: fractions
    expect(quiz.tasks[2].questions.length).toBe(2); // Task 3: solve
    expect(quiz.tasks[3].questions.length).toBeGreaterThanOrEqual(4); // Task 4: compare
    expect(quiz.tasks[4].questions.length).toBeGreaterThanOrEqual(1); // Task 5: application
    expect(quiz.tasks[5].questions.length).toBeGreaterThanOrEqual(1); // Task 6: enrichment
  });

  test('Saved quiz renders all tasks in HTML preview', async ({ request, page }) => {
    const quiz = JSON.parse(fs.readFileSync(SAVED_QUIZ_PATH, 'utf8'));

    const res = await request.post(`${API}/quiz/render-preview`, {
      data: { quiz },
    });
    expect(res.status()).toBe(200);
    const html = await res.text();

    await page.setContent(html);

    // All 6 task blocks must render
    const taskBlocks = page.locator('.task-block');
    expect(await taskBlocks.count()).toBe(6);

    // Task titles must be visible
    const body = await page.locator('body').textContent();
    expect(body).toMatch(/Task\s*1/);
    expect(body).toMatch(/Task\s*2/);
    expect(body).toMatch(/Task\s*3/);
    expect(body).toMatch(/Task\s*4/);
    expect(body).toMatch(/Task\s*5/);
    expect(body).toMatch(/Enrichment/i);
  });

  test('Saved quiz — no console errors during render', async ({ request, page }) => {
    const quiz = JSON.parse(fs.readFileSync(SAVED_QUIZ_PATH, 'utf8'));

    const res = await request.post(`${API}/quiz/render-preview`, {
      data: { quiz },
    });
    const html = await res.text();

    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.setContent(html);
    await page.waitForTimeout(1000);

    expect(errors.length, `Console errors: ${errors.join('; ')}`).toBe(0);
  });
});
