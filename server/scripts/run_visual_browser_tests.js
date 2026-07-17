/**
 * run_visual_browser_tests.js
 * 
 * Automated Browser Visual & Rendering QA Test Harness using Puppeteer (Headless Chrome).
 * Loads generated interactive quiz HTML, monitors browser JS errors/broken images,
 * takes full-page browser screenshots (.png), and updates reports with visual diagnoses.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3006;
const SERVER_URL = `http://localhost:${PORT}`;
const ARTIFACT_DIR = path.resolve('C:/Users/Asus/.gemini/antigravity-cli/brain/65eabd7b-8186-47df-9a75-5c5ccd1e2a93');
const REPORTS_DIR = path.join(ARTIFACT_DIR, 'reports');
const SCREENSHOTS_DIR = path.join(ARTIFACT_DIR, 'screenshots');
const MASTER_JSON = path.join(ARTIFACT_DIR, 'overnight_qa_master_report.json');

if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

let activeServerProc = null;

async function isServerUp() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${SERVER_URL}/quiz/list`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServerUp() {
  if (await isServerUp()) return null;
  console.log(`\n[Visual QA] Starting backend server (node index.js on port ${PORT})...`);
  const serverRoot = path.resolve(__dirname, '..');
  if (activeServerProc) { try { activeServerProc.kill(); } catch (_) {} }
  activeServerProc = spawn('node', ['index.js'], { cwd: serverRoot, env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
  for (let i = 0; i < 45; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await isServerUp()) {
      console.log(`[Visual QA] Server ready on ${SERVER_URL}!\n`);
      return activeServerProc;
    }
  }
  throw new Error('Server failed to become ready for visual testing.');
}

function cleanName(filename) {
  return filename.replace(/[^\w.-]+/g, '_').replace(/\.[^/.]+$/, '').slice(0, 50);
}

async function runVisualTests() {
  console.log(`======================================================`);
  console.log(`[Visual QA] Starting Puppeteer Automated Browser Suite`);
  console.log(`======================================================`);

  if (!fs.existsSync(MASTER_JSON)) {
    console.error(`[Visual QA] Error: ${MASTER_JSON} not found. Run backend pipeline first.`);
    process.exit(1);
  }

  await ensureServerUp();

  const masterList = JSON.parse(fs.readFileSync(MASTER_JSON, 'utf8'));
  const eligible = masterList.filter(r => r.status === 'SUCCESS' || r.status === 'PARTIAL_WARNINGS');

  console.log(`[Visual QA] Found ${eligible.length} successfully generated quizzes for browser rendering checks.\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,1024']
  });

  for (let i = 0; i < eligible.length; i++) {
    const item = eligible[i];
    console.log(`[Visual QA] (${i + 1}/${eligible.length}) Browser rendering check: ${item.filename}`);
    
    // Check if we need to re-fetch quiz object or generate
    let quiz = item.quizObject;
    if (!quiz) {
      // If quiz object wasn't stored in summary json, re-generate or check local cache
      try {
        const fileBuf = fs.readFileSync(item.filePath);
        const mime = item.ext === '.png' ? 'image/png' : (item.ext === '.jpg' ? 'image/jpeg' : (item.ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf'));
        const fieldName = (item.ext === '.png' || item.ext === '.jpg') ? 'image' : 'pdf';
        const endpoint = (item.ext === '.png' || item.ext === '.jpg') ? '/quiz/generate-image' : '/quiz/generate';
        const blob = new Blob([fileBuf], { type: mime });
        const form = new FormData();
        form.set(fieldName, blob, item.filename);
        form.set('grade', 'PYP 4');
        form.set('subject', 'English / Inquiry');
        form.set('school', 'Toddle International School');

        const res = await fetch(`${SERVER_URL}${endpoint}`, { method: 'POST', body: form });
        if (res.ok) {
          const data = await res.json();
          quiz = data.quiz;
        }
      } catch (e) {
        console.warn(`[Visual QA] Could not retrieve quiz JSON for ${item.filename}: ${e.message}`);
        continue;
      }
    }

    if (!quiz) {
      console.warn(`[Visual QA] Skipping ${item.filename}: quiz object not available.`);
      continue;
    }

    // Step 1: Request rendered HTML via `/quiz/render-preview`
    let html = '';
    try {
      const previewRes = await fetch(`${SERVER_URL}/quiz/render-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quiz,
          branding: {
            schoolLogoUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            curriculumLogoUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
          }
        })
      });
      if (previewRes.ok) {
        const contentType = previewRes.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const pData = await previewRes.json();
          html = pData.html || '';
        } else {
          html = await previewRes.text();
        }
      }
    } catch (e) {
      console.error(`[Visual QA] render-preview fetch error for ${item.filename}: ${e.message}`);
      continue;
    }

    if (!html) {
      console.warn(`[Visual QA] No HTML returned for ${item.filename}`);
      continue;
    }

    // Step 2: Open page in Chromium and monitor
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1024 });

    const jsErrors = [];
    const consoleWarnings = [];
    const failedRequests = [];

    page.on('pageerror', err => {
      jsErrors.push(err.message || String(err));
    });

    page.on('console', msg => {
      if (msg.type() === 'error') jsErrors.push(msg.text());
      else if (msg.type() === 'warning') consoleWarnings.push(msg.text());
    });

    page.on('requestfailed', req => {
      failedRequests.push(`${req.url()} (${req.failure()?.errorText || 'failed'})`);
    });

    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    // Step 3: DOM inspection inside browser context
    const domInspection = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      const brokenImages = images.filter(img => img.naturalWidth === 0 || !img.src || img.src.includes('/data/images/')).map(img => ({
        src: img.src ? img.src.slice(0, 80) : 'no-src',
        naturalWidth: img.naturalWidth
      }));

      const inputs = document.querySelectorAll('input, select, textarea, button, .diagram-input, .option-box');
      const interactiveCount = inputs.length;

      const hasOverflow = document.body.scrollWidth > window.innerWidth;
      const title = document.title || document.querySelector('h1, h2')?.innerText || 'No title';

      return {
        totalImages: images.length,
        brokenImages,
        interactiveCount,
        hasOverflow,
        title
      };
    });

    // Step 4: Take full-page screenshot
    const scFilename = `${cleanName(item.filename)}_render.png`;
    const scPath = path.join(SCREENSHOTS_DIR, scFilename);
    await page.screenshot({ path: scPath, fullPage: true });

    await page.close();

    // Step 5: Diagnose rendering result
    let renderStatus = '✅ PERFECT_RENDERING';
    let renderRootCause = 'Browser rendered interactive quiz HTML cleanly without JS runtime errors or broken DOM elements (`renderQuizHTML` in server/routes/quiz.js).';
    const issuesList = [];

    if (jsErrors.length > 0) {
      renderStatus = '❌ VISUAL_RENDERING_FAILED (JS_RUNTIME_ERROR)';
      renderRootCause = `BROWSER_JS_RUNTIME_ERROR: Inline JavaScript in renderQuizHTML() (server/routes/quiz.js) threw unhandled exceptions during browser evaluation: "${jsErrors[0].slice(0, 150)}"`;
      issuesList.push(`JS Runtime Errors (${jsErrors.length}): ${jsErrors.slice(0, 3).join(' | ')}`);
    } else if (domInspection.brokenImages.length > 0) {
      renderStatus = '⚠️ RENDERING_WARNINGS (BROKEN_IMAGES)';
      renderRootCause = `IMAGE_NOT_BASE64_EMBEDDED: ` + domInspection.brokenImages.map(b => b.src).join(', ') + ` — embedQuizImages() in server/routes/quiz.js left relative image paths which 404 in the browser when Cloud Run recycles ephemeral disk.`;
      issuesList.push(`Broken Images (${domInspection.brokenImages.length}): relative paths or failed load.`);
    } else if (domInspection.interactiveCount === 0) {
      renderStatus = '⚠️ RENDERING_WARNINGS (NO_INTERACTIVE_INPUTS)';
      renderRootCause = `MISSING_INTERACTIVE_INPUTS: renderQuizHTML() generated static task descriptions without radio buttons, input boxes, or diagram fill zones for student submission.`;
      issuesList.push('0 interactive input elements detected in DOM.');
    }

    item.visualRenderStatus = renderStatus;
    item.visualRenderRootCause = renderRootCause;
    item.screenshotPath = scPath;
    item.visualIssues = issuesList;

    console.log(`[Visual QA] Result: ${renderStatus} | Saved screenshot -> ${scPath}`);

    // Step 6: Update individual report with screenshot and visual section
    updateWorksheetReportWithVisuals(item, scPath, renderStatus, renderRootCause, issuesList);
  }

  await browser.close();
  if (activeServerProc) { try { activeServerProc.kill(); } catch (_) {} }

  // Save updated master list with visual status
  fs.writeFileSync(MASTER_JSON, JSON.stringify(masterList, null, 2), 'utf8');
  updateMasterMarkdownWithVisuals(masterList);

  console.log(`\n======================================================`);
  console.log(`[Visual QA] ALL BROWSER RENDERING TESTS COMPLETED!`);
  console.log(`======================================================`);
}

function updateWorksheetReportWithVisuals(item, scPath, renderStatus, renderRootCause, issuesList) {
  const reportPath = path.join(REPORTS_DIR, `${cleanName(item.filename)}_report.md`);
  if (!fs.existsSync(reportPath)) return;

  let md = fs.readFileSync(reportPath, 'utf8');
  const scRelPath = `file:///C:/Users/Asus/.gemini/antigravity-cli/brain/65eabd7b-8186-47df-9a75-5c5ccd1e2a93/screenshots/${cleanName(item.filename)}_render.png`;

  const visualSection = `\n---\n
## 5. Automated Browser Rendering Visual Verification (Puppeteer Chromium)
- **Visual Rendering Status:** **${renderStatus}**
- **Browser JavaScript Console Check:** ${issuesList.some(i => i.includes('JS Runtime')) ? '❌ JS Errors Detected' : '✅ 0 Runtime Errors'}
- **Visual Issues Detected:** ${issuesList.length > 0 ? issuesList.join('; ') : 'None'}
- **Diagnosed Codebase Root Cause:** **${renderRootCause}**

### Browser Rendering Screenshot (Actual Browser Viewport)
![Browser Rendering Verification](${scRelPath})
`;

  if (!md.includes('## 5. Automated Browser Rendering')) {
    md += visualSection;
    fs.writeFileSync(reportPath, md, 'utf8');
  }
}

function updateMasterMarkdownWithVisuals(results) {
  const masterMdPath = path.join(ARTIFACT_DIR, 'overnight_qa_master_report.md');
  let md = `# Overnight Automated QA Master Summary Report (Pipeline + Visual Browser Tests)

Generated at: **${new Date().toLocaleString()}**
Total Worksheets Tracked: **${results.length}**

### Status Breakdown:
- ✅ **Fully Successful Pipeline:** ${results.filter(r => r.status === 'SUCCESS').length}
- ⚠️ **Pipeline Warnings:** ${results.filter(r => r.status === 'PARTIAL_WARNINGS').length}
- 🖥️ **Visual Rendering Verified (PERFECT_RENDERING):** ${results.filter(r => r.visualRenderStatus && r.visualRenderStatus.includes('PERFECT')).length}
- ❌ **Visual/JS Errors Found:** ${results.filter(r => r.visualRenderStatus && r.visualRenderStatus.includes('FAILED')).length}
- ⏳ **Pending / In Progress:** ${results.filter(r => r.status.includes('PENDING')).length}
- ❌ **Pipeline API/Conversion Failed:** ${results.filter(r => r.status.startsWith('FAILED_') && r.status !== 'FAILED_EXPECTED_SIZE_LIMIT').length}

---

## Detailed Results Table (Pipeline Status + Browser Rendering Verification)

| # | Worksheet Filename | Category | Size (KB) | Pipeline Status | Visual Browser Status | Visual Screenshot | Codebase Root Cause / Diagnosis | Report Link |
|---|--------------------|----------|-----------|-----------------|-----------------------|-------------------|---------------------------------|-------------|
`;

  results.forEach((r, i) => {
    const reportLink = r.status.includes('PENDING') ? '-' : `[View Report](file:///C:/Users/Asus/.gemini/antigravity-cli/brain/65eabd7b-8186-47df-9a75-5c5ccd1e2a93/reports/${cleanName(r.filename)}_report.md)`;
    const scLink = r.screenshotPath ? `[View Screenshot](file:///C:/Users/Asus/.gemini/antigravity-cli/brain/65eabd7b-8186-47df-9a75-5c5ccd1e2a93/screenshots/${cleanName(r.filename)}_render.png)` : '-';
    const visStatus = r.visualRenderStatus ? r.visualRenderStatus.replace(/[✅❌⚠️]/g, '').trim() : '-';
    const rootCause = r.visualRenderRootCause || r.rootCause || 'Perfect';
    
    md += `| ${i + 1} | \`${r.filename.slice(0, 32)}\` | ${r.category} | ${(r.sizeBytes / 1024).toFixed(0)} | **${r.status}** | **${visStatus}** | ${scLink} | ${rootCause} | ${reportLink} |\n`;
  });

  md += `\n---\n*End of Master Summary Report.*`;
  fs.writeFileSync(masterMdPath, md, 'utf8');
}

runVisualTests().catch(err => {
  console.error(`[Visual QA] Fatal Suite Error:`, err);
  process.exit(1);
});
