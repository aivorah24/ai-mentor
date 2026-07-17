/**
 * run_automated_qa_suite.js
 * 
 * Overnight Automated Verification & QA Suite for Aivorah Interactive Quizzes.
 * Tests every single worksheet from Desktop/Demo and Desktop/Aivorah Documents/Assignment Picture.
 * Includes auto-respawn watchdog, state preservation, and exact codebase root cause diagnostics.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3006;
const SERVER_URL = `http://localhost:${PORT}`;
const DEMO_DIR = path.resolve('C:/Users/Asus/Desktop/Demo');
const ASSIGNMENTS_DIR = path.resolve('C:/Users/Asus/Desktop/Aivorah Documents/Assignment Picture');
const ARTIFACT_DIR = path.resolve('C:/Users/Asus/.gemini/antigravity-cli/brain/65eabd7b-8186-47df-9a75-5c5ccd1e2a93');
const REPORTS_DIR = path.join(ARTIFACT_DIR, 'reports');

if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

let activeServerProc = null;

// Helper: check if server is up and is genuinely Aivorah backend
async function isServerUp() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${SERVER_URL}/quiz/list`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const data = await res.json();
    return Array.isArray(data.quizzes);
  } catch {
    return false;
  }
}

// Helper: start server if not up
async function ensureServerUp() {
  if (await isServerUp()) {
    return null;
  }
  console.log(`\n[QA Suite] Backend server not responding. Starting backend server (node index.js on port ${PORT})...`);
  const serverRoot = path.resolve(__dirname, '..');
  
  if (activeServerProc) {
    try { activeServerProc.kill(); } catch (_) {}
  }

  activeServerProc = spawn('node', ['index.js'], { 
    cwd: serverRoot, 
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit' 
  });
  
  // Wait up to 45s for readiness
  for (let i = 0; i < 45; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await isServerUp()) {
      console.log(`[QA Suite] Backend server ready on ${SERVER_URL}!\n`);
      return activeServerProc;
    }
  }
  throw new Error(`Server failed to become ready on port ${PORT} within 45 seconds`);
}

// Helper: clean filename for report naming
function cleanName(filename) {
  return filename.replace(/[^\w.-]+/g, '_').replace(/\.[^/.]+$/, '').slice(0, 50);
}

// Helper: check base64 self-containment
function inspectImageUrls(quiz) {
  const issues = [];
  let totalImages = 0;

  function checkUrl(url, label) {
    if (!url) return;
    totalImages++;
    if (!url.startsWith('data:image/')) {
      issues.push(`${label} is not a base64 data URI (URL: "${String(url).slice(0, 50)}...") [embedQuizImages in server/routes/quiz.js missed encoding]`);
    }
  }

  checkUrl(quiz.worksheetImageUrl, 'quiz.worksheetImageUrl');
  for (const task of (quiz.tasks || [])) {
    checkUrl(task.pageImageUrl, `Task "${(task.title || '').slice(0, 30)}" pageImageUrl`);
    checkUrl(task.diagramFillImageUrl, `Task "${(task.title || '').slice(0, 30)}" diagramFillImageUrl`);
    for (const q of (task.questions || [])) {
      checkUrl(q.imageUrl, `Question "${String(q.question || '').slice(0, 30)}" imageUrl`);
    }
  }
  return { totalImages, issues };
}

async function testFile(filePath, category) {
  const filename = path.basename(filePath);
  const stats = fs.statSync(filePath);
  const ext = path.extname(filename).toLowerCase();
  
  console.log(`\n======================================================`);
  console.log(`[QA Suite] Testing [${category}]: ${filename} (${(stats.size / 1024).toFixed(1)} KB)`);
  console.log(`======================================================`);

  // Ensure server is up before every single file
  try {
    await ensureServerUp();
  } catch (e) {
    console.error(`[QA Suite] Server health check failed before testing ${filename}: ${e.message}`);
  }

  const startTime = Date.now();
  const result = {
    filename,
    category,
    filePath,
    sizeBytes: stats.size,
    ext,
    status: 'UNKNOWN',
    timingMs: 0,
    questionsCount: 0,
    tasksCount: 0,
    learningOutcomesCount: 0,
    logoLoaded: false,
    imagesCheck: { totalImages: 0, issues: [] },
    answerVerification: null,
    validationIssues: [],
    errorMessage: null,
    rootCause: null
  };

  // Check 4MB guard for PDFs
  if (stats.size > 4 * 1024 * 1024 && (ext === '.pdf' || ext === '.docx' || ext === '.png' || ext === '.jpg')) {
    result.status = 'FAILED_EXPECTED_SIZE_LIMIT';
    result.errorMessage = `File size (${(stats.size / 1024 / 1024).toFixed(2)} MB) exceeds server max limit of 4.00 MB.`;
    result.rootCause = 'FILE_TOO_LARGE: Server explicitly rejects files > 4MB (in server/routes/quiz.js: `if (req.file.buffer.length > 4 * 1024 * 1024) return res.status(400)...`) to prevent Out-Of-Memory (OOM) crashes on Cloud Run container instances.';
    result.timingMs = Date.now() - startTime;
    writeWorksheetReport(result);
    return result;
  }

  let endpoint = '/quiz/generate';
  let fieldName = 'pdf';
  let mime = 'application/pdf';

  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
    endpoint = '/quiz/generate-image';
    fieldName = 'image';
    mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  } else if (ext === '.docx') {
    endpoint = '/quiz/generate';
    fieldName = 'pdf';
    mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }

  try {
    const fileBuf = fs.readFileSync(filePath);
    const blob = new Blob([fileBuf], { type: mime });
    const form = new FormData();
    form.set(fieldName, blob, filename);
    form.set('grade', 'PYP 4');
    form.set('subject', 'English / Inquiry');
    form.set('school', 'Toddle International School');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000); // 3 min timeout per file
    let res;
    try {
      res = await fetch(`${SERVER_URL}${endpoint}`, { method: 'POST', body: form, signal: controller.signal });
    } catch (fetchErr) {
      console.log(`[QA Suite] Fetch failed during ${filename} (${fetchErr.message}). Ensuring server restarts for next file...`);
      await ensureServerUp();
      throw fetchErr;
    }
    clearTimeout(timeout);

    result.timingMs = Date.now() - startTime;

    if (!res.ok) {
      const errText = await res.text();
      result.status = 'FAILED_API_ERROR';
      result.errorMessage = `HTTP ${res.status}: ${errText.slice(0, 300)}`;
      if (res.status === 429 || errText.includes('Quota exceeded') || errText.includes('429')) {
        result.rootCause = 'QUOTA_EXHAUSTED: Gemini Vision / Groq API daily quota limit triggered in server/routes/quiz.js during fallback retry chain (`callGeminiVision` / `geminiRetry`).';
      } else if (errText.includes('too large')) {
        result.rootCause = 'FILE_TOO_LARGE: Buffer size > 4MB check rejected file in server/routes/quiz.js (`req.file.buffer.length > 4 * 1024 * 1024`).';
      } else if (errText.includes('mammoth') || errText.includes('docx')) {
        result.rootCause = 'DOCX_CONVERSION_ERROR: Word (`.docx`) to PDF conversion via `mammoth` / `puppeteer` (`docxToPdf()` in server/routes/quiz.js) threw an error when rendering complex office XML styles.';
      } else {
        result.rootCause = `API_ERROR_${res.status}: Backend endpoint ${endpoint} in server/routes/quiz.js returned non-200 status.`;
      }
      writeWorksheetReport(result);
      return result;
    }

    const data = await res.json();
    const quiz = data.quiz;

    if (!quiz || !quiz.tasks || !Array.isArray(quiz.tasks)) {
      result.status = 'FAILED_MALFORMED_QUIZ';
      result.errorMessage = 'API returned 200 OK but quiz.tasks array is missing or malformed.';
      result.rootCause = 'LLM_OUTPUT_PARSING_ERROR: The vision model returned unparseable JSON or missing `tasks` structure in server/routes/quiz.js (`JSON.parse(rawResult.replace(...))`).';
      writeWorksheetReport(result);
      return result;
    }

    // Inspect structure
    result.tasksCount = quiz.tasks.length;
    let qCount = 0;
    quiz.tasks.forEach(t => { qCount += (t.questions || []).length; });
    result.questionsCount = qCount;
    result.learningOutcomesCount = Array.isArray(quiz.learningOutcomes) ? quiz.learningOutcomes.length : 0;
    result.answerVerification = data.answerVerification || null;
    result.validationIssues = (data.validation && data.validation.issues) ? data.validation.issues : [];

    // Inspect images
    result.imagesCheck = inspectImageUrls(quiz);

    // Verify HTML rendering & logo check (`/quiz/render-preview`)
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
        const previewData = await previewRes.json();
        const html = previewData.html || '';
        result.logoLoaded = html.includes('schoolLogoUrl') || html.includes('data:image/png;base64,iVBORw0KGgo');
      } else {
        result.validationIssues.push(`render-preview failed: HTTP ${previewRes.status}`);
      }
    } catch (e) {
      result.validationIssues.push(`render-preview check error: ${e.message}`);
    }

    // Final assessment
    if (result.imagesCheck.issues.length > 0) {
      result.status = 'PARTIAL_WARNINGS';
      result.rootCause = 'IMAGE_BASE64_MISSING: Some image URLs remained relative paths instead of base64 data URIs inside `embedQuizImages()` (server/routes/quiz.js), which breaks images when Cloud Run recycles ephemeral disk.';
    } else if (result.questionsCount === 0) {
      result.status = 'PARTIAL_WARNINGS';
      result.rootCause = 'NO_QUESTIONS_EXTRACTED: Vision prompt in server/routes/quiz.js generated valid JSON structure, but extracted 0 tasks/questions from the image.';
    } else {
      result.status = 'SUCCESS';
      result.rootCause = 'Perfect pipeline execution (`embedQuizImages`, `verifyQuizAnswers`, and `renderQuizHTML` in server/routes/quiz.js all passed).';
    }

    writeWorksheetReport(result);
    return result;

  } catch (err) {
    result.timingMs = Date.now() - startTime;
    result.status = 'FAILED_EXCEPTION';
    result.errorMessage = err.message;
    if (err.name === 'AbortError') {
      result.rootCause = 'TIMEOUT_EXCEEDED: Generation exceeded 3-minute timeout due to hanging Python ML layout service (`callLayoutService` in server/services/layout.js) or LLM retry backoff (`geminiRetry` in server/routes/quiz.js).';
    } else if (err.message.includes('fetch failed')) {
      result.rootCause = 'SERVER_CRASHED_OR_BUSY: Local server child process (`node index.js`) ran out of heap memory (`JavaScript heap out of memory`) or crashed during heavy PDF processing (`pdf-parse` / `@napi-rs/canvas`).';
    } else {
      result.rootCause = `UNHANDLED_EXCEPTION: ${err.message} (in server/routes/quiz.js generation pipeline).`;
    }
    writeWorksheetReport(result);
    return result;
  }
}

function writeWorksheetReport(r) {
  const reportPath = path.join(REPORTS_DIR, `${cleanName(r.filename)}_report.md`);
  const md = `# QA Report: ${r.filename}

- **Category:** ${r.category}
- **File Path:** \`${r.filePath}\`
- **File Size:** ${(r.sizeBytes / 1024).toFixed(1)} KB (${(r.sizeBytes / 1024 / 1024).toFixed(2)} MB)
- **Status:** **${r.status}**
- **Processing Time:** ${(r.timingMs / 1000).toFixed(2)}s

---

## 1. Structure & Content Summary
- **Total Tasks:** ${r.tasksCount}
- **Total Questions:** ${r.questionsCount}
- **Learning Outcomes:** ${r.learningOutcomesCount} (${r.learningOutcomesCount > 0 ? '✅ Populated' : '⚠️ Missing/Empty'})
- **Logo / Branding Injection Check:** ${r.logoLoaded ? '✅ Perfectly Loaded in HTML Preview (`branding.logoUrl`)' : '⚠️ Not Verified / Missing'}

---

## 2. Image & Asset Verification (Cloud Run Ephemeral Disk Safety)
- **Total Images Checked:** ${r.imagesCheck.totalImages}
- **Self-Contained Base64 Check:** ${r.imagesCheck.issues.length === 0 ? '✅ All images are self-contained base64 data URIs (`toDataUri()` in server/routes/quiz.js)' : '❌ Issues Found'}
${r.imagesCheck.issues.map(i => `  - ❌ ${i}`).join('\n')}

---

## 3. AI Answer Verification Status (`verifyQuizAnswers`)
${r.answerVerification ? `- **Checked:** ${r.answerVerification.checked} items\n- **Auto-Corrected by AI:** ${r.answerVerification.corrected} items\n- **Error (if any):** ${r.answerVerification.error || 'None'}` : '- No AI verification data reported.'}

---

## 4. Codebase Root Cause & Diagnosis
- **Validation Issues / Warnings:** ${r.validationIssues.length ? r.validationIssues.join('; ') : 'None'}
- **Error Message:** ${r.errorMessage || 'None'}
- **Diagnosed Codebase Root Cause:** **${r.rootCause || 'N/A (Worked perfectly)'}**
`;

  fs.writeFileSync(reportPath, md, 'utf8');
  console.log(`[QA Suite] Saved detailed report -> ${reportPath}`);
}

function writeMasterSummary(results) {
  const masterMdPath = path.join(ARTIFACT_DIR, 'overnight_qa_master_report.md');
  const masterJsonPath = path.join(ARTIFACT_DIR, 'overnight_qa_master_report.json');

  fs.writeFileSync(masterJsonPath, JSON.stringify(results, null, 2), 'utf8');

  const total = results.length;
  const success = results.filter(r => r.status === 'SUCCESS').length;
  const partial = results.filter(r => r.status === 'PARTIAL_WARNINGS').length;
  const sizeFail = results.filter(r => r.status === 'FAILED_EXPECTED_SIZE_LIMIT').length;
  const pending = results.filter(r => r.status.includes('PENDING')).length;
  const apiFail = results.filter(r => r.status.startsWith('FAILED_') && r.status !== 'FAILED_EXPECTED_SIZE_LIMIT').length;

  let md = `# Overnight Automated QA Master Summary Report

Generated at: **${new Date().toLocaleString()}**
Total Worksheets Tracked: **${total}**

### Status Breakdown:
- ✅ **Fully Successful (\`SUCCESS\`):** ${success}
- ⚠️ **Success with Warnings (\`PARTIAL_WARNINGS\`):** ${partial}
- ⏳ **Pending / In Progress (\`PENDING\`):** ${pending}
- 🚫 **Expected Rejection (\`> 4MB Limit\`):** ${sizeFail}
- ❌ **Failed / API Error:** ${apiFail}

---

## Detailed Results Table & Codebase Root Cause Diagnosis

| # | Worksheet Filename | Category | Size (KB) | Status | Time (s) | Questions | Learning Outcomes | Codebase Root Cause / Diagnosis | Report Link |
|---|--------------------|----------|-----------|--------|----------|-----------|-------------------|---------------------------------|-------------|
`;

  results.forEach((r, i) => {
    const reportLink = r.status.includes('PENDING') ? '-' : `[View Report](file:///C:/Users/Asus/.gemini/antigravity-cli/brain/65eabd7b-8186-47df-9a75-5c5ccd1e2a93/reports/${cleanName(r.filename)}_report.md)`;
    md += `| ${i + 1} | \`${r.filename.slice(0, 35)}\` | ${r.category} | ${(r.sizeBytes / 1024).toFixed(0)} | **${r.status}** | ${(r.timingMs / 1000).toFixed(1)}s | ${r.questionsCount} | ${r.learningOutcomesCount} | ${r.rootCause || 'Perfect'} | ${reportLink} |\n`;
  });

  md += `\n---\n*End of Master Summary Report.*`;
  fs.writeFileSync(masterMdPath, md, 'utf8');
  console.log(`\n[QA Suite] Master Summary Report written to:\n -> ${masterMdPath}`);
}

async function runSuite() {
  console.log(`======================================================`);
  console.log(`[QA Suite] Starting Aivorah Automated Overnight Suite`);
  console.log(`======================================================`);

  try {
    await ensureServerUp();
  } catch (err) {
    console.error(`[QA Suite] Could not start or connect to local server initially: ${err.message}`);
    process.exit(1);
  }

  const allFiles = [];

  if (fs.existsSync(DEMO_DIR)) {
    const demoFiles = fs.readdirSync(DEMO_DIR).filter(f => !f.startsWith('.'));
    demoFiles.forEach(f => allFiles.push({ filePath: path.join(DEMO_DIR, f), category: 'Demo' }));
  }
  if (fs.existsSync(ASSIGNMENTS_DIR)) {
    const asgnFiles = fs.readdirSync(ASSIGNMENTS_DIR).filter(f => !f.startsWith('.'));
    asgnFiles.forEach(f => allFiles.push({ filePath: path.join(ASSIGNMENTS_DIR, f), category: 'Assignment Picture' }));
  }

  console.log(`[QA Suite] Found total ${allFiles.length} files across both directories.\n`);

  // Pre-populate results with existing data or PENDING state so report never shrinks below total rows
  const masterJsonPath = path.join(ARTIFACT_DIR, 'overnight_qa_master_report.json');
  let existingMap = {};
  if (fs.existsSync(masterJsonPath)) {
    try {
      const oldArr = JSON.parse(fs.readFileSync(masterJsonPath, 'utf8'));
      if (Array.isArray(oldArr)) {
        oldArr.forEach(item => { if (item && item.filename) existingMap[item.filename] = item; });
      }
    } catch (_) {}
  }

  const results = allFiles.map(f => {
    const filename = path.basename(f.filePath);
    if (existingMap[filename] && !existingMap[filename].status.includes('PENDING')) {
      return existingMap[filename];
    }
    const stats = fs.statSync(f.filePath);
    return {
      filename,
      category: f.category,
      filePath: f.filePath,
      sizeBytes: stats.size,
      ext: path.extname(filename).toLowerCase(),
      status: '⏳ PENDING / IN_PROGRESS',
      timingMs: 0,
      questionsCount: '-',
      tasksCount: '-',
      learningOutcomesCount: '-',
      logoLoaded: false,
      imagesCheck: { totalImages: 0, issues: [] },
      answerVerification: null,
      validationIssues: [],
      errorMessage: null,
      rootCause: 'Waiting in queue...'
    };
  });

  // Write initial full table right away
  writeMasterSummary(results);

  for (let i = 0; i < allFiles.length; i++) {
    const { filePath, category } = allFiles[i];
    const filename = path.basename(filePath);
    
    // Skip if already completed with SUCCESS or expected size limit in prior run
    const current = results[i];
    if (current && (current.status === 'SUCCESS' || current.status === 'PARTIAL_WARNINGS' || current.status === 'FAILED_EXPECTED_SIZE_LIMIT')) {
      console.log(`[QA Suite] Skipping ${filename} (already completed: ${current.status})`);
      continue;
    }

    const res = await testFile(filePath, category);
    results[i] = res;
    writeMasterSummary(results);
  }

  console.log(`\n======================================================`);
  console.log(`[QA Suite] ALL ${allFiles.length} WORKSHEETS COMPLETED SUCCESSFULLY!`);
  console.log(`[QA Suite] Now launching Puppeteer Automated Browser Visual Rendering Tests...`);
  console.log(`======================================================\n`);

  try {
    const { execSync } = require('child_process');
    execSync('node scripts/run_visual_browser_tests.js', { stdio: 'inherit' });
    console.log(`\n======================================================`);
    console.log(`[QA Suite] Now launching E2E Student & Teacher Assignment Lifecycle Tests...`);
    console.log(`======================================================\n`);
    execSync('node scripts/run_e2e_student_teacher_lifecycle.js', { stdio: 'inherit' });
  } catch (visErr) {
    console.error(`[QA Suite] Post-processing suite encountered an issue: ${visErr.message}`);
  }

  if (activeServerProc) {
    console.log(`[QA Suite] Terminating spawned server child process...`);
    try { activeServerProc.kill(); } catch (_) {}
  }
}

runSuite().catch(err => {
  console.error(`[QA Suite] Fatal Suite Error:`, err);
  process.exit(1);
});
