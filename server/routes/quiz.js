/**
 * quiz.js — PDF-to-Interactive-Quiz generation via Gemini Vision (primary) + Qwen 2.5-VL-72B / Pixtral (fallbacks)
 *
 * POST /quiz/generate       — Upload PDF, send to Gemini Vision directly
 * POST /quiz/generate-image — Upload worksheet image, send to Gemini Vision
 * POST /quiz/save           — Save approved quiz to Qdrant vector DB (after teacher review)
 * GET  /quiz/list           — List saved quizzes for a school/grade (search Qdrant)
 * GET  /quiz/:id            — Get a single quiz from Qdrant
 * GET  /quiz/:id/html       — Render quiz as interactive HTML
 */

const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const pdfParse = require('pdf-parse');
const fs       = require('fs');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');
const { client, COLLECTION } = require('../services/qdrant');
const { embed } = require('../services/embeddings');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { extractDiagrams, extractDiagramsFromImage, matchDiagramsToQuestions, ocrFullPDF, ocrRegion, analyzeRegionContent, pdfToImages: pdfToPageImages } = require('../services/diagram-extractor');
const supabase = require('../services/supabase');

// Mirrors GET /branding/logos — looked up here directly (no self HTTP call) so
// every server-rendered preview/worksheet gets the school/curriculum logo.
async function fetchBranding(school, curriculum) {
  try {
    const kinds = [];
    if (school)     kinds.push('school');
    if (curriculum) kinds.push('curriculum');
    if (kinds.length === 0) return { schoolLogoUrl: null, curriculumLogoUrl: null };
    const { data } = await supabase.from('branding_logos').select('kind, name, logo_url').in('kind', kinds);
    const schoolLogoUrl     = (data || []).find(r => r.kind === 'school' && r.name === school)?.logo_url || null;
    const curriculumLogoUrl = (data || []).find(r => r.kind === 'curriculum' && r.name === curriculum)?.logo_url || null;
    return { schoolLogoUrl, curriculumLogoUrl };
  } catch {
    return { schoolLogoUrl: null, curriculumLogoUrl: null };
  }
}

// ── Python Layout Detection Microservice (ML-based, replaces heuristic OpenCV) ──
const LAYOUT_SERVICE_URL = process.env.LAYOUT_SERVICE_URL || 'http://localhost:5050';

/**
 * Call Python layout microservice to detect & crop figures/tables from PDF/image.
 * Returns: { pages: [{ pageNum, fullPageUrl, crops: [{ type, confidence, bbox, imageUrl }] }], allCrops: [...] }
 */
async function callLayoutService(fileBuffer, quizId, { filename = 'file.pdf', mime = 'application/pdf', types = 'figure,table', conf = 0.25, padding = 10 } = {}) {
  try {
    const form = new FormData();
    form.set('file', new Blob([fileBuffer], { type: mime }), filename);
    form.set('quiz_id', quizId);

    const url = `${LAYOUT_SERVICE_URL}/crop?quiz_id=${quizId}&types=${types}&conf=${conf}&padding=${padding}`;
    const controller = new AbortController();
    // layout_service.py now eagerly warms the model at startup and serializes all
    // inference calls (see _inference_lock there), so a request should normally finish in
    // a few seconds — the old failure mode (many minutes) was cold-load + concurrent
    // requests fighting over CPU, both fixed on the Python side now. 45s leaves headroom
    // for a large multi-page PDF while still failing fast if the service is genuinely down.
    const timeout = setTimeout(() => controller.abort(), 45000);
    const res = await fetch(url, { method: 'POST', body: form, signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Layout service ${res.status}: ${err}`);
    }

    const result = await res.json();
    console.log(`[layout-ml] Detected ${result.allCrops?.length || 0} crops in ${result.timing_ms}ms`);
    return result;
  } catch (err) {
    console.log(`[layout-ml] Service unavailable (${err.message}), falling back to heuristic OpenCV`);
    return null;
  }
}

/**
 * Fast path: Convert PDF to page images via Python service (no ML needed).
 * Then run subfigure extraction on each page image.
 * Used when the ML model isn't loaded but we still want diagram extraction.
 */
async function extractDiagramsWithoutML(fileBuffer, quizId, { filename = 'file.pdf', mime = 'application/pdf' } = {}) {
  try {
    // Step 1: Convert PDF to page images
    const form = new FormData();
    form.set('file', new Blob([fileBuffer], { type: mime }), filename);
    const url = `${LAYOUT_SERVICE_URL}/pdf-to-images?quiz_id=${quizId}`;
    const res = await fetch(url, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`pdf-to-images failed: ${res.status}`);

    const { pages } = await res.json();
    console.log(`[layout-fast] Converted PDF to ${pages.length} page images`);

    // Step 2: Run subfigure extraction on each page
    const allSubfigures = [];
    for (const pg of pages) {
      const imgPath = path.join(__dirname, '..', pg.fullPageUrl);
      if (!fs.existsSync(imgPath)) continue;

      const imgBuf = fs.readFileSync(imgPath);
      const sfForm = new FormData();
      sfForm.set('file', new Blob([imgBuf], { type: 'image/png' }), 'page.png');
      const sfUrl = `${LAYOUT_SERVICE_URL}/extract-subfigures?quiz_id=${quizId}&prefix=diag_p${pg.pageNum}_`;
      const sfRes = await fetch(sfUrl, { method: 'POST', body: sfForm });
      if (!sfRes.ok) continue;

      const sfResult = await sfRes.json();
      if (sfResult.subfigures && sfResult.subfigures.length > 0) {
        console.log(`[layout-fast] Page ${pg.pageNum}: ${sfResult.subfigures.length} subfigures (${sfResult.method})`);
        allSubfigures.push({ pageNum: pg.pageNum, subfigures: sfResult.subfigures });
      }
    }

    return {
      pages,
      subfigures: allSubfigures,
      fullPageImages: pages.map(p => ({ pageNum: p.pageNum, imageUrl: p.fullPageUrl })),
    };
  } catch (err) {
    console.log(`[layout-fast] Failed:`, err.message);
    return null;
  }
}

/**
 * Convert Python layout service result to the same format as diagram-extractor.js
 * so matchDiagramsToQuestions() works unchanged.
 */
async function layoutResultToDiagramFormat(layoutResult) {
  if (!layoutResult || !layoutResult.pages) return null;

  const diagrams = [];
  const fullPageImages = [];
  const serverRoot = path.resolve(__dirname, '..');

  for (const page of layoutResult.pages) {
    fullPageImages.push({ pageNum: page.pageNum, imageUrl: page.fullPageUrl });

    for (const crop of (page.crops || [])) {
      // Only include FIGURE crops as question-level diagrams.
      // TABLE crops contain question text/rows — showing them as images
      // duplicates the interactive inputs below. Skip them.
      if (crop.type === 'figure') {
        // Safety net: the ML model sometimes mislabels a letters/words table as "figure"
        // (confirmed case — a grid of large Telugu letters classified as figure got
        // matched to a "match the picture" question instead of the real picture).
        // Re-check with analyzeRegionContent, whose colored-pixel-fraction + middle-band
        // grid-ruling checks were validated against 3 runs of real crops from this exact
        // failure (18/18 correct: all pictures kept, all mislabeled tables excluded).
        let contentType = 'diagram';
        try {
          const cropBuf = fs.readFileSync(path.join(serverRoot, crop.imageUrl));
          if (await analyzeRegionContent(cropBuf) === 'text') {
            // Keep the crop but tag it 'text': matchDiagramsToQuestions skips text crops
            // (so it can't land on a picture question), while verifyDiagramAssignments can
            // still hand it to a task that genuinely IS about a letters/words table
            // (e.g. "Write words using the letters from the table").
            console.log(`[quiz] ML labeled "${crop.filename}" as figure but it reads as a text/letters table — excluding from picture matching`);
            contentType = 'text';
          }
        } catch { /* if the re-check itself fails, trust the ML label */ }
        diagrams.push({
          id: crop.filename,
          pageNum: page.pageNum,
          imageUrl: crop.imageUrl,
          bbox: { x: crop.bbox.x1, y: crop.bbox.y1, w: crop.bbox.width, h: crop.bbox.height },
          area: crop.bbox.width * crop.bbox.height,
          contentType,
          confidence: crop.confidence,
        });
      }
    }
  }

  return { diagrams, fullPageImages, pages: layoutResult.pages, tableCrops: layoutResult.pages.flatMap(p => (p.crops || []).filter(c => c.type === 'table').map(c => ({ ...c, pageNum: p.pageNum }))) };
}

/**
 * Extract sub-figures (e.g. conversion diagrams) from table crops.
 * Called when Gemini marks column groups with hasDiagram:true but ML only detected tables.
 * Uses Python layout service's contour-based sub-figure extraction.
 */
async function extractSubfiguresFromTables(quiz, tableCrops, quizId) {
  if (!tableCrops || tableCrops.length === 0) return;

  // Find tasks with hasDiagram column groups but no figure images assigned
  for (const task of (quiz.tasks || [])) {
    const layout = task.layout || {};
    const colGroups = layout.columnGroups || [];
    if (layout.type !== 'two-column' || colGroups.length < 2) continue;

    const hasDiagramGroups = colGroups.filter(g => g.hasDiagram);
    if (hasDiagramGroups.length === 0) continue;

    // Check if any question already has an imageUrl (from figure crops)
    const allQs = task.questions || [];
    if (allQs.some(q => q.imageUrl)) continue;

    // Find table crops on this task's page
    const pg = task.sourcePage || 1;
    const pageTables = tableCrops.filter(c => c.pageNum === pg);
    if (pageTables.length === 0) continue;

    // Try the first (topmost) table crop — most likely contains the diagrams
    const tableCrop = pageTables[0];
    const tableImagePath = path.join(__dirname, '..', tableCrop.imageUrl);
    if (!fs.existsSync(tableImagePath)) continue;

    try {
      // Call Python service to extract sub-figures from this table crop
      const form = new FormData();
      const tableBuffer = fs.readFileSync(tableImagePath);
      form.set('file', new Blob([tableBuffer], { type: 'image/png' }), 'table.png');

      const url = `${LAYOUT_SERVICE_URL}/extract-subfigures?quiz_id=${quizId}&prefix=diag_p${pg}_`;
      const res = await fetch(url, { method: 'POST', body: form });
      if (!res.ok) continue;

      const result = await res.json();
      const subfigures = result.subfigures || [];

      if (subfigures.length === 0) continue;
      console.log(`[quiz] Extracted ${subfigures.length} sub-figures from table on page ${pg} (method: ${result.method})`);

      // Assign sub-figures to column groups with hasDiagram
      // Sort subfigures left-to-right (already sorted by service)
      const questionsById = {};
      for (const q of allQs) questionsById[q.id] = q;

      let subfigIdx = 0;
      for (const group of colGroups) {
        if (!group.hasDiagram || subfigIdx >= subfigures.length) continue;
        const firstQId = (group.questionIds || [])[0];
        const firstQ = firstQId ? questionsById[firstQId] : null;
        if (firstQ && !firstQ.imageUrl) {
          firstQ.imageUrl = subfigures[subfigIdx].imageUrl;
          firstQ.diagramDescription = 'Reference diagram from worksheet';
          console.log(`[quiz] Assigned subfigure ${subfigures[subfigIdx].filename} → ${task.title} Q(${firstQ.id})`);
          subfigIdx++;
        }
      }
    } catch (err) {
      console.log(`[quiz] Sub-figure extraction failed for page ${pg}:`, err.message);
    }
  }
}

/**
 * Detect blank answer regions (boxes, cells, underlines) on a diagram image via the
 * Python layout service's OpenCV detector. Returns normalized (0..1) coordinates
 * relative to the supplied image — used to overlay input fields on ANY diagram
 * (pyramid, clock, number line, labeled figure) without a per-type renderer.
 */
async function detectBlanksInImage(fileBuffer, quizId, { filename = 'diagram.png', mime = 'image/png' } = {}) {
  try {
    const form = new FormData();
    form.set('file', new Blob([fileBuffer], { type: mime }), filename);
    const url = `${LAYOUT_SERVICE_URL}/detect-blanks?quiz_id=${quizId}&debug=0`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(url, { method: 'POST', body: form, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`detect-blanks ${res.status}`);
    const j = await res.json();
    const page = (j.pages || [])[0];
    if (!page) return null;
    console.log(`[quiz] detect-blanks: ${page.blankCount} blanks found on diagram`);
    return { blanks: page.blanks || [], width: page.width, height: page.height };
  } catch (err) {
    console.log('[quiz] detect-blanks failed:', err.message);
    return null;
  }
}

/**
 * Crop an image tightly around a set of normalized (0..1) blank regions, with padding
 * so surrounding diagram lines and already-filled values stay visible. Returns a new
 * buffer + the blanks re-normalized to the CROPPED image (so overlay % positions stay
 * correct). This is what keeps the diagram-fill overlay scoped to just its own task
 * instead of showing the whole worksheet page.
 */
async function cropToBlanks(buffer, blanks, srcWidth, srcHeight) {
  const sharp = require('sharp');
  if (!blanks.length) return null;

  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const b of blanks) {
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  // Generous padding so diagram outlines / already-filled adjacent values stay in frame,
  // but NOT the whole page (task headings above/below stay excluded).
  const padX = Math.max(0.03, (maxX - minX) * 0.22);
  const padY = Math.max(0.03, (maxY - minY) * 0.35);
  const cx0 = Math.max(0, minX - padX), cy0 = Math.max(0, minY - padY);
  const cx1 = Math.min(1, maxX + padX), cy1 = Math.min(1, maxY + padY);

  const left = Math.round(cx0 * srcWidth), top = Math.round(cy0 * srcHeight);
  const width = Math.max(1, Math.round((cx1 - cx0) * srcWidth));
  const height = Math.max(1, Math.round((cy1 - cy0) * srcHeight));

  const cropped = await sharp(buffer).extract({ left, top, width, height }).png().toBuffer();

  const reNormalized = blanks.map(b => ({
    ...b,
    x: ((b.x * srcWidth) - left) / width,
    y: ((b.y * srcHeight) - top) / height,
    w: (b.w * srcWidth) / width,
    h: (b.h * srcHeight) / height,
  }));
  return { buffer: cropped, blanks: reNormalized };
}

// Gemini Vision (primary engine — free, excellent vision)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

const QUIZ_COLLECTION = 'school_quizzes';
const QUIZ_IMG_DIR = path.join(__dirname, '..', 'data', 'images', 'quiz');
// Ensure quiz image directory exists
if (!fs.existsSync(QUIZ_IMG_DIR)) fs.mkdirSync(QUIZ_IMG_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

// Hugging Face router — serves the Qwen vision fallback (first fallback after Gemini)
const HF_TOKEN = process.env.HF_TOKEN;
// Qwen3-VL-235B: current best open-source document/OCR vision model (successor to 2.5-VL-72B)
const QWEN_VISION_MODEL = process.env.QWEN_VISION_MODEL || 'Qwen/Qwen3-VL-235B-A22B-Instruct';

// Groq (third fallback — generous free tier: 30 req/min)
const Groq = require('groq-sdk');
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

async function callGroq(prompt, { vision = false, imageBuffers = [] } = {}) {
  if (!groq) throw new Error('GROQ_API_KEY not configured');

  if (vision && imageBuffers.length > 0) {
    // Groq Vision — llama-4-scout can read images (max 8192 output tokens)
    const imageBlocks = imageBuffers.map(({ buffer, mime }) => ({
      type: 'image_url',
      image_url: { url: `data:${mime || 'image/png'};base64,${buffer.toString('base64')}` },
    }));
    const completion = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: prompt }] }],
      temperature: 0.3,
      max_tokens: 8192,
    });
    return completion.choices?.[0]?.message?.content || '';
  }

  // Text-only — llama-3.3-70b (max 32k output)
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 8192,
  });
  return completion.choices?.[0]?.message?.content || '';
}

// ── Initialize Qdrant quiz collection on first load ─────────────────────────
let quizCollectionReady = false;
async function ensureQuizCollection() {
  if (quizCollectionReady) return;
  try {
    const { collections } = await client.getCollections();
    const exists = collections.some(c => c.name === QUIZ_COLLECTION);
    if (!exists) {
      await client.createCollection(QUIZ_COLLECTION, {
        vectors: { size: 384, distance: 'Cosine' },
      });
      console.log('✅ Qdrant quiz collection created:', QUIZ_COLLECTION);
    }
    // Ensure every field ever filtered on has an index — Qdrant rejects filtering
    // on an unindexed payload field. This runs even when the collection already
    // existed (created before `curriculum` was added to the mandatory school/
    // curriculum scoping filter), so a field added later still gets indexed
    // instead of only being applied at first-ever collection creation.
    for (const field of ['school_id', 'grade', 'subject', 'teacher_id', 'status', 'curriculum']) {
      try {
        await client.createPayloadIndex(QUIZ_COLLECTION, { field_name: field, field_schema: 'keyword' });
      } catch (idxErr) {
        // Already indexed — Qdrant errors on a duplicate index, which is fine.
        if (!/already exists/i.test(idxErr.message || '')) {
          console.warn(`[quiz] payload index for "${field}" failed:`, idxErr.message);
        }
      }
    }
    quizCollectionReady = true;
  } catch (err) {
    console.error('Qdrant quiz collection init error:', err.message);
  }
}

// ── Mistral API call ────────────────────────────────────────────────────────
async function callMistral(messages, model = 'mistral-small-latest', maxTokens = 4000) {
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: maxTokens }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Mistral API ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ── Mistral OCR — extract text + images from PDF ──────────────────────────
async function mistralOCR(pdfBuffer) {
  const base64 = pdfBuffer.toString('base64');
  const res = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'mistral-ocr-latest',
      document: { type: 'document_url', document_url: `data:application/pdf;base64,${base64}` },
      include_image_base64: true,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Mistral OCR ${res.status}: ${err}`);
  }
  return res.json();
}

// Strip markdown fences + defend against LLMs occasionally adding JS-style "// comments"
// inside JSON (invalid JSON, but common enough from vision models annotating arrays like
// blankAnswers) — removes // comments only when outside of quoted strings.
function cleanLLMJson(raw) {
  let s = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  // Fallback engines (Pixtral/Groq) often wrap the JSON in prose — "Here is the JSON
  // quiz replica...\n\n{...}" — which fence-stripping alone doesn't remove and which
  // 500'd whole generations. The quiz payload is always a single object, so slice to
  // the outermost braces to drop any leading/trailing chatter.
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) s = s.slice(first, last + 1);
  s = s.replace(/"answer":\s*(\d+\/\d+)/g, '"answer": "$1"');
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    out += c;
  }
  return out;
}

// ── Save OCR images to disk, return URL map ───────────────────────────────
function saveOCRImages(ocrResult, quizId) {
  const imageMap = {}; // { "image_id_in_markdown": "/data/images/quiz/xxx.jpg" }
  for (const page of (ocrResult.pages || [])) {
    for (const img of (page.images || [])) {
      if (!img.image_base64) continue;
      // img.id is the markdown image reference id (e.g. "img-0.jpeg")
      const imgId = img.id || uuidv4();
      const hasExt = /\.(jpe?g|png|gif|webp)$/i.test(imgId);
      const fname = hasExt ? `${quizId}_${imgId}` : `${quizId}_${imgId}.jpg`;
      const fpath = path.join(QUIZ_IMG_DIR, fname);
      // Strip data URI prefix if present
      let b64 = img.image_base64;
      if (b64.includes(',')) b64 = b64.split(',')[1];
      fs.writeFileSync(fpath, Buffer.from(b64, 'base64'));
      imageMap[img.id] = `/data/images/quiz/${fname}`;
    }
  }
  return imageMap;
}




/**
 * For every task with a "diagramFill" instruction, run OpenCV blank-detection on that
 * task's diagram image and pair each detected blank (reading-order) with Gemini's
 * blankAnswers (also reading-order). Stores task.diagramFillBlanks for the renderer.
 * This is the general mechanism that makes ANY diagram (pyramid, clock, number line,
 * labeled figure) interactive without a bespoke renderer per shape.
 */
async function resolveDiagramFills(quiz, quizId) {
  const serverRoot = path.resolve(__dirname, '..');
  for (const task of (quiz.tasks || [])) {
    if (!task.diagramFill || !Array.isArray(task.diagramFill.blankAnswers) || !task.diagramFill.blankAnswers.length) continue;

    // Find the image already assigned to this task's diagram (shared crop, per-question
    // crop, or the full worksheet page as a last resort).
    const imgUrl = (task.questions || []).find(q => q.imageUrl)?.imageUrl || task.pageImageUrl;
    if (!imgUrl) { console.log(`[quiz] diagramFill: no image found for task "${(task.title || '').slice(0, 30)}" — skipping overlay`); continue; }

    let buf;
    try {
      if (imgUrl.startsWith('data:')) {
        buf = Buffer.from(imgUrl.split(',')[1], 'base64');
      } else {
        buf = fs.readFileSync(path.join(serverRoot, imgUrl));
      }
    } catch (e) { console.log('[quiz] diagramFill: could not read image', e.message); continue; }

    const detected = await detectBlanksInImage(buf, `${quizId}_df${task.title ? task.title.length : 0}`, { filename: 'diagram.png', mime: 'image/png' });
    if (!detected || !detected.blanks.length) { console.log(`[quiz] diagramFill: no blanks detected for "${(task.title || '').slice(0, 30)}"`); continue; }

    // Crop TIGHTLY to just this diagram (bounding box of its blanks + padding) so the
    // student sees only this task's picture — not the whole worksheet page, and not
    // another task's content bleeding in.
    let finalBuf = buf, finalBlanks = detected.blanks;
    try {
      const cropped = await cropToBlanks(buf, detected.blanks, detected.width, detected.height);
      if (cropped) { finalBuf = cropped.buffer; finalBlanks = cropped.blanks; }
    } catch (e) { console.log('[quiz] diagramFill: crop failed, using full image:', e.message); }

    const answers = task.diagramFill.blankAnswers;
    const n = Math.min(finalBlanks.length, answers.length);
    if (finalBlanks.length !== answers.length) {
      console.log(`[quiz] diagramFill: blank/answer count mismatch (${finalBlanks.length} boxes vs ${answers.length} answers) — pairing first ${n}`);
    }
    task.diagramFillBlanks = finalBlanks.slice(0, n).map((b, i) => ({ ...b, answer: answers[i] }));

    // Save the cropped image and point the renderer at it (instead of the original page/crop)
    const cropFname = `${quizId}_${(task.title || 'diagram').replace(/[^\w]+/g, '_').slice(0, 30)}_fill.png`;
    fs.writeFileSync(path.join(QUIZ_IMG_DIR, cropFname), finalBuf);
    task.diagramFillImageUrl = `/data/images/quiz/${cropFname}`;
    console.log(`[quiz] diagramFill: "${(task.title || '').slice(0, 30)}" → ${task.diagramFillBlanks.length} interactive blanks placed (cropped image)`);
  }
}

// ── Retry wrapper: exponential backoff on Gemini 429 (rate limit) / 503 (overloaded) ──
async function geminiRetry(fn, { tries = 6, base = 2500 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String((e && e.message) || e);
      const is429 = /429|too many requests|quota|resource_exhausted|rate.?limit/i.test(msg);
      const is503 = /503|overloaded|unavailable/i.test(msg);
      lastErr = e;
      // DAILY quota exhaustion can't recover in a minute — retrying just delays the
      // fallback chain by ~2 min per call. Fail fast so Qwen/Pixtral take over.
      if (is429 && /PerDay|per.?day|daily/i.test(msg)) {
        console.log('[quiz] Gemini DAILY quota exhausted — failing fast to fallback engines');
        throw e;
      }
      if ((!is429 && !is503) || i === tries - 1) throw e;
      // Honor server-suggested retry delay if present, else exponential backoff + jitter
      const suggested = msg.match(/retry.?after[^\d]*(\d+)/i) || msg.match(/retryDelay[":\s]+(\d+)/i);
      const wait = suggested ? parseInt(suggested[1], 10) * 1000
        : base * Math.pow(2, i) + Math.floor(Math.random() * 600);
      console.log(`[quiz] Gemini ${is429 ? '429 rate-limit' : '503 overloaded'} — retry ${i + 1}/${tries - 1} in ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// Generate content on a Gemini model with automatic 429/503 retry.
async function geminiGenerate(model, content) {
  const result = await geminiRetry(() => model.generateContent(content));
  return result.response.text();
}

// ── Timeout guard for the primary Gemini Vision call ──────────────────────────
// The Gemini SDK call has no built-in timeout/AbortSignal: if Google's backend
// stalls on a large multimodal payload, generateContent() can hang indefinitely
// with no error and no result, starving the Promise.all() it's raced against in
// generateQuizHandler and blocking the existing Qwen/Pixtral/Groq/OCR fallback
// chain from ever kicking in. This wraps ONLY that call in a configurable
// timeout so a stall becomes a fast, logged failure instead of an infinite wait
// — the fallback chain itself is untouched. The underlying SDK call can't be
// aborted (no AbortController exposed), so it keeps running in the background
// after the timeout fires; Promise.race still attaches a handler to it, so it
// cannot become an unhandled-rejection leak — it just resolves/rejects unused.
const GEMINI_VISION_TIMEOUT_MS = parseInt(process.env.GEMINI_VISION_TIMEOUT_MS || '75000', 10);
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT:${label}:${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── Gemini Vision — primary engine (free, excellent accuracy) ────────────────
async function callGeminiVision(parts, { grade, subject, school } = {}) {
  if (!genAI) throw new Error('GEMINI_API_KEY not configured');
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    // temperature was never set here, so Gemini defaulted to ~1.0 (its highest,
    // most "creative"/randomized setting) for what is a pure READING task, not
    // a creative one — this is why the SAME worksheet's bar chart came back
    // right on one upload and wrong on the next: the model was sampling a
    // different "guess" each run instead of deterministically reading the
    // pixels. temperature: 0 makes it always pick its single most likely
    // (highest-confidence) reading of the image, run after run.
    generationConfig: { responseMimeType: 'application/json', temperature: 0 }
  });
  const prompt = buildQuizVisionPrompt({ grade, subject, school });

  return geminiGenerate(model, [
    ...parts,
    { text: prompt },
  ]);
}

// Helper: build Gemini parts from PDF buffer (sends PDF directly)
function geminiPdfPart(pdfBuffer) {
  return { inlineData: { mimeType: 'application/pdf', data: pdfBuffer.toString('base64') } };
}

// Helper: build Gemini parts from image buffers
function geminiImageParts(imageBuffers) {
  return imageBuffers.map(({ buffer, mime }) => ({
    inlineData: { mimeType: mime || 'image/png', data: buffer.toString('base64') },
  }));
}

// ── Bar-chart recovery ──────────────────────────────────────────────────────
// The main vision pass SOMETIMES omits the structured task.chart (LLM run-to-run
// nondeterminism), leaving the task to fall back to the raw cropped scan of the graph.
// That's why the SAME worksheet renders a clean, generated bar chart on one upload and
// a screenshot on the next. This targeted second pass re-reads the graph image for any
// bar-graph task that is missing chart data and rebuilds task.chart deterministically,
// so the generated chart ALWAYS wins. If the recovery call fails we keep the crop
// (existing behaviour) — never worse than before.
function taskLooksLikeBarGraph(task) {
  const blob = [task.title, task.sharedImageDescription, ...(task.questions || []).map(q => q.question || '')].join('  ');
  return /bar\s*graph|column\s*chart|bar\s*chart/i.test(blob);
}

// True if the task has NO visual representation at all yet — no chart, no
// shared task image, no diagram-fill, no per-question image. Deliberately
// generic (not bar-chart-specific): "does this task claim ANY visual
// component" applies the same way to a Venn diagram, a table, a geometry
// figure, a timeline, or a map.
function taskHasNoVisual(task) {
  const hasChart = task.chart && Array.isArray(task.chart.bars) && task.chart.bars.length;
  return !hasChart && !task.sharedImage && !task.diagramFill
    && !(task.questions || []).some(q => q.hasImage);
}

// Generic, type-agnostic recovery trigger: does this task sit on a page where
// the layout service (DocLayout-YOLO) detected a visual region, with NO
// interactive component in the quiz claiming it? This is intentionally
// decoupled from any one visual TYPE (bar chart, Venn, table, geometry,
// timeline, map, ...) — it only answers "was something visual detected here
// that nothing in the quiz accounts for," using layout data ALREADY fetched
// during generation (see Step 1's reuse of the same /crop response for
// validation), so it costs zero additional API calls. Any future recovery
// handler for a different visual type can call this same function instead of
// re-deriving page/region lookup logic — `regionTypes` lets each caller pick
// which detected region kinds are relevant to it (e.g. a table-recovery
// handler would pass ['table'] instead of the default ['figure']).
function hasUnclaimedVisualRegion(task, layoutMLResult, regionTypes = ['figure']) {
  if (!layoutMLResult?.pages || !taskHasNoVisual(task)) return false;
  const page = layoutMLResult.pages.find(p => p.pageNum === (task.sourcePage || 1));
  return (page?.crops || []).some(c => regionTypes.includes(c.type));
}

// `layoutMLResult` (optional) is the SAME /crop response already fetched for
// diagram cropping earlier in generation (see Step 1's use of allCrops for
// validation) — reused here, not a new call. Its `pages[].crops` list every
// figure/table region DocLayout-YOLO found on that page.
// One task's chart-recovery attempt — factored out of recoverBarCharts so it
// can be run concurrently across tasks (see below) instead of serially. Each
// call only reads/writes its own `task` object, so running several at once is
// safe: no shared mutable state between tasks.
async function recoverOneBarChart(task, layoutMLResult) {
  // Already has structured bars (from the main pass or normalizeCharts) — nothing to do.
  if (task.chart && Array.isArray(task.chart.bars) && task.chart.bars.length) return;
  // Keyword trigger stays specific to THIS recovery handler (bar charts) —
  // the generic, reusable part is hasUnclaimedVisualRegion below, not this.
  const keywordTrigger = taskLooksLikeBarGraph(task);
  const layoutTrigger = !keywordTrigger && hasUnclaimedVisualRegion(task, layoutMLResult, ['figure']);
  if (!keywordTrigger && !layoutTrigger) return;

  // The graph image is either the crop assigned to this task, or its page image.
  // At generation time this is a /data/... file path; on a SAVED quiz reopened later
  // (e.g. from the quiz library, or Preview/Edit Answers re-normalizing it) it has
  // already been converted to a base64 data: URI by embedQuizImages — handle both.
  const imgUrl = (task.questions || []).find(q => q.imageUrl)?.imageUrl || task.pageImageUrl;
  if (!imgUrl) return;
  let buf;
  try {
    if (imgUrl.startsWith('data:')) {
      const b64 = imgUrl.split(',')[1];
      if (!b64) return;
      buf = Buffer.from(b64, 'base64');
    } else {
      const p = path.join(__dirname, '..', imgUrl);
      if (!fs.existsSync(p)) return;
      buf = fs.readFileSync(p);
    }
  } catch { return; }

  try {
    // temperature: 0 — this is the targeted RE-READ of a bar chart specifically
    // because the main pass sometimes omits/misreads it; leaving temperature
    // unset here would reintroduce the same run-to-run randomness this
    // recovery pass exists to fix.
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { responseMimeType: 'application/json', temperature: 0 } });
    const prompt = `This image is a BAR GRAPH from a school worksheet. Read it precisely and return ONLY a JSON object:
{"type":"bar","title":"<graph title or empty string>","xLabel":"<x-axis label or empty>","yLabel":"<y-axis label or empty>","yMax":<number at the TOP gridline>,"yStep":<gap between gridlines>,"bars":[{"label":"<category>","value":<exact bar height read off the y-axis>}]}
Rules: list bars strictly LEFT-TO-RIGHT in the order they appear. Read every bar's height precisely against the y-axis scale (yMax = top gridline, yStep = gap between gridlines). Do NOT swap adjacent bars. Output JSON only — no markdown, no commentary.`;
    // Same timeout guard as the primary/retry vision calls.
    const raw = await withTimeout(
      geminiGenerate(model, [...geminiImageParts([{ buffer: buf, mime: 'image/png' }]), { text: prompt }]),
      GEMINI_VISION_TIMEOUT_MS,
      'gemini-chart-recovery'
    );
    const chart = JSON.parse(cleanLLMJson(raw));
    if (chart && Array.isArray(chart.bars) && chart.bars.length >= 2) {
      chart.type = 'bar';
      chart.bars = chart.bars.filter(b => b && b.label != null && !isNaN(Number(b.value))).map(b => ({ label: String(b.label), value: Number(b.value) }));
      if (chart.bars.length >= 2) {
        task.chart = chart;
        // The structured chart now owns the visual — drop the raw scan so it isn't shown
        // twice (stripImagesForStructuredTasks does the rest at render time).
        task.sharedImage = false;
        delete task.sharedImageDescription;
        console.log(`[quiz] chart-recovery: rebuilt bar chart for "${(task.title || '').slice(0, 30)}" (${chart.bars.length} bars)`);
      }
    }
  } catch (e) {
    const isTimeout = String(e && e.message).startsWith('TIMEOUT:');
    console.log(`[quiz] chart-recovery ${isTimeout ? `TIMEOUT after ${GEMINI_VISION_TIMEOUT_MS}ms` : 'failed'} for "${(task.title || '').slice(0, 30)}"${isTimeout ? '' : ': ' + e.message}`);
  }
}

async function recoverBarCharts(quiz, layoutMLResult = null) {
  if (!genAI) return;
  // Each task's recovery attempt is fully independent (own image, own
  // task.chart write) — running them concurrently instead of one-at-a-time
  // means N tasks needing recovery cost ~1 timeout window total instead of
  // N timeout windows serially (profiling showed a single stalled task
  // already cost 75s alone; a worksheet with 2+ such tasks was paying that
  // multiple times over for no reason).
  await Promise.all((quiz.tasks || []).map(task => recoverOneBarChart(task, layoutMLResult)));
}

// ── Missing-digit vertical arithmetic: deterministic solver ────────────────
// Solves for "_" digits in a stacked addition/subtraction (top ± bottom = result)
// using the same column-by-column carry/borrow procedure a student would use —
// pure arithmetic, no AI call, reusing the top/bottom/result strings the main
// extraction pass already produced. A column is only solved when exactly one of
// its three digits is unknown (the standard "missing digit puzzle" shape); a
// column with 2+ unknowns can't be solved by this fast path and falls through
// to the brute-force verifier below instead.
function solveVerticalMath(vm) {
  if (!vm || !vm.top || !vm.bottom) return { solvable: false };
  const op = vm.operator === '+' ? '+' : '-';
  const width = Math.max(vm.top.length, vm.bottom.length, (vm.result || '').length);
  const pad = (s) => String(s || '').padStart(width, '_'); // right-align
  const hadResult = !!vm.result;
  const fast = solveVerticalMathFast(pad(vm.top).split(''), pad(vm.bottom).split(''), hadResult ? pad(vm.result).split('') : new Array(width).fill('_'), hadResult, op, width);
  if (fast.solvable) return fast;

  // Fallback: brute-force search for puzzles with 2+ unknown digits in the same
  // column (under-determined for the column method above, e.g. "7_5 - 3_7 = 670").
  // Only meaningful when a result row was actually shown (nothing to verify a
  // guess against otherwise). If exactly one digit assignment reproduces the
  // shown equation, that's the verified answer. If NONE do, the extracted
  // digits/operator are simply impossible — `impossible: true` tells the caller
  // to drop the question rather than ever display a guessed/hallucinated
  // "solution". If MORE THAN ONE do, the puzzle is genuinely ambiguous and gets
  // the same treatment — we never guess between competing valid answers.
  if (!hadResult) return { solvable: false };
  const brute = bruteForceSolveVerticalMath(pad(vm.top).split(''), pad(vm.bottom).split(''), pad(vm.result).split(''), op, width);
  if (!brute) return { solvable: false, impossible: true };
  const topArr = pad(vm.top).split(''), bottomArr = pad(vm.bottom).split(''), resultArr = pad(vm.result).split('');
  const blanks = [];
  for (let i = 0; i < width; i++) {
    if (topArr[i] === '_') blanks.push({ row: 'top', index: i, digit: brute.t[i] });
    if (bottomArr[i] === '_') blanks.push({ row: 'bottom', index: i, digit: brute.b[i] });
    if (resultArr[i] === '_') blanks.push({ row: 'result', index: i, digit: brute.r[i] });
  }
  return {
    solvable: true,
    blanks,
    solvedTopStr: brute.t.join(''),
    solvedBottomStr: brute.b.join(''),
    solvedResultStr: brute.r.join(''),
    steps: [`${brute.t.join('')} ${op} ${brute.b.join('')} = ${brute.r.join('')} (verified — the only digit combination that satisfies this problem)`],
  };
}

// Fast path: solves a column only when exactly one of its three digits is
// unknown, using the same carry/borrow procedure a student would follow —
// this also produces the human-readable step-by-step narrative.
function solveVerticalMathFast(top, bottom, result, hadResult, op, width) {
  const blanks = [];
  const steps = [];
  let carry = 0; // carry (addition) or borrow (subtraction) into the next (leftward) column
  for (let i = width - 1; i >= 0; i--) {
    const t = top[i], b = bottom[i], r = result[i];
    const tKnown = t !== '_' && t !== undefined, bKnown = b !== '_' && b !== undefined, rKnown = r !== '_' && r !== undefined && hadResult;
    const unknownCount = (tKnown ? 0 : 1) + (bKnown ? 0 : 1) + (hadResult ? (rKnown ? 0 : 1) : 0);
    const colLabel = width - i; // 1 = units, 2 = tens, ...
    if (op === '+') {
      if (tKnown && bKnown) {
        const sum = Number(t) + Number(b) + carry;
        const digit = sum % 10;
        const nextCarry = sum >= 10 ? 1 : 0;
        if (!hadResult) { result[i] = String(digit); }
        else if (!rKnown) { result[i] = String(digit); blanks.push({ row: 'result', index: i, digit: String(digit) }); }
        else if (Number(r) !== digit) return { solvable: false }; // extracted digits are internally inconsistent — bail rather than show a wrong "fix"
        steps.push(`Column ${colLabel}: ${t} + ${b}${carry ? ' + 1 (carried)' : ''} = ${sum} → write ${digit}${nextCarry ? ', carry 1' : ''}`);
        carry = nextCarry;
      } else if (unknownCount === 1 && hadResult && rKnown) {
        if (!tKnown) {
          let v = Number(r) - Number(b) - carry; let nextCarry = 0;
          if (v < 0) { v += 10; } // shouldn't happen for '+', but guards against bad extraction
          if (v < 0 || v > 9) return { solvable: false };
          top[i] = String(v); blanks.push({ row: 'top', index: i, digit: String(v) });
          steps.push(`Column ${colLabel}: ? + ${b}${carry ? ' + 1 (carried)' : ''} = ${r} → missing top digit is ${v}`);
          carry = nextCarry;
        } else {
          let v = Number(r) - Number(t) - carry; let nextCarry = 0;
          if (v < 0 || v > 9) return { solvable: false };
          bottom[i] = String(v); blanks.push({ row: 'bottom', index: i, digit: String(v) });
          steps.push(`Column ${colLabel}: ${t} + ? ${carry ? '+ 1 (carried) ' : ''}= ${r} → missing bottom digit is ${v}`);
          carry = nextCarry;
        }
      } else {
        return { solvable: false }; // under-determined column
      }
    } else {
      // subtraction: top - bottom = result, with borrow propagating leftward
      if (tKnown && bKnown) {
        let tv = Number(t) - carry, borrowOut = 0;
        if (tv < Number(b)) { tv += 10; borrowOut = 1; }
        const digit = tv - Number(b);
        if (!hadResult) { result[i] = String(digit); }
        else if (!rKnown) { result[i] = String(digit); blanks.push({ row: 'result', index: i, digit: String(digit) }); }
        else if (Number(r) !== digit) return { solvable: false };
        steps.push(`Column ${colLabel}: ${t}${carry ? ' (borrowed, so ' + tv + ')' : ''} − ${b} = ${digit}${borrowOut ? ', borrow 1 from next column' : ''}`);
        carry = borrowOut;
      } else if (unknownCount === 1 && hadResult && rKnown) {
        if (!bKnown) {
          let tv = Number(t) - carry;
          let v = tv - Number(r);
          let borrowOut = 0;
          if (v < 0) { v += 10; borrowOut = 1; }
          if (v < 0 || v > 9) return { solvable: false };
          bottom[i] = String(v); blanks.push({ row: 'bottom', index: i, digit: String(v) });
          steps.push(`Column ${colLabel}: ${t}${carry ? ' (borrowed)' : ''} − ? = ${r} → missing bottom digit is ${v}`);
          carry = borrowOut;
        } else {
          // top unknown, bottom & result known.
          // t - carry - b = r  (if no further borrow needed)  =>  t = r + b + carry
          // or, if that column itself needed a borrow: t = r + b + carry - 10
          let v = Number(r) + Number(b) + carry;
          let borrowOut = 0;
          if (v > 9) { v -= 10; borrowOut = 1; }
          if (v < 0 || v > 9) return { solvable: false };
          top[i] = String(v); blanks.push({ row: 'top', index: i, digit: String(v) });
          steps.push(`Column ${colLabel}: ? ${carry ? '(borrowed) ' : ''}− ${b} = ${r} → missing top digit is ${v}`);
          carry = borrowOut;
        }
      } else {
        return { solvable: false };
      }
    }
  }
  if (blanks.length === 0) return { solvable: false }; // nothing was actually missing — not this feature's concern
  // Steps were pushed units-first (loop runs right→left); that IS the natural
  // solving order a student follows, so no reordering needed here.
  return {
    solvable: true,
    blanks,
    solvedTopStr: top.join(''),
    solvedBottomStr: bottom.join(''),
    solvedResultStr: result.join(''),
    steps,
  };
}

// Brute-force fallback for columns with 2+ unknown digits (out of reach for the
// carry/borrow fast path). Tries every digit 0-9 for each blank position and
// keeps only assignments where top ± bottom EXACTLY equals the shown result.
// Returns the unique solution, or null if there are zero or multiple — either
// way the caller must not display an unverified guess. Capped at 6 blanks
// (10^6 combinations) which comfortably covers any real worksheet puzzle
// while keeping this instant.
function bruteForceSolveVerticalMath(top, bottom, result, op, width) {
  const blanks = [];
  for (let i = 0; i < width; i++) {
    if (top[i] === '_') blanks.push({ row: 'top', index: i });
    if (bottom[i] === '_') blanks.push({ row: 'bottom', index: i });
    if (result[i] === '_') blanks.push({ row: 'result', index: i });
  }
  if (blanks.length === 0 || blanks.length > 6) return null;
  let solution = null;
  const total = Math.pow(10, blanks.length);
  for (let n = 0; n < total; n++) {
    const t = top.slice(), b = bottom.slice(), r = result.slice();
    let rem = n;
    for (let k = 0; k < blanks.length; k++) {
      const d = String(rem % 10);
      rem = Math.floor(rem / 10);
      const bl = blanks[k];
      if (bl.row === 'top') t[bl.index] = d;
      else if (bl.row === 'bottom') b[bl.index] = d;
      else r[bl.index] = d;
    }
    if (width > 1 && t[0] === '0') continue; // no leading-zero numbers
    if (width > 1 && b[0] === '0') continue;
    const tv = Number(t.join('')), bv = Number(b.join('')), rv = Number(r.join(''));
    const computed = op === '+' ? tv + bv : tv - bv;
    if (computed !== rv) continue;
    if (solution) return null; // second valid assignment found — ambiguous, refuse to guess
    solution = { t, b, r };
  }
  return solution;
}

// ── Vertical-math operator self-consistency check ──────────────────────────
// The +/− symbol is a small glyph vision models occasionally misread even at
// temperature 0. This never rewords the prompt or adds an API call — it just
// cross-checks the ALREADY-EXTRACTED top/bottom/result/answer against pure JS
// arithmetic, using two independent, purely pattern-based signals:
//   Tier 1 (broad, no gating): if the worksheet shows a result row, does
//   top OP bottom actually equal it? If not, does the OPPOSITE operator match?
//   Applies to any vertical-math question with a result row, on any worksheet.
//   Tier 2 (narrow fallback): if there's no result row (the answer is a
//   looked-up letter, not a shown digit — e.g. a decode-the-message pattern),
//   and the SAME task also has a lookup table, check whether the stated vs.
//   opposite operator's result appears as a key in that table. Only ever
//   activates when both a code-style table AND a no-result vertical-math
//   question coexist in the same task — worksheets without a lookup table are
//   completely untouched by this tier; its trigger condition never matches.
function checkVerticalMathOperator(q, task) {
  const vm = q.verticalMath;
  if (!vm || !vm.top || !vm.bottom || /_/.test(vm.top) || /_/.test(vm.bottom)) return null; // only fully-given digits — blanks are solveVerticalMath's job
  const top = Number(vm.top), bottom = Number(vm.bottom);
  if (isNaN(top) || isNaN(bottom)) return null;
  const stated = vm.operator === '+' ? '+' : '-';
  const opposite = stated === '+' ? '-' : '+';
  const compute = (op, a, b) => op === '+' ? a + b : a - b;
  const statedResult = compute(stated, top, bottom);
  const oppositeResult = compute(opposite, top, bottom);

  // Tier 1: a shown result row is itself the ground truth.
  if (vm.result && !/_/.test(vm.result)) {
    const shown = Number(vm.result);
    if (!isNaN(shown)) {
      if (statedResult === shown) return null; // consistent — nothing to flag
      if (oppositeResult === shown) return { correctOperator: opposite, correctResult: oppositeResult, via: 'result-row' };
      return null; // neither matches — a different kind of error; don't guess
    }
  }

  // Tier 2: no result row — only usable if this task has a lookup table
  // shaped like "<number> - <letter/code>" rows (a decode/cipher pattern).
  const lookup = buildDecodeLookup(task);
  if (lookup.size === 0) return null; // no code table in this task — Tier 2 never activates
  const statedHit = lookup.get(String(statedResult));
  const oppositeHit = lookup.get(String(oppositeResult));
  if (!statedHit && oppositeHit) return { correctOperator: opposite, correctResult: oppositeResult, correctAnswer: oppositeHit, via: 'code-table' };
  return null;
}

// Builds a "<number printed in table> → <letter/code printed next to it>" map from a
// task's decode/cipher reference table(s), e.g. rows like "745 - M" become ("745" → "M").
// Shared by checkVerticalMathOperator's Tier 2 and checkDecodeAnswer below.
function buildDecodeLookup(task) {
  const tables = Array.isArray(task.tables) ? task.tables : (task.table ? [task.table] : []);
  const lookup = new Map();
  for (const tbl of tables) {
    for (const row of (tbl.rows || [])) {
      for (const cell of row) {
        const text = (cell && (cell.text || '')) || '';
        const m = text.match(/^\s*(\d+)\s*[-–—]\s*(\S+)\s*$/);
        if (m) lookup.set(m[1], m[2]);
      }
    }
  }
  return lookup;
}

// ── Decode/cipher plain-arithmetic answer cross-check ──────────────────────
// For ordinary (non-verticalMath) sub-questions like "326 + 419" that sit under a
// "solve, then use the code to find the letter" task, the LLM has to do arithmetic
// AND a table lookup in the same pass — nothing forces those two steps to agree
// with each other. This recomputes the arithmetic straight from the question text
// in pure JS, looks the result up in the SAME code table Gemini already extracted,
// and overrides `q.answer` whenever the LLM's stored answer doesn't match what the
// table actually says — so the student is never graded against a mismatched letter.
function checkDecodeAnswer(q, task) {
  if (!q || q.verticalMath) return null; // vertical-math questions have their own check
  const text = String(q.question || '');
  const m = text.match(/(-?\d+(?:\.\d+)?)\s*([+\-])\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lookup = buildDecodeLookup(task);
  if (lookup.size === 0) return null;
  const a = Number(m[1]), b = Number(m[3]);
  if (isNaN(a) || isNaN(b)) return null;
  const result = m[2] === '+' ? a + b : a - b;
  const correctAnswer = lookup.get(String(result));
  if (correctAnswer === undefined) return null; // computed sum isn't in the table — don't guess
  const stated = String(q.answer == null ? '' : q.answer).trim();
  if (stated.toLowerCase() === String(correctAnswer).trim().toLowerCase()) return null; // already consistent
  return { result, correctAnswer };
}

// Downscale + cap page images so vision fallbacks don't 413 / exceed image limits.
// Pixtral allows ≤8 images; Groq has a hard request-size limit — big full-res PNGs blow it.
async function prepVisionImages(imageBuffers, { max = 8, width = 1400 } = {}) {
  const sharp = require('sharp');
  const sliced = imageBuffers.slice(0, max);
  const out = [];
  for (const img of sliced) {
    try {
      const buffer = await sharp(img.buffer)
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality: 72 })
        .toBuffer();
      out.push({ buffer, mime: 'image/jpeg' });
    } catch {
      out.push(img); // fall back to original if resize fails
    }
  }
  return out;
}

// Convert a Word .docx → PDF (mammoth: docx→HTML preserves tables/images; puppeteer: HTML→PDF).
// This lets Word worksheets flow through the SAME vision pipeline as PDFs, so tables/graphs
// are detected and rendered interactively instead of flattened to text.
async function docxToPdf(buffer) {
  const mammoth = require('mammoth');
  const puppeteer = require('puppeteer');
  const { value: bodyHtml } = await mammoth.convertToHtml({ buffer });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 16mm; }
    body { font-family: 'Times New Roman', Georgia, serif; font-size: 13pt; color:#000; line-height:1.55; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    td, th { border: 1px solid #000; padding: 6px 10px; text-align: left; vertical-align: top; }
    img { max-width: 100%; height: auto; }
    h1,h2,h3 { margin: 12px 0 6px; }
    p { margin: 6px 0; }
  </style></head><body>${bodyHtml}</body></html>`;
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

// ── Pixtral Vision — fallback engine ───────────────────────────────────────
async function callPixtralVision(imageBuffers, { grade, subject, school } = {}) {
  if (!MISTRAL_API_KEY) throw new Error('MISTRAL_API_KEY not configured');

  // Build image content blocks
  const imageBlocks = imageBuffers.map(({ buffer, mime }) => ({
    type: 'image_url',
    image_url: { url: `data:${mime || 'image/png'};base64,${buffer.toString('base64')}` },
  }));

  const prompt = buildQuizVisionPrompt({ grade, subject, school });

  const result = await callMistral([{
    role: 'user',
    content: [
      ...imageBlocks,
      { type: 'text', text: prompt },
    ],
  }], 'mistral-small-latest', 16000);

  return result;
}

// ── Qwen 2.5-VL-72B Vision — first fallback after Gemini (via HF router) ───
async function callQwenVision(imageBuffers, { grade, subject, school } = {}) {
  if (!HF_TOKEN) throw new Error('HF_TOKEN not configured');

  const imageBlocks = imageBuffers.map(({ buffer, mime }) => ({
    type: 'image_url',
    image_url: { url: `data:${mime || 'image/png'};base64,${buffer.toString('base64')}` },
  }));

  const prompt = buildQuizVisionPrompt({ grade, subject, school });

  // Qwen on the free HF router is slow (~1-3 min) — abort so the chain can move on to Pixtral
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240000);
  try {
    const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${HF_TOKEN}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: QWEN_VISION_MODEL,
        messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: prompt }] }],
        max_tokens: 8192,
        temperature: 0.3,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HF router ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    return json.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SEMANTIC CROP VERIFICATION — caption every figure crop with a vision LLM
// (Gemini primary → Qwen fallback) and check the caption actually matches the
// question the crop was assigned to. CV decides WHERE the pictures are; this
// decides WHAT they are. Rules:
//   • Only intervene when captions give a confident signal (fail open).
//   • A question with no confident crop keeps its heuristic image — unless that
//     crop was claimed by another question, in which case it is DROPPED:
//     no image beats the wrong image.
// ═════════════════════════════════════════════════════════════════════════

function cropCaptionPrompt(n) {
  return `These are ${n} cropped regions from a school worksheet, in order. For each one, describe the main content in 3-8 simple English words (e.g. "a clay pot", "a swan swimming", "table of Telugu letters", "bar graph of sports", "L-shaped polygon diagram"). Reply with ONLY a JSON array of ${n} strings in the same order. No markdown, no explanations.`;
}

function parseCaptionArray(raw, n) {
  let s = String(raw || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const first = s.indexOf('[');
  const last = s.lastIndexOf(']');
  if (first === -1 || last <= first) return null;
  try {
    const arr = JSON.parse(s.slice(first, last + 1));
    if (!Array.isArray(arr) || arr.length !== n) return null;
    return arr.map(x => String(x || ''));
  } catch { return null; }
}

async function captionCropsGemini(crops) {
  if (!genAI) throw new Error('GEMINI_API_KEY not configured');
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json', temperature: 0 }
  });
  const raw = await geminiGenerate(model, [
    ...geminiImageParts(crops),
    { text: cropCaptionPrompt(crops.length) },
  ]);
  return parseCaptionArray(raw, crops.length);
}

async function captionCropsQwen(crops) {
  if (!HF_TOKEN) throw new Error('HF_TOKEN not configured');
  const imageBlocks = crops.map(({ buffer, mime }) => ({
    type: 'image_url',
    image_url: { url: `data:${mime || 'image/png'};base64,${buffer.toString('base64')}` },
  }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${HF_TOKEN}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: QWEN_VISION_MODEL,
        messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: cropCaptionPrompt(crops.length) }] }],
        max_tokens: 1024,
        temperature: 0.1,
      }),
    });
    if (!res.ok) throw new Error(`HF router ${res.status}`);
    const json = await res.json();
    return parseCaptionArray(json.choices?.[0]?.message?.content || '', crops.length);
  } finally {
    clearTimeout(timer);
  }
}

const CAPTION_STOPWORDS = new Set(['the', 'and', 'with', 'for', 'its', 'has', 'this', 'that', 'from', 'are',
  'picture', 'image', 'images', 'photo', 'drawing', 'illustration', 'cartoon', 'clip', 'art', 'diagram',
  'showing', 'shows', 'object', 'item', 'worksheet', 'correct', 'match', 'matching', 'word', 'telugu',
  'hindi', 'english', 'simple', 'small', 'large', 'colorful', 'white', 'background']);

function captionTokens(s) {
  return new Set(String(s || '').toLowerCase().replace(/[^a-z0-9ఀ-౿ऀ-ॿ\s]/g, ' ')
    .split(/\s+/).filter(w => w.length >= 3 && !CAPTION_STOPWORDS.has(w)));
}

function captionOverlap(a, b) {
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const w of a) {
    if (b.has(w)) { hits++; continue; }
    for (const v of b) {
      if ((w.length >= 4 && v.includes(w)) || (v.length >= 4 && w.includes(v))) { hits += 0.5; break; }
    }
  }
  return hits / Math.min(a.size, b.size);
}

async function verifyDiagramAssignments(diagramExtraction, quiz) {
  try {
    // Include 'text' crops too: they can't be claimed by picture questions (captions like
    // "table of Telugu letters" won't match them), but a letters-table TASK can claim one.
    const diagrams = ((diagramExtraction && diagramExtraction.diagrams) || []).filter(d => d.imageUrl);
    if (!diagrams.length) return;
    const serverRoot = path.join(__dirname, '..');
    const crops = [];
    for (const d of diagrams.slice(0, 12)) {
      const p = path.join(serverRoot, d.imageUrl);
      if (fs.existsSync(p)) crops.push({ diagram: d, buffer: fs.readFileSync(p), mime: 'image/png' });
    }
    if (!crops.length) return;

    // Units = things that own an image: one per hasImage question, one per sharedImage task
    const units = [];
    for (const task of (quiz.tasks || [])) {
      const qs = task.questions || [];
      if (!qs.length) continue;
      if (task.sharedImage || (qs[0] && qs[0]._sharedImage)) {
        // Includes sharedImage tasks that ended up with NO crop (e.g. their table crop was
        // excluded from picture matching) — a confident caption can still attach one here.
        units.push({ type: 'shared', task, qs, desc: `${task.sharedImageDescription || ''} ${task.title || ''}`, current: qs[0].imageUrl });
      } else {
        for (const q of qs) {
          if (q.imageUrl || q.hasImage) {
            units.push({ type: 'q', q, desc: `${q.diagramDescription || ''} ${q.question || ''}`, current: q.imageUrl });
          }
        }
      }
    }
    if (!units.length) return;

    let captions = null;
    try { captions = await captionCropsGemini(crops); }
    catch (e) { console.log('[verify] Gemini captioning failed:', e.message); }
    if (!captions) {
      try { captions = await captionCropsQwen(crops); console.log('[verify] Captions via Qwen fallback'); }
      catch (e) { console.log('[verify] Qwen captioning failed:', e.message); }
    }
    if (!captions) { console.log('[verify] No captions available — keeping heuristic image matching'); return; }
    crops.forEach((c, i) => {
      c.caption = captions[i];
      console.log(`[verify] ${c.diagram.imageUrl.split('/').pop()} = "${c.caption}"`);
    });

    const capTok = crops.map(c => captionTokens(c.caption));
    const pairs = [];
    units.forEach((u, ui) => {
      const uTok = captionTokens(u.desc);
      crops.forEach((c, ci) => pairs.push({ ui, ci, s: captionOverlap(capTok[ci], uTok) }));
    });

    const THRESH = 0.34;
    if (!pairs.some(p => p.s >= THRESH)) {
      console.log('[verify] Captions gave no confident signal — keeping heuristic image matching');
      return;
    }

    // Greedy unique assignment, best similarity first
    pairs.sort((a, b) => b.s - a.s);
    const uAssigned = new Map();
    const cAssigned = new Set();
    for (const p of pairs) {
      if (p.s < THRESH) break;
      if (uAssigned.has(p.ui) || cAssigned.has(p.ci)) continue;
      uAssigned.set(p.ui, p.ci);
      cAssigned.add(p.ci);
    }

    const setImage = (u, url, bbox) => {
      if (u.type === 'shared') { for (const q of u.qs) { q.imageUrl = url; q.diagramBbox = bbox; q._sharedImage = true; } }
      else { u.q.imageUrl = url; u.q.diagramBbox = bbox; }
    };
    const dropImage = (u) => {
      if (u.type === 'shared') { for (const q of u.qs) { q.imageUrl = null; q._sharedImage = false; } }
      else { u.q.imageUrl = null; }
    };

    units.forEach((u, ui) => {
      const ci = uAssigned.get(ui);
      const label = u.type === 'shared' ? `task "${String(u.task.title || '').slice(0, 30)}"` : `Q(${u.q.id})`;
      if (ci !== undefined) {
        const d = crops[ci].diagram;
        if (u.current !== d.imageUrl) {
          console.log(`[verify] REASSIGNED ${label}: ${String(u.current || 'none').split('/').pop()} → ${d.imageUrl.split('/').pop()} ("${crops[ci].caption}")`);
        }
        setImage(u, d.imageUrl, d.bbox);
      } else if (u.current) {
        // No confident crop for this unit. Drop its image only if another unit
        // confidently claimed the same crop — otherwise keep the heuristic match.
        const claimedElsewhere = [...uAssigned.entries()].some(([oui, oci]) => oui !== ui && crops[oci].diagram.imageUrl === u.current);
        if (claimedElsewhere) {
          console.log(`[verify] DROPPED wrong image from ${label} (${String(u.current).split('/').pop()} belongs to another question)`);
          dropImage(u);
        }
      }
    });
  } catch (err) {
    console.log('[verify] Verification skipped:', err.message);
  }
}

// ── Shared quiz vision prompt (used by both Claude and Pixtral) ────────────
function buildQuizVisionPrompt({ grade, subject, school } = {}) {
  return `You are an expert quiz generator for ${grade || 'IB PYP Grade 4'} ${subject || 'Mathematics'}.

STEP 1: CAREFULLY examine the worksheet image(s). Read EVERY number, word, symbol, shape, table, and layout element.

⚠️ ACCURACY IS THE #1 PRIORITY. NEVER guess, approximate, or invent a number. Every number in your output MUST be a number you can actually SEE printed on the worksheet. If you output a problem like "100 + 233" when the worksheet actually shows "326 + 419", that is a CRITICAL FAILURE. Read each digit individually.

⚠️ VERTICAL / COLUMN ARITHMETIC (READ THIS CAREFULLY — this is where most mistakes happen):
Many math worksheets show addition/subtraction as a VERTICAL STACK, not inline. For example:
     326                317
   + 419              - 258
   ─────              ─────
This means "326 + 419" and "317 - 258". To read a vertical stack correctly:
  1. Read the TOP number completely, digit by digit, left to right (e.g. 3-2-6 = 326).
  2. Read the operator on the left (+ or −).
  3. Read the BOTTOM number completely, digit by digit (e.g. 4-1-9 = 419).
  4. The problem is "TOP operator BOTTOM" (e.g. "326 + 419").
Do NOT swap digits, drop digits, or invent a smaller/rounder number. "628" is NOT "68" or "600". Read all THREE digits. If the worksheet has 9 stacked problems, you MUST output those 9 problems with their EXACT numbers — count them and match.

STEP 2: For each task/section in the worksheet, extract:
- The exact title/heading
- Every single question with exact numbers
- Any diagrams, tables, or visual elements
- The operation being performed (+, -, ×, ÷)

STEP 3: Generate quiz JSON that is a PERFECT REPLICA of the worksheet.

RULES:
1. Each Task from the worksheet = one task in JSON. Keep EXACT task title and instructions.
2. Label questions EXACTLY as worksheet does (a, b, c, d, e — NOT q1, q2).
2b. NEVER collapse multiple numbered/lettered items under one instruction into a single
    question. If one instruction covers several sentences/blanks/rows (e.g. "d1) ... d2) ...
    d3) ... d4) ..." or 4 separate sentences each needing its own circled word and blank),
    emit ONE question per item, each with its own id (d1, d2, d3, d4) and its own answer/
    hint/solution — never merge them into a single answer field. Count the actual items in
    the worksheet and make sure your output has that same count of questions for that task.
3. Use the EXACT SAME NUMBERS from the worksheet. Do NOT substitute different numbers.
4. Every question MUST have a correct "answer" field. YOU MUST SOLVE each problem. Think step by step, compute the answer, and write the final result. NEVER write "Not provided in the text" or "N/A" — you are the solver, not just an extractor.
4b. Keep "answer" SHORT — the literal, direct response a student would type in the blank (e.g. "football", "12 cm", "rugby and badminton"). NEVER pack your full working/narrative into "answer" (e.g. do NOT write "20, closer to football" or "Current votes for rugby = 10, so doubled = 20..." as the answer) — that full reasoning belongs ONLY in "solution". A bloated "answer" field makes correct short student responses get marked wrong.
5. Pay careful attention to UNITS.
6. Every question MUST have a "solution" field with a clear step-by-step explanation. NEVER write "Not provided" — work through the problem and explain how to get the answer.
7. Every question MUST have a "hint" field — a short clue that guides the student without giving the full answer. NEVER leave hint empty or omit it.
8. DIAGRAM/IMAGE HANDLING (CRITICAL — read carefully):
   a) If MULTIPLE questions in a task ALL reference the SAME shared diagram/picture (e.g. a picture of objects where Q1-Q4 all ask about the same picture, or a set of weighing scales where all questions refer to the same image), then:
      - Set "sharedImage": true on the TASK object (not on individual questions)
      - Set "sharedImageDescription": description of the shared diagram
      - Set "sharedImagePosition": position on the page ("top-center", "middle-center", etc.)
      - Set "hasImage": false on ALL individual questions (the image belongs to the task, not to any single question)
      Example: A picture showing a book, bench, and foot — with Q1 "The book is ___ foot", Q2 "The bench is ___ feet", Q3 "The book is ___ than the bench" — ALL reference the SAME picture. Use sharedImage on the task.
   b) If a question has its OWN UNIQUE diagram that no other question uses, set "hasImage": true on that question with:
      - "diagramDescription": short description (e.g. "L-shaped polygon with sides 5m, 6m, 8m, 3m")
      - "diagramPosition": approximate position on the page: "top-left", "top-right", "top-center", "middle-left", "middle-right", "middle-center", "bottom-left", "bottom-right", "bottom-center"
   c) For text-only questions with no diagram, set "hasImage": false.
   These fields are used by the server to match cropped images to the correct questions. Getting this wrong causes images to appear on the wrong questions.
   d) If a task/section has an ILLUSTRATION or DECORATIVE IMAGE (e.g. a cartoon character, animal picture, beehive, tree diagram, branching arrows) that provides context but is not a per-question diagram, treat it as a sharedImage on the task:
      - Set "sharedImage": true, "sharedImageDescription": description, "sharedImagePosition": position
      This ensures ALL visual elements from the worksheet are preserved, not just math diagrams.
9. Do NOT generate SVG, HTML diagrams, or diagramHTML. The server handles all image rendering separately.
10. For questions that reference a graph/chart/image: READ the visual data from the image to compute the answer. For example, if a bar graph shows football=16, tennis=8 and the Y-axis goes 0,2,4,6... then the scale is 2.
11. MATCH-THE-FOLLOWING TASKS (e.g. "match the word to the picture", "match the following", "జతపరచండి"): emit ONE question per item to match. Set "type": "mcq" and "options": an array of ALL candidate words/phrases from the matching column (the full pool — the SAME list for every question in that task, in a different order per question), and "answer": the correct word for that item. Do NOT emit matching items as free-text fill-in questions — the student must pick from the pool, not type it.
12. COUNT THE ANSWER SPACES. If a task provides N blank lines / boxes / spaces for the student to write answers (e.g. 6 blank lines next to a letters table), generate EXACTLY N questions — one per blank line. Count the physical blank lines in the image before writing the questions. Never collapse them into fewer questions.

LAYOUT EXTRACTION (CRITICAL — replicate the worksheet's visual layout):
- Look at how questions are arranged: single column, two columns side-by-side, grid, etc.
- For each task, include a "layout" object describing the visual arrangement.
- "layout.type": "single-column" (one column of questions), "two-column" (two side-by-side columns like conversion tables), "grid" (grid of cells), "list" (numbered list)
- "layout.columns": number of columns (1 or 2 typically)
- "layout.columnGroups": array of column groups, each with "questionIds" listing which questions belong to that column (in order, top to bottom)
- If a column group has a diagram/image above its questions, set "hasDiagram": true on that group
- Questions in column 0 are LEFT side, column 1 are RIGHT side
- CRITICAL ID RULE: Every question in a task MUST have a globally unique "id" (e.g. "a", "b", "c", "d", "e" for the left column, and "f", "g", "h", "i", "j" for the right column). Never reuse the same "id" within a task, even if the worksheet repeats question labels (like two columns both labeled 'a', 'b', 'c').

Return this EXACT JSON structure:
{
  "title": "worksheet title",
  "subject": "${subject || 'Mathematics'}",
  "grade": "${grade || 'PYP 4'}",
  "school": "${school || ''}",
  "purpose": "the Purpose/objective line stated on the worksheet, verbatim (empty string if none)",
  "learningOutcomes": ["each Learning Outcome bullet point, exactly as written on the worksheet"],
  "concepts": [{ "term": "name", "definition": "short child-friendly definition", "unit": "unit" }],
  "tasks": [
    {
      "tier": "<section label exactly as printed, e.g. 'Must Do' — or '' if none>",
      "title": "Task 1: exact title from worksheet",
      "sourcePage": 1,
      "layout": {
        "type": "two-column",
        "columns": 2,
        "columnGroups": [
          { "hasDiagram": true, "questionIds": ["a","b","c","d","e"] },
          { "hasDiagram": true, "questionIds": ["f","g","h","i","j"] }
        ]
      },
      "questions": [
        { "id": "a", "type": "numeric", "question": "4 kg = ___ gm", "unit": "gm", "answer": 4000, "hint": "1 kg = 1000 gm", "solution": "4 × 1000 = 4000 gm", "hasImage": false },
        { "id": "f", "type": "numeric", "question": "5 l = ___ ml", "unit": "ml", "answer": 5000, "hint": "1 l = 1000 ml", "solution": "5 × 1000 = 5000 ml", "hasImage": false }
      ]
    },
    {
      "tier": "<this task's own section label, exactly as printed>",
      "title": "Task 3: Observe the picture and fill in the blanks",
      "sourcePage": 2,
      "sharedImage": true,
      "sharedImageDescription": "Picture showing a book, a bench, and a foot as measurement unit",
      "sharedImagePosition": "top-center",
      "layout": { "type": "single-column", "columns": 1 },
      "questions": [
        { "id": "a", "type": "numeric", "question": "The length of the book is ___ foot.", "unit": "foot", "answer": 1, "hasImage": false },
        { "id": "b", "type": "numeric", "question": "The length of the bench is ___ feet.", "unit": "feet", "answer": 4, "hasImage": false }
      ]
    }
  ]
}

NOTE on layout:
- For simple single-column worksheets, use: "layout": { "type": "single-column", "columns": 1 }
- For two-column conversion tables (like kg/gm on left, l/ml on right), use "two-column" with columnGroups
- The "hasImage" on questions refers to per-question diagrams. The "hasDiagram" on columnGroups refers to shared diagrams above a group of questions (like conversion arrows).
- ALWAYS include layout — it is used to render the quiz in the same visual format as the worksheet.

NUMBER PYRAMID HANDLING (use this INSTEAD of diagramFill/sharedImage when the diagram is a
number pyramid — a triangle of stacked boxes where each pair of adjacent blocks sums to the
block above them). Add a "pyramids" ARRAY to the TASK (one entry per pyramid shown):
"pyramids": [
  {
    "label": "1.",
    "rows": [ [null], [null, null], ["3.3", "1.2", "0.1"] ]
  }
]
- "rows" goes TOP to BOTTOM, each row left to right, exactly matching the worksheet layout.
- A cell is the STRING of the printed value (e.g. "3.3") if given, or JSON null if that
  block is BLANK for the student to fill in.
- SOLVE every null cell (each pair of adjacent blocks sums to the block above them) and
  provide a "solved" array of the SAME shape with every cell filled with its true value:
  "solved": [ ["4.5"], ["3.4", "1.1"], ["3.3", "1.2", "0.1"] ]  (example only — solve for real)
- Do NOT set sharedImage/diagramFill for a task fully described by "pyramids", and do NOT
  create separate questions for it — "pyramids" + "solved" fully replaces both.
- ⚠️ The numbers above (1., 3.3, 1.2, 4.5...) are ONLY an illustration of the JSON shape — they are
  NOT from any real worksheet. Read the ACTUAL numbers printed in the pyramid you were given and
  solve THOSE. Never output this example's numbers unless they genuinely appear on the page.

DIAGRAM-FILL HANDLING (use this for any OTHER diagram not covered above — clocks, number
lines, labeled figures, and ANY diagram type where the student writes answers directly ONTO
the picture, not in separate boxes):
If a task shows a diagram with MULTIPLE blank spots to fill in (e.g. a number pyramid with
empty blocks, a clock-conversion table with empty cells, a labeled diagram with blank labels,
a number line with missing values), do NOT reduce it to one or two simplified questions.
Instead add a "diagramFill" object to the TASK:
"diagramFill": {
  "blankAnswers": ["3.3", "1.2", "0.1", "4.5", "1.4", "5.9"]
}
- List the correct answer for EVERY SINGLE blank in the diagram, in the exact order a person
  reading the image top-to-bottom, then left-to-right within each row, would fill them in.
  Example: a pyramid with a blank top block, then a blank in row 2, then a blank in row 3
  (middle), then a blank bottom-row cell needs 4 entries in that exact order — not just
  "the top value". Count every empty box/cell you can see and solve every one of them.
- Still set "sharedImage": true and "sharedImageDescription" on the task as usual so the
  diagram picture is captured — diagramFill ADDS to that, it doesn't replace it.
- Do NOT also create separate questions asking about individual blanks in this diagram —
  diagramFill.blankAnswers covers all of them; the questions array should only contain
  OTHER questions in the task that are not part of filling the diagram itself (if any).

GRAPH / CHART HANDLING (CRITICAL — never reduce a graph to a text note):
⚠️ FIRST decide whether a chart ALREADY EXISTS on the worksheet, or whether the worksheet is
ASKING THE STUDENT TO CREATE ONE:
- If the worksheet ALREADY PRINTS a finished bar graph/column chart with bars, axes, and a scale
  — and questions below it ask the student to READ values off that graph — then add "chart" to
  the task as described below (this is the ONLY case where "chart" applies).
- If the worksheet instead gives RAW DATA (a list of survey answers, a tally table, a frequency
  table) and the INSTRUCTION says something like "organize the data and draw a bar graph in your
  graph book/notebook" — there is NO existing chart to read. The graph does not exist yet; the
  STUDENT draws it on paper. This is a hands-on "activity" question ("type": "activity"), NOT a
  chart-reading task. Do NOT synthesize/compute a "chart" object for this — that would show the
  student an already-solved graph before they've done the work themselves, which defeats the
  exercise. Just capture the raw data as a "tables" entry (per TABLE HANDLING above) and emit ONE
  "activity" question with the "draw a bar graph" instruction as its text.
- When in doubt: only emit "chart" if you can literally see bars with a height/scale printed on
  the page right now — never emit it as a "solution" or "answer" to a data-organizing activity.

If a task shows a BAR GRAPH / COLUMN CHART that students read to answer questions (the FIRST case
above), you MUST ALWAYS add a "chart" object to the TASK (not the question). This is MANDATORY — never describe the graph only as a "sharedImage" or in text; the structured "chart" object must ALWAYS be present so the graph can be redrawn cleanly. READ THE EXACT VALUES from the image:
"chart": {
  "type": "bar",
  "title": "Favourite Fruit",
  "xLabel": "Fruit",
  "yLabel": "Count",
  "yMax": 30,
  "yStep": 5,
  "bars": [
    { "label": "apple",  "value": 15 },
    { "label": "banana", "value": 25 },
    { "label": "orange", "value": 10 },
    { "label": "grape",  "value": 20 }
  ]
}
⚠️ CRITICAL — the "apple"/"banana"/15/25 values above are ONLY a JSON-shape illustration. They are
NOT from any real worksheet and must NEVER appear in your output. Extract the ACTUAL labels and
values shown on the REAL graph you were given, reading fresh from the image each time — do not
let any category names or numbers you've seen before (in this prompt or any other worksheet)
influence what you report here. Every value must come from the pixels in front of you right now.
- BE EXTREMELY CAREFUL with the alignment of category labels on the X-axis and their corresponding bars. Do not swap or misalign adjacent columns/bars — count bars left to right and match each one to its own label directly below it before reading its height.
- Cross-reference and double-check your extracted values against the math questions in the worksheet to make sure they are consistent (e.g., if a question asks about the sum of votes or doubled values, verify that your bar values yield the correct mathematical answers to those questions!).
- Ensure that the "answer" field value is 100% consistent with your step-by-step reasoning in the "solution" field — both must name the exact same categories, computed from the exact same bar values you read.
- Read every bar's height precisely using the y-axis scale. yMax = top of the axis, yStep = gap between gridlines.
- The questions below the graph stay as normal numeric/text/long questions — the chart is the shared visual they refer to.

TABLE HANDLING (CRITICAL — never split a table into separate one-line questions, never drop a table):
Capture EVERY table in a task inside a "tables" ARRAY on the TASK (a task can have more than one table — e.g. a raw data grid AND a tally/frequency table). Keep each grid intact. This is only an
illustration of the JSON SHAPE — "ItemA"/"ItemB" etc are generic placeholders, NOT real content;
replace every value with what is ACTUALLY printed on the worksheet you were given:
"tables": [
  {
    "title": "<table title or empty string>",
    "headers": [],
    "rows": [
      [ { "text": "ItemA" }, { "text": "ItemB" }, { "text": "ItemA" }, { "text": "ItemC" }, { "text": "ItemB" } ],
      [ { "text": "ItemD" }, { "text": "ItemE" }, { "text": "ItemB" }, { "text": "ItemE" }, { "text": "ItemA" } ]
    ]
  },
  {
    "title": "",
    "headers": ["<column 1 header>", "<column 2 header>", "<column 3 header>"],
    "rows": [
      [ { "text": "ItemA" }, { "input": true, "answer": "<count you computed>" }, { "input": true, "answer": "<count you computed>" } ],
      [ { "text": "ItemB" }, { "input": true, "answer": "<count you computed>" }, { "input": true, "answer": "<count you computed>" } ]
    ]
  }
]
- Each cell is either { "text": "given content" } OR { "input": true, "answer": "correct value" } for a blank the student fills.
- READ-ONLY tables (raw data grids, reference tables with NO blanks) MUST still be captured — use all { "text": ... } cells. NEVER drop them or turn them into a paragraph. "headers" may be [] if the grid has no header row.
- SOLVE every blank cell yourself and put the value in "answer" (e.g. count the tallies → frequency).
- Do NOT also emit table cells as separate questions — the tables replace them.

DECODE / CIPHER / SECRET-CODE TABLES (CRITICAL — do not skip this, it is easy to miss):
Many "solve the problems, then use the code to reveal the secret message" tasks show a small
reference table/box mapping numbers to letters (e.g. "333 - S", "622 - R", "1219 - Y" ...) ABOVE
the actual problems. This mapping key is ALWAYS a separate READ-ONLY table you must capture in
"tables" — even though it looks like a small boxed grid rather than a traditional data table, and
even though the questions below it ask "what is the secret letter for X" (those stay as their own
"numeric"/"text" questions in "questions" as already instructed — the mapping key is IN ADDITION
to them, not instead). Shape only — every number/letter below is a placeholder, NOT real content:
"tables": [
  {
    "title": "CODE",
    "headers": [],
    "rows": [
      [ { "text": "<n1> - <L1>" }, { "text": "<n2> - <L2>" }, { "text": "<n3> - <L3>" } ],
      [ { "text": "<n4> - <L4>" }, { "text": "<n5> - <L5>" }, { "text": "<n6> - <L6>" } ]
    ]
  }
]
- Read the EXACT number and letter for EVERY cell actually printed in the box on the worksheet you
  were given — students need this table to check their own decoded answers, so it must be 100%
  accurate, not approximate, and must match the real page, not this placeholder shape.
- Preserve the grid's row/column layout exactly as printed (do not reorder or reflow entries).
- CRITICAL SELF-CHECK — for every problem that decodes through this table: after you compute the
  arithmetic result, LOOK UP that exact number in the code table you just captured, and put the
  matching letter (not a guessed or remembered one) in the "answer" field. Then re-read the
  "answer" field back against the "solution" field's final number — they MUST reference the same
  row of the table. Never let "answer" and "solution" disagree; if they would, redo the lookup
  rather than shipping a mismatch.

VERTICAL / COLUMN ARITHMETIC DISPLAY (CRITICAL for readability — worksheets showing a stacked
sum like "96_ \n -_83 \n ----- \n 162" MUST NOT be flattened into run-on text like "Calculate the
missing digits: 9 6 _ - _ 8 3 ----- 1 6 2" — students can't read that). For ANY question whose
worksheet shows the numbers stacked vertically (with a rule line under the second number),
whether or not any digits are missing, add a "verticalMath" object to that question so it can be
displayed in the same column layout as the worksheet:
"verticalMath": { "operator": "-", "top": "<digits you actually see>", "bottom": "<digits you actually see>", "result": "<digits you actually see>" }
- "top"/"bottom"/"result" are STRINGS of digits, one character per column, read top-to-bottom
  exactly as printed on the REAL worksheet — never copy the placeholder text above literally.
  Use "_" for any digit that is blank/missing on the worksheet (to be solved).
- "operator" is "+" or "-".
- Leave "result" as "" if the worksheet doesn't show a result row (i.e. the student computes the
  whole sum, not just missing digits).
- This is IN ADDITION to the normal "question"/"answer"/"hint"/"solution" fields — keep those as
  usual (the "question" text can stay short, e.g. "Calculate the missing digits.", since the
  numbers themselves are now shown via verticalMath, not restated in the sentence).
- Do NOT use this for simple inline sums the worksheet already writes horizontally (e.g. "12 + 8 = ___") — only for worksheets that print the numbers stacked with a line under them.

QUESTION TYPES:
- "numeric" — number answer (integer or decimal)
- "text" — text answers, fractions like "14/25", comparisons like "<", mixed like "1 km 800 m"
- "long" — open-ended written response (sentences/paragraphs). Use textarea, NO "Answer =" label.
- "mcq" — multiple choice (include "options" array with {label, correct} objects)
- "activity" — drawing, colouring, pasting, constructing tasks (NO typed answer — student does it on paper)
- "venn" — a Venn diagram the student must FILL IN (two overlapping circles). Use this WHENEVER the worksheet shows a Venn diagram / two overlapping circles to be completed. DO NOT convert a Venn into a plain text box.

VENN DIAGRAM QUESTIONS (CRITICAL — never flatten a Venn into a single text box):
⚠️ The example below is ONLY the JSON SHAPE, not real content — "GroupA"/"GroupB" and every item
name are generic placeholders. Read the ACTUAL two circle labels and the ACTUAL items from the
worksheet you were given; never output "Almond"/"Spinach" or any of the placeholder item names
below unless those exact words genuinely appear on the real page in front of you.
If the worksheet contains a Venn diagram to complete, output ONE question with "type":"venn" and this exact shape:
{
  "id": "1",
  "type": "venn",
  "question": "Complete the Venn diagram to compare <GroupA> and <GroupB>.",
  "leftLabel": "GroupA",
  "rightLabel": "GroupB",
  "regions": [
    { "id": "left",   "placeholder": "GroupA only" },
    { "id": "center", "placeholder": "Both (common)" },
    { "id": "right",  "placeholder": "GroupB only" }
  ],
  "answers": {
    "left":   ["<item unique to GroupA>", "<item unique to GroupA>"],
    "center": ["<item shared by both>"],
    "right":  ["<item unique to GroupB>", "<item unique to GroupB>"]
  },
  "hint": "Items shared by BOTH go in the overlapping middle; unique items go in their own circle.",
  "solution": "<restate exactly which items you put in each region, matching 'answers' above>"
}
- "left"/"right" answers = items that belong ONLY to that circle. "center" = items in BOTH.
- YOU MUST solve it: read the source text, compute which items are shared vs unique, and fill all three answer arrays. Never leave them empty.
- Set "leftLabel"/"rightLabel" to the two circle labels from the worksheet.
- CONSISTENCY (CRITICAL): the "answers" arrays and the "solution" text MUST list the EXACT SAME items — same count, same values. Never have "solution" narrate one set of numbers/items while "answers" contains a different set. An item must appear in EXACTLY ONE of left/center/right — never duplicated across regions, never omitted from all three. For "multiples of N" style lists, double-check your boundary (e.g. "first 15 multiples of 3" = 3,6,...,45 — recompute and recount before splitting into only/common).

⚠️ OPEN-ENDED VENN DIAGRAMS — DO NOT SKIP THESE, HANDLE DIFFERENTLY (do not drop the task just
because it can't be auto-solved): some worksheets ask the STUDENT to first pick their OWN input
before filling a Venn diagram — e.g. "Choose any two times tables. Write the first 15 multiples of
each, then sort them into a Venn diagram" (the student decides which two numbers — the worksheet
gives no fixed numbers, so there is no single correct "answers" to compute). For this kind of task:
- Still emit "type":"venn" (so the student gets the real two-circle diagram to fill in, not a
  plain text instruction with no diagram) — but set "openEnded": true and OMIT "answers" entirely
  (do not invent/guess numbers; you cannot know what the student will choose, and a fixed answer
  would be hallucinated). Use the actual circle labels the worksheet gives if any are fixed (e.g.
  "left"/"right" for "First Number"/"Second Number"), otherwise generic labels like "Circle A"/
  "Circle B". Set "hint" to explain the PROCESS the student should follow (e.g. "Pick two numbers,
  list 15 multiples of each, then sort: only-first-number's-multiples on the left, only-second on
  the right, shared multiples in the middle.") — never a "solution" with specific values, since
  there isn't one.
- The distinguishing signal: if the worksheet gives you the SPECIFIC items/data to sort (like the
  GroupA/GroupB shape above, filled with the real items from the page), it's a solvable "venn"
  question with "answers" filled in. If the worksheet tells the student to CHOOSE their own
  numbers/items first, it's "venn" with
  "openEnded": true and no "answers" — never invent one, and never downgrade it to plain text.

PASSAGE & EXAMPLE EXTRACTION (CRITICAL):
- If a task has a reading passage, story, or paragraph that students must read before answering, include it as "passage" on the task object. Preserve the FULL text exactly.
- If a question has an example (e.g. "→ Example: The buyer went to the market"), include it as "example" on the question object.
- For fill-in-the-table tasks (e.g. "Incorrect Word / Correct Word"), represent each row as a separate question with type "text".
- NEVER truncate or omit passage text. Students cannot answer without it.

CRITICAL ACCURACY RULES:
1. Use "activity" type for questions that say "draw", "sketch", "construct", "colour", "paste", etc.
2. For approximate answers (grid counting, estimation), include "acceptRange": [min, max].
3. Bold key numbers in questions using **markdown**: "A square has sides **65 m** long."
4. Identify polygons correctly: count the sides (hexagon=6, octagon=8, pentagon=5).
5. Calculate ALL answers correctly. SHOW YOUR WORK mentally — solve step by step before writing the answer.
6. For L-shapes, calculate missing sides FIRST before finding perimeter.
7. Keep units consistent — use EXACT units from the worksheet.
8. Extract EVERY SINGLE question — do NOT skip or truncate. If a task has 9 problems, include ALL 9.
9. If the worksheet has a decode/secret message with letter boxes, include ALL letter-answer mappings.
10. EVERY question MUST have "hint" — a short, helpful clue that guides the student WITHOUT giving the full answer. Examples: "1 kg = 1000 gm", "Count all the sides of the shape", "Use the formula: Area = length × width". NEVER leave hint empty or omit it.
11. EVERY question MUST have "solution" — a clear step-by-step explanation of how to reach the answer. NEVER leave solution empty or omit it.

IMPORTANT: Each task MUST include "sourcePage": <page_number> (1-indexed) indicating which PDF page the task appears on.

TIERS/SECTIONS: extract whatever section labels the worksheet actually prints for "tier"
(e.g. "Must Do" / "Could Do" / "Enrichment" is one common convention, but others exist —
"Core" / "Extension" / "Challenge", "Level 1" / "Level 2", or a worksheet may have no
tier/section labels at all). Copy the label EXACTLY as printed, in its original casing and
wording — do NOT force it into "MUST DO" / "COULD DO" / "ENRICHMENT" if the worksheet uses
different words. If the worksheet has no tier/section structure, leave "tier" as "".

PURPOSE & LEARNING OUTCOME:
- If the worksheet has a "Purpose:" line near the top, copy it verbatim into the top-level "purpose" field. Leave it "" if the worksheet has none.
- If the worksheet has a "Learning Outcome:" section (usually a bulleted list right under Purpose), copy EACH bullet verbatim as its own entry in the top-level "learningOutcomes" array. Leave it [] if the worksheet has none. Do NOT confuse this with "Success Criteria"/"Learning Goals"/"I can..." statements below — those go in "successCriteria" instead, per the section below.

NOTES & SUCCESS CRITERIA:
- If the worksheet includes a "Note to Parents", "Teacher's Note", or general instructions at the top/bottom (e.g. explaining Must Do / Could Do / Enrichment Task tiers), extract them into a top-level "notes" field (string).
- If the worksheet includes "Success Criteria", "Learning Goals", "I can..." statements, or rubric, extract them into a top-level "successCriteria" array of strings.
- Shape only, NOT real content — use the worksheet's own actual wording, never these placeholders:
  "purpose": "<verbatim Purpose line, or empty string>", "learningOutcomes": ["<verbatim bullet 1>", "<verbatim bullet 2>"], "notes": "<verbatim note/instructions text, or empty string>", "successCriteria": ["<verbatim I-can statement 1>", "<verbatim I-can statement 2>"]

Return ONLY valid JSON, no markdown fences, no extra text, and NO // or /* */ comments anywhere in the JSON (comments make it invalid and unparseable).`;
}

// ── Validation: check LLM output against OCR ground truth ───────────────────
// `layoutCounts` (optional) is { figures, tables } detected by the ML layout
// service (DocLayout-YOLO) — infrastructure that already runs on every
// generation for cropping, just never previously consulted for validation.
// Deliberately scoped to figures/tables only, not a full question count:
// DocLayout-YOLO's "plain text" regions are coarse (one region can span
// several questions), so comparing its region count directly to question
// count would produce false-positive retries. Figure/table detection is
// where this model is actually reliable, and it directly targets the
// "dropped diagram/table" failure mode, which existing OCR-text-based
// validation structurally cannot see (a diagram has no text to miss).
function validateQuizAgainstOCR(quiz, ocrText, layoutCounts = null) {
  if (!ocrText) return { valid: true, missingTasks: [], detectedTiers: [], detectedTaskHeaders: [] };

  const textLower = ocrText.toLowerCase();

  // Detect tier markers in OCR text
  const detectedTiers = [];
  if (/must\s*do/i.test(ocrText)) detectedTiers.push('MUST DO');
  if (/could\s*do/i.test(ocrText)) detectedTiers.push('COULD DO');
  if (/enrichment/i.test(ocrText)) detectedTiers.push('ENRICHMENT');

  // Detect task headers: "Task 1:", "Task 2:", etc.
  const taskHeaderRegex = /task\s*(\d+)\s*[:.]/gi;
  const detectedTaskHeaders = [];
  let match;
  while ((match = taskHeaderRegex.exec(ocrText)) !== null) {
    detectedTaskHeaders.push(`Task ${match[1]}`);
  }

  // Check which tiers are missing from quiz output
  const quizTiers = new Set((quiz.tasks || []).map(t => (t.tier || '').toUpperCase()));
  const missingTasks = [];
  for (const tier of detectedTiers) {
    if (!quizTiers.has(tier)) {
      missingTasks.push(`${tier} section`);
    }
  }

  // Check task count: if OCR has "Task 1, Task 2, Task 3" but quiz only has 2 tasks
  if (detectedTaskHeaders.length > (quiz.tasks || []).length) {
    missingTasks.push(`${detectedTaskHeaders.length - (quiz.tasks || []).length} task(s) by count`);
  }

  // Question-level check (not just task/tier headers): count question-label-like
  // patterns in the OCR text (lettered "a)", numbered "1)", or "Q1"/"Q.1" style)
  // and compare against how many questions actually made it into the quiz. This
  // catches the specific failure mode of "the model got the right TASKS but
  // silently dropped one question inside a task" — the previous check only saw
  // task/tier headers, so a dropped individual question was invisible to it.
  // Deliberately conservative (only flags a CLEAR shortfall, not off-by-one) to
  // avoid triggering an unnecessary/wasteful retry on borderline OCR noise —
  // table cells and decode-code entries can loosely resemble a label pattern,
  // so a small mismatch is expected and not worth a retry.
  const labelMatches = new Set();
  const letterLabelRe = /(?:^|[\s(])([a-h])\)\s/gm;
  const numberLabelRe = /(?:^|[\s(])(\d{1,2})\)\s/gm;
  const qLabelRe = /\bQ\.?\s?(\d{1,2})\b/gi;
  let lm;
  while ((lm = letterLabelRe.exec(ocrText)) !== null) labelMatches.add(`L${lm[1].toLowerCase()}`);
  while ((lm = numberLabelRe.exec(ocrText)) !== null) labelMatches.add(`N${lm[1]}`);
  while ((lm = qLabelRe.exec(ocrText)) !== null) labelMatches.add(`Q${lm[1]}`);
  const likelyLabelCount = labelMatches.size;
  const actualQuestionCount = (quiz.tasks || []).reduce((sum, t) => sum + (t.questions || []).length, 0);
  // Only flag a shortfall of at least 3 (or 25%, whichever is larger) — well
  // past normal OCR-pattern noise, but still catches genuinely dropped questions.
  const shortfall = likelyLabelCount - actualQuestionCount;
  const shortfallThreshold = Math.max(3, Math.ceil(actualQuestionCount * 0.25));
  if (likelyLabelCount > 0 && shortfall >= shortfallThreshold) {
    missingTasks.push(`~${shortfall} question(s) by label count (OCR suggests ~${likelyLabelCount} labeled items, quiz has ${actualQuestionCount})`);
  }

  // Figure/table cross-check against the ML layout detector (see comment above
  // the function). Count every visual element the quiz actually captured —
  // shared task images, per-question diagrams, charts, Venns, diagram-fills,
  // and table blocks — and compare against what the layout model detected on
  // the page. Conservative by design (shortfall of 2+, not 1) since a single
  // detected "figure" is sometimes decorative (a logo, clipart) rather than
  // content — this check exists to catch a clearly dropped diagram or table,
  // not to nitpick borderline cases.
  if (layoutCounts && (layoutCounts.figures > 0 || layoutCounts.tables > 0)) {
    let capturedVisuals = 0;
    for (const t of (quiz.tasks || [])) {
      if (t.sharedImage) capturedVisuals++;
      if (t.chart) capturedVisuals++;
      if (t.diagramFill) capturedVisuals++;
      if (Array.isArray(t.tables)) capturedVisuals += t.tables.length;
      for (const q of (t.questions || [])) {
        if (q.type === 'venn') capturedVisuals++;
        if (q.hasImage) capturedVisuals++;
      }
    }
    const detectedVisuals = (layoutCounts.figures || 0) + (layoutCounts.tables || 0);
    const visualShortfall = detectedVisuals - capturedVisuals;
    if (visualShortfall >= 2) {
      missingTasks.push(`~${visualShortfall} diagram/table(s) by layout detection (page has ~${detectedVisuals} figure/table regions, quiz captured ${capturedVisuals})`);
    }
  }

  return { valid: missingTasks.length === 0, missingTasks, detectedTiers, detectedTaskHeaders, likelyLabelCount, actualQuestionCount };
}

// ── POST /quiz/generate — PDF upload → quiz JSON (Claude Vision primary, Mistral fallback) ──
// Named (not inline) so it can also be driven by a mock req/res from the
// queued /generate-async path (see quiz_generate job handler) — same logic,
// just not blocking the teacher's browser tab for the full AI pipeline.
async function generateQuizHandler(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });

    const { grade, subject, school } = req.body;
    const quizId = uuidv4().slice(0, 8);
    // ── Diagnostic timing instrumentation (temporary — investigating an
    // intermittent stall on large image-heavy worksheets). Logs elapsed ms at
    // each pipeline stage boundary, tagged with quizId so concurrent requests
    // don't interleave confusingly. ──
    const __t0 = Date.now();
    const __mark = (stage) => console.log(`[quiz][timing][${quizId}] ${stage}: ${Date.now() - __t0}ms elapsed`);
    // ?engine=qwen (etc.) skips Gemini so the fallback chain starts at that engine —
    // used for benchmarking engines against each other on the same worksheet.
    const forceEngine = String(req.query.engine || req.body.engine || '').toLowerCase();
    const skipGemini = forceEngine && forceEngine !== 'gemini';
    if (skipGemini) console.log(`[quiz] engine=${forceEngine} — skipping Gemini primary`);

    // ── Word document? Convert .docx → PDF so it uses the SAME vision pipeline ──
    const origName = (req.file.originalname || '').toLowerCase();
    const isDocx = origName.endsWith('.docx')
      || req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (isDocx) {
      try {
        console.log('[quiz] Word .docx detected — converting to PDF (mammoth + puppeteer)...');
        const pdfBuf = await docxToPdf(req.file.buffer);
        req.file.buffer = pdfBuf;
        req.file.mimetype = 'application/pdf';
        console.log(`[quiz] docx→pdf OK: ${(pdfBuf.length / 1024).toFixed(0)}KB`);
      } catch (e) {
        console.log('[quiz] docx→pdf failed:', e.message);
        return res.status(400).json({ error: 'Could not read this Word document. Please export it to PDF and upload that.' });
      }
    }

    // Guard: reject PDFs > 4MB to prevent OOM on Cloud Run (2GB)
    if (req.file.buffer.length > 4 * 1024 * 1024) {
      return res.status(400).json({ error: 'File too large (max 4MB). Please upload a smaller worksheet.' });
    }

    let result;
    let usedEngine = 'gemini'; // tracks which LLM actually produced the result
    let usedVision = true; // tracks if the LLM actually SAW the worksheet image
    let diagramExtraction = null;

    // ══════════════════════════════════════════════════════════════════════
    // STEP 1: Run THREE things in PARALLEL (no waiting):
    //   A) Tesseract OCR           → extract text from PDF (no LLM)
    //   B) Python ML Layout Service → crop figures/tables using DocLayout-YOLO (no LLM)
    //      (falls back to heuristic OpenCV if Python service is unavailable)
    //   C) Gemini Vision            → read PDF directly for quiz JSON (LLM)
    //
    // Priority: Gemini reads the PDF best, so its JSON is the primary result.
    // OCR text serves two purposes: (1) fallback content source if Gemini fails,
    // and (2) ALWAYS-ON ground truth for validateQuizAgainstOCR() below, so every
    // generation — not just failed ones — gets cross-checked before the teacher
    // sees a preview.
    // Images come from ML layout crops (primary) or OpenCV crops (fallback).
    // ══════════════════════════════════════════════════════════════════════

    const parallelTasks = [];

    // A) Tesseract OCR — ALWAYS run, not just as a failure fallback. This is the
    // ground truth validateQuizAgainstOCR() below checks Gemini's output against
    // (missing tasks/tiers) before the teacher ever sees a preview. Previously
    // this only ran when Gemini's primary call had already FAILED, so on the
    // normal/successful path (the common case, especially now with
    // temperature:0 making Gemini reliable) there was NO independent
    // cross-check at all before showing the preview — a real accuracy gap.
    parallelTasks.push(
      ocrFullPDF(req.file.buffer, 1.5)
        .then(r => ({ type: 'ocr', result: r }))
        .catch(err => { console.log('[quiz] OCR failed:', err.message); return { type: 'ocr', result: null }; })
    );

    // B) Python ML layout detection (primary) — DocLayout-YOLO for precise figure/table cropping
    parallelTasks.push(
      callLayoutService(req.file.buffer, quizId, { filename: req.file.originalname || 'worksheet.pdf', mime: 'application/pdf' })
        .then(r => ({ type: 'layout-ml', result: r }))
        .catch(err => { console.log('[quiz] ML layout failed:', err.message); return { type: 'layout-ml', result: null }; })
    );

    // High-DPI page images for Gemini. Sending the RAW PDF let Gemini rasterize
    // it internally at a low, uncontrolled resolution — which is why small
    // vertically-stacked digits (326 over 419) and dense CODE tables got misread
    // or dropped. Rendering each page ourselves at scale 3.0 (~216 DPI) gives
    // Gemini sharp text to read, dramatically improving digit/symbol accuracy.
    // Falls back to the raw PDF if rasterization fails, so we never regress.
    let geminiParts = [geminiPdfPart(req.file.buffer)];
    try {
      // scale 2.5 ≈ 180 DPI — sharp enough for 3-digit stacked arithmetic and
      // dense code tables, while keeping multi-page PNG payload within Gemini's
      // inline request limit and Cloud Run memory.
      const hiResPages = await pdfToPageImages(req.file.buffer, 2.5); // [{ pageNum, buffer }]
      if (Array.isArray(hiResPages) && hiResPages.length > 0) {
        geminiParts = geminiImageParts(hiResPages.map(p => ({ buffer: p.buffer || p, mime: 'image/png' })));
        console.log(`[quiz] Rendered ${hiResPages.length} page(s) at high DPI (scale 2.5) for Gemini`);
      }
    } catch (e) {
      console.log('[quiz] High-DPI page render failed, sending raw PDF to Gemini:', e.message);
    }

    // C) Gemini Vision — generate structured quiz JSON (LLM, primary)
    if (genAI && !skipGemini) {
      parallelTasks.push(
        withTimeout(callGeminiVision(geminiParts, { grade, subject, school }), GEMINI_VISION_TIMEOUT_MS, 'gemini-vision')
          .then(r => ({ type: 'gemini', result: r }))
          .catch(err => {
            const msg = String((err && err.message) || err);
            if (msg.startsWith('TIMEOUT:')) {
              console.log(`[quiz] Gemini TIMEOUT — no response after ${GEMINI_VISION_TIMEOUT_MS}ms, falling back to Qwen/Pixtral/Groq/OCR`);
            } else if (/network|fetch|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(msg)) {
              console.log('[quiz] Gemini local/network error:', msg);
            } else {
              console.log('[quiz] Gemini API error:', msg);
            }
            return { type: 'gemini', result: null };
          })
      );
    }

    console.log(`[quiz] Running ${parallelTasks.length} tasks in parallel: ML Layout${genAI && !skipGemini ? ' + Gemini' : ''}...`);
    __mark('before Promise.all(OCR + layout-ml + Gemini)');
    const parallelResults = await Promise.all(parallelTasks);
    __mark('after Promise.all(OCR + layout-ml + Gemini)');

    let ocrText = null;
    let layoutMLResult = null;
    for (const pr of parallelResults) {
      if (pr.type === 'gemini' && pr.result) result = pr.result;
      if (pr.type === 'layout-ml' && pr.result) layoutMLResult = pr.result;
      if (pr.type === 'ocr' && pr.result) ocrText = pr.result;
    }

    // Convert ML layout result to diagram format (or fall back to heuristic OpenCV)
    if (layoutMLResult) {
      diagramExtraction = await layoutResultToDiagramFormat(layoutMLResult);
      console.log(`[quiz] ML Layout: ${diagramExtraction?.diagrams?.length || 0} figures/tables detected`);
      __mark('after layoutResultToDiagramFormat');
    }
    if (!diagramExtraction) {
      console.log('[quiz] ML Layout unavailable, falling back to heuristic OpenCV...');
      try {
        // minArea lowered from the 15000px² default — small worksheet clipart (e.g. a
        // "match the picture to the word" row of individual small images, ~140x70px each)
        // was being filtered out entirely, causing those pictures to never get attached to
        // any question at all. 6000px² still excludes true noise (small icons/bullets) while
        // keeping legitimate small diagram crops.
        const opencvResult = await extractDiagrams(req.file.buffer, quizId, { scale: 1.5, doOCR: false, minArea: 6000 });
        diagramExtraction = opencvResult;
        console.log(`[quiz] OpenCV fallback: ${opencvResult.diagrams.length} diagrams`);
      } catch (err) {
        console.log('[quiz] OpenCV fallback also failed:', err.message);
      }
    }

    // Safety net: OCR now runs upfront in the parallel block above, always — but
    // if that specific call failed (network blip, timeout) while the vision fallback
    // chain below is about to run anyway, retry it once so validation still has
    // ground truth to check against.
    if (!ocrText) {
      try {
        console.log('[quiz] OCR missing — retrying once before validation...');
        ocrText = await ocrFullPDF(req.file.buffer, 1.5);
      } catch (err) {
        console.log('[quiz] OCR retry also failed:', err.message);
      }
    }

    console.log(`[quiz] Gemini: ${result ? result.length + ' chars' : 'N/A'} | OCR: ${ocrText ? ocrText.fullText.length + ' chars' : 'skipped/failed'} | Diagrams: ${diagramExtraction ? diagramExtraction.diagrams.length + ' crops' : 'none'}`);

    // ══════════════════════════════════════════════════════════════════════
    // FALLBACK CHAIN: Send page IMAGES (not OCR text) to vision LLMs.
    // Vision LLMs see the actual layout, tables, diagrams — far more accurate
    // than sending flat OCR text where structure is lost.
    //
    // Priority: Gemini Vision → Qwen 2.5-VL-72B → Pixtral Vision → Groq Vision → OCR text fallback
    // ══════════════════════════════════════════════════════════════════════
    if (!result) {
      // Collect page images from ML layout result or convert PDF ourselves
      let pageImageBuffers = [];
      if (layoutMLResult && layoutMLResult.pages) {
        for (const pg of layoutMLResult.pages) {
          if (pg.fullPageUrl) {
            const imgPath = path.join(__dirname, '..', pg.fullPageUrl);
            if (fs.existsSync(imgPath)) {
              pageImageBuffers.push({ buffer: fs.readFileSync(imgPath), mime: 'image/png' });
            }
          }
        }
      }
      // If ML layout didn't produce page images, convert PDF pages via Python service
      if (pageImageBuffers.length === 0) {
        try {
          const form = new FormData();
          form.set('file', new Blob([req.file.buffer], { type: 'application/pdf' }), 'worksheet.pdf');
          const pdfImgRes = await fetch(`${LAYOUT_SERVICE_URL}/pdf-to-images?quiz_id=${quizId}`, { method: 'POST', body: form });
          if (pdfImgRes.ok) {
            const { pages } = await pdfImgRes.json();
            for (const pg of pages) {
              const imgPath = path.join(__dirname, '..', pg.fullPageUrl);
              if (fs.existsSync(imgPath)) {
                pageImageBuffers.push({ buffer: fs.readFileSync(imgPath), mime: 'image/png' });
              }
            }
          }
        } catch (e) { console.log('[quiz] PDF-to-images failed:', e.message); }
      }

      const hasPageImages = pageImageBuffers.length > 0;
      console.log(`[quiz] Gemini unavailable — fallback with ${hasPageImages ? pageImageBuffers.length + ' page images (VISION)' : 'OCR text only'}...`);

      // FALLBACK 1: Qwen 2.5-VL-72B (HF router — strong vision, slow on free tier). Cap ≤8, downscale.
      if (!result && HF_TOKEN && hasPageImages) {
        try {
          const qwImgs = await prepVisionImages(pageImageBuffers, { max: 8, width: 1500 });
          console.log(`[quiz] Trying Qwen 2.5-VL-72B with ${qwImgs.length} page image(s)...`);
          result = await callQwenVision(qwImgs, { grade, subject, school });
          if (result) { usedEngine = 'qwen'; console.log(`[quiz] Qwen Vision returned ${result.length} chars`); }
        } catch (e) { console.log('[quiz] Qwen Vision failed:', e.message); }
      }

      // FALLBACK 2: Pixtral Vision (sees images → understands layout). Cap ≤8, downscale.
      if (!result && MISTRAL_API_KEY && hasPageImages) {
        try {
          const pxImgs = await prepVisionImages(pageImageBuffers, { max: 8, width: 1500 });
          console.log(`[quiz] Trying Pixtral Vision with ${pxImgs.length} page image(s)...`);
          result = await callPixtralVision(pxImgs, { grade, subject, school });
          if (result) { usedEngine = 'pixtral'; console.log(`[quiz] Pixtral Vision returned ${result.length} chars`); }
        } catch (e) { console.log('[quiz] Pixtral Vision failed:', e.message); }
      }

      // FALLBACK 3: Groq Vision (llama-4-scout). Hard request-size limit → fewer/smaller images.
      if (!result && groq && hasPageImages) {
        try {
          const gqImgs = await prepVisionImages(pageImageBuffers, { max: 4, width: 1100 });
          console.log(`[quiz] Trying Groq Vision (llama-4-scout) with ${gqImgs.length} page image(s)...`);
          const visionPrompt = buildQuizVisionPrompt({ grade, subject, school });
          result = await callGroq(visionPrompt, { vision: true, imageBuffers: gqImgs });
          if (result) { usedEngine = 'groq'; console.log(`[quiz] Groq Vision returned ${result.length} chars`); }
        } catch (e) { console.log('[quiz] Groq Vision failed:', e.message); }
      }

      // FALLBACK 4: OCR text + LLM (last resort — text only, may miss layout)
      if (!result && ocrText && ocrText.fullText.length >= 20) {
        console.log('[quiz] Vision fallbacks exhausted — using OCR text (layout may be incomplete)...');
        usedVision = false; // text-only LLM cannot reliably provide diagramPosition
        const text = ocrText.fullText.substring(0, 12000);
        const prompt = buildQuizVisionPrompt({ grade, subject, school })
          + `\n\nHere is the OCR-extracted text from the worksheet:\n---\n${text}\n---\nGenerate quiz JSON from this text. Mark questions that likely have a diagram in the worksheet with "hasImage": true.`;

        if (MISTRAL_API_KEY) {
          try { result = await callMistral([{ role: 'user', content: prompt }], 'mistral-large-latest', 16000); if (result) usedEngine = 'pixtral'; }
          catch (e) { console.log('[quiz] Mistral text failed:', e.message); }
        }
        if (!result && groq) {
          try { result = await callGroq(prompt); if (result) usedEngine = 'groq'; }
          catch (e) { console.log('[quiz] Groq text failed:', e.message); }
        }
      }

      // LAST RESORT: pdf-parse text (when OCR also failed)
      if (!result) {
        console.log('[quiz] Last resort: pdf-parse text...');
        usedVision = false;
        try {
          const parsed = await pdfParse(req.file.buffer);
          const text = (parsed.text || '').substring(0, 12000);
          if (text && text.trim().length >= 20) {
            const prompt = buildQuizVisionPrompt({ grade, subject, school })
              + `\n\nHere is the text from the worksheet:\n---\n${text}\n---\nGenerate quiz JSON from this text.`;
            if (MISTRAL_API_KEY) {
              try { result = await callMistral([{ role: 'user', content: prompt }], 'mistral-large-latest', 16000); if (result) usedEngine = 'pixtral'; }
              catch (e) { /* skip */ }
            }
            if (!result && groq) {
              try { result = await callGroq(prompt); if (result) usedEngine = 'groq'; }
              catch (e) { /* skip */ }
            }
          }
        } catch (e) { console.log('[quiz] pdf-parse failed:', e.message); }
      }
    }

    if (!result) {
      return res.status(500).json({ error: 'Could not generate quiz from worksheet' });
    }
    __mark('after fallback chain (result ready)');

    // Parse JSON response
    let quiz;
    try {
      quiz = JSON.parse(cleanLLMJson(result));
    } catch {
      return res.status(500).json({ error: 'AI returned invalid JSON', raw: result });
    }
    __mark('after JSON.parse(result)');

    // ── VALIDATION: Check LLM output against OCR ground truth ──
    const ocrFullText = ocrText ? ocrText.fullText : '';
    // layoutMLResult.allCrops is already computed by the /crop call in the
    // parallel step above (default types=figure,table) — reading its counts
    // here adds zero extra requests, zero extra latency, zero extra cost.
    const layoutCounts = layoutMLResult?.allCrops
      ? {
          figures: layoutMLResult.allCrops.filter(c => c.type === 'figure').length,
          tables: layoutMLResult.allCrops.filter(c => c.type === 'table').length,
        }
      : null;
    const validation = validateQuizAgainstOCR(quiz, ocrFullText, layoutCounts);
    if (!validation.valid) {
      console.log(`[quiz] VALIDATION FAILED: Missing ${validation.missingTasks.join(', ')} | Detected tiers: ${validation.detectedTiers.join(',')} | Tasks in OCR: ${validation.detectedTaskHeaders.join(',')}`);

      // Auto-retry with a targeted prompt that tells the LLM exactly what it missed
      const retryPrompt = buildQuizVisionPrompt({ grade, subject, school })
        + `\n\nHere is the OCR-extracted text from the worksheet:\n---\n${ocrFullText.substring(0, 12000)}\n---`
        + `\n\nCRITICAL: A previous attempt missed these sections: ${validation.missingTasks.join(', ')}.`
        + `\nThe worksheet contains these tiers: ${validation.detectedTiers.join(', ')}`
        + `\nThe worksheet contains these task headers: ${validation.detectedTaskHeaders.join(', ')}`
        + `\nYou MUST include ALL of them. Do NOT skip any section.`;

      let retryResult = null;
      // Retry: Gemini → Mistral → Groq
      // This call is TEXT-ONLY (OCR text in, JSON out) — no images — so it's
      // inherently much faster than the primary vision call when it succeeds.
      // Profiling across every observed run this session (MHLE-12, MHLE-22
      // best/worst case) showed this retry NEVER once completed within the
      // shared 75s vision timeout — it always timed out and fell through to
      // Mistral/Groq, which is what actually produced the result. That made
      // this step pure dead time: 50-67% of total generation time across all
      // three profiled runs, for zero benefit. A shorter, dedicated timeout
      // fails fast into the same existing fallback chain (no capability lost)
      // instead of always waiting the full 75s first.
      const GEMINI_RETRY_TIMEOUT_MS = parseInt(process.env.GEMINI_RETRY_TIMEOUT_MS || '25000', 10);
      if (genAI) {
        try {
          const m = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { temperature: 0 } });
          retryResult = await withTimeout(geminiGenerate(m, [{ text: retryPrompt }]), GEMINI_RETRY_TIMEOUT_MS, 'gemini-retry');
        }
        catch (e) {
          if (String(e && e.message).startsWith('TIMEOUT:')) console.log(`[quiz] Gemini retry TIMEOUT after ${GEMINI_RETRY_TIMEOUT_MS}ms — falling back to Mistral/Groq`);
        }
      }
      if (!retryResult && MISTRAL_API_KEY) {
        try { retryResult = await callMistral([{ role: 'user', content: retryPrompt }], 'mistral-large-latest', 16000); }
        catch (e) { /* skip */ }
      }
      if (!retryResult && groq) {
        try { retryResult = await callGroq(retryPrompt); }
        catch (e) { /* skip */ }
      }

      if (retryResult) {
        try {
          const retryQuiz = JSON.parse(cleanLLMJson(retryResult));
          if ((retryQuiz.tasks || []).length > (quiz.tasks || []).length) {
            console.log(`[quiz] Retry: ${retryQuiz.tasks.length} tasks (was ${quiz.tasks.length}) — using retry ✓`);
            quiz = retryQuiz;
            usedEngine += '+retry';
          } else {
            console.log(`[quiz] Retry: ${retryQuiz.tasks?.length} tasks (no improvement) — keeping original`);
          }
        } catch { /* retry parse failed */ }
      }
    } else {
      console.log(`[quiz] VALIDATION OK: ${(quiz.tasks||[]).length} tasks, tiers: ${validation.detectedTiers.join(',')}`);
    }
    __mark('after validateQuizAgainstOCR (+ retry chain if triggered)');

    // ── Strip unreliable diagramPosition when LLM was text-only (couldn't see the image) ──
    if (!usedVision) {
      console.log('[quiz] Text-only engine — stripping diagramPosition (unreliable without vision)');
      for (const t of (quiz.tasks || [])) {
        for (const q of (t.questions || [])) { delete q.diagramPosition; }
      }
    }

    // ── Match figure-cropped diagrams to questions ──
    if (diagramExtraction && diagramExtraction.diagrams.length > 0) {
      console.log(`[quiz] Matching ${diagramExtraction.diagrams.length} figure crops to questions...`);
      matchDiagramsToQuestions(diagramExtraction, quiz);
      quiz.fullPageImages = diagramExtraction.fullPageImages;
      await verifyDiagramAssignments(diagramExtraction, quiz);
      __mark('after matchDiagramsToQuestions + verifyDiagramAssignments');
    }

    // ── Extract sub-figures from table crops (diagrams embedded inside tables) ──
    if (diagramExtraction && diagramExtraction.tableCrops && diagramExtraction.tableCrops.length > 0) {
      console.log(`[quiz] Checking ${diagramExtraction.tableCrops.length} table crops for embedded diagrams...`);
      await extractSubfiguresFromTables(quiz, diagramExtraction.tableCrops, quizId);
      __mark('after extractSubfiguresFromTables');
    }

    // ── Fast path: If ML was unavailable, try PDF→images→subfigure extraction (no ML needed) ──
    if (!diagramExtraction || (diagramExtraction.diagrams.length === 0 && (!diagramExtraction.tableCrops || diagramExtraction.tableCrops.length === 0))) {
      console.log('[quiz] No ML crops available — trying fast OpenCV subfigure extraction...');
      const fastResult = await extractDiagramsWithoutML(req.file.buffer, quizId, { filename: req.file.originalname });
      if (fastResult && fastResult.subfigures.length > 0) {
        quiz.fullPageImages = fastResult.fullPageImages;
        // Assign subfigures to tasks with hasDiagram column groups
        for (const task of (quiz.tasks || [])) {
          const layout = task.layout || {};
          const colGroups = layout.columnGroups || [];
          if (layout.type !== 'two-column' || colGroups.length < 2) continue;
          const hasDiagramGroups = colGroups.filter(g => g.hasDiagram);
          if (hasDiagramGroups.length === 0) continue;
          const allQs = task.questions || [];
          if (allQs.some(q => q.imageUrl)) continue;

          const pg = task.sourcePage || 1;
          const pageSubfigs = fastResult.subfigures.find(s => s.pageNum === pg);
          if (!pageSubfigs || pageSubfigs.subfigures.length === 0) continue;

          const questionsById = {};
          for (const q of allQs) questionsById[q.id] = q;

          let sfIdx = 0;
          for (const group of colGroups) {
            if (!group.hasDiagram || sfIdx >= pageSubfigs.subfigures.length) continue;
            const firstQId = (group.questionIds || [])[0];
            const firstQ = firstQId ? questionsById[firstQId] : null;
            if (firstQ && !firstQ.imageUrl) {
              firstQ.imageUrl = pageSubfigs.subfigures[sfIdx].imageUrl;
              firstQ.diagramDescription = 'Reference diagram from worksheet';
              console.log(`[quiz] Fast path: assigned subfigure → ${task.title} Q(${firstQ.id})`);
              sfIdx++;
            }
          }
        }
      }
    }

    // ── Diagram-fill: detect blanks on any diagram (pyramid/clock/number-line/etc.)
    //    and pair them with Gemini's answers so students can write directly on it ──
    await resolveDiagramFills(quiz, quizId);
    __mark('after resolveDiagramFills');

    // ── Bar-chart recovery: if a bar-graph task lost its structured chart data (LLM
    //    nondeterminism), re-read the graph image and rebuild it so the generated chart
    //    is shown every time instead of a raw scanned screenshot. ──
    await recoverBarCharts(quiz, layoutMLResult);
    __mark('after recoverBarCharts');

    // ── Missing-digit vertical arithmetic: solve blanks deterministically from
    //    the top/bottom/result strings the main pass already extracted — pure
    //    JS arithmetic, zero additional Gemini calls. Attaches per-blank correct
    //    digits + step-by-step working so the renderer/grader below don't have
    //    to fall back to generic single-text-box comparison for this type. ──
    for (const task of (quiz.tasks || [])) {
      for (const q of (task.questions || [])) {
        if (q.verticalMath) {
          const solved = solveVerticalMath(q.verticalMath);
          if (solved.solvable) Object.assign(q.verticalMath, solved);
          else if (solved.impossible) {
            // No digit assignment reproduces the extracted equation at all (the
            // OCR/extraction of this puzzle is simply wrong) — never show a
            // guessed/hallucinated answer for it. Drop the question outright.
            console.warn(`[quiz] dropping impossible vertical-math question (task "${task.title}", id ${q.id}): "${q.verticalMath.top} ${q.verticalMath.operator} ${q.verticalMath.bottom} = ${q.verticalMath.result}" has no valid solution`);
            q.__drop = true;
            continue;
          }
          const opCheck = checkVerticalMathOperator(q, task);
          if (opCheck) {
            console.log(`[quiz] vertical-math operator corrected (${opCheck.via}): "${q.verticalMath.top} ${q.verticalMath.operator} ${q.verticalMath.bottom}" → operator should be "${opCheck.correctOperator}"`);
            q.verticalMath.operator = opCheck.correctOperator;
            if (opCheck.correctAnswer !== undefined) q.answer = opCheck.correctAnswer;
            else if (q.verticalMath.result) q.verticalMath.result = String(opCheck.correctResult);
          }
        } else {
          // Plain "326 + 419"-style sub-question feeding a decode/cipher table:
          // recompute the arithmetic ourselves and cross-check against the SAME
          // table Gemini extracted, so a stale/mistaken lookup never ships as-is.
          const decodeCheck = checkDecodeAnswer(q, task);
          if (decodeCheck) {
            console.log(`[quiz] decode-table answer corrected: "${q.question}" → ${decodeCheck.result} maps to "${decodeCheck.correctAnswer}" (was "${q.answer}")`);
            q.answer = decodeCheck.correctAnswer;
          }
        }
      }
      if (task.questions && task.questions.some(q => q.__drop)) {
        task.questions = task.questions.filter(q => !q.__drop);
      }
    }

    // ── Post-process: auto-detect MCQ questions the LLM missed ──
    autoDetectMCQ(quiz);

    // ── Embed all images as base64 data URIs (so quiz works on Cloud Run / any server) ──
    embedQuizImages(quiz);
    __mark('after embedQuizImages (done)');

    // Add metadata
    quiz.engine = usedEngine;
    quiz.sourceFile = req.file.originalname;
    quiz.generatedAt = new Date().toISOString();
    quiz.status = 'draft';

    // ── AI answer verification: re-derive every answer from the original PDF
    //    and auto-correct any that don't match (general safety net beyond the
    //    two deterministic checks above). ──
    const answerVerification = await verifyQuizAnswers(req.file.buffer, 'application/pdf', quiz);
    console.log(`[quiz] Answer verification: ${answerVerification.checked} checked, ${answerVerification.corrected} corrected${answerVerification.error ? ` (error: ${answerVerification.error})` : ''}`);
    __mark('after verifyQuizAnswers');

    // Auto-validate quality
    const qualityCheck = validateQuiz(quiz);
    console.log(`[quiz] Quality: ${qualityCheck.grade} (${qualityCheck.score}/100) — ${qualityCheck.totalQuestions} questions, ${qualityCheck.issues.length} issues`);
    if (qualityCheck.issues.length) console.log(`[quiz] Issues:`, qualityCheck.issues.join('; '));

    res.json({ quiz, validation: qualityCheck, answerVerification });
  } catch (err) {
    console.error('Quiz generate error:', err);
    res.status(500).json({ error: err.message });
  }
}
router.post('/generate', upload.single('pdf'), generateQuizHandler);

// ── POST /quiz/generate-async — same as /generate, but QUEUED (via the
// swappable db/Kafka job queue) instead of blocking the request. Returns
// { jobId } immediately; poll GET /jobs/:id for status + result. Body is JSON
// (not multipart) since the file has to round-trip through the job payload:
// { fileBase64, mimeType?, filename?, grade?, subject?, school?, engine? }
router.post('/generate-async', express.json({ limit: '10mb' }), async (req, res) => {
  const { fileBase64, mimeType, filename, grade, subject, school, engine } = req.body || {};
  if (!fileBase64) return res.status(400).json({ error: 'fileBase64 required' });
  try {
    const { publishJob } = require('../services/jobQueue');
    const { jobId } = await publishJob('quiz_generate', {
      fileBase64, mimeType: mimeType || 'application/pdf', filename: filename || 'worksheet.pdf',
      grade, subject, school, engine,
    });
    res.json({ jobId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /quiz/generate-image — Worksheet image → quiz (Claude Vision primary, Mistral fallback) ──
router.post('/generate-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });

    const { grade, subject, school } = req.body;
    const mime = req.file.mimetype || 'image/png';
    const quizId = uuidv4().slice(0, 8);
    let usedEngine = 'gemini';
    let usedVision = true;

    // Save uploaded worksheet image for display in quiz
    const wsImgName = `${quizId}_worksheet.jpg`;
    const wsImgPath = path.join(QUIZ_IMG_DIR, wsImgName);
    fs.writeFileSync(wsImgPath, req.file.buffer);
    const worksheetImageUrl = `/data/images/quiz/${wsImgName}`;

    // ── STEP 1: Run Tesseract OCR + ML Layout detection in parallel (NO LLM) ──
    const parallelTasks = [];

    // A) Tesseract OCR — extract text from image (no LLM)
    parallelTasks.push(
      (async () => {
        try {
          console.log('[quiz] Running Tesseract OCR on image...');
          const ocr = await ocrRegion(req.file.buffer);
          console.log(`[quiz] Tesseract: ${ocr.text.length} chars, confidence ${ocr.confidence}%`);
          return { type: 'tesseract', result: ocr };
        } catch (err) {
          console.log('[quiz] Tesseract failed:', err.message);
          return { type: 'tesseract', result: null };
        }
      })()
    );

    // B) Python ML layout detection (primary) — DocLayout-YOLO for figure/table cropping
    parallelTasks.push(
      callLayoutService(req.file.buffer, quizId, { filename: req.file.originalname || 'worksheet.jpg', mime })
        .then(r => ({ type: 'layout-ml', result: r }))
        .catch(err => { console.log('[quiz] ML layout failed:', err.message); return { type: 'layout-ml', result: null }; })
    );

    const parallelResults = await Promise.all(parallelTasks);

    let ocrText = null;
    let diagramExtraction = null;
    let layoutMLResult = null;
    for (const pr of parallelResults) {
      if (pr.type === 'tesseract' && pr.result) ocrText = pr.result;
      if (pr.type === 'layout-ml' && pr.result) layoutMLResult = pr.result;
    }

    // Convert ML layout result to diagram format (or fall back to heuristic OpenCV)
    if (layoutMLResult) {
      diagramExtraction = await layoutResultToDiagramFormat(layoutMLResult);
      console.log(`[quiz] ML Layout: ${diagramExtraction?.diagrams?.length || 0} figures/tables detected`);
    }
    if (!diagramExtraction) {
      console.log('[quiz] ML Layout unavailable, falling back to heuristic OpenCV...');
      try {
        const opencvResult = await extractDiagramsFromImage(req.file.buffer, quizId, { doOCR: false });
        diagramExtraction = opencvResult;
        console.log(`[quiz] OpenCV fallback: ${opencvResult.diagrams.length} diagrams`);
      } catch (err) {
        console.log('[quiz] OpenCV fallback also failed:', err.message);
      }
    }

    // ── STEP 2: Use LLM text-only to structure OCR text into quiz JSON (cheaper, higher quota) ──
    let result = null;

    // Build context about extracted diagrams so LLM knows which questions have images
    let diagramContext = '';
    if (diagramExtraction && diagramExtraction.diagrams.length > 0) {
      diagramContext = `\n\nNOTE: ${diagramExtraction.diagrams.length} diagram(s) were detected in the worksheet image. ` +
        `The diagrams are at these vertical positions (top to bottom): ` +
        diagramExtraction.diagrams.map((d, i) => `Diagram ${i + 1} at y=${d.bbox.y} (${d.bbox.w}x${d.bbox.h}px)`).join(', ') +
        `. Set "hasImage": true for questions that appear near these diagram positions.`;
    }

    const ocrContent = ocrText ? ocrText.text : '';
    if (ocrContent.length >= 20) {
      const prompt = buildQuizVisionPrompt({ grade, subject, school })
        + `\n\nHere is the OCR-extracted text from the worksheet:\n---\n${ocrContent.substring(0, 12000)}\n---`
        + diagramContext
        + `\nGenerate quiz JSON from this text. Replicate the worksheet layout exactly.`;

      // PRIMARY: Gemini text-only (no vision — much cheaper, higher quota)
      if (genAI) {
        try {
          console.log('[quiz] Using Gemini text-only for OCR text structuring...');
          usedVision = false; // text-only cannot reliably provide diagramPosition
          const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { responseMimeType: 'application/json', temperature: 0 }
          });
          result = await geminiGenerate(model, [{ text: prompt }]);
          console.log(`[quiz] Gemini text returned ${result.length} chars`);
        } catch (err) {
          console.log('[quiz] Gemini text failed:', err.message);
        }
      }

      // FALLBACK: Gemini Vision (if text-only failed, try with image)
      if (!result && genAI) {
        usedVision = true; // vision engine can provide accurate diagramPosition
        try {
          console.log('[quiz] Falling back to Gemini Vision...');
          const parts = geminiImageParts([{ buffer: req.file.buffer, mime }]);
          result = await callGeminiVision(parts, { grade, subject, school });
          console.log(`[quiz] Gemini Vision returned ${result.length} chars`);
        } catch (err) {
          console.log('[quiz] Gemini Vision failed:', err.message);
        }
      }

      // FALLBACK: Qwen 2.5-VL-72B Vision
      if (!result && HF_TOKEN) {
        try {
          console.log('[quiz] Falling back to Qwen 2.5-VL-72B...');
          usedVision = true;
          result = await callQwenVision([{ buffer: req.file.buffer, mime }], { grade, subject, school });
          if (result) usedEngine = 'qwen';
          console.log(`[quiz] Qwen returned ${result.length} chars`);
        } catch (err) {
          console.log('[quiz] Qwen failed:', err.message);
        }
      }

      // FALLBACK: Pixtral Vision
      if (!result && MISTRAL_API_KEY) {
        try {
          console.log('[quiz] Falling back to Pixtral Vision...');
          result = await callPixtralVision([{ buffer: req.file.buffer, mime }], { grade, subject, school });
          if (result) usedEngine = 'pixtral';
          console.log(`[quiz] Pixtral returned ${result.length} chars`);
        } catch (err) {
          console.log('[quiz] Pixtral failed:', err.message);
        }
      }

      // FALLBACK: Groq text-only (llama-3.3-70b — generous free tier)
      if (!result && groq) {
        try {
          console.log('[quiz] Falling back to Groq (llama-3.3-70b)...');
          usedVision = false; // text-only
          result = await callGroq(prompt);
          if (result) usedEngine = 'groq';
          console.log(`[quiz] Groq text returned ${result.length} chars`);
        } catch (err) {
          console.log('[quiz] Groq text failed:', err.message);
        }
      }
    } else {
      // OCR failed or too little text — must use vision
      console.log('[quiz] OCR text too short, using Vision API...');
      if (genAI) {
        try {
          const parts = geminiImageParts([{ buffer: req.file.buffer, mime }]);
          result = await callGeminiVision(parts, { grade, subject, school });
          console.log(`[quiz] Gemini Vision returned ${result.length} chars`);
        } catch (err) {
          console.log('[quiz] Gemini Vision failed:', err.message);
        }
      }
      if (!result && HF_TOKEN) {
        try {
          console.log('[quiz] Falling back to Qwen 2.5-VL-72B...');
          result = await callQwenVision([{ buffer: req.file.buffer, mime }], { grade, subject, school });
          if (result) usedEngine = 'qwen';
        } catch (err) {
          console.log('[quiz] Qwen failed:', err.message);
        }
      }
      if (!result && MISTRAL_API_KEY) {
        try {
          result = await callPixtralVision([{ buffer: req.file.buffer, mime }], { grade, subject, school });
          if (result) usedEngine = 'pixtral';
        } catch (err) {
          console.log('[quiz] Pixtral failed:', err.message);
        }
      }
      // Groq Vision fallback (llama-4-scout can read images)
      if (!result && groq) {
        try {
          console.log('[quiz] Falling back to Groq Vision (llama-4-scout)...');
          const visionPrompt = buildQuizVisionPrompt({ grade, subject, school });
          result = await callGroq(visionPrompt, { vision: true, imageBuffers: [{ buffer: req.file.buffer, mime }] });
          if (result) usedEngine = 'groq';
          console.log(`[quiz] Groq Vision returned ${result.length} chars`);
        } catch (err) {
          console.log('[quiz] Groq Vision failed:', err.message);
        }
      }
    }

    if (!result) return res.status(500).json({ error: 'Could not generate quiz. OCR text: ' + (ocrContent.length) + ' chars' });

    let quiz;
    try {
      quiz = JSON.parse(cleanLLMJson(result));
    } catch {
      return res.status(500).json({ error: 'AI returned invalid JSON', raw: result });
    }

    // ── Strip unreliable diagramPosition when LLM was text-only ──
    if (!usedVision) {
      console.log('[quiz] Text-only engine — stripping diagramPosition (unreliable without vision)');
      for (const t of (quiz.tasks || [])) {
        for (const q of (t.questions || [])) { delete q.diagramPosition; }
      }
    }

    // ── Match OpenCV-cropped diagrams to questions ──
    if (diagramExtraction && diagramExtraction.diagrams.length > 0) {
      console.log(`[quiz] Matching ${diagramExtraction.diagrams.length} OpenCV diagram crops to questions...`);
      matchDiagramsToQuestions(diagramExtraction, quiz);
      quiz.fullPageImages = diagramExtraction.fullPageImages;
      await verifyDiagramAssignments(diagramExtraction, quiz);
    }

    // ── Diagram-fill: detect blanks on any diagram and pair with Gemini's answers ──
    await resolveDiagramFills(quiz, quizId);

    // ── Bar-chart recovery: rebuild any bar-graph task that lost its structured chart
    //    data so the generated chart shows instead of a raw scanned screenshot. ──
    await recoverBarCharts(quiz, layoutMLResult);

    // ── Missing-digit vertical arithmetic + decode-table answer cross-check
    //    (same deterministic verification as the PDF path) ──
    for (const task of (quiz.tasks || [])) {
      for (const q of (task.questions || [])) {
        if (q.verticalMath) {
          const solved = solveVerticalMath(q.verticalMath);
          if (solved.solvable) Object.assign(q.verticalMath, solved);
          else if (solved.impossible) {
            console.warn(`[quiz] dropping impossible vertical-math question (task "${task.title}", id ${q.id}): "${q.verticalMath.top} ${q.verticalMath.operator} ${q.verticalMath.bottom} = ${q.verticalMath.result}" has no valid solution`);
            q.__drop = true;
            continue;
          }
          const opCheck = checkVerticalMathOperator(q, task);
          if (opCheck) {
            q.verticalMath.operator = opCheck.correctOperator;
            if (opCheck.correctAnswer !== undefined) q.answer = opCheck.correctAnswer;
            else if (q.verticalMath.result) q.verticalMath.result = String(opCheck.correctResult);
          }
        } else {
          const decodeCheck = checkDecodeAnswer(q, task);
          if (decodeCheck) q.answer = decodeCheck.correctAnswer;
        }
      }
      if (task.questions && task.questions.some(q => q.__drop)) {
        task.questions = task.questions.filter(q => !q.__drop);
      }
    }

    // ── Post-process: auto-detect MCQ questions the LLM missed ──
    autoDetectMCQ(quiz);

    // Attach full worksheet image as fallback for tasks without OpenCV crops
    quiz.worksheetImageUrl = worksheetImageUrl;
    for (const task of (quiz.tasks || [])) {
      if (!task.pageImageUrl) task.pageImageUrl = worksheetImageUrl;
    }

    // ── Embed all images as base64 data URIs (so quiz works on Cloud Run / any server) ──
    embedQuizImages(quiz);

    quiz.engine = usedEngine;
    quiz.sourceFile = req.file.originalname;
    quiz.generatedAt = new Date().toISOString();
    quiz.status = 'draft';

    // ── AI answer verification: re-derive every answer from the original image
    //    and auto-correct any that don't match. ──
    const answerVerification = await verifyQuizAnswers(req.file.buffer, mime, quiz);
    console.log(`[quiz] Answer verification: ${answerVerification.checked} checked, ${answerVerification.corrected} corrected${answerVerification.error ? ` (error: ${answerVerification.error})` : ''}`);

    const validation = validateQuiz(quiz);
    console.log(`[quiz] Quality: ${validation.grade} (${validation.score}/100) — ${validation.totalQuestions} questions, ${validation.issues.length} issues`);
    if (validation.issues.length) console.log(`[quiz] Issues:`, validation.issues.join('; '));

    res.json({ quiz, validation, answerVerification });
  } catch (err) {
    console.error('Quiz generate-image error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /quiz/save — Save teacher-approved quiz to Qdrant vector DB ────────
router.post('/save', async (req, res) => {
  try {
    await ensureQuizCollection();
    const { quiz, schoolId, teacherId } = req.body;
    if (!quiz) return res.status(400).json({ error: 'quiz object required' });

    let school = schoolId || '';
    let curriculum = quiz.curriculum || '';
    let teacherName = '';
    if (teacherId) {
      const { data: teacherUser } = await supabase
        .from('users')
        .select('name, school, curriculum')
        .eq('id', teacherId)
        .maybeSingle();
      if (teacherUser) {
        school = school || teacherUser.school || '';
        curriculum = curriculum || teacherUser.curriculum || '';
        teacherName = teacherUser.name || '';
      }
    }

    const id = uuidv4();
    // Create embedding from quiz title + questions for semantic search
    const searchText = [
      quiz.title || '',
      quiz.subject || '',
      quiz.grade || '',
      ...(quiz.tasks || []).flatMap(t =>
        (t.questions || []).map(q => q.question || '')
      ),
    ].join(' ').substring(0, 1000);

    const vector = await embed(searchText);

    await client.upsert(QUIZ_COLLECTION, {
      points: [{
        id,
        vector,
        payload: {
          title: quiz.title || '',
          subject: quiz.subject || 'Mathematics',
          grade: quiz.grade || 'PYP 4',
          curriculum,
          school_id: school,
          school,
          teacher_id: teacherId || '',
          teacher_name: teacherName,
          source_file: quiz.sourceFile || '',
          status: 'published',
          created_at: new Date().toISOString(),
          quiz_data: quiz,
        },
      }],
      wait: true,
    });

    res.json({ id, message: 'Quiz saved to vector DB successfully' });
  } catch (err) {
    console.error('Quiz save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /quiz/list — List quizzes from Qdrant, scoped to the requesting ─────
// teacher's own school + curriculum. School/curriculum are resolved server-side
// from the teacher's own user record (never trusted from the client), so a
// teacher can never see another school's worksheets by omitting a query param.
router.get('/list', async (req, res) => {
  try {
    await ensureQuizCollection();
    const { teacherId: teacherIdOrEmail, grade, subject, search } = req.query;

    if (!teacherIdOrEmail) return res.json({ quizzes: [] });

    // The frontend has no reliable Supabase user UUID on hand (the auth User type
    // only carries email/name/role/etc.) — it sends the teacher's email instead.
    // Accept either shape, same pattern already used by resolveUserId() elsewhere
    // in this codebase.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(teacherIdOrEmail);
    const { data: teacherUser } = await supabase
      .from('users')
      .select('school, curriculum')
      .eq(isUuid ? 'id' : 'email', isUuid ? teacherIdOrEmail : teacherIdOrEmail.toLowerCase())
      .maybeSingle();
    const schoolId = teacherUser?.school || '';
    const curriculum = teacherUser?.curriculum || '';

    // No school on file for this teacher — nothing to safely show.
    if (!schoolId) return res.json({ quizzes: [] });

    const must = [
      { key: 'status', match: { value: 'published' } },
      { key: 'school_id', match: { value: schoolId } },
    ];
    if (curriculum) must.push({ key: 'curriculum', match: { value: curriculum } });
    if (grade)      must.push({ key: 'grade', match: { value: grade } });
    if (subject)    must.push({ key: 'subject', match: { value: subject } });

    // If search query provided, do semantic search
    if (search) {
      const vector = await embed(search);
      const results = await client.search(QUIZ_COLLECTION, {
        vector,
        limit: 20,
        filter: { must },
        with_payload: true,
      });

      const quizzes = results.map(r => ({
        id: r.id,
        title: r.payload.title,
        subject: r.payload.subject,
        grade: r.payload.grade,
        curriculum: r.payload.curriculum,
        school_id: r.payload.school_id,
        teacher_name: r.payload.teacher_name,
        source_file: r.payload.source_file,
        status: r.payload.status,
        created_at: r.payload.created_at,
        score: r.score,
      }));
      return res.json({ quizzes });
    }

    // Otherwise, scroll/filter
    const results = await client.scroll(QUIZ_COLLECTION, {
      filter: { must },
      limit: 50,
      with_payload: true,
    });

    const quizzes = (results.points || []).map(p => ({
      id: p.id,
      title: p.payload.title,
      subject: p.payload.subject,
      grade: p.payload.grade,
      curriculum: p.payload.curriculum,
      school_id: p.payload.school_id,
      teacher_name: p.payload.teacher_name,
      source_file: p.payload.source_file,
      status: p.payload.status,
      created_at: p.payload.created_at,
    }));
    res.json({ quizzes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /quiz/extract-diagrams — Upload form ───────────────────────────────────
router.get('/extract-diagrams', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Diagram Extractor — Aivorah</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;background:#0F0F0F;color:#F0EEEC;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{background:#1C1C1C;border:1px solid rgba(195,220,216,0.12);border-radius:16px;padding:40px;max-width:500px;width:100%}
h1{color:#C3DCD8;font-size:22px;margin-bottom:6px}p{color:#5A6B69;font-size:13px;margin-bottom:24px}
label{display:block;color:#A8B5B3;font-size:13px;font-weight:600;margin-bottom:6px}
input[type=file]{width:100%;padding:14px;background:#252525;border:2px dashed rgba(195,220,216,0.25);border-radius:10px;color:#F0EEEC;font-size:14px;margin-bottom:16px;cursor:pointer}
input[type=file]:hover{border-color:#93B0AC}
.row{display:flex;gap:12px;margin-bottom:16px}.row label{flex:1}
input[type=checkbox]{margin-right:6px;accent-color:#93B0AC}
select,input[type=number]{width:100%;padding:8px 10px;background:#252525;border:1px solid rgba(195,220,216,0.2);border-radius:6px;color:#F0EEEC;font-size:13px}
button{width:100%;padding:14px;background:linear-gradient(135deg,#93B0AC,#7AADA8);color:#0F0F0F;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;transition:all 0.2s}
button:hover{transform:translateY(-1px);box-shadow:0 4px 20px rgba(147,176,172,0.3)}
.note{margin-top:16px;font-size:11px;color:#5A6B69;text-align:center}
</style></head><body>
<div class="card">
  <h1>Diagram Extractor</h1>
  <p>Upload a worksheet PDF to auto-detect and crop diagram regions. No LLM needed — pure OpenCV + OCR.</p>
  <form method="POST" enctype="multipart/form-data" action="/quiz/extract-diagrams?format=html">
    <label>Worksheet PDF</label>
    <input type="file" name="pdf" accept=".pdf" required>
    <div class="row">
      <label><input type="checkbox" name="ocr" value="true"> Enable OCR (extract text from crops)</label>
    </div>
    <div class="row">
      <label>Min Area (px²)<input type="number" name="minArea" value="15000" min="1000" step="1000"></label>
      <label>Render Scale<select name="scale"><option value="1.5" selected>1.5x (fast)</option><option value="2.0">2.0x (HD)</option><option value="1.0">1.0x (draft)</option></select></label>
    </div>
    <button type="submit">Extract Diagrams</button>
  </form>
  <div class="note">Pipeline: PDF → pdfjs render → threshold → contour detection → crop → Tesseract OCR</div>
</div></body></html>`);
});

// ── POST /quiz/extract-diagrams — OpenCV diagram extraction only (no LLM) ──────
router.post('/extract-diagrams', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });
    const quizId = uuidv4().slice(0, 8);
    const doOCR = req.body.ocr === 'true';

    console.log(`[quiz] OpenCV diagram extraction (quizId: ${quizId}, OCR: ${doOCR})`);
    const result = await extractDiagrams(req.file.buffer, quizId, {
      scale: parseFloat(req.body.scale) || 1.5,
      doOCR,
      minArea: parseInt(req.body.minArea) || 15000,
    });

    // Return HTML preview of all extracted regions
    if (req.query.format === 'html') {
      const html = renderExtractionPreview(result, req.file.originalname);
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    }

    res.json(result);
  } catch (err) {
    console.error('Diagram extraction error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── HTML preview for extracted diagram regions ───────────────────────────────
function renderExtractionPreview(extraction, filename) {
  let pagesHTML = '';
  for (const page of extraction.pages) {
    pagesHTML += `
    <div style="margin:30px 0;padding:20px;background:#1C1C1C;border-radius:12px;border:1px solid rgba(195,220,216,0.12)">
      <h2 style="color:#C3DCD8;margin:0 0 16px">Page ${page.pageNum}</h2>
      <div style="display:flex;gap:20px;flex-wrap:wrap">
        <div style="flex:1;min-width:300px">
          <h3 style="color:#93B0AC;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px">Full Page</h3>
          <img src="${page.imageUrl}" alt="Page ${page.pageNum}" style="max-width:100%;border-radius:8px;border:1px solid #333">
        </div>
        <div style="flex:1;min-width:300px">
          <h3 style="color:#93B0AC;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px">${page.regions.length} Diagram Regions Detected</h3>
          ${page.regions.map((r, i) => `
            <div style="margin:12px 0;padding:12px;background:#252525;border-radius:8px;border:1px solid rgba(147,176,172,0.2)">
              <div style="font-size:12px;color:#5A6B69;margin-bottom:6px">Crop ${i + 1} &mdash; ${r.bbox.w}&times;${r.bbox.h}px at (${r.bbox.x}, ${r.bbox.y})${r.type ? ' &mdash; ' + r.type : ''}</div>
              <img src="${r.imageUrl}" alt="Crop ${i + 1}" style="max-width:100%;border-radius:6px;border:1px solid #444">
              ${r.ocrText ? `<div style="margin-top:8px;padding:8px;background:#1a1a1a;border-radius:4px;font-size:12px;color:#A8B5B3;font-family:monospace;white-space:pre-wrap">${r.ocrText}</div>` : ''}
            </div>
          `).join('')}
          ${page.regions.length === 0 ? '<div style="color:#5A6B69;font-size:13px">No diagram regions detected on this page</div>' : ''}
        </div>
      </div>
    </div>`;
  }

  return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenCV Diagram Extraction — ${filename}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;background:#0F0F0F;color:#F0EEEC;padding:24px}</style>
</head><body>
  <h1 style="color:#C3DCD8;margin-bottom:8px">OpenCV Diagram Extraction</h1>
  <p style="color:#5A6B69;margin-bottom:24px">File: ${filename} &mdash; ${extraction.diagrams.length} total diagram regions detected across ${extraction.pages.length} pages (no LLM used)</p>
  ${pagesHTML}
</body></html>`;
}

// ── POST /quiz/validate — Validate a quiz JSON and return quality score ──
router.post('/validate', express.json({ limit: '5mb' }), (req, res) => {
  try {
    const quiz = req.body.quiz || req.body;
    if (!quiz) return res.status(400).json({ error: 'No quiz data' });
    const validation = validateQuiz(quiz);
    res.json(validation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /quiz/grade-answer — Tier 2 semantic grading (only called when the
// free client-side keyword check already marked an answer wrong) ───────────
// Short-answer questions have many valid phrasings ("Plants need sunlight to
// make food" vs "Sunlight helps plants produce food") that a keyword-overlap
// check can miss when the paraphrase shares no root words. This is the
// fallback: a small, fast Groq text call (no vision, no Gemini) that judges
// MEANING, not wording. Kept cheap/fast on purpose — it's Tier 2, only
// invoked for the minority of answers that already failed the free Tier 1
// check, so most correct answers never reach this endpoint at all.
router.post('/grade-answer', express.json({ limit: '20kb' }), async (req, res) => {
  try {
    const { expected, student, question } = req.body || {};
    if (!expected || !student) return res.status(400).json({ error: 'expected and student required' });
    if (!groq) return res.json({ verdict: 'incorrect', reason: 'Semantic grading unavailable.' });

    const prompt = `You are grading a primary-school student's short-answer response.
Question: ${question || '(not provided)'}
Expected concept: ${expected}
Student's answer: ${student}

Judge whether the student's answer means the SAME THING as the expected concept, even if the
wording, sentence structure, or synonyms differ completely. Accept valid paraphrases. Reject
answers that state a genuinely different or incorrect concept, even if some words overlap.
Be strict about the CONCEPT being right — do not accept a wrong idea just because it's phrased
confidently or shares a topic word with the expected answer.

The expected concept may have MULTIPLE parts (e.g. "Plants need sunlight, water, and carbon
dioxide to make food" has three parts). If the student correctly names SOME but not ALL of the
required parts, and nothing they said is wrong, that is "partial" — not "correct" and not
"incorrect". Only use "correct" when every required part is present (in any wording). Use
"incorrect" when the answer is off-topic or states a wrong concept, even if partially detailed.

Reply with ONLY this JSON, no markdown:
{"verdict": "correct" or "partial" or "incorrect", "reason": "one short sentence, written directly to the student, explaining why (for partial, name what's missing)"}`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 150,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(completion.choices[0].message.content);
    const verdict = ['correct', 'partial', 'incorrect'].includes(parsed.verdict) ? parsed.verdict : 'incorrect';
    res.json({ verdict, reason: parsed.reason || '' });
  } catch (err) {
    console.error('[quiz/grade-answer]', err.message);
    // Fail closed to "incorrect" but don't crash the quiz UI — the student
    // still sees their Tier-1 result, just without the semantic override.
    res.json({ verdict: 'incorrect', reason: '' });
  }
});

// ── POST /quiz/batch-test — Upload multiple PDFs, generate + validate + compare, return summary ──
// Accepts up to 25 PDFs. For each: generates quiz, validates structure, then uses Gemini Vision
// to compare the original PDF against the generated quiz (questions, images, layout, answers).
// Query: ?compare=true (default true) to enable PDF-vs-quiz comparison via Gemini
// Query: ?save=true to save each quiz JSON to disk for debugging
router.post('/batch-test', upload.array('pdfs', 25), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No PDF files' });
  const { grade, subject, school } = req.body;
  const doCompare = req.query.compare !== 'false'; // default true
  const doSave = req.query.save === 'true';
  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < req.files.length; i++) {
    const file = req.files[i];
    const fileStart = Date.now();
    console.log(`[batch-test] (${i + 1}/${req.files.length}) Processing: ${file.originalname}`);

    try {
      // Step 1: Generate quiz from PDF
      const parts = [{ inlineData: { data: file.buffer.toString('base64'), mimeType: 'application/pdf' } }];
      const rawResult = await callGeminiVision(parts, { grade, subject, school });
      let quiz;
      try {
        quiz = typeof rawResult === 'string' ? JSON.parse(rawResult.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')) : rawResult;
      } catch (parseErr) {
        results.push({ file: file.originalname, status: 'error', error: `JSON parse failed: ${parseErr.message}`, timeMs: Date.now() - fileStart });
        continue;
      }

      // Step 2: Structural validation (fast, local)
      const validation = validateQuiz(quiz);

      // Step 3: Save quiz JSON if requested
      if (doSave) {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/\.pdf$/i, '');
        const savePath = path.join(__dirname, '..', 'data', `test-quiz-${safeName}.json`);
        fs.writeFileSync(savePath, JSON.stringify(quiz, null, 2));
      }

      // Step 4: PDF-vs-Quiz comparison via Gemini Vision (if enabled)
      let comparison = null;
      if (doCompare) {
        try {
          comparison = await compareQuizWithPDF(file.buffer, quiz);
        } catch (compErr) {
          comparison = { error: compErr.message };
        }
      }

      const entry = {
        file: file.originalname,
        status: 'success',
        timeMs: Date.now() - fileStart,
        // Structural validation
        structuralScore: validation.score,
        structuralGrade: validation.grade,
        totalQuestions: validation.totalQuestions,
        totalTasks: validation.totalTasks,
        issues: validation.issues,
        warnings: validation.warnings,
        checks: validation.checks,
      };

      // PDF comparison results
      if (comparison && !comparison.error) {
        entry.comparison = comparison;
        entry.comparisonScore = comparison.score || comparison.checks?.overall_fidelity?.score || null;
        // Combined score: 40% structural + 60% comparison (comparison is the real test)
        if (entry.comparisonScore != null) {
          entry.finalScore = Math.round(validation.score * 0.4 + entry.comparisonScore * 0.6);
          entry.finalGrade = entry.finalScore >= 90 ? 'A' : entry.finalScore >= 75 ? 'B' : entry.finalScore >= 60 ? 'C' : entry.finalScore >= 40 ? 'D' : 'F';
        }
        // Count pass/fail checks
        if (comparison.checks) {
          entry.checksPassed = comparison.passed || Object.values(comparison.checks).filter(c => c.status === 'PASS').length;
          entry.checksFailed = comparison.failed || Object.values(comparison.checks).filter(c => c.status === 'FAIL').length;
        }
      } else if (comparison?.error) {
        entry.comparisonError = comparison.error;
        entry.finalScore = validation.score;
        entry.finalGrade = validation.grade;
      } else {
        entry.finalScore = validation.score;
        entry.finalGrade = validation.grade;
      }

      results.push(entry);
      console.log(`[batch-test] (${i + 1}/${req.files.length}) ${file.originalname}: score=${entry.finalScore}, grade=${entry.finalGrade}, ${entry.totalQuestions}q, ${Math.round((Date.now() - fileStart) / 1000)}s`);

    } catch (err) {
      results.push({ file: file.originalname, status: 'error', error: err.message, timeMs: Date.now() - fileStart });
      console.error(`[batch-test] (${i + 1}/${req.files.length}) ${file.originalname}: ERROR — ${err.message}`);
    }
  }

  // Summary
  const scored = results.filter(r => r.finalScore != null);
  const avgScore = scored.reduce((s, r) => s + r.finalScore, 0) / Math.max(1, scored.length);
  const totalQuestions = results.reduce((s, r) => s + (r.totalQuestions || 0), 0);

  // Aggregate check failures across all files
  const allCheckFailures = [];
  for (const r of results) {
    if (r.comparison?.checks) {
      for (const [checkName, checkVal] of Object.entries(r.comparison.checks)) {
        if (checkVal.status === 'FAIL') {
          allCheckFailures.push({ file: r.file, check: checkName, details: checkVal });
        }
      }
    }
  }

  res.json({
    summary: {
      total: results.length,
      passed: results.filter(r => (r.finalScore || 0) >= 75).length,
      failed: results.filter(r => (r.finalScore || 0) < 75 || r.status === 'error').length,
      avgScore: Math.round(avgScore),
      totalQuestions,
      totalTimeMs: Date.now() - startTime,
      checkFailures: allCheckFailures.length,
    },
    failedChecks: allCheckFailures,
    results,
  });
});

// ── POST /quiz/render-preview — Accept quiz JSON, return fully rendered interactive HTML ──
// Used by frontend to show Student Preview (rich server-rendered HTML with two-column layouts, SVGs, etc.)
router.post('/render-preview', express.json({ limit: '5mb' }), async (req, res) => {
  try {
    const quiz = req.body.quiz || req.body;
    if (!quiz || !quiz.tasks) return res.status(400).json({ error: 'No quiz data provided' });
    autoDetectMCQ(quiz);
    // Recover any bar-graph task missing its structured chart — covers quizzes
    // saved/reopened from BEFORE this fix (or generated on a day the LLM skipped
    // the chart object), not just freshly-uploaded ones.
    await recoverBarCharts(quiz);
    const branding = await fetchBranding(quiz.school, quiz.curriculum);
    const html = renderQuizHTML(quiz, branding);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /quiz/normalize — Accept quiz JSON, return it with the same structural
// normalization Preview applies (riddle/word-bank → table, grid → table, charts,
// venn) but as JSON, not HTML. Lets the Edit Answers screen show the exact same
// shape (e.g. a No./Riddle/Answer table) instead of drifting from Preview. ──
router.post('/normalize', express.json({ limit: '5mb' }), async (req, res) => {
  try {
    const quiz = req.body.quiz || req.body;
    if (!quiz || !quiz.tasks) return res.status(400).json({ error: 'No quiz data provided' });
    normalizeVennQuestions(quiz);
    normalizeCharts(quiz);
    normalizeRiddleTables(quiz);
    normalizeLetterGridTables(quiz);
    normalizeTables(quiz);
    normalizeMatchingTasks(quiz);
    // Same safety net as Preview — a saved quiz reopened for editing may predate
    // this fix (or the LLM skipped the chart object on generation day).
    await recoverBarCharts(quiz);
    res.json({ quiz });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /quiz/test-preview — Render last generated quiz as HTML (for testing) ──
// ?name=mhle-32 | ?name=mhle-31 | ?name=mhle-12  (default: test-quiz.json)
router.get('/test-preview', (req, res) => {
  try {
    const name = req.query.name;
    const filename = name ? `test-quiz-${name}.json` : 'test-quiz.json';
    const testFile = path.join(__dirname, '..', 'data', filename);
    if (!fs.existsSync(testFile)) return res.status(404).send(`No test quiz found: ${filename}`);
    const quiz = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    autoDetectMCQ(quiz);
    const html = renderQuizHTML(quiz);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// ── GET /quiz/transliterate — server-side proxy for Google Input Tools ─────
// The quiz HTML used to call inputtools.google.com directly from the browser,
// which fails CORS in the student iframe — so Telugu/Hindi typing silently
// broke. Proxying through our server removes the browser CORS problem.
// NOTE: must be declared BEFORE router.get('/:id') or ':id' swallows it.
router.get('/transliterate', async (req, res) => {
  try {
    const text = String(req.query.text || '').slice(0, 60);
    const lang = /^[a-z]{2}$/.test(String(req.query.lang)) ? req.query.lang : 'te';
    if (!text) return res.json({ suggestions: [] });
    const url = 'https://inputtools.google.com/request?text=' + encodeURIComponent(text)
      + '&itc=transliteration_en_' + lang + '&num=5&cp=0&cs=1&ie=utf-8&oe=utf-8';
    const r = await fetch(url);
    const data = await r.json();
    const suggestions = (data && data[0] === 'SUCCESS' && data[1] && data[1][0] && data[1][0][1]) ? data[1][0][1] : [];
    res.json({ suggestions });
  } catch (err) {
    res.json({ suggestions: [] });
  }
});

// ── GET /quiz/:id — Get single quiz from Qdrant ────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    await ensureQuizCollection();
    const results = await client.retrieve(QUIZ_COLLECTION, {
      ids: [req.params.id],
      with_payload: true,
    });

    if (!results || results.length === 0) {
      return res.status(404).json({ error: 'Quiz not found' });
    }
    res.json({ quiz: results[0].payload });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /quiz/:id/html — Render interactive HTML quiz ───────────────────────
router.get('/:id/html', async (req, res) => {
  try {
    await ensureQuizCollection();
    const results = await client.retrieve(QUIZ_COLLECTION, {
      ids: [req.params.id],
      with_payload: true,
    });

    if (!results || results.length === 0) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    const payload = results[0].payload;
    const quiz = payload.quiz_data;
    // renderQuizHTML draws the school/curriculum logo header from `branding` —
    // this endpoint never fetched it, so previews from the library always
    // rendered with no logo even though the same quiz has one when assigned
    // through the normal create/publish flow (which does pass branding).
    const branding = await fetchBranding(payload.school || payload.school_id, payload.curriculum);
    const html = renderQuizHTML(quiz, branding);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Server-side SVG builder — generates perfect geometry from shapeData ─────
function buildShapeSVG(shapeData) {
  if (!shapeData || !shapeData.type) return '';
  const BLUE = '#1565c0';
  const RED = '#c62828';
  const FILL = '#e3f2fd';

  switch (shapeData.type) {
    case 'polygon': {
      const n = shapeData.sides || 4;
      const name = shapeData.name || `${n}-gon`;
      const cx = 120, cy = 120, r = 90;
      const points = [];
      for (let i = 0; i < n; i++) {
        const angle = (2 * Math.PI * i / n) - Math.PI / 2; // start from top
        points.push(`${Math.round(cx + r * Math.cos(angle))},${Math.round(cy + r * Math.sin(angle))}`);
      }
      const sideInfo = shapeData.sideLength ? `<text x="${cx}" y="${cy + 18}" font-size="12" text-anchor="middle" fill="#555">${n} equal sides of ${shapeData.sideLength}</text>` : '';
      return `<svg viewBox="0 0 240 240" style="max-width:200px;width:100%">
        <polygon points="${points.join(' ')}" fill="${FILL}" stroke="${BLUE}" stroke-width="3"/>
        <text x="${cx}" y="${cy - 2}" font-size="15" text-anchor="middle" fill="${BLUE}" font-weight="bold">${name}</text>
        ${sideInfo}
      </svg>`;
    }

    case 'lshape': {
      // Parse segments to get dimensions
      const segs = shapeData.segments || [];
      const getLabel = (side) => (segs.find(s => s.side === side) || {}).label || '?';
      const isGiven = (side) => (segs.find(s => s.side === side) || {}).given !== false;

      // Parse numeric values for proportional drawing
      const parseNum = (lbl) => parseFloat(String(lbl).replace(/[^0-9.]/g, '')) || 0;
      const topVal = parseNum(getLabel('top'));
      const bottomVal = parseNum(getLabel('bottom'));
      const stepDownVal = parseNum(getLabel('step-down'));
      const rightVal = parseNum(getLabel('right'));

      // Calculate proportions (bottom is the widest)
      const maxH = bottomVal || 8;
      const maxV = (stepDownVal + rightVal) || (topVal ? topVal + rightVal : 9);
      const totalH = Math.max(maxH, topVal + 1);
      const totalV = stepDownVal + rightVal || maxV;

      // Scale to fit in viewBox with padding
      const pad = 40;
      const svgW = 320, svgH = 280;
      const drawW = svgW - 2 * pad, drawH = svgH - 2 * pad;
      const scale = Math.min(drawW / totalH, drawH / totalV);

      // Key coordinates
      const topW = topVal * scale;
      const bottomW = bottomVal * scale;
      const stepH = stepDownVal * scale;
      const rightH = rightVal * scale;
      const totalHeight = stepH + rightH;

      // L-shape polygon: starts top-left, goes clockwise
      // Shape: top-left → top-right → step corner → bottom-right-top → bottom-right → bottom-left
      const x0 = pad, y0 = pad;
      const x1 = pad + topW, y1 = pad;                    // top-right of upper part
      const x2 = pad + topW, y2 = pad + stepH;            // inner step corner
      const x3 = pad + bottomW, y3 = pad + stepH;         // bottom-right-top
      const x4 = pad + bottomW, y4 = pad + totalHeight;   // bottom-right
      const x5 = pad, y5 = pad + totalHeight;             // bottom-left

      const pts = `${x0},${y0} ${x1},${y1} ${x2},${y2} ${x3},${y3} ${x4},${y4} ${x5},${y5}`;

      // Build labels
      const lblStyle = (given) => given
        ? `fill="${BLUE}" font-weight="bold" font-size="14"`
        : `fill="${RED}" font-weight="bold" font-size="14"`;

      // Dashed lines for non-given sides
      let dashes = '';
      if (!isGiven('step-left')) {
        dashes += `<line x1="${x2}" y1="${y2}" x2="${x3}" y2="${y3}" stroke="${RED}" stroke-width="2" stroke-dasharray="6 3"/>`;
      }
      if (!isGiven('step-up')) {
        dashes += `<line x1="${x3}" y1="${y3}" x2="${x3}" y2="${y4}" stroke="${RED}" stroke-width="2" stroke-dasharray="6 3"/>`;
      }

      // Label positions (outside each edge)
      const labels = [];
      // top edge
      labels.push(`<text x="${(x0 + x1) / 2}" y="${y0 - 8}" ${lblStyle(isGiven('top'))} text-anchor="middle">${getLabel('top')}</text>`);
      // step-down (right side of upper part)
      labels.push(`<text x="${x1 + 14}" y="${(y1 + y2) / 2 + 5}" ${lblStyle(isGiven('step-down'))} text-anchor="start">${getLabel('step-down')}</text>`);
      // bottom edge
      labels.push(`<text x="${(x5 + x4) / 2}" y="${y4 + 20}" ${lblStyle(isGiven('bottom'))} text-anchor="middle">${getLabel('bottom')}</text>`);
      // right side
      labels.push(`<text x="${x4 + 14}" y="${(y3 + y4) / 2 + 5}" ${lblStyle(isGiven('right'))} text-anchor="start">${getLabel('right')}</text>`);
      // step-left (inner horizontal)
      labels.push(`<text x="${(x2 + x3) / 2}" y="${y2 - 8}" ${lblStyle(isGiven('step-left'))} text-anchor="middle">${getLabel('step-left')}</text>`);
      // step-up (inner vertical) — only if it exists
      if (segs.find(s => s.side === 'step-up')) {
        labels.push(`<text x="${x3 + 14}" y="${(y2 + y3) / 2 + 5}" ${lblStyle(isGiven('step-up'))} text-anchor="start">${getLabel('step-up')}</text>`);
      }
      // left side
      if (segs.find(s => s.side === 'left')) {
        labels.push(`<text x="${x0 - 14}" y="${(y0 + y5) / 2 + 5}" ${lblStyle(isGiven('left'))} text-anchor="end">${getLabel('left')}</text>`);
      }

      return `<svg viewBox="0 0 ${svgW} ${svgH}" style="max-width:280px;width:100%">
        <polygon points="${pts}" fill="${FILL}" stroke="${BLUE}" stroke-width="2.5"/>
        ${dashes}
        ${labels.join('\n        ')}
      </svg>`;
    }

    case 'rectangle': {
      const w = 180, h = 110;
      const pad = 35;
      return `<svg viewBox="0 0 ${w + 2 * pad} ${h + 2 * pad}" style="max-width:220px;width:100%">
        <rect x="${pad}" y="${pad}" width="${w}" height="${h}" fill="${FILL}" stroke="${BLUE}" stroke-width="2.5" rx="2"/>
        <text x="${pad + w / 2}" y="${pad - 8}" font-size="14" text-anchor="middle" fill="${BLUE}" font-weight="bold">${shapeData.width || ''}</text>
        <text x="${pad + w + 14}" y="${pad + h / 2 + 5}" font-size="14" text-anchor="start" fill="${BLUE}" font-weight="bold">${shapeData.height || ''}</text>
      </svg>`;
    }

    case 'grid': {
      const size = shapeData.gridSize || 10;
      const cellSize = 22;
      const gridPx = size * cellSize;
      let gridLines = '';
      for (let i = 0; i <= size; i++) {
        gridLines += `<line x1="${i * cellSize}" y1="0" x2="${i * cellSize}" y2="${gridPx}" stroke="#bbb" stroke-width="0.5"/>`;
        gridLines += `<line x1="0" y1="${i * cellSize}" x2="${gridPx}" y2="${i * cellSize}" stroke="#bbb" stroke-width="0.5"/>`;
      }
      // Build shape path from outlinePoints (grid coordinates) provided by Gemini
      let shapePath = '';
      const pts = shapeData.outlinePoints;
      if (Array.isArray(pts) && pts.length >= 3) {
        // Convert grid coords to pixel coords and build smooth cubic bezier path
        const px = pts.map(([col, row]) => [col * cellSize, row * cellSize]);
        // Start point
        shapePath = `M ${px[0][0]},${px[0][1]}`;
        // Use smooth curves through each point
        for (let i = 1; i < px.length; i++) {
          const prev = px[i - 1];
          const curr = px[i];
          const next = px[i < px.length - 1 ? i + 1 : 0];
          // Control points: pull towards midpoints for smooth curve
          const cp1x = prev[0] + (curr[0] - prev[0]) * 0.5;
          const cp1y = prev[1] + (curr[1] - prev[1]) * 0.5;
          const cp2x = curr[0] - (next[0] - prev[0]) * 0.15;
          const cp2y = curr[1] - (next[1] - prev[1]) * 0.15;
          shapePath += ` C ${Math.round(cp1x)},${Math.round(cp1y)} ${Math.round(cp2x)},${Math.round(cp2y)} ${Math.round(curr[0])},${Math.round(curr[1])}`;
        }
        shapePath += ' Z';
      } else {
        // Fallback: generic rounded shape
        const r = gridPx * 0.35, cx = gridPx / 2, cy = gridPx / 2;
        shapePath = `M ${cx},${cy - r} C ${cx + r * 1.1},${cy - r} ${cx + r},${cy + r * 0.5} ${cx + r * 0.6},${cy + r * 0.8} C ${cx},${cy + r} ${cx - r * 0.8},${cy + r * 0.6} ${cx - r * 0.7},${cy} C ${cx - r * 0.5},${cy - r * 0.7} ${cx - r * 0.2},${cy - r} ${cx},${cy - r} Z`;
      }
      return `<svg viewBox="0 0 ${gridPx} ${gridPx}" style="max-width:240px;width:100%">
        <rect width="${gridPx}" height="${gridPx}" fill="white" stroke="#999" stroke-width="1"/>
        ${gridLines}
        <path d="${shapePath}" fill="rgba(30,136,229,0.12)" stroke="${BLUE}" stroke-width="2.5" fill-rule="nonzero"/>
      </svg>`;
    }

    case 'vertical-calc': {
      const nums = shapeData.numbers || [];
      const op = shapeData.operation || '+';
      if (nums.length < 2) return '';
      const lines = nums.map((n, i) => i === 0 ? `<div>&nbsp;&nbsp;${n}</div>` : `<div>${op} ${n}</div>`);
      return `<div style="display:inline-block;background:#f5f5f5;padding:12px 20px;border-radius:8px;font-family:monospace;font-size:18px;text-align:right;line-height:1.6;border:1px solid #ddd">${lines.join('')}<div style="border-top:2px solid #333;margin-top:4px;padding-top:4px">____</div></div>`;
    }

    case 'table': {
      const rows = shapeData.rows || [];
      if (rows.length === 0) return '';
      const trs = rows.map(row =>
        `<tr>${(Array.isArray(row) ? row : [row]).map(cell =>
          `<td style="border:1px solid #ccc;padding:8px 12px">${cell}</td>`
        ).join('')}</tr>`
      ).join('');
      return `<div><table style="width:100%;border-collapse:collapse;font-size:14px">${trs}</table></div>`;
    }

    default:
      return '';
  }
}

// ── Infer shapeData from question text when AI doesn't provide it ──────────
function inferShapeData(question, answer, solution) {
  const text = `${question} ${solution || ''}`.toLowerCase();

  // Grid / area estimation — check FIRST (before polygon names interfere)
  if (text.includes('grid') || (text.includes('area') && text.includes('irregular'))) {
    return { type: 'grid', gridSize: 10, shapeDescription: 'irregular shape on grid' };
  }

  // L-shape — check before generic polygon
  if (text.includes('l-shape') || text.includes('l shape') || text.includes('l shaped')) {
    const dimMatch = (solution || '').match(/(\d+)\s*m?\s*\+\s*(\d+)\s*m?\s*\+\s*(\d+)\s*m?\s*\+\s*(\d+)\s*m?\s*\+\s*(\d+)\s*m?\s*\+\s*(\d+)/);
    if (dimMatch) {
      const d = dimMatch.slice(1, 7).map(Number);
      // Solution typically lists: bottom + step-down + step-left + step-up + top + right  OR some order
      // We need: top, step-down, bottom, right as given; step-left, step-up as calculated
      // Look for the 4 given values from the question text
      const qNums = (question.match(/(\d+)\s*(?:m|cm)\b/g) || []).map(s => parseFloat(s));
      if (qNums.length >= 4) {
        return { type: 'lshape', segments: [
          { side: 'top', label: `${qNums[0]}m`, given: true },
          { side: 'step-down', label: `${qNums[1]}m`, given: true },
          { side: 'bottom', label: `${qNums[2]}m`, given: true },
          { side: 'right', label: `${qNums[3]}m`, given: true },
          { side: 'step-left', label: '?', given: false },
          { side: 'step-up', label: '?', given: false },
        ]};
      }
      // Fallback: use solution dims — assume [bottom, right, step-left, step-up, top, step-down] or similar
      return { type: 'lshape', segments: [
        { side: 'top', label: `${d[0]}m`, given: true },
        { side: 'step-down', label: `${d[1]}m`, given: true },
        { side: 'bottom', label: `${d[2]}m`, given: true },
        { side: 'right', label: `${d[3]}m`, given: true },
        { side: 'step-left', label: `${d[4]}m`, given: false },
        { side: 'step-up', label: `${d[5]}m`, given: false },
      ]};
    }
    // Fallback: look for individual numbers in question text
    const sideNums = (question.match(/(\d+)\s*(?:m|cm|mm)\b/g) || []).map(s => s.trim());
    if (sideNums.length >= 4) {
      return { type: 'lshape', segments: [
        { side: 'top', label: sideNums[0], given: true },
        { side: 'step-down', label: sideNums[1], given: true },
        { side: 'bottom', label: sideNums[2], given: true },
        { side: 'right', label: sideNums[3], given: true },
        { side: 'step-left', label: '?', given: false },
        { side: 'step-up', label: '?', given: false },
      ]};
    }
  }

  // Rectangle (check before square since "rectangular" should take priority)
  if (text.includes('rectangle') || text.includes('rectangular')) {
    const dimMatch = text.match(/(\d+(?:\.\d+)?)\s*(m|cm|mm|km)\b.*?(\d+(?:\.\d+)?)\s*(m|cm|mm|km)\b/);
    if (dimMatch) {
      return { type: 'rectangle', width: `${dimMatch[1]} ${dimMatch[2]}`, height: `${dimMatch[3]} ${dimMatch[4]}` };
    }
  }

  // Named regular polygons (triangle, pentagon, hexagon, octagon, etc.)
  const polyMap = { triangle: 3, pentagon: 5, hexagon: 6, heptagon: 7, octagon: 8, nonagon: 9, decagon: 10 };
  for (const [name, sides] of Object.entries(polyMap)) {
    if (text.includes(name)) {
      const perimMatch = text.match(/perimeter\s+(?:is|=|of)\s*\*?\*?\s*(\d+)/);
      const sideLen = perimMatch ? (parseFloat(perimMatch[1]) / sides) : null;
      return { type: 'polygon', sides, name: name.charAt(0).toUpperCase() + name.slice(1), sideLength: sideLen ? `${sideLen} cm` : undefined };
    }
  }

  // "regular polygon" with perimeter — infer sides from answer
  if (text.includes('regular polygon') && text.includes('perimeter')) {
    const perimMatch = text.match(/perimeter\s+(?:is|=|of)?\s*\*?\*?\s*(\d+)/);
    if (perimMatch && answer) {
      const perim = parseFloat(perimMatch[1]);
      const side = parseFloat(answer);
      if (side > 0) {
        const n = Math.round(perim / side);
        if (n >= 3 && n <= 12) {
          const polyName = Object.entries(polyMap).find(([_, s]) => s === n)?.[0] || `${n}-gon`;
          return { type: 'polygon', sides: n, name: polyName.charAt(0).toUpperCase() + polyName.slice(1), sideLength: `${side} cm` };
        }
      }
    }
  }

  // Square (separate from polygon since we need dimension extraction)
  if (text.includes('square') && !text.includes('squared')) {
    const sideMatch = text.match(/sides?\s+(?:of|are|is|that are)?\s*\*?\*?\s*(\d+(?:\.\d+)?)\s*(m|cm|mm|km)\b/);
    if (sideMatch) {
      return { type: 'rectangle', width: `${sideMatch[1]} ${sideMatch[2]}`, height: `${sideMatch[1]} ${sideMatch[2]}` };
    }
    return { type: 'polygon', sides: 4, name: 'Square' };
  }

  return null;
}

function sanitizeDuplicateQuestionIds(quiz) {
  for (const task of (quiz.tasks || [])) {
    const seenIds = new Set();
    const allQs = task.questions || [];
    for (const q of allQs) {
      if (!q.id) {
        q.id = Math.random().toString(36).substring(7);
      }
      if (seenIds.has(q.id)) {
        const baseId = q.id;
        let counter = 2;
        while (seenIds.has(`${baseId}_${counter}`)) {
          counter++;
        }
        const newId = `${baseId}_${counter}`;
        
        // Update in columnGroups
        const colGroups = task.layout?.columnGroups || [];
        for (let gIdx = colGroups.length - 1; gIdx >= 0; gIdx--) {
          const group = colGroups[gIdx];
          const qIds = group.questionIds || [];
          const idx = qIds.lastIndexOf(baseId); // start replacing from the back
          if (idx !== -1) {
            qIds[idx] = newId;
            break;
          }
        }
        q.id = newId;
        console.log(`[quiz-sanitize] Renamed duplicate ID collision: ${baseId} -> ${newId} for task "${task.title}"`);
      }
      seenIds.add(q.id);
    }
  }
}

// ── Post-process: auto-detect MCQ questions the LLM returned as text ──────
function autoDetectMCQ(quiz) {
  sanitizeDuplicateQuestionIds(quiz);
  for (const task of (quiz.tasks || [])) {
    const title = (task.title || '').toLowerCase();
    const isMcqTask = /tick|choose|circle.*correct|select.*option|multiple.*choice/i.test(title);

    for (const q of (task.questions || [])) {
      // Skip if already MCQ with options
      if (q.type === 'mcq' && Array.isArray(q.options) && q.options.length > 0) continue;

      const qText = q.question || '';

      // Detect inline options in question text: "A pencil is about: (2 cm / 15 cm / 2 m)"
      // Or: "... (centimetre / metre)"  or "... (gram / kilogram)"
      const parenMatch = qText.match(/\(([^)]+\/[^)]+)\)/);
      if (parenMatch && (isMcqTask || /tick|choose|circle|select/i.test(qText))) {
        const rawOpts = parenMatch[1].split('/').map(s => s.trim()).filter(Boolean);
        if (rawOpts.length >= 2) {
          q.type = 'mcq';
          q.options = rawOpts.map(label => {
            const isCorrect = String(q.answer).toLowerCase().trim() === label.toLowerCase().trim();
            return { label, correct: isCorrect };
          });
          // Clean the options out of question text
          q.question = qText.replace(parenMatch[0], '').replace(/\s+$/, '').replace(/:\s*$/, ':');
          console.log(`[mcq-detect] Converted Q(${q.id}) to MCQ: ${rawOpts.join(' | ')}`);
          continue;
        }
      }

      // Detect when task says "tick correct option" but LLM gave text type with options embedded differently
      if (isMcqTask && q.type !== 'mcq' && q.type !== 'activity') {
        // Try to extract "a) X  b) Y  c) Z" style options from question
        const abcMatch = qText.match(/\ba\)\s*(.+?)\s+b\)\s*(.+?)(?:\s+c\)\s*(.+?))?(?:\s+d\)\s*(.+?))?$/i);
        if (abcMatch) {
          const rawOpts = [abcMatch[1], abcMatch[2], abcMatch[3], abcMatch[4]].filter(Boolean).map(s => s.trim());
          if (rawOpts.length >= 2) {
            q.type = 'mcq';
            q.options = rawOpts.map(label => ({
              label,
              correct: String(q.answer).toLowerCase().trim() === label.toLowerCase().trim()
            }));
            q.question = qText.replace(abcMatch[0], '').trim();
            console.log(`[mcq-detect] Converted Q(${q.id}) to MCQ (abc): ${rawOpts.join(' | ')}`);
          }
        }
      }
    }
  }
}

// ── Normalize "match the following" tasks → per-item MCQ with shared word bank ──
// Worksheets like "Match the correct word to the pictures" arrive as one question
// per picture with a free-text answer (the word to match). Typing the word defeats
// the point of a matching task, so pool every answer in the task into a word bank
// and render each item as options to pick from.
function normalizeMatchingTasks(quiz) {
  (quiz.tasks || []).forEach((task, ti) => {
    const qs = task.questions || [];
    if (qs.length < 2) return;
    const taskText = `${task.title || ''} ${task.description || ''} ${task.instructions || ''}`;
    const looksMatching = /\bmatch(ing)?\b/i.test(taskText) || /జతపరచ/.test(taskText)
      || qs.filter(q => /^match\b/i.test(q.question || '')).length >= 2;
    if (!looksMatching) return;

    // Word bank = every answer in the task (a matching column is one shared pool)
    const bank = [...new Set(qs.map(q => String(q.answer ?? '').trim()).filter(Boolean))];
    if (bank.length < 2) return;

    let matched = 0;
    qs.forEach((q, qi) => {
      if (q.type === 'venn' || q.type === 'activity') return;
      // Genuine MCQ with a flagged correct option — leave untouched
      if (q.type === 'mcq' && Array.isArray(q.options) && q.options.some(o => o && o.correct)) { matched++; return; }
      const ans = String(q.answer ?? '').trim();
      if (!ans || !bank.includes(ans)) return;
      matched++;
      // Deterministic seeded shuffle: stable across re-renders, but the correct
      // word's position varies per question (bank is in question order, so a
      // plain rotation would park every correct answer in slot A)
      const shuffled = bank.slice();
      let s = ((ti + 1) * 2654435761 + (qi + 1) * 40503) >>> 0;
      for (let i = shuffled.length - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) >>> 0;
        const j = s % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      q.type = 'mcq';
      q.options = shuffled.map(label => ({ label, correct: label === ans }));
    });
    if (matched >= 2) {
      // Flags consumed by renderQuizHTML to draw the drag & drop matching UI
      task._matchTask = true;
      task._wordBank = bank;
    }
    console.log(`[match-detect] Task ${ti + 1} "${String(task.title || '').slice(0, 50)}" → matching (${bank.length}-word bank, ${matched} items)`);
  });
}

// ── Post-process quiz: build SVGs from shapeData ──────────────────────────
function buildQuizDiagrams(quiz) {
  for (const task of (quiz.tasks || [])) {
    // Convert task-level shapeData if present
    if (task.shapeData && !task.diagramHTML) {
      task.diagramHTML = buildShapeSVG(task.shapeData);
    }
    for (const q of (task.questions || [])) {
      // Skip SVG generation entirely if OpenCV already cropped a real image
      if (q.imageUrl) continue;
      // If AI provided shapeData, use it
      if (q.shapeData && !q.diagramHTML) {
        q.diagramHTML = buildShapeSVG(q.shapeData);
      }
      // If no shapeData/diagramHTML, try to infer from question text
      if (!q.diagramHTML && !q.imageUrl) {
        const inferred = inferShapeData(q.question, q.answer, q.solution);
        if (inferred) {
          q.shapeData = inferred;
          q.diagramHTML = buildShapeSVG(inferred);
          q.hasImage = true;
          console.log(`[svg] Inferred ${inferred.type} for question ${q.id}`);
        }
      }
    }
  }
}

// ── Helper: convert **bold** markdown to <strong> tags ──────────────────────
function fmt(text) {
  if (!text) return '';
  return String(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// ── Embed all quiz images as base64 data URIs (works on ephemeral filesystems like Cloud Run) ──
function embedQuizImages(quiz) {
  const serverRoot = path.resolve(__dirname, '..');
  function toDataUri(relUrl) {
    if (!relUrl || relUrl.startsWith('data:')) return relUrl;
    const filePath = path.join(serverRoot, relUrl);
    try {
      const buf = fs.readFileSync(filePath);
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext || 'png'}`;
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      return relUrl;
    }
  }

  // Build page image lookup for fallback
  const pageImageMap = {};
  for (const p of (quiz.fullPageImages || [])) {
    if (p.imageUrl) {
      p.imageUrl = toDataUri(p.imageUrl);
      pageImageMap[p.pageNum] = p.imageUrl;
    }
  }

  // Embed question images + remove SVG diagrams (use only original worksheet images)
  for (const task of (quiz.tasks || [])) {
    if (task.pageImageUrl) task.pageImageUrl = toDataUri(task.pageImageUrl);
    const taskPage = task.sourcePage || 1;
    let taskNeedsPageFallback = false;

    for (const q of (task.questions || [])) {
      if (q.imageUrl) {
        q.imageUrl = toDataUri(q.imageUrl);
      } else if (q.hasImage) {
        // Question references a figure but no individual crop exists — flag for page fallback
        taskNeedsPageFallback = true;
      }
      // Remove auto-generated SVG — only use original worksheet images
      delete q.diagramHTML;
      delete q.shapeData;
    }

    // Fallback: if any question needs an image but doesn't have one, attach the full page image
    if (taskNeedsPageFallback && !task.pageImageUrl) {
      const pageImg = pageImageMap[taskPage] || pageImageMap[1];
      if (pageImg) {
        task.pageImageUrl = pageImg;
        console.log(`[quiz] Page fallback: Task "${(task.title || '').slice(0, 40)}" → full page ${taskPage} image`);
      }
    }
  }

  if (quiz.worksheetImageUrl) quiz.worksheetImageUrl = toDataUri(quiz.worksheetImageUrl);
}

// ── HTML renderer — Aivorah Enchanted Forest dark theme ────────────────────
// ── Quiz Quality Validator — automatically scores generated quizzes ──
function validateQuiz(quiz) {
  const issues = [];
  const warnings = [];
  let score = 100;

  if (!quiz) return { score: 0, issues: ['No quiz data'], warnings: [], grade: 'F', checks: {} };

  // 1. Basic structure
  if (!quiz.title) { issues.push('Missing title'); score -= 5; }
  if (!quiz.subject) { issues.push('Missing subject'); score -= 3; }
  if (!quiz.tasks || quiz.tasks.length === 0) { issues.push('No tasks found'); score -= 30; }

  let totalQ = 0;
  let missingAnswers = 0;
  let missingHints = 0;
  let missingSolutions = 0;
  let notProvidedCount = 0;
  let emptyQuestions = 0;
  let hasImageCount = 0;
  let sharedImageCount = 0;
  let imagesRendered = 0;
  let imagesMissing = 0;
  let layoutCount = 0;
  let twoColumnCount = 0;
  let branchDiagramCount = 0;
  let mcqCount = 0;
  let mcqMissingOptions = 0;
  let activityCount = 0;
  let passageCount = 0;

  // Language detection
  const allText = (quiz.tasks || []).map(t =>
    (t.title || '') + ' ' + (t.questions || []).map(q => q.question || '').join(' ')
  ).join(' ');
  const hasTeluguScript = /[\u0C00-\u0C7F]/.test(allText);
  const hasDevanagari = /[\u0900-\u097F]/.test(allText);
  const hasFrenchChars = /[àâæçéèêëïîôùûüÿœ]/i.test(allText);
  const detectedLang = hasTeluguScript ? 'te' : hasDevanagari ? 'hi' : hasFrenchChars ? 'fr' : 'en';
  const isLanguageWorksheet = hasTeluguScript || hasDevanagari || hasFrenchChars ||
    /telugu|hindi|french|fran[çc]ais|language acquisition/i.test(quiz.subject || '');

  for (const task of (quiz.tasks || [])) {
    if (!task.title) { warnings.push('Task missing title'); score -= 2; }
    if (task.sharedImage) sharedImageCount++;
    if (task.layout) layoutCount++;
    if (task.layout?.type === 'two-column') twoColumnCount++;
    if (task.passage) passageCount++;

    // Check shared image rendering
    if (task.sharedImage) {
      const firstQ = (task.questions || [])[0];
      const hasUrl = firstQ?.imageUrl || task.pageImageUrl;
      const hasDesc = task.sharedImageDescription;
      const isBranchDiagram = hasDesc && /branch/i.test(hasDesc);
      if (isBranchDiagram) branchDiagramCount++;
      if (hasUrl) {
        imagesRendered++;
      } else if (isBranchDiagram) {
        // Branch diagrams fall back to HTML — that's OK
        imagesRendered++;
      } else if (hasDesc) {
        // Has description but no image URL — might render as fallback text
        imagesMissing++;
        warnings.push(`Task "${(task.title || '').slice(0, 30)}" sharedImage has no image URL`);
        score -= 3;
      }
    }

    for (const q of (task.questions || [])) {
      totalQ++;
      if (!q.question || q.question.trim().length < 3) { emptyQuestions++; score -= 5; }
      if (!q.answer && q.answer !== 0) { missingAnswers++; score -= 4; }
      if (!q.hint) { missingHints++; score -= 1; }
      if (!q.solution) { missingSolutions++; score -= 1; }

      // Check for "Not provided" lazy answers
      const ansStr = String(q.answer || '');
      const solStr = String(q.solution || '');
      if (/not provided|n\/a|unknown/i.test(ansStr) || /not provided|n\/a/i.test(solStr)) {
        notProvidedCount++;
        score -= 8;
      }

      // Image checks per question
      if (q.hasImage) {
        hasImageCount++;
        if (q.imageUrl) {
          imagesRendered++;
        } else if (task.pageImageUrl) {
          imagesRendered++; // page fallback will show
        } else {
          imagesMissing++;
          warnings.push(`Question "${q.id}" has hasImage=true but no imageUrl or page fallback`);
          score -= 3;
        }
      }

      // MCQ checks
      if (q.type === 'mcq') {
        mcqCount++;
        if (!q.options || q.options.length < 2) {
          mcqMissingOptions++;
          issues.push(`MCQ "${q.id}" has missing/insufficient options`);
          score -= 5;
        } else {
          const hasCorrect = q.options.some(o => o.correct);
          if (!hasCorrect) {
            issues.push(`MCQ "${q.id}" has no correct option marked`);
            score -= 5;
          }
        }
      }

      if (q.type === 'activity') activityCount++;
    }
  }

  if (totalQ === 0) { issues.push('Zero questions extracted'); score -= 40; }
  if (missingAnswers > 0) issues.push(`${missingAnswers}/${totalQ} questions missing answers`);
  if (notProvidedCount > 0) issues.push(`${notProvidedCount} questions have "Not provided" answers`);
  if (emptyQuestions > 0) issues.push(`${emptyQuestions} questions have empty/too-short text`);
  if (missingHints > 0) warnings.push(`${missingHints}/${totalQ} questions missing hints`);
  if (missingSolutions > 0) warnings.push(`${missingSolutions}/${totalQ} questions missing solutions`);
  if (imagesMissing > 0) issues.push(`${imagesMissing} images referenced but not rendered`);

  // Clamp score
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

  return {
    score, grade,
    totalQuestions: totalQ,
    totalTasks: (quiz.tasks || []).length,
    issues, warnings,
    checks: {
      images: { rendered: imagesRendered, missing: imagesMissing, sharedImages: sharedImageCount, perQuestion: hasImageCount },
      layout: { tasksWithLayout: layoutCount, twoColumn: twoColumnCount, branchDiagrams: branchDiagramCount },
      content: { missingAnswers, missingHints, missingSolutions, notProvidedCount, emptyQuestions, mcq: mcqCount, mcqMissingOptions, activities: activityCount, passages: passageCount },
      language: { detected: detectedLang, isLanguageWorksheet, hasTransliteration: isLanguageWorksheet && (detectedLang === 'te' || detectedLang === 'hi'), hasFrenchAccents: isLanguageWorksheet && detectedLang === 'fr' },
    },
  };
}

// ── Vision-based comparison: original PDF vs generated quiz ──────────────
// Sends BOTH the original PDF and the quiz JSON to Gemini and asks it to compare
async function compareQuizWithPDF(pdfBuffer, quiz, quizHTML) {
  if (!genAI) throw new Error('GEMINI_API_KEY not configured');
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { temperature: 0 } });

  const prompt = `You are a Quality Assurance expert for an EdTech platform called Aivorah.

I will show you TWO things:
1. The ORIGINAL worksheet PDF (the teacher uploaded this)
2. The GENERATED interactive quiz JSON (our AI extracted this from the PDF)

Your job: Compare them CAREFULLY and report what matches and what's missing/wrong.

CHECK EACH OF THESE (give a PASS/FAIL + details for each):

1. **QUESTIONS_COUNT**: Count every question in the original PDF. Count every question in the quiz JSON. Do they match? List any missing questions by their number/letter.

2. **QUESTIONS_TEXT**: Are the question texts extracted correctly? Check for typos, wrong numbers, missing words, wrong symbols (×, ÷, +, −). Check that special characters (Telugu, Hindi, French accents) are preserved.

3. **ANSWERS_CORRECT**: For each question, verify the answer is mathematically/factually correct. List any wrong answers with the correct answer.

4. **IMAGES_PRESENT**: Look at every diagram, illustration, picture, table, chart in the PDF. For each one, check if the quiz JSON has a corresponding "hasImage", "sharedImage", or "diagramDescription". List any images in the PDF that are NOT captured in the quiz JSON.

5. **LAYOUT_MATCH**: Does the quiz preserve the worksheet layout? If the PDF has two columns, does the quiz JSON have layout.type="two-column"? If there's a branch/tree diagram, is it described? If questions are grouped in a table/grid, is that captured?

6. **HINTS_SOLUTIONS**: Does every question have a hint and solution? Are they helpful and correct?

7. **LANGUAGE_SUPPORT**: If the worksheet is in Telugu/Hindi/French, are all characters preserved correctly? No mojibake or missing diacritics?

8. **TASK_TIERS**: Does the quiz preserve the tier structure (MUST DO / COULD DO / ENRICHMENT)? Any sections from the PDF missing entirely?

9. **PASSAGES_NOTES**: If the PDF has reading passages, instructions, or "Note to Parents", are they extracted into the quiz?

10. **OVERALL_FIDELITY**: On a scale of 1-100, how faithful is the quiz to the original PDF? Would a teacher say "yes, this is my worksheet"?

Return ONLY valid JSON:
{
  "checks": {
    "questions_count": { "status": "PASS|FAIL", "pdf_count": N, "quiz_count": N, "missing": ["list of missing question IDs"] },
    "questions_text": { "status": "PASS|FAIL", "errors": [{"id": "q1", "issue": "wrong number: PDF says 456 but quiz says 465"}] },
    "answers_correct": { "status": "PASS|FAIL", "errors": [{"id": "q1", "expected": "correct answer", "got": "wrong answer"}] },
    "images_present": { "status": "PASS|FAIL", "pdf_images": N, "quiz_images": N, "missing": ["description of missing images"] },
    "layout_match": { "status": "PASS|FAIL", "notes": "description" },
    "hints_solutions": { "status": "PASS|FAIL", "missing_hints": N, "missing_solutions": N, "bad_hints": [{"id":"q1","issue":"too vague"}] },
    "language_support": { "status": "PASS|FAIL|N/A", "language": "en|te|hi|fr", "issues": [] },
    "task_tiers": { "status": "PASS|FAIL", "pdf_sections": N, "quiz_sections": N, "missing": [] },
    "passages_notes": { "status": "PASS|FAIL|N/A", "notes": "" },
    "overall_fidelity": { "score": 85, "summary": "one sentence summary" }
  },
  "passed": 8,
  "failed": 2,
  "score": 85
}

Return ONLY valid JSON, no markdown fences.`;

  const parts = [
    { inlineData: { mimeType: 'application/pdf', data: pdfBuffer.toString('base64') } },
    { text: 'ORIGINAL WORKSHEET PDF is above.\n\nGENERATED QUIZ JSON:\n' + JSON.stringify(quiz, null, 2) },
    { text: prompt },
  ];

  const result = await geminiRetry(() => model.generateContent(parts));
  let text = result.response.text().trim();
  // Strip markdown fences if present
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(text);
}

// ── AI answer verification: catches wrong answers on ANY question type ─────
// The deterministic checks above (solveVerticalMath, checkDecodeAnswer) only
// cover two specific puzzle shapes. This is the general safety net: one extra
// Gemini call per generation that re-derives every answer from the ORIGINAL
// worksheet file and flags whichever ones don't match what's on file. Runs
// once, after all other post-processing, right before the quiz is returned.
// Fail-open: if the call errors or returns malformed JSON, generation still
// succeeds with today's (unverified) answers rather than blocking the teacher.
async function verifyQuizAnswers(fileBuffer, mimeType, quiz) {
  if (!genAI) return { checked: 0, corrected: 0 };
  const items = [];
  (quiz.tasks || []).forEach((task, ti) => {
    (task.questions || []).forEach(q => {
      if (q.type === 'activity' || q.type === 'venn' || q.verticalMath) return; // no single "answer" field, or already deterministically verified
      items.push({ uid: `${ti}-${q.id}`, question: String(q.question || '').slice(0, 300), answer: q.answer });
    });
  });
  if (items.length === 0) return { checked: 0, corrected: 0 };

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { temperature: 0 } });
    const prompt = `You are checking a generated quiz's answer key against the original worksheet file (attached).

Below is every question along with the answer our system currently has on file. For EACH one, independently work out the correct answer from the worksheet (do the actual computation/lookup yourself — don't just trust the stated answer), then compare.

QUESTIONS:
${JSON.stringify(items, null, 2)}

Return ONLY JSON, no markdown fences:
{ "corrections": [ { "uid": "<uid of a WRONG entry only>", "correctAnswer": "<the right answer>", "reason": "short reason" } ] }

Only include an entry in "corrections" if its CURRENT answer is actually wrong — omit every question that's already correct. If everything is correct, return { "corrections": [] }.`;

    const parts = [
      { inlineData: { mimeType, data: fileBuffer.toString('base64') } },
      { text: prompt },
    ];
    const result = await geminiRetry(() => model.generateContent(parts));
    let text = result.response.text().trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const parsed = JSON.parse(text);
    const corrections = Array.isArray(parsed.corrections) ? parsed.corrections : [];

    let corrected = 0;
    for (const c of corrections) {
      if (!c || !c.uid || c.correctAnswer === undefined || c.correctAnswer === null || c.correctAnswer === '') continue;
      const dashIdx = String(c.uid).indexOf('-');
      if (dashIdx < 0) continue;
      const ti = Number(String(c.uid).slice(0, dashIdx));
      const qId = String(c.uid).slice(dashIdx + 1);
      const task = (quiz.tasks || [])[ti];
      const q = task && (task.questions || []).find(qq => String(qq.id) === qId);
      if (!q) continue;
      console.log(`[quiz] AI answer-verification corrected "${String(q.question || '').slice(0, 60)}": "${q.answer}" → "${c.correctAnswer}" (${c.reason || ''})`);
      q.answer = c.correctAnswer;
      corrected++;
    }
    return { checked: items.length, corrected };
  } catch (err) {
    console.warn('[quiz] AI answer-verification failed, keeping existing answers:', err.message);
    return { checked: items.length, corrected: 0, error: err.message };
  }
}

// ── Venn helpers ────────────────────────────────────────────────────────────
// Split a free-text list ("Protein, Healthy Fats and Vitamin E") into clean items.
function splitVennItems(s) {
  return String(s || '')
    .replace(/\band\b/gi, ',')
    .split(/[,;\n]/)
    .map(x => x.replace(/^[\s.\-•*]+|[\s.\-•*]+$/g, '').trim())
    .filter(x => x && x.length <= 40 && !/^\d+$/.test(x));
}

// Normalize any task that contains a Venn diagram into ONE structured `venn` question.
// Handles both the new structured schema (q.answers) and older/plain outputs where the
// LLM flattened the Venn into a single text box (parses regions from the solution text).
function normalizeVennQuestions(quiz) {
  for (const task of (quiz.tasks || [])) {
    const qs = task.questions || [];
    const explicit = qs.find(q => q.type === 'venn');
    const blob = [task.title, task.sharedImageDescription, ...qs.map(q => q.question || '')].join(' ');
    const isVenn = !!explicit || /venn\s*diagram|overlapping circles/i.test(blob);
    if (!isVenn) continue;

    const src = explicit || qs[0] || {};

    // ── Labels for the two circles ──
    let leftLabel = src.leftLabel, rightLabel = src.rightLabel;
    if (!leftLabel || !rightLabel) {
      // Prefer quoted labels ("...labeled 'Almond' and 'Spinach'"); fall back to unquoted words.
      let m = blob.match(/['"]([A-Za-z][\w ]{0,18}?)['"]\s*(?:and|,|&)\s*['"]([A-Za-z][\w ]{0,18}?)['"]/)
           || (task.title || '').match(/between\s+(?:adding\s+)?([A-Za-z]+)\s+(?:or|and)\s+([A-Za-z]+)/i)
           || blob.match(/compare\s+(?:the\s+[\w ]+?\s+in\s+)?([A-Za-z]+)\s+and\s+([A-Za-z]+)/i);
      if (m) { leftLabel = leftLabel || m[1].trim(); rightLabel = rightLabel || m[2].trim(); }
    }
    leftLabel = leftLabel || 'Group A';
    rightLabel = rightLabel || 'Group B';

    // ── Answers for the three regions ──
    let answers = src.answers;
    const hasAns = answers && (answers.left?.length || answers.center?.length || answers.right?.length);
    if (!hasAns) {
      const sol = qs.map(q => q.solution || '').join('  ') + '  ' + blob;
      const lBase = leftLabel.replace(/s$/i, '');
      const rBase = rightLabel.replace(/s$/i, '');
      const grab = (re) => { const m = sol.match(re); return m ? splitVennItems(m[1]) : []; };
      const center = grab(/(?:common|both|shared|overlap(?:ping)?)[^:]*:\s*([^.\n]+)/i);
      const left = grab(new RegExp('(?:unique to (?:the\\s+)?' + lBase + 's?|' + lBase + 's?\\s*only)[^:]*:\\s*([^.\\n]+)', 'i'));
      const right = grab(new RegExp('(?:unique to (?:the\\s+)?' + rBase + 's?|' + rBase + 's?\\s*only)[^:]*:\\s*([^.\\n]+)', 'i'));
      answers = { left, center, right };
    }

    const vennQ = {
      id: src.id || '1',
      type: 'venn',
      question: src.question || `Complete the Venn diagram to compare ${leftLabel} and ${rightLabel}.`,
      leftLabel, rightLabel,
      answers: { left: answers.left || [], center: answers.center || [], right: answers.right || [] },
      hint: src.hint || 'Items shared by BOTH go in the overlapping middle; unique items go in their own circle.',
      solution: src.solution || `${leftLabel} only: ${(answers.left || []).join(', ')}. Both: ${(answers.center || []).join(', ')}. ${rightLabel} only: ${(answers.right || []).join(', ')}.`,
    };

    // Replace the task's questions with the single structured Venn, force single-column,
    // and drop the stray "blank Venn diagram" description note.
    task.questions = [vennQ];
    task.layout = { type: 'single-column', columns: 1 };
    task.sharedImage = false;
    delete task.sharedImageDescription;
  }
}

// ── Riddle/word-bank table helper ────────────────────────────────────────────
// The original worksheet is a No. | Riddle | Answer table (each row a one-line
// clue, answer picked from a word bank above). If the LLM split that into a
// stack of separate question cards, rebuild it as a real table (task.table) so
// the render matches the source layout: numbered rows, riddle text, and a
// single input box per row — instead of one big card per riddle.
function normalizeRiddleTables(quiz) {
  for (const task of (quiz.tasks || [])) {
    if (task.table && Array.isArray(task.table.rows) && task.table.rows.length) continue;
    if (Array.isArray(task.tables) && task.tables.length) continue;
    const qs = task.questions || [];
    if (qs.length < 3) continue;

    const blob = [task.title, task.passage, task.sharedImageDescription].join(' ').toLowerCase();
    const looksLikeRiddleSet = /riddle|word bank/i.test(blob);
    const iAmCount = qs.filter(q => /^i\s+am\b/i.test(String(q.question || '').trim())).length;
    const shortTextAnswers = qs.filter(q => q.type !== 'numeric' && String(q.answer || '').trim().split(/\s+/).length <= 4).length;
    if (!(looksLikeRiddleSet || iAmCount >= Math.ceil(qs.length * 0.6))) continue;
    if (shortTextAnswers < qs.length) continue; // every row must be a short pick-the-word answer

    task.table = {
      headers: ['No.', 'Riddle', 'Answer'],
      rows: qs.map((q, i) => [
        { text: q.id || String(i + 1) },
        { text: (q.question || '').replace(/\*\*(.+?)\*\*/g, '$1') },
        { input: true, answer: q.answer, _qtype: 'text' },
      ]),
    };
    task.questions = [];
    task._tableFromQuestions = true;
  }
}

// ── Letter-grid table helper ─────────────────────────────────────────────────
// The source worksheet shows a row of given letters with ONE blank row beneath
// (add a vowel-sign/dheergham to each letter and write it). The LLM sometimes
// explodes this into a stack of near-identical "Add 'X' to 'Y' and write."
// questions (one per letter) instead of the single table it visually is. Detect
// that repeated phrasing regardless of exact wording and collapse it back into
// a table (or several, chunked to match the source's per-row grouping), the
// same way normalizeRiddleTables does for riddle sets.
function normalizeLetterGridTables(quiz) {
  const ADD_PATTERN = /^add\s+['"‘’“”]?(.+?)['"‘’“”]?\s+to\s+['"‘’“”]?(.+?)['"‘’“”]?\s+and\s+write\.?$/i;
  for (const task of (quiz.tasks || [])) {
    if (task.table && Array.isArray(task.table.rows) && task.table.rows.length) continue;
    if (Array.isArray(task.tables) && task.tables.length) continue;
    const qs = task.questions || [];
    if (qs.length < 5) continue;

    const parsed = qs.map(q => {
      const m = String(q.question || '').trim().match(ADD_PATTERN);
      return m ? { mark: m[1].trim(), letter: m[2].trim(), answer: q.answer } : null;
    });
    if (parsed.some(p => !p)) continue; // every question must match the pattern
    const marks = new Set(parsed.map(p => p.mark));
    if (marks.size > 1) continue; // should be the same symbol added throughout

    const mark = parsed[0].mark;
    const CHUNK = 10; // mirrors the ~10 letters-per-row grouping in the source worksheet
    const tables = [];
    for (let i = 0; i < parsed.length; i += CHUNK) {
      const chunk = parsed.slice(i, i + CHUNK);
      tables.push({
        headers: ['Letter', ...chunk.map(c => c.letter)],
        rows: [[
          { text: mark },
          ...chunk.map(c => ({ input: true, answer: c.answer, _qtype: 'text' })),
        ]],
      });
    }
    task.tables = tables;
    task.questions = [];
    task._tableFromQuestions = true;
  }
}

// ── Table helpers ────────────────────────────────────────────────────────────
// Rebuild task.table from questions the LLM split apart, e.g.
// "Complete the Tally marks for Chutney", "Complete the Frequency for Chutney", ...
function normalizeTables(quiz) {
  for (const task of (quiz.tasks || [])) {
    if (Array.isArray(task.tables) && task.tables.length) continue;
    if (task.table && Array.isArray(task.table.rows) && task.table.rows.length) continue;
    const qs = task.questions || [];
    if (qs.length < 2) continue;

    const parsed = [];
    for (const q of qs) {
      const m = String(q.question || '').match(/complete\s+the\s+(.+?)\s+for\s+(.+?)[:.\s]*$/i);
      if (m) parsed.push({ col: m[1].trim(), row: m[2].trim(), answer: q.answer, type: q.type });
    }
    // Need at least 2 columns × 2 rows worth of grid signal
    if (parsed.length < 3) continue;

    const cols = [];
    const rows = [];
    for (const p of parsed) {
      if (!cols.includes(p.col)) cols.push(p.col);
      if (!rows.includes(p.row)) rows.push(p.row);
    }
    if (cols.length < 1 || rows.length < 2) continue;

    const blob = [task.title, task.passage, task.sharedImageDescription].join(' ');
    const hdrMatch = blob.match(/(favourite[\w ]*|item|name|word|category)[^\n.:]{0,20}/i);
    const firstHeader = hdrMatch ? hdrMatch[0].trim() : 'Item';

    const find = (col, row) => parsed.find(p => p.col === col && p.row === row);
    task.table = {
      headers: [firstHeader, ...cols],
      rows: rows.map(r => [
        { text: r },
        ...cols.map(c => {
          const p = find(c, r);
          return { input: true, answer: p ? p.answer : '', _qtype: (p && p.type) || 'text' };
        }),
      ]),
    };
    task._tableFromQuestions = true;
  }
}

// ── Bar-graph helpers ───────────────────────────────────────────────────────
// Build task.chart from a text description when the LLM didn't emit structured bars.
function normalizeCharts(quiz) {
  for (const task of (quiz.tasks || [])) {
    if (task.chart && Array.isArray(task.chart.bars) && task.chart.bars.length) continue;
    const blob = [task.title, task.sharedImageDescription, ...(task.questions || []).map(q => q.question || '')].join('  ');
    if (!/bar\s*graph|column\s*chart|bar\s*chart/i.test(blob)) continue;
    // Never auto-synthesize a chart for a task the AI already classified as an
    // "activity" — that means the student draws/constructs the graph
    // themselves on paper (e.g. "organize the data... draw a bar graph in
    // your graph book"), so showing a pre-solved chart here defeats the
    // exercise. This regex fallback used to run blind, ignoring that
    // classification entirely — it would trigger on the mere PHRASE "bar
    // graph" even when the worksheet was asking the student to draw one,
    // not showing an existing one to read.
    if ((task.questions || []).some(q => q.type === 'activity')) continue;
    if (/\bdraw\b[^.]{0,40}\b(graph|chart)\b[^.]{0,25}\b(book|notebook|copy)\b/i.test(blob)) continue;

    // Parse "football has 16 votes, tennis has 8, ..." → bars
    const bars = [];
    const re = /([A-Za-z][A-Za-z ]{1,24}?)\s+(?:has|=|:|scored|got)\s+(\d+)/gi;
    let m;
    while ((m = re.exec(blob)) !== null) {
      const label = m[1].trim().replace(/^(and|the)\s+/i, '');
      const value = parseInt(m[2], 10);
      if (label && !isNaN(value) && label.length <= 24) bars.push({ label, value });
    }
    if (bars.length < 2) continue;

    const yMaxMatch = blob.match(/(?:from\s*0\s*to|0\s*(?:to|-|–)\s*)(\d+)/i);
    const maxVal = Math.max(...bars.map(b => b.value));
    const yMax = yMaxMatch ? parseInt(yMaxMatch[1], 10) : Math.ceil(maxVal / 2) * 2;
    const titleMatch = blob.match(/titled\s*['"]([^'"]+)['"]/i) || blob.match(/graph\s+(?:titled\s+)?['"]?([A-Z][\w ]{2,30})['"]?/);
    task.chart = {
      type: 'bar',
      title: titleMatch ? titleMatch[1].trim() : 'Bar Graph',
      yMax, yStep: yMax >= 20 ? 2 : Math.max(1, Math.round(yMax / 10)),
      bars,
    };
    task.sharedImage = false;
    delete task.sharedImageDescription;
  }
}

// Render a structured bar chart as inline SVG (no external image needed).
function renderBarChart(chart) {
  const bars = chart.bars || [];
  if (!bars.length) return '';
  const yMax = chart.yMax || Math.max(...bars.map(b => b.value));
  const yStep = chart.yStep || Math.max(1, Math.round(yMax / 10));
  const W = 640, H = 360, padL = 48, padR = 20, padT = 30, padB = 54;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const bw = plotW / bars.length;
  const barW = Math.min(64, bw * 0.6);
  const y = v => padT + plotH - (v / yMax) * plotH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:640px;height:auto;background:rgba(255,255,255,0.03);border-radius:10px;">`;
  // gridlines + y labels
  for (let v = 0; v <= yMax; v += yStep) {
    const yy = y(v);
    svg += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="rgba(195,220,216,0.18)" stroke-width="1"></line>`;
    svg += `<text x="${padL - 8}" y="${yy + 4}" text-anchor="end" fill="#A8B5B3" font-size="11" font-family="Arial">${v}</text>`;
  }
  // axes
  svg += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#93B0AC" stroke-width="1.5"></line>`;
  svg += `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#93B0AC" stroke-width="1.5"></line>`;
  // bars
  const palette = ['#93B0AC', '#C5BD96', '#D4A898', '#7AADA8', '#EFD1D4', '#C3DCD8'];
  bars.forEach((b, i) => {
    const cx = padL + bw * i + bw / 2;
    const x = cx - barW / 2;
    const yy = y(b.value);
    const h = padT + plotH - yy;
    svg += `<rect x="${x}" y="${yy}" width="${barW}" height="${h}" rx="4" fill="${palette[i % palette.length]}"></rect>`;
    svg += `<text x="${cx}" y="${yy - 6}" text-anchor="middle" fill="#F0EEEC" font-size="12" font-weight="700" font-family="Arial">${b.value}</text>`;
    svg += `<text x="${cx}" y="${padT + plotH + 18}" text-anchor="middle" fill="#D8E8E6" font-size="11" font-family="Arial">${String(b.label).slice(0, 12)}</text>`;
  });
  if (chart.yLabel) svg += `<text x="14" y="${padT + plotH / 2}" transform="rotate(-90 14 ${padT + plotH / 2})" text-anchor="middle" fill="#A8B5B3" font-size="11" font-family="Arial">${chart.yLabel}</text>`;
  if (chart.xLabel) svg += `<text x="${padL + plotW / 2}" y="${H - 6}" text-anchor="middle" fill="#A8B5B3" font-size="11" font-family="Arial">${chart.xLabel}</text>`;
  svg += `</svg>`;

  return `<div style="text-align:center;margin:4px 0 18px;">
    ${chart.title ? `<div style="font-size:14px;font-weight:700;color:#C3DCD8;margin-bottom:8px;">${chart.title}</div>` : ''}
    ${svg}
  </div>`;
}

// When a task is rendered structurally (chart / table / venn), drop any cropped
// worksheet images for that task so we don't show the same visual twice.
function stripImagesForStructuredTasks(quiz) {
  for (const task of (quiz.tasks || [])) {
    const hasChart = task.chart && Array.isArray(task.chart.bars) && task.chart.bars.length;
    const hasTable = (task.table && Array.isArray(task.table.rows) && task.table.rows.length)
      || (Array.isArray(task.tables) && task.tables.some(t => Array.isArray(t.rows) && t.rows.length));
    const hasVenn = (task.questions || []).some(q => q.type === 'venn');
    const hasDiagramFill = task.diagramFillBlanks && task.diagramFillBlanks.length;
    if (!hasChart && !hasTable && !hasVenn) continue;
    if (hasDiagramFill) continue; // diagram-fill owns its own image (task.diagramFillImageUrl) — leave it alone
    task.sharedImage = false;
    delete task.sharedImageDescription;
    delete task.pageImageUrl;
    for (const q of (task.questions || [])) {
      q.hasImage = false;
      delete q.imageUrl;
      delete q.diagramDescription;
      q._sharedImage = false;
    }
  }
}

function renderQuizHTML(quiz, branding = {}) {
  normalizeVennQuestions(quiz);
  normalizeCharts(quiz);
  normalizeRiddleTables(quiz);
  normalizeLetterGridTables(quiz);
  normalizeTables(quiz);
  normalizeMatchingTasks(quiz);
  stripImagesForStructuredTasks(quiz);
  // Helper: convert relative image URL to base64 data URI so HTML works standalone
  const serverRoot = path.resolve(__dirname, '..');
  function embedImage(relUrl) {
    if (!relUrl) return relUrl;
    if (relUrl.startsWith('data:')) return relUrl; // already base64
    // relUrl like "/data/images/quiz/abc.png" → server/data/images/quiz/abc.png
    const filePath = path.join(serverRoot, relUrl);
    try {
      const buf = fs.readFileSync(filePath);
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      return relUrl; // fallback to original URL if file not found
    }
  }

  // Auto-generate hints & fix "Not provided" answers for ALL questions (universal — all subjects/languages)
  for (const task of (quiz.tasks || [])) {
    for (const q of (task.questions || [])) {
      const qText = (q.question || '') + ' ' + (task.title || '');

      // Fix "Not provided" answers — LLM sometimes returns this instead of solving
      if (q.answer && /not provided|n\/a|unknown/i.test(String(q.answer))) {
        q.answer = '';
      }
      if (q.solution && /not provided|n\/a/i.test(q.solution)) {
        q.solution = '';
      }

      // Generate hint if missing or empty
      if (!q.hint || !q.hint.trim()) {
        if (q.type === 'fraction' || /fract|reduce|lowest|simplif/i.test(qText)) {
          q.hint = 'Find the GCF (Greatest Common Factor) of the numerator and denominator, then divide both by it.';
        } else if (q.type === 'comparison' || /compar|<|>|=/i.test(qText)) {
          q.hint = 'Convert fractions to the same denominator (find the LCM), then compare the numerators.';
        } else if (q.unit && /g$|gm$|kg$/i.test(q.unit)) {
          q.hint = '1 kg = 1000 g. Multiply when converting larger to smaller units, divide for smaller to larger.';
        } else if (q.unit && /ml$|l$/i.test(q.unit)) {
          q.hint = '1 L = 1000 mL. Multiply when converting larger to smaller units, divide for smaller to larger.';
        } else if (q.unit && /cm$|mm$|m$|km$/i.test(q.unit)) {
          q.hint = '1 km = 1000 m, 1 m = 100 cm, 1 cm = 10 mm. Use these conversion factors.';
        } else if (q.unit && /m²|cm²|sq/i.test(q.unit)) {
          q.hint = 'Area = length × width. Perimeter = sum of all sides.';
        } else if (/perimete/i.test(qText)) {
          q.hint = 'Perimeter = sum of all sides. Find any missing sides first.';
        } else if (/area/i.test(qText)) {
          q.hint = 'Area = length × width for rectangles. Break complex shapes into simpler parts.';
        } else if (/angle|protract|degree/i.test(qText)) {
          q.hint = 'Acute < 90°, Right = 90°, Obtuse > 90°, Straight = 180°.';
        } else if (/bar\s*graph|chart|graph|data/i.test(qText)) {
          q.hint = 'Read the values carefully from the graph. Check the scale on each axis.';
        } else if (/venn|diagram/i.test(qText)) {
          q.hint = 'Look at where the circles overlap for shared items, and outside for unique items.';
        } else if (q.solution && q.solution.trim().length > 5) {
          const firstStep = q.solution.split(/[.\n]/).find(s => s.trim().length > 5);
          if (firstStep) q.hint = 'Think about: ' + firstStep.trim().replace(/^Step\s*\d+[:\s]*/i, '');
        }
      }

      // Universal fallback — EVERY question gets a hint, no exceptions
      if (!q.hint || !q.hint.trim()) {
        q.hint = 'Read the question carefully and think step by step.';
      }

      // Ensure solution exists
      if (!q.solution || !q.solution.trim()) {
        if (q.answer !== undefined && q.answer !== '') {
          q.solution = 'The answer is: ' + q.answer;
        }
      }
    }
  }

  // NOTE: totalQ is finalized to qNum after the task loop below registers every
  // checkable question — registerQuestion() may run more/fewer times than
  // task.questions.length (e.g. two-column layouts can register a question
  // twice), so counting task.questions directly could make the score (sc)
  // exceed this total.

  const tierStyles = {
    'MUST DO':     { bg: 'rgba(147,176,172,0.08)', border: '#93B0AC', label: '#93B0AC', labelBg: 'rgba(147,176,172,0.15)' },
    'COULD DO':    { bg: 'rgba(197,189,150,0.08)', border: '#C5BD96', label: '#C5BD96', labelBg: 'rgba(197,189,150,0.15)' },
    'ENRICHMENT':  { bg: 'rgba(239,209,212,0.08)', border: '#EFD1D4', label: '#EFD1D4', labelBg: 'rgba(239,209,212,0.15)' },
    // Neutral fallback for any tier language that isn't one of the three
    // above ("Core"/"Extension", "Level 1/2/3", custom section names, or no
    // tiers at all). Previously any unrecognized tier silently inherited
    // MUST DO's green — implying an urgency/priority meaning the worksheet
    // never stated. Slate, not tied to any tier's meaning.
    'DEFAULT':     { bg: 'rgba(168,181,179,0.06)', border: '#8C9C99', label: '#8C9C99', labelBg: 'rgba(168,181,179,0.14)' },
  };

  // Aivorah concept card colors
  const conceptCardColors = ['#93B0AC', '#C5BD96', '#D4A898', '#C3DCD8', '#EFD1D4', '#7AADA8'];

  // Concept icon lookup
  const conceptIcons = {
    'area': '&#9998;', 'perimeter': '&#9997;', 'angle': '&#8736;',
    'data': '&#128202;', 'graph': '&#128200;', 'fraction': '&#189;',
    'measurement': '&#128207;', 'default': '&#128218;'
  };
  function getConceptIcon(term) {
    const t = (term || '').toLowerCase();
    for (const [key, icon] of Object.entries(conceptIcons)) {
      if (t.includes(key)) return icon;
    }
    return conceptIcons['default'];
  }

  // Smart label based on question context — returns null for long/open-ended questions
  function smartLabel(q, unit) {
    if (q.type === 'long') return null;
    const qLower = (q.question || '').toLowerCase();
    const uLower = (unit || '').toLowerCase();
    if (qLower.includes('side') || qLower.includes('side length')) return 'Side =';
    if (qLower.includes('perimeter') || uLower === 'cm' && qLower.includes('perimeter')) return 'Perimeter =';
    if (qLower.includes('area') || uLower.includes('²') || uLower.includes('m2')) return 'Area =';
    if (qLower.includes('distance') || qLower.includes('jog') || qLower.includes('walk') || qLower.includes('run')) return 'Distance =';
    if (uLower === 'tiles' || qLower.includes('tiles')) return 'Number of tiles =';
    if (qLower.includes('how many') || qLower.includes('number of')) return 'Answer =';
    if (uLower.includes('km') && uLower.includes('m')) return 'Distance =';
    // Open-ended / language questions — no label
    if (/\b(write|describe|explain|identify|correct|find the error|use.*word|sentence|passage|paragraph)\b/i.test(qLower)) return null;
    // Non-numeric answers (riddles, word-bank picks, vocabulary) aren't a math equation —
    // "=" reads oddly for a word answer, so use a plain colon label instead.
    const isNumericAnswer = /^-?\d+(\.\d+)?$/.test(String(q.answer || '').trim());
    if (q.type !== 'numeric' && !isNumericAnswer) return 'Answer:';
    return 'Answer =';
  }

  // Smart placeholder based on answer type/unit
  function smartPlaceholder(q, unit) {
    const uLower = (unit || '').toLowerCase();
    const ans = String(q.answer || '');
    if (uLower.includes('km') && uLower.includes('m') && !uLower.includes('²')) return 'e.g. 1 km 800 m';
    if (q.type === 'text' && ans.includes(',')) return 'e.g. ' + ans.split(',')[0].trim() + ', ...';
    if (uLower.includes('²')) return '? ' + unit;
    return '?';
  }

  // Bold key numbers/words in question text
  function fmtQuestion(text) {
    if (!text) return '';
    let s = String(text);
    // Bold numbers with units: "65 m", "450 m", "200 m", "40 cm", etc.
    s = s.replace(/(\d+(?:\.\d+)?)\s*(m²|cm²|km|m|cm|mm|kg|g|mg|kL|L|mL|tiles|degrees|rounds)\b/g, '<strong>$1 $2</strong>');
    // Bold key action words
    s = s.replace(/\b(four times|five rounds|three times|twice|double[sd]?)\b/gi, '<strong>$1</strong>');
    // Apply markdown bold
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    return s;
  }

  // Detect non-Latin/non-English scripts for language-specific input support
  const allText = (quiz.tasks || []).map(t =>
    `${t.title || ''} ${(t.questions || []).map(q => q.question || '').join(' ')}`
  ).join(' ');
  const hasTeluguScript = /[\u0C00-\u0C7F]/.test(allText);
  const hasDevanagari = /[\u0900-\u097F]/.test(allText);
  const hasFrenchChars = /[àâæçéèêëïîôùûüÿœÀÂÆÇÉÈÊËÏÎÔÙÛÜŸŒ]/.test(allText);
  const isFrench = hasFrenchChars || /french|fran[çc]ais/i.test(quiz.subject || '');
  const detectedLang = hasTeluguScript ? 'te' : hasDevanagari ? 'hi' : isFrench ? 'fr' : 'en';
  const inputLangAttr = detectedLang !== 'en' ? ` lang="${detectedLang}"` : '';
  const htmlLang = detectedLang;
  const isLanguageWorksheet = hasTeluguScript || hasDevanagari || isFrench ||
    /telugu|hindi|sanskrit|urdu|tamil|kannada|malayalam|bengali|marathi|gujarati|french|fran[çc]ais|spanish|espa[ñn]ol|german|deutsch/i.test(quiz.subject || '');

  let tasksHTML = '';
  let qNum = 0;
  const answersMap = {};

  // ── Helper: register a question in answersMap, return its qId ──
  function registerQuestion(q) {
    qNum++;
    const qId = `q${qNum}`;
    if (q.type === 'venn') {
      // openEnded: the worksheet asks the student to pick their OWN data to sort
      // (e.g. "choose any two times tables and sort their multiples") — there is
      // no single correct answer for the AI to compute, so grading against a
      // fixed "answers" set is impossible. Auto-accept once filled in, same
      // pattern as open-ended text questions above (a.open).
      answersMap[qId] = { venn: true, open: !!q.openEnded, answers: q.answers || { left: [], center: [], right: [] } };
      return qId;
    }
    // Missing-digit vertical arithmetic with a deterministic solve available
    // (see solveVerticalMath) gets its OWN grading path — dedicated per-blank
    // digit validation + an independent arithmetic cross-check — instead of
    // the generic single-text-box comparison every other type uses below.
    if (q.verticalMath && q.verticalMath.solvable) {
      answersMap[qId] = {
        vertMath: true,
        vmOperator: q.verticalMath.operator || '-',
        vmBlanks: q.verticalMath.blanks,
        vmTop: q.verticalMath.solvedTopStr,
        vmBottom: q.verticalMath.solvedBottomStr,
        vmResult: q.verticalMath.solvedResultStr,
        vmSteps: q.verticalMath.steps,
      };
      return qId;
    }
    const ansRaw = q.answer;
    const isActivity = q.type === 'activity' || (q.type === 'text' && /\b(draw|sketch|create|construct|design|colour|color|paste|cut)\b/i.test(q.question));
    const isFraction = typeof ansRaw === 'string' && /^\d+\/\d+$/.test(ansRaw);
    const ansIsNumber = typeof ansRaw === 'number' || (typeof ansRaw === 'string' && !isNaN(parseFloat(ansRaw)) && isFinite(ansRaw));
    const isNum = !isFraction && ansIsNumber;
    const isMcq = q.type === 'mcq' && Array.isArray(q.options);
    const hasDefinedAnswer = ansRaw !== undefined && ansRaw !== null && String(ansRaw).trim() !== '';
    // Open-ended (reflection/opinion) questions have NO single correct answer at all —
    // mirrors smartLabel()'s null-label condition. These are auto-accepted once attempted.
    const isOpenEnded = !hasDefinedAnswer && (q.type === 'long' ||
      /\b(write|describe|explain|identify|correct|find the error|use.*word|sentence|passage|paragraph)\b/i.test(q.question || ''));
    // Theory/short-factual answers DO have a definite correct answer, but it's multi-word
    // TEXT ("hockey and football") where a student's exact phrasing rarely matches a
    // strict string comparison. These get AI-tolerant grading instead of exact-match.
    // Requires at least 2 genuinely alphabetic words — a number, a number-with-unit
    // ("12 cm"), or a tally count must NEVER take this path; they have exactly one
    // right answer and belong on the fast exact-match check.
    const isTheory = typeof ansRaw === 'string' && !isNum && !isFraction && hasDefinedAnswer &&
      (() => {
        const tokens = ansRaw.trim().split(/\s+/);
        const alphaTokens = tokens.filter(t => /^[a-zA-Z][a-zA-Z''-]*$/.test(t));
        return tokens.length > 1 && alphaTokens.length >= 2;
      })();

    if (isMcq) {
      const correctIdx = (q.options || []).findIndex(o => o.correct);
      const correctLetter = correctIdx >= 0 ? String.fromCharCode(65 + correctIdx) : '';
      answersMap[qId] = { answer: ansRaw, isNum: false, mcq: true, correctLetter };
    } else if (isActivity) {
      answersMap[qId] = { answer: ansRaw, isNum: false, activity: true };
    } else {
      answersMap[qId] = { answer: ansRaw, isNum, range: q.acceptRange || null, open: isOpenEnded, theory: isTheory };
    }
    return qId;
  }

  // ── Helper: render a number pyramid as clean CSS boxes (redrawn, not the scanned image) ──
  function renderPyramid(pyramid) {
    const rows = pyramid.rows || [];
    const solved = pyramid.solved || rows;
    const BOX = 64, GAP = 4;
    let inner = '';
    const nRows = rows.length;
    rows.forEach((row, r) => {
      const rowW = row.length * BOX + (row.length - 1) * GAP;
      const totalW = nRows * BOX + (nRows - 1) * GAP;
      const rowLeft = (totalW - rowW) / 2;
      const top = r * BOX;
      row.forEach((cell, c) => {
        const left = rowLeft + c * (BOX + GAP);
        const given = cell !== null && cell !== undefined && String(cell).trim() !== '';
        const trueVal = (solved[r] && solved[r][c] !== undefined) ? solved[r][c] : cell;
        if (given) {
          inner += `<div style="position:absolute;left:${left}px;top:${top}px;width:${BOX}px;height:${BOX}px;border:1.5px solid rgba(195,220,216,0.4);border-radius:6px;background:rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#F0EEEC;box-sizing:border-box;">${fmt(String(cell))}</div>`;
        } else {
          const qId = registerQuestion({ type: 'numeric', answer: trueVal });
          inner += `<input type="text" id="${qId}-input" class="q-input"${inputLangAttr} placeholder="?"
            style="position:absolute;left:${left}px;top:${top}px;width:${BOX}px;height:${BOX}px;
            border:1.5px dashed rgba(195,220,216,0.5);border-radius:6px;background:rgba(255,255,255,0.06);
            color:#F0EEEC;font-size:14px;font-weight:700;text-align:center;box-sizing:border-box;font-family:inherit;">`;
          inner += `<button class="mini-check" title="Check this box" onclick="checkOneGroup('${qId}')"
            style="position:absolute;left:${left + BOX - 20}px;top:${top + BOX - 20}px;width:18px;height:18px;z-index:2;
            border-radius:50%;border:none;background:#4a9d6e;color:#0F0F0F;font-size:11px;font-weight:900;
            line-height:18px;padding:0;cursor:pointer;">&#10003;</button>`;
        }
      });
    });
    const totalW = nRows * BOX + (nRows - 1) * GAP;
    const totalH = nRows * BOX;
    return `<div style="display:inline-block;text-align:left;margin:6px 22px 18px 0;vertical-align:top;">
      ${pyramid.label ? `<div style="font-size:14px;font-weight:700;color:#C3DCD8;margin-bottom:6px;">${fmt(pyramid.label)}</div>` : ''}
      <div style="position:relative;width:${totalW}px;height:${totalH}px;">${inner}</div>
    </div>`;
  }

  // ── Helper: wrap a diagram render (pyramid/diagramFill/etc.) in the same bordered
  // dark "q-card" look used by the Venn diagram, so every diagram task feels consistent. ──
  function renderDiagramCard({ label, instructions, innerHtml }) {
    return `<div class="q-card">
      ${label ? `<p class="q-text"><strong>${fmt(label)}</strong></p>` : ''}
      ${instructions ? `<p style="font-size:12px;color:#A8B5B3;margin:2px 0 12px;">${fmt(instructions)}</p>` : ''}
      ${innerHtml}
    </div>`;
  }

  // ── Helper: render a fill-in table (registers each blank cell for scoring) ──
  // Render the traditional school tally convention: groups of 4 upright strokes with a
  // diagonal 5th stroke crossing them, then loose strokes for the remainder. Typing a
  // number into a "Tally marks" box (what this used to do) means nothing to a student —
  // tally marks are a drawn notation, not text — so instead of asking them to type it,
  // we DRAW the real thing here as a reference, and let the "Frequency" column (a genuine
  // typed number) be the actual thing being tested.
  function renderTallyMarks(n) {
    // Extraction sometimes returns the tally column's answer as literal pipe
    // characters (e.g. "|||" or "| | | |") instead of a plain count — parseInt
    // on that yields NaN and nothing ever rendered. Count the pipes as a
    // fallback rather than assuming the value is always a clean number.
    let count = parseInt(n, 10);
    if (isNaN(count) && typeof n === 'string') {
      const pipes = (n.match(/\|/g) || []).length;
      if (pipes > 0) count = pipes;
    }
    n = count;
    if (isNaN(n) || n < 0) return '';
    const groups = Math.floor(n / 5), rem = n % 5;
    const groupW = 34, totalW = Math.max(groups * groupW + rem * 7 + 10, 30);
    let svg = `<svg viewBox="0 0 ${totalW} 36" style="width:auto;height:32px;max-width:100%;">`;
    let x = 4;
    for (let g = 0; g < groups; g++) {
      for (let i = 0; i < 4; i++) svg += `<line x1="${x + i * 7}" y1="4" x2="${x + i * 7}" y2="30" stroke="#F0EEEC" stroke-width="2.2" stroke-linecap="round"></line>`;
      svg += `<line x1="${x - 2}" y1="30" x2="${x + 3 * 7 + 2}" y2="4" stroke="#C5BD96" stroke-width="2.4" stroke-linecap="round"></line>`;
      x += groupW;
    }
    for (let i = 0; i < rem; i++) svg += `<line x1="${x + i * 7}" y1="4" x2="${x + i * 7}" y2="30" stroke="#F0EEEC" stroke-width="2.2" stroke-linecap="round"></line>`;
    svg += `</svg>`;
    return svg;
  }

  function renderTaskTable(table) {
    let h = '<div class="ws-table-wrap" style="overflow-x:auto;margin:8px 0 14px;">';
    if (table.title) h += `<div style="font-weight:700;color:#C3DCD8;margin-bottom:8px;">${fmt(String(table.title))}</div>`;
    const tallyColIdx = Array.isArray(table.headers) ? table.headers.findIndex(x => /tally/i.test(String(x || ''))) : -1;
    // The Frequency column's answer is a plain verified number; the Tally column's
    // own extracted answer is a hand-drawn-pipe STRING that can disagree with it
    // (e.g. tally="| | | |" but frequency="6") — draw the tally marks from the
    // frequency count instead of trusting the separately-extracted tally string.
    const freqColIdx = Array.isArray(table.headers) ? table.headers.findIndex(x => /frequency/i.test(String(x || ''))) : -1;
    if (tallyColIdx >= 0) {
      h += `<div style="margin:0 0 10px;padding:10px 14px;background:rgba(197,189,150,0.10);border-left:3px solid #C5BD96;border-radius:6px;font-size:12.5px;color:#D8E8E6;line-height:1.6;">
        In your notebook you draw the tally marks yourself: one line for each item, and the 5th line crosses the first four. Here the computer has already drawn them for you in the Tally marks column — you just need to COUNT the lines (every crossed bundle = 5, plus any loose lines) and write that total number in the Frequency box.
      </div>`;
    }
    h += '<table style="width:100%;border-collapse:collapse;">';
    if (Array.isArray(table.headers) && table.headers.length) {
      h += '<tr>' + table.headers.map(x =>
        `<th style="border:1px solid rgba(195,220,216,0.28);padding:10px 12px;background:rgba(147,176,172,0.14);color:#D8E8E6;font-size:13px;font-weight:700;text-align:center;">${fmt(String(x))}</th>`
      ).join('') + '</tr>';
    }
    for (const row of (table.rows || [])) {
      h += '<tr>';
      (row || []).forEach((cell, ci) => {
        if (ci === tallyColIdx) {
          // Display-only: draw the real tally marks from the verified Frequency
          // count for this row when available (falls back to the tally cell's own
          // answer only if there's no Frequency column at all). Not a checkable
          // question — the Frequency column is where the student's understanding is tested,
          // so this cell must NOT be registered (an unregistered cell can't ever block
          // "answer every question" from reaching 100%).
          const freqAnswer = freqColIdx >= 0 ? (row[freqColIdx] && row[freqColIdx].answer) : undefined;
          h += `<td style="border:1px solid rgba(195,220,216,0.18);padding:8px 12px;text-align:center;">${renderTallyMarks(freqAnswer ?? (cell && cell.answer))}</td>`;
          return;
        }
        if (cell && cell.input) {
          const isNumAns = /^\d+(\.\d+)?$/.test(String(cell.answer || '').trim());
          const qId = registerQuestion({ type: cell._qtype || (isNumAns ? 'numeric' : 'text'), answer: cell.answer });
          const hintText = cell.hint || '';
          h += `<td style="border:1px solid rgba(195,220,216,0.18);padding:8px;text-align:center;">
            <div style="display:flex;flex-direction:column;gap:6px;align-items:center;">
              <div style="display:flex;gap:6px;align-items:center;justify-content:center;flex-wrap:wrap;">
                <input type="text" id="${qId}-input" class="q-input"${inputLangAttr} style="width:100px;padding:6px 8px;font-size:14px;" placeholder="?">
                <button class="btn-check" style="padding:6px 12px;font-size:12px;" onclick="checkAnswer('${qId}')">Check</button>
                ${hintText ? `<button class="btn-hint" style="padding:6px 10px;font-size:12px;" onclick="toggleHint('${qId}')">Hint</button>` : ''}
              </div>
              ${hintText ? `<div id="${qId}-hint" class="hint-box" style="display:none;width:100%;box-sizing:border-box;margin-top:0;">${fmt(hintText)}</div>` : ''}
              <div id="${qId}-result" class="result-box"></div>
              <div id="${qId}-solution" class="solution-box" style="display:none;width:100%;box-sizing:border-box;margin-top:0;font-size:12px;padding:10px 12px;"><strong>&#9989; Solution</strong><br>${fmt(String(cell.answer ?? ''))}</div>
              <button id="${qId}-show" class="btn-show" style="display:none;font-size:11px;padding:4px 10px;" onclick="toggleSolution('${qId}')">Show Answer</button>
            </div>
          </td>`;
        } else {
          h += `<td style="border:1px solid rgba(195,220,216,0.18);padding:8px 12px;text-align:center;color:#F0EEEC;font-size:13px;">${fmt(String((cell && cell.text) || ''))}</td>`;
        }
      });
      h += '</tr>';
    }
    h += '</table>';
    h += '</div>';
    return h;
  }

  // ── Helper: render a match-the-following task as drag & drop (word chips → picture slots) ──
  function renderMatchingTask(task) {
    const questions = task.questions || [];
    const matchQs = questions.filter(q => q.type === 'mcq' && Array.isArray(q.options) && q.options.length >= 2);
    const rest = questions.filter(q => !matchQs.includes(q));
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

    const qIds = matchQs.map(q => registerQuestion(q));
    const bankId = `${qIds[0]}-bank`;

    // Bank chips shuffled deterministically so their order never mirrors the picture order
    const bankWords = (task._wordBank && task._wordBank.length)
      ? task._wordBank.slice()
      : [...new Set(matchQs.map(q => String(q.answer ?? '').trim()).filter(Boolean))];
    let s = (bankWords.length * 2246822519 + qIds.length * 40503) >>> 0;
    for (let i = bankWords.length - 1; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const j = s % (i + 1);
      [bankWords[i], bankWords[j]] = [bankWords[j], bankWords[i]];
    }

    let h = `<p style="font-size:13px;color:#A8B5B3;margin:0 0 10px;">Drag each word onto its matching picture &mdash; or tap a word, then tap a picture&rsquo;s box.</p>`;
    h += `<div class="match-bank" id="${bankId}">` + bankWords.map(w =>
      `<span class="match-chip" draggable="true" data-word="${esc(w)}" data-bank="${bankId}" ondragstart="mDragStart(event)" onclick="mChipClick(this)">${fmt(w)}</span>`).join('') + `</div>`;

    h += `<div class="match-grid">`;
    matchQs.forEach((q, i) => {
      const qId = qIds[i];
      h += `<div class="match-card" id="${qId}-card">`;
      if (q.id) h += `<div class="match-card-label">${esc(q.id)})</div>`;
      if (q.imageUrl) {
        h += `<div class="match-img"><img src="${embedImage(q.imageUrl)}" alt="${esc(q.diagramDescription || 'Picture to match')}"></div>`;
      } else {
        // No cropped picture — fall back to the question text as the thing to match
        h += `<div class="match-img match-img-text">${fmt(q.question || '')}</div>`;
      }
      h += `<div class="match-slot" id="${qId}-slot" ondragover="event.preventDefault()" ondrop="mDrop(event,'${qId}-slot')" onclick="mSlotClick(this)"><span class="match-slot-ph">Drop word here</span></div>`;
      h += `<div style="display:flex;gap:6px;align-items:center;justify-content:center;margin-top:6px;flex-wrap:wrap;">
        <button class="btn-check" style="padding:6px 12px;font-size:12px;" onclick="checkOneMatch('${qId}')">Check</button>
        ${q.hint ? `<button class="btn-hint" style="padding:6px 10px;font-size:12px;" onclick="toggleHint('${qId}')">Hint</button>` : ''}
      </div>`;
      if (q.hint) h += `<div id="${qId}-hint" class="hint-box" style="display:none;font-size:12px;">${fmt(q.hint)}</div>`;
      h += `<div id="${qId}-result" class="lang-result"></div>`;
      h += `<div id="${qId}-solution" class="solution-box" style="display:none;font-size:12px;"><strong>&#9989;</strong> ${fmt(String(q.answer ?? ''))}</div>`;
      h += `<button id="${qId}-show" class="btn-show" style="display:none;font-size:11px;" onclick="toggleSolution('${qId}')">Show Answer</button>`;
      h += `</div>`;
    });
    h += `</div>`;

    // Any non-matching questions in the same task render normally below
    for (const q of rest) {
      const qId = registerQuestion(q);
      h += renderQuestionCell(q, qId, false);
    }
    return h;
  }

  // ── Helper: render a single question cell (for table or card layout) ──
  function renderQuestionCell(q, qId, isTableCell = false) {
    // ── VENN DIAGRAM: interactive two-circle diagram with three fillable regions ──
    if (q.type === 'venn') {
      const leftLabel = q.leftLabel || 'Group A';
      const rightLabel = q.rightLabel || 'Group B';
      const baseTaStyle = 'position:absolute;box-sizing:border-box;resize:none;border:1.5px dashed rgba(195,220,216,0.5);border-radius:8px;background:rgba(255,255,255,0.06);color:#F0EEEC;font-size:13px;font-family:inherit;padding:6px 8px;text-align:center;';
      const ta = (rid, ph, pos) =>
        `<textarea id="${qId}-${rid}" class="venn-input" placeholder="${ph}" style="${baseTaStyle}${pos}"></textarea>`;
      const solutionText = (q.solution || '').replace(/\. /g, '.<br>');
      return `<div class="q-card" id="${qId}-card">
        <p class="q-text"><strong>${q.id ? q.id + ')' : 'Q' + qNum + '.'}</strong> ${fmtQuestion(q.question)}</p>
        <p style="font-size:12px;color:#A8B5B3;margin:2px 0 0;">Type items separated by commas — shared items go in the middle.</p>
        <div class="venn-wrap" style="position:relative;width:100%;max-width:580px;height:340px;margin:12px auto 8px;">
          <svg viewBox="0 0 580 340" style="position:absolute;inset:0;width:100%;height:100%;">
            <ellipse cx="210" cy="185" rx="165" ry="140" fill="rgba(147,176,172,0.12)" stroke="#93B0AC" stroke-width="2.5"></ellipse>
            <ellipse cx="370" cy="185" rx="165" ry="140" fill="rgba(197,189,150,0.12)" stroke="#C5BD96" stroke-width="2.5"></ellipse>
            <text x="150" y="34" text-anchor="middle" fill="#93B0AC" font-size="17" font-weight="700" font-family="Arial">${leftLabel}</text>
            <text x="430" y="34" text-anchor="middle" fill="#C5BD96" font-size="17" font-weight="700" font-family="Arial">${rightLabel}</text>
          </svg>
          ${ta('left', leftLabel + ' only', 'left:2%;top:34%;width:26%;height:120px;')}
          ${ta('center', 'Both', 'left:38%;top:40%;width:24%;height:110px;')}
          ${ta('right', rightLabel + ' only', 'right:2%;top:34%;width:26%;height:120px;')}
        </div>
        <div class="q-actions" style="display:flex;gap:10px;margin-top:10px;">
          <button class="btn-check" onclick="checkVenn('${qId}')">Check</button>
          <button class="btn-hint" onclick="toggleHint('${qId}')">Hint</button>
        </div>
        <div id="${qId}-hint" class="hint-box" style="display:none">${fmt(q.hint || '')}</div>
        <div id="${qId}-result" class="result-box"></div>
        <div id="${qId}-solution" class="solution-box" style="display:none"><strong>&#9989; Solution</strong><br>${fmt(solutionText)}</div>
        <button id="${qId}-show" class="btn-show" style="display:none" onclick="toggleSolution('${qId}')">Show Answer</button>
      </div>`;
    }
    const qLabel = q.id && /^[a-z0-9]/i.test(q.id) && q.id.length <= 3 ? `${q.id})` : `Q${qNum}.`;
    const skipUnits = ['comparison', 'symbol', 'n/a', 'none', 'fraction', 'text', 'yes/no', 'explanation', 'activity'];
    const displayUnit = q.unit && !skipUnits.includes((q.unit || '').toLowerCase()) ? q.unit : '';
    const isActivity = q.type === 'activity' || (q.type === 'text' && /\b(draw|sketch|create|construct|design|colour|color|paste|cut)\b/i.test(q.question));
    const isMcq = q.type === 'mcq' && Array.isArray(q.options);

    // Extract the "blank" part from the question: "4 kg = ___ gm" → show "4 kg =" with input and "gm"
    const questionText = (q.question || '').replace(/___+/g, '').replace(/=\s*$/, '=').trim();

    let html = '';

    if (isTableCell) {
      // Worksheet-style table cell: compact, inline input
      html += `<div class="ws-cell" id="${qId}-card" style="padding:10px 14px;border-bottom:1px solid rgba(195,220,216,0.15);display:flex;flex-direction:column;align-items:flex-start;gap:8px;">`;
      html += `<span style="font-size:14px;color:#F0EEEC;"><strong style="color:#C3DCD8">${qLabel}</strong> ${fmtQuestion(questionText)}</span>`;

      if (q.imageUrl && !q._sharedImage) {
        html += `<div class="q-image" style="margin:4px 0 8px;align-self:center;"><img src="${embedImage(q.imageUrl)}" alt="${q.diagramDescription || 'Diagram'}" style="max-width:240px;max-height:200px;border-radius:6px;border:1px solid rgba(195,220,216,0.2);background:#fff;padding:6px;"></div>`;
      }

      html += `<div style="display:flex;align-items:center;gap:8px;width:100%;flex-wrap:wrap;">`;
      if (!isActivity && !isMcq) {
        html += `<input type="text" id="${qId}-input" class="q-input"${inputLangAttr} style="width:90px;padding:6px 8px;font-size:14px;" placeholder="?">`;
        if (displayUnit) html += `<span style="font-size:13px;color:#A8B5B3;">${displayUnit}</span>`;
        html += `<button class="btn-check" style="padding:6px 14px;font-size:12px;" onclick="checkAnswer('${qId}')">&#10003;</button>`;
        if (q.hint) html += `<button class="btn-hint" style="padding:6px 14px;font-size:12px;" onclick="toggleHint('${qId}')">Hint</button>`;
      } else if (isMcq) {
        html += `<div style="display:flex;gap:6px;flex-wrap:wrap;">`;
        html += q.options.map((opt, i) => {
          const letter = String.fromCharCode(65 + i);
          const label = typeof opt === 'string' ? opt : (opt.label || opt);
          return `<label style="font-size:13px;color:#F0EEEC;cursor:pointer;padding:4px 8px;border:1px solid rgba(195,220,216,0.2);border-radius:4px;"><input type="radio" name="${qId}" value="${letter}" style="margin-right:4px;"> ${label}</label>`;
        }).join('');
        html += `</div><button class="btn-check" style="padding:6px 14px;font-size:12px;" onclick="checkMCQ('${qId}')">&#10003;</button>`;
      } else {
        html += `<button class="btn-show" style="display:inline-block;padding:6px 14px;font-size:12px;" onclick="toggleSolution('${qId}'); if(!done.has('${qId}')){sc++;done.add('${qId}');} attempted.add('${qId}'); up();">Show</button>`;
      }
      html += `</div></div>`;
      // Feedback row (hidden by default, spans full width)
      const solutionText = (q.solution || '').replace(/Step (\d)/g, '<br>Step $1').replace(/Answer:/g, '<br><strong>Answer:</strong>');
      html += `<div id="${qId}-hint" class="hint-box" style="display:none;margin:0 14px;font-size:13px;">${fmt(q.hint || '')}</div>`;
      html += `<div id="${qId}-result" class="result-box" style="margin:0 14px;"></div>`;
      html += `<div id="${qId}-solution" class="solution-box" style="display:none;margin:0 14px;font-size:13px;"><strong>&#9989;</strong> ${fmt(solutionText)}</div>`;
      html += `<button id="${qId}-show" class="btn-show" style="display:none;margin:4px 14px;font-size:11px;" onclick="toggleSolution('${qId}')">Show Answer</button>`;
    } else if (isLanguageWorksheet) {
      // ── Language worksheet layout: clean, document-like ──
      // Mimics original worksheet: sentence + dotted-line answer fields, no "Answer ="
      html += `<div class="lang-q-row" id="${qId}-card">`;
      html += `<div class="lang-q-left">`;
      html += `<span class="lang-q-num">(${q.id || qNum})</span>`;
      html += `<span class="lang-q-text">${fmtQuestion(q.question)}</span>`;
      html += `</div>`;

      // This branch never rendered q.imageUrl at all — a picture-matching language
      // task (e.g. "match the picture to the Telugu word") would silently drop its
      // image even though it was correctly attached to the question data. The
      // math/science branch below already does this; language worksheets need it too.
      if (q.imageUrl && !q._sharedImage) {
        html += `<div class="q-image" style="margin:6px 0 10px 38px;text-align:left"><img src="${embedImage(q.imageUrl)}" alt="${q.diagramDescription || 'Worksheet picture'}" style="max-width:200px;border-radius:8px;border:1px solid rgba(195,220,216,0.2);background:#fff;padding:6px;"></div>`;
      }

      if (q.example) {
        html += `<div class="lang-example">${fmt(q.example)}</div>`;
      }

      if (isMcq) {
        html += `<div class="lang-mcq-opts">`;
        html += q.options.map((opt, i) => {
          const letter = String.fromCharCode(65 + i);
          const label = typeof opt === 'string' ? opt : (opt.label || opt);
          return `<label class="lang-mcq-opt"><input type="radio" name="${qId}" value="${letter}"> ${fmt(label)}</label>`;
        }).join('');
        html += `<button class="lang-btn-check" onclick="checkMCQ('${qId}')">&#10003;</button>`;
        html += `</div>`;
      } else {
        // Language worksheets: ALWAYS show input field (even for activities/riddles)
        html += `<div class="lang-q-answer">`;
        html += `<input type="text" id="${qId}-input" class="lang-input"${inputLangAttr} placeholder="">`;
        html += `<div class="lang-q-actions">`;
        html += `<button class="lang-btn-check" onclick="checkAnswer('${qId}')">&#10003;</button>`;
        if (q.hint) html += `<button class="lang-btn-hint" onclick="toggleHint('${qId}')">?</button>`;
        html += `</div></div>`;
      }

      const solutionText = (q.solution || '').replace(/Answer:/g, '<br><strong>Answer:</strong>');
      html += `
        <div id="${qId}-hint" class="hint-box" style="display:none;margin:4px 0 4px 36px;font-size:13px;">${fmt(q.hint || '')}</div>
        <div id="${qId}-result" class="lang-result"></div>
        <div id="${qId}-solution" class="solution-box" style="display:none;margin:4px 0 4px 36px;font-size:13px;"><strong>&#9989;</strong> ${fmt(solutionText)}</div>
        <button id="${qId}-show" class="btn-show" style="display:none;margin:4px 36px;font-size:11px;" onclick="toggleSolution('${qId}')">Show Answer</button>
      </div>`;
    } else {
      // Card layout (existing style — math/science)
      html += `<div class="q-card" id="${qId}-card">
        <p class="q-text"><strong>${qLabel}</strong> ${fmtQuestion(q.question)}</p>`;

      // Show example if present
      if (q.example) {
        html += `<div style="margin:8px 0 12px;padding:10px 14px;background:rgba(195,220,216,0.07);border-left:3px solid rgba(195,220,216,0.4);border-radius:0 8px 8px 0;font-size:13px;color:#A8B5B3;font-style:italic;">${fmt(q.example)}</div>`;
      }

      // Vertical column arithmetic (e.g. "96_ - _83 ----- 162"): render as the
      // student would actually see it on the worksheet — a right-aligned digit
      // stack with the operator and a rule line — instead of flat run-on text
      // like "Calculate the missing digits: 9 6 _ - _ 8 3 ----- 1 6 2", which
      // students couldn't parse.
      // When solveVerticalMath() found a deterministic answer, blank cells
      // become individual single-digit <input> boxes (dedicated grading path,
      // see checkVerticalMath below) instead of just a static dash.
      const isVertMathSolvable = q.verticalMath && q.verticalMath.solvable;
      if (q.verticalMath && q.verticalMath.top && q.verticalMath.bottom) {
        const vm = q.verticalMath;
        const digitCell = (d, row, idx) => {
          const blank = d === '_' || d === '' || d == null;
          if (blank && isVertMathSolvable) {
            return `<input type="text" maxlength="1" inputmode="numeric" id="${qId}-vmb-${row}-${idx}" data-vm-row="${row}" data-vm-idx="${idx}" style="display:inline-block;width:1.1em;height:1.2em;text-align:center;font:inherit;color:inherit;background:rgba(197,189,150,0.12);border:none;border-bottom:2px solid #C5BD96;padding:0;">`;
          }
          return `<span style="display:inline-block;min-width:1.3em;text-align:center;${blank ? 'border-bottom:2px solid #C5BD96;color:#C5BD96;' : ''}">${blank ? '&nbsp;' : fmt(String(d))}</span>`;
        };
        const digitsRow = (s, row) => String(s).split('').map((d, idx) => digitCell(d, row, idx)).join('');
        const opSpacer = `<span style="display:inline-block;min-width:1.3em;text-align:center;">&nbsp;</span>`;
        const opCell = `<span style="display:inline-block;min-width:1.3em;text-align:center;color:#93B0AC;">${fmt(vm.operator || '-')}</span>`;
        html += `<div id="${qId}-vm-display" style="margin:4px 0 16px;font-family:'Courier New',monospace;font-size:22px;font-weight:700;color:#F0EEEC;display:inline-block;text-align:right;line-height:1.5;">
          <div>${opSpacer}${digitsRow(vm.top, 'top')}</div>
          <div>${opCell}${digitsRow(vm.bottom, 'bottom')}</div>
          <div style="border-top:2px solid #93B0AC;margin:2px 0;"></div>
          <div>${vm.result ? `${opSpacer}${digitsRow(vm.result, 'result')}` : ''}</div>
        </div>
        <div id="${qId}-vm-corrected" style="display:none;margin:4px 0 16px;font-family:'Courier New',monospace;font-size:22px;font-weight:700;color:#F0EEEC;text-align:right;line-height:1.5;"></div>`;
      }

      if (q.imageUrl && !q._sharedImage) {
        html += `<div class="q-image" style="margin:0 0 14px;text-align:center"><img src="${embedImage(q.imageUrl)}" alt="${q.diagramDescription || 'Worksheet diagram'}" style="max-width:320px;border-radius:8px;border:1px solid rgba(195,220,216,0.2);background:#fff;padding:8px;"></div>`;
      }

      if (isActivity) {
        html += `
        <div class="activity-box" style="margin:12px 0;padding:18px 20px;background:linear-gradient(135deg,rgba(147,176,172,0.08),rgba(197,189,150,0.08));border-radius:12px;border:1px solid rgba(147,176,172,0.25)">
          <p style="font-size:13px;color:#A8B5B3;margin:0 0 12px;line-height:1.5">This is a hands-on activity. Try it on paper!</p>
        </div>
        <div class="q-actions" style="display:flex;gap:10px;margin-top:10px">
          <button class="btn-show" style="display:inline-block" onclick="toggleSolution('${qId}'); if(!done.has('${qId}')){sc++;done.add('${qId}');} attempted.add('${qId}'); up();">Show Answer</button>
          ${q.hint ? `<button class="btn-hint" onclick="toggleHint('${qId}')">Hint</button>` : ''}
        </div>`;
      } else if (isVertMathSolvable) {
        // Dedicated validator (checkVerticalMath below) — reads the per-blank
        // digit inputs rendered above, not a single generic text box.
        html += `
        <div class="q-actions" style="display:flex;gap:10px;margin-top:10px">
          <button class="btn-check" onclick="checkVerticalMath('${qId}')">Check</button>
          ${q.hint ? `<button class="btn-hint" onclick="toggleHint('${qId}')">Hint</button>` : ''}
        </div>`;
      } else if (isMcq) {
        html += q.options.map((opt, i) => {
          const letter = String.fromCharCode(65 + i);
          const label = typeof opt === 'string' ? opt : (opt.label || opt);
          return `<label class="mcq-opt"><input type="radio" name="${qId}" value="${letter}"> ${fmt(label)}</label>`;
        }).join('');
        html += `
        <div class="q-actions" style="display:flex;gap:10px;margin-top:10px">
          <button class="btn-check" onclick="checkMCQ('${qId}')">Check</button>
          ${q.hint ? `<button class="btn-hint" onclick="toggleHint('${qId}')">Hint</button>` : ''}
        </div>`;
      } else {
        const labelText = smartLabel(q, displayUnit);
        const placeholder = smartPlaceholder(q, displayUnit);
        const isLong = q.type === 'long' || labelText === null;
        if (isLong) {
          html += `
        <div class="q-input-row" style="flex-direction:column;align-items:stretch;gap:10px;">
          <textarea id="${qId}-input" class="q-input"${inputLangAttr} rows="3" placeholder="Write your answer here..." style="width:100%;min-height:80px;resize:vertical;font-size:14px;padding:10px;border-radius:8px;border:1.5px solid rgba(195,220,216,0.3);background:rgba(255,255,255,0.05);color:#F0EEEC;font-family:inherit;"></textarea>
          <div style="display:flex;gap:10px;">
            <button class="btn-check" onclick="checkAnswer('${qId}')">Check</button>
            ${q.hint ? `<button class="btn-hint" onclick="toggleHint('${qId}')">Hint</button>` : ''}
          </div>
        </div>`;
        } else {
          html += `
        <div class="q-input-row">
          <span class="q-label">${labelText}</span>
          <input type="text" id="${qId}-input" class="q-input"${inputLangAttr} placeholder="${placeholder}">
          ${displayUnit ? `<span class="q-unit">${displayUnit}</span>` : ''}
          <button class="btn-check" onclick="checkAnswer('${qId}')">Check</button>
          ${q.hint ? `<button class="btn-hint" onclick="toggleHint('${qId}')">Hint</button>` : ''}
        </div>`;
        }
      }

      const solutionText = (q.solution || '').replace(/Step (\d)/g, '<br>Step $1').replace(/Answer:/g, '<br><strong>Answer:</strong>').replace(/(\d+(?:\.\d+)?)\s*(m²|cm²|km|m|cm|mm|tiles)/g, '<strong>$1 $2</strong>');
      html += `
        <div id="${qId}-hint" class="hint-box" style="display:none">${fmt(q.hint || '')}</div>
        <div id="${qId}-result" class="result-box"></div>
        <div id="${qId}-solution" class="solution-box" style="display:none">
          <strong>&#9989; Solution</strong><br>${fmt(solutionText)}
          ${q.acceptRange ? `<br><span style="font-size:12px;color:#666">(any answer ${q.acceptRange[0]}–${q.acceptRange[1]} is accepted)</span>` : ''}
        </div>
        <button id="${qId}-show" class="btn-show" style="display:none" onclick="toggleSolution('${qId}')">Show Answer</button>
      </div>`;
    }

    return html;
  }

  for (const task of (quiz.tasks || [])) {
    // Case-insensitive match: the prompt now preserves the worksheet's own
    // casing verbatim ("Must Do", not forced to "MUST DO"), so the lookup
    // must normalize before matching — otherwise the three common tiers
    // would ALSO wrongly fall through to the neutral style, breaking the
    // exact worksheets this styling was originally built for. The BADGE
    // TEXT still uses task.tier's original casing below, unchanged.
    const s = tierStyles[(task.tier || '').toUpperCase()] || tierStyles['DEFAULT'];
    const taskTitle = (task.title || '').replace(/^(Task\s*\d+)\s*[:\.]\s*/i, '$1 &middot; ').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const layout = task.layout || { type: 'single-column', columns: 1 };
    const questions = task.questions || [];

    tasksHTML += `
    <div class="task-block" style="border-left:5px solid ${s.border}; background:${s.bg}; border-radius:12px; padding:20px 24px; margin:28px 0;">
      ${task.tier ? `<span class="tier-badge" style="display:inline-block;background:${s.labelBg};color:${s.label};font-weight:800;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;padding:4px 12px;border-radius:4px;margin-bottom:6px;">${task.tier}</span>` : ''}
      <h2 style="font-size:18px;color:${s.label};margin:6px 0 18px;font-weight:700;">${taskTitle}</h2>
      ${task.passage ? `<div style="margin:0 0 20px;padding:16px 20px;background:rgba(255,255,255,0.04);border:1px solid rgba(195,220,216,0.2);border-radius:10px;font-size:14px;color:#D8E8E6;line-height:1.8;">${fmt(task.passage)}</div>` : ''}`;

    // ── MATCH-THE-FOLLOWING: drag & drop words onto pictures (replaces per-question rendering) ──
    if (task._matchTask) {
      tasksHTML += renderMatchingTask(task);
      tasksHTML += `</div>`;
      continue;
    }

    // ── BAR GRAPH / CHART: render structured chart as inline SVG (all questions refer to it) ──
    if (task.chart && Array.isArray(task.chart.bars) && task.chart.bars.length) {
      tasksHTML += renderBarChart(task.chart);
    }

    // ── NUMBER PYRAMIDS: redrawn as clean CSS boxes (not the scanned image), wrapped in
    //    the same bordered q-card look as the Venn diagram for visual consistency. ──
    if (Array.isArray(task.pyramids) && task.pyramids.length) {
      const pyramidsHtml = task.pyramids.map(p => renderPyramid(p)).join('');
      tasksHTML += renderDiagramCard({
        instructions: 'Fill in each blank, then tap its check mark — every pair of adjacent blocks sums to the block above it.',
        innerHtml: `<div>${pyramidsHtml}</div>`
      });
    }

    // ── DIAGRAM-FILL OVERLAY: worksheet image + input fields placed directly on each
    //    detected blank (pyramid blocks, clock cells, number-line ticks, labeled figures —
    //    ANY diagram, without a bespoke renderer per shape). The image never changes; only
    //    the inputs are positioned by percentage, so it's responsive. ──
    if (task.diagramFillBlanks && task.diagramFillBlanks.length && task.diagramFillImageUrl) {
      const dfIds = task.diagramFillBlanks.map(b => registerQuestion({ type: /^-?\d+(\.\d+)?$/.test(String(b.answer).trim()) ? 'numeric' : 'text', answer: b.answer }));
      const inputsHtml = task.diagramFillBlanks.map((b, i) => {
        const left = (b.x * 100).toFixed(2), top = (b.y * 100).toFixed(2);
        const w = (b.w * 100).toFixed(2), h = (b.h * 100).toFixed(2);
        return `<input type="text" id="${dfIds[i]}-input" class="q-input df-input"${inputLangAttr}
          style="position:absolute;left:${left}%;top:${top}%;width:${w}%;height:${h}%;box-sizing:border-box;
          padding:2px 4px;font-size:13px;text-align:center;border:1.5px dashed rgba(195,220,216,0.5);
          border-radius:6px;background:rgba(28,28,28,0.82);color:#F0EEEC;font-weight:700;font-family:inherit;">`
          + `<button class="mini-check" title="Check this box" onclick="checkOneGroup('${dfIds[i]}')"
          style="position:absolute;left:calc(${left}% + ${w}% - 16px);top:calc(${top}% + ${h}% - 16px);width:16px;height:16px;z-index:2;
          border-radius:50%;border:none;background:#4a9d6e;color:#0F0F0F;font-size:10px;font-weight:900;
          line-height:16px;padding:0;cursor:pointer;">&#10003;</button>`;
      }).join('');
      tasksHTML += renderDiagramCard({
        instructions: 'Write your answers directly on the diagram below, then tap each check mark.',
        innerHtml: `<div class="diagram-fill-wrap" style="position:relative;display:inline-block;max-width:100%;background:#fff;border-radius:8px;border:1px solid rgba(195,220,216,0.2);padding:10px;">
          <img src="${embedImage(task.diagramFillImageUrl)}" alt="${task.sharedImageDescription || 'Worksheet diagram'}" style="display:block;max-width:100%;height:auto;border-radius:4px;">
          ${inputsHtml}
        </div>`
      });
    } else
    // ── SHARED IMAGE: show one diagram for the entire task (all questions reference it) ──
    if (task.sharedImage) {
      // Only ever show a real cropped diagram (questions[0].imageUrl) — never task.pageImageUrl,
      // which is the entire scanned worksheet page (other tasks, header info, etc.). Showing the
      // whole page instead of the specific diagram is confusing and wrong for every worksheet,
      // not just this one — if no crop was extracted, fall through to the text-description path.
      const sharedUrl = questions[0] && questions[0].imageUrl;
      if (sharedUrl) {
        tasksHTML += `<div style="text-align:center;margin:0 0 16px;"><img src="${embedImage(sharedUrl)}" alt="${task.sharedImageDescription || 'Worksheet diagram'}" style="max-width:320px;max-height:300px;border-radius:8px;border:1px solid rgba(195,220,216,0.2);background:#fff;padding:8px;"></div>`;
      } else if (task.sharedImageDescription) {
        // Fallback: render branching/tree diagrams as HTML when image extraction missed them
        const desc = task.sharedImageDescription || '';
        let trees = [];

        // If description mentions "branch", try to build tree from QUESTION DATA
        // (more reliable than parsing LLM descriptions which vary each time)
        if (/branch/i.test(desc) && questions.length >= 2) {
          // Strategy 1: Group by question ID (e.g., id="మీద" → root from question text first word)
          // In Telugu worksheets: question="చెట్టు మీద __", id="మీద" → root="చెట్టు", branch="మీద"
          const rootMapFromQ = {};
          for (const q of questions) {
            const qText = String(q.question || '').trim();
            const qId = String(q.id || '').trim();
            // Try extracting root as first word of question text
            const firstWord = qText.split(/\s+/)[0];
            const secondWord = qText.split(/\s+/)[1] || '';
            if (firstWord && secondWord && qId) {
              if (!rootMapFromQ[firstWord]) rootMapFromQ[firstWord] = [];
              // Use id as branch label (cleaner), avoid duplicates
              if (!rootMapFromQ[firstWord].includes(qId)) {
                rootMapFromQ[firstWord].push(qId);
              }
            }
          }
          const rootsFromQ = Object.keys(rootMapFromQ).filter(r => rootMapFromQ[r].length >= 1);
          if (rootsFromQ.length >= 2 || (rootsFromQ.length === 1 && rootMapFromQ[rootsFromQ[0]].length >= 2)) {
            trees = rootsFromQ.map(r => ({ root: r, branches: rootMapFromQ[r] }));
          }

          // Strategy 2: Group by answer — each unique answer is a tree root
          if (trees.length === 0) {
            const rootMap = {};
            for (const q of questions) {
              const ans = String(q.answer || '').trim();
              const qText = String(q.question || q.id || '').trim();
              if (ans && qText && ans !== qText) {
                if (!rootMap[ans]) rootMap[ans] = [];
                rootMap[ans].push(qText);
              }
            }
            const roots = Object.keys(rootMap).filter(r => rootMap[r].length >= 1);
            if (roots.length >= 2 || (roots.length === 1 && rootMap[roots[0]].length >= 2)) {
              trees = roots.map(r => ({ root: r, branches: rootMap[r] }));
            }
          }
        }

        // Fallback: try regex patterns on the description text
        if (trees.length === 0) {
          let bm;
          // Pattern A: "'చెట్టు' branching to 'మీద' and 'కింద'"
          const patA = /[''']([^''']+)[''']\s*branch(?:ing|es)?\s*to\s*[''']([^''']+)['''](?:\s*(?:and|,)\s*[''']([^''']+)['''])?/gi;
          while ((bm = patA.exec(desc)) !== null) {
            trees.push({ root: bm[1], branches: [bm[2], bm[3]].filter(Boolean) });
          }
          // Pattern B: "'మీద' and 'కింద' branch from 'చెట్టు'"
          if (trees.length === 0) {
            const patB = /[''']([^''']+)['''](?:\s*(?:and|,)\s*[''']([^''']+)['''])?\s*branch(?:es)?\s*from\s*[''']([^''']+)[''']/gi;
            while ((bm = patB.exec(desc)) !== null) {
              trees.push({ root: bm[3], branches: [bm[1], bm[2]].filter(Boolean) });
            }
          }
          // Pattern C: "'చెట్టు' with branches labeled 'మీద' and 'కింద'"
          if (trees.length === 0) {
            const patC = /[''']([^''']+)[''']\s*(?:\([^)]*\)\s*)?with\s*branches?\s*(?:labeled\s*)?[''']([^''']+)['''](?:\s*(?:\([^)]*\)\s*)?(?:and|,)\s*[''']([^''']+)['''])?/gi;
            while ((bm = patC.exec(desc)) !== null) {
              trees.push({ root: bm[1], branches: [bm[2], bm[3]].filter(Boolean) });
            }
          }
        }
        if (trees.length > 0) {
          tasksHTML += `<div class="branch-diagram" style="display:flex;gap:40px;justify-content:center;margin:16px 0 20px;flex-wrap:wrap;">`;
          for (const tree of trees) {
            tasksHTML += `<div class="branch-tree" style="display:flex;align-items:center;gap:12px;">`;
            tasksHTML += `<span style="font-size:17px;font-weight:700;color:#C3DCD8;">${tree.root}</span>`;
            tasksHTML += `<div style="display:flex;flex-direction:column;gap:0;position:relative;">`;
            // Draw bracket/brace
            tasksHTML += `<div style="position:absolute;left:-8px;top:4px;bottom:4px;width:8px;border-left:2px solid #93B0AC;border-top:2px solid #93B0AC;border-bottom:2px solid #93B0AC;border-radius:4px 0 0 4px;"></div>`;
            for (const b of tree.branches) {
              const branchQId = `branch_${qNum}_${b.replace(/\s/g,'')}`;
              tasksHTML += `<div style="padding:6px 0 6px 12px;font-size:15px;color:#F0EEEC;display:flex;align-items:center;gap:8px;">${b} <input type="text" class="lang-input"${inputLangAttr} style="flex:1;max-width:200px;" placeholder=""></div>`;
            }
            tasksHTML += `</div></div>`;
          }
          tasksHTML += `</div>`;
        } else {
          // Generic fallback: show description as a styled note
          tasksHTML += `<div style="margin:0 0 16px;padding:12px 16px;background:rgba(195,220,216,0.06);border:1px dashed rgba(195,220,216,0.25);border-radius:8px;font-size:13px;color:#A8B5B3;text-align:center;font-style:italic;">📐 ${fmt(desc)}</div>`;
        }
      }
    }

    // ── Missing-crop fallback: never dump the raw scanned worksheet page here — it contains
    // every other task, headers, and unrelated content on that page, not just this diagram.
    // (This was the exact bug: a question flagged hasImage with no extracted crop was falling
    // back to task.pageImageUrl, the full page.) Show a plain note instead, for every worksheet.
    const anyQuestionNeedsImage = questions.some(q => q.hasImage && !q.imageUrl);
    if (anyQuestionNeedsImage && task.pageImageUrl) {
      tasksHTML += `<div style="margin:0 0 16px;padding:10px 14px;background:rgba(195,220,216,0.06);border:1px dashed rgba(195,220,216,0.25);border-radius:8px;font-size:12px;color:#A8B5B3;">Diagram for this task could not be auto-cropped from the worksheet.</div>`;
    }

    // ── TABLES (one or more per task: data grids + fill-in tally/frequency) ──
    const taskTables = (Array.isArray(task.tables) && task.tables.length)
      ? task.tables
      : (task.table && Array.isArray(task.table.rows) && task.table.rows.length ? [task.table] : []);
    const hasInputTable = taskTables.some(t => (t.rows || []).some(r => (r || []).some(c => c && c.input)));

    if (taskTables.length) {
      for (const tbl of taskTables) {
        if (tbl && Array.isArray(tbl.rows) && tbl.rows.length) tasksHTML += renderTaskTable(tbl);
      }
    }

    // If an interactive (input) table represents the questions, skip re-rendering them.
    if (hasInputTable) {
      // questions are covered by the fill-in table above
    } else
    // ── TWO-COLUMN TABLE LAYOUT (matches worksheet) ──
    if (layout.type === 'two-column' && layout.columnGroups && layout.columnGroups.length >= 2) {
      const colGroups = layout.columnGroups;
      const questionsById = {};
      for (const q of questions) { questionsById[q.id] = q; }

      const leftIds = colGroups[0].questionIds || [];
      const rightIds = colGroups[1].questionIds || [];
      const leftQuestions = leftIds.map(id => questionsById[id]).filter(Boolean);
      const rightQuestions = rightIds.map(id => questionsById[id]).filter(Boolean);
      const maxRows = Math.max(leftQuestions.length, rightQuestions.length);

      // Register all questions
      const leftQIds = leftQuestions.map(q => registerQuestion(q));
      const rightQIds = rightQuestions.map(q => registerQuestion(q));

      tasksHTML += `<table class="ws-table" style="width:100%;border-collapse:collapse;border:1px solid rgba(195,220,216,0.2);border-radius:8px;overflow:hidden;">`;

      // Question rows
      for (let r = 0; r < maxRows; r++) {
        tasksHTML += `<tr>`;
        // Left cell
        tasksHTML += `<td style="width:50%;vertical-align:top;border:1px solid rgba(195,220,216,0.15);">`;
        if (r < leftQuestions.length) {
          tasksHTML += renderQuestionCell(leftQuestions[r], leftQIds[r], true);
        }
        tasksHTML += `</td>`;
        // Right cell
        tasksHTML += `<td style="width:50%;vertical-align:top;border:1px solid rgba(195,220,216,0.15);">`;
        if (r < rightQuestions.length) {
          tasksHTML += renderQuestionCell(rightQuestions[r], rightQIds[r], true);
        }
        tasksHTML += `</td>`;
        tasksHTML += `</tr>`;
      }

      tasksHTML += `</table>`;

    } else {
      // ── SINGLE-COLUMN / CARD LAYOUT (default) ──
      for (const q of questions) {
        const qId = registerQuestion(q);
        tasksHTML += renderQuestionCell(q, qId, false);
      }
    }

    tasksHTML += `</div>`;
  }

  // Concept cards — Aivorah themed
  let conceptsHTML = '';
  if (quiz.concepts?.length) {
    conceptsHTML = `<div class="concepts-row">` +
      quiz.concepts.map((c, i) => {
        const cc = conceptCardColors[i % conceptCardColors.length];
        return `
        <div class="concept-card" style="background:${cc}18;border:1px solid ${cc}40">
          <div class="concept-icon" style="color:${cc}">${getConceptIcon(c.term)}</div>
          <h3 style="color:${cc}">${c.term}</h3>
          <p>${c.definition}</p>
          ${c.unit && c.unit !== 'N/A' ? `<p class="concept-unit">Measured in<br><strong style="color:#C3DCD8">${c.unit}</strong></p>` : ''}
        </div>`;
      }).join('') +
      `</div>`;
  }

  return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${quiz.title || 'Quiz'} - Aivorah</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, 'Segoe UI', Roboto, 'Noto Sans Telugu', 'Noto Sans Devanagari', Helvetica, Arial, sans-serif; background: #0F0F0F; color: #F0EEEC; line-height: 1.6; }

    /* ── Header — Aivorah Enchanted Forest ── */
    /* Matches the page's own background (#0F0F0F) instead of a lighter gradient box —
       when there's no school/curriculum logo to show, the header used to read as a
       separate, visually disconnected dark rectangle sitting on top of the page rather
       than blending into it. */
    .header { background: #0F0F0F; color: #F0EEEC; padding: 14px 110px 14px 40px; position: relative; border-bottom: 1px solid rgba(195,220,216,0.12); display: flex; align-items: center; gap: 16px; flex-wrap: wrap; min-height: 60px; }
    /* flex-grow MUST stay 0 here — giving header-text grow:1 (equal to
       header-logos) let it fight header-logos for free space, which pushed the
       logos off the true center between title and score (the regression seen
       with a short title like "Mathematics Activity Sheet" leaving the logos
       sitting right-of-center instead of centered in the remaining gap). Only
       flex-shrink + a basis are needed for wrapping on narrow/split screens. */
    .header-text { text-align: left; flex: 0 1 260px; min-width: 0; }
    .header-text h1 { overflow-wrap: anywhere; }
    .header-sub { font-size: 13px; color: #5A6B69; margin-bottom: 2px; }
    .header h1 { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; color: #C3DCD8; margin: 0; }
    .header-meta { font-size: 13px; color: #5A6B69; margin-top: 2px; }
    /* Centered in the space BETWEEN the title text and the score badge, not the
       header box's raw 50% mark — the box has asymmetric padding (extra room on
       the right for the score circle), so centering on the box itself always
       skewed the logos off the true visual center. */
    .header-logos { flex: 1 1 auto; display: flex; gap: 16px; align-items: center;
                     justify-content: center; min-width: 0; }
    .header-logos img { height: 55px; width: auto; max-width: 100%; object-fit: contain; display: block; }

    /* Compact / split-screen: the fixed-height logos used to collide with a long
       title (they don't shrink), so the row overlapped. Below these widths the
       header wraps the logos onto their own centered line and scales them down so
       nothing overlaps the title or the score badge. */
    @media (max-width: 820px) {
      .header { padding: 14px 96px 14px 20px; }
      .header-logos { flex-basis: 100%; order: 3; justify-content: center; margin-top: 6px; }
      .header-logos img { height: 42px; }
    }
    @media (max-width: 520px) {
      .header-logos img { height: 34px; }
      .header h1 { font-size: 20px; }
    }

    /* ── Score Badge — anchored to the header itself, not the viewport ── */
    .score { position: absolute; top: 50%; right: 24px; transform: translateY(-50%); width: 76px; height: 76px; border-radius: 50%;
             background: linear-gradient(135deg, #93B0AC, #7AADA8); color: #0F0F0F;
             display: flex; flex-direction: column; align-items: center; justify-content: center;
             box-shadow: 0 4px 20px rgba(147,176,172,0.3); z-index: 100; }
    .score-num { font-size: 22px; font-weight: 800; line-height: 1; }
    .score-label { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.7; margin-top: 2px; }

    /* ── Progress ── */
    .progress-wrap { padding: 20px 0 4px; }
    .progress-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #5A6B69; margin-bottom: 8px; }
    .progress-bar { background: #252525; border-radius: 6px; height: 12px; overflow: hidden; border: 1px solid rgba(195,220,216,0.08); }
    .progress-fill { background: linear-gradient(90deg, #93B0AC, #C3DCD8); height: 100%; border-radius: 6px; transition: width 0.6s ease; }
    .progress-pct { text-align: right; font-size: 12px; color: #93B0AC; font-weight: 600; margin-top: 4px; }

    /* ── Container ── */
    .container { max-width: 960px; margin: 0 auto; padding: 0 24px 60px; }

    /* ── Concepts ── */
    .concepts-row { display: flex; gap: 16px; margin: 24px 0; flex-wrap: wrap; }
    .concept-card { flex: 1; min-width: 220px; padding: 20px; border-radius: 12px; color: #F0EEEC; }
    .concept-card h3 { font-size: 18px; font-weight: 800; margin-bottom: 6px; }
    .concept-card p { font-size: 13px; color: #A8B5B3; line-height: 1.5; }
    .concept-unit { margin-top: 8px; font-size: 12px; color: #5A6B69; }
    .concept-icon { font-size: 20px; margin-bottom: 6px; }

    /* ── Question cards ── */
    .q-card { background: #1C1C1C; padding: 20px 24px; border-radius: 10px; margin: 14px 0;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3); border: 1px solid rgba(195,220,216,0.12); }
    .q-text { font-size: 15px; color: #F0EEEC; margin-bottom: 14px; line-height: 1.6; }
    .q-text strong { color: #C3DCD8; }

    /* ── Input row ── */
    .q-input-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
    .q-label { font-weight: 700; font-size: 14px; color: #A8B5B3; }
    .q-input { width: 130px; padding: 10px 12px; border: 2px solid rgba(195,220,216,0.25); border-radius: 8px;
               font-size: 16px; text-align: center; transition: border-color 0.2s; background: #252525; color: #F0EEEC; }
    .q-input:focus { border-color: #93B0AC; outline: none; box-shadow: 0 0 0 3px rgba(147,176,172,0.2); }
    .q-unit { font-size: 14px; color: #A8B5B3; font-weight: 500; }

    /* ── MCQ ── */
    .mcq-opt { display: block; margin: 8px 0; padding: 10px 14px; border-radius: 8px;
               border: 1.5px solid rgba(195,220,216,0.15); cursor: pointer; font-size: 14px; color: #F0EEEC; transition: all 0.2s; }
    .mcq-opt:hover { background: rgba(147,176,172,0.1); border-color: #93B0AC; }
    .mcq-opt input { margin-right: 8px; }

    /* ── Buttons ── */
    .btn-check { background: #93B0AC; color: #0F0F0F; border: none; padding: 10px 24px; border-radius: 8px;
                 font-weight: 700; font-size: 14px; cursor: pointer; transition: all 0.2s; }
    .btn-check:hover { background: #7AADA8; transform: translateY(-1px); }
    .mini-check:hover { transform: scale(1.15); }
    .btn-hint { background: #C5BD96; color: #0F0F0F; border: none; padding: 10px 20px; border-radius: 8px;
                font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s; }
    .btn-hint:hover { opacity: 0.85; transform: translateY(-1px); }
    .btn-show { background: #93B0AC; color: #0F0F0F; border: none; padding: 8px 18px; border-radius: 6px;
                font-weight: 600; font-size: 13px; cursor: pointer; margin-top: 10px; }
    .btn-show:hover { background: #7AADA8; }

    /* ── Feedback boxes ── */
    .hint-box { margin-top: 12px; padding: 14px 16px; background: rgba(197,189,150,0.1); border-radius: 8px;
                border-left: 4px solid #C5BD96; color: #C5BD96; font-size: 14px; line-height: 1.5; }
    .result-box { margin-top: 8px; font-size: 14px; min-height: 6px; }
    .solution-box { margin-top: 12px; padding: 16px 18px; background: rgba(74,157,110,0.14); border-radius: 8px;
                    border-left: 4px solid #4a9d6e; color: #4a9d6e; font-size: 14px; line-height: 1.7; }

    /* ── Activity boxes ── */
    .activity-box { background: linear-gradient(135deg, rgba(147,176,172,0.08), rgba(197,189,150,0.08)) !important;
                    border-color: rgba(147,176,172,0.25) !important; }

    /* ── Language worksheet layout (Telugu, Hindi, etc.) ── */
    .lang-q-row { padding: 16px 20px 12px; margin: 6px 0; border-bottom: 1px solid rgba(195,220,216,0.08); }
    .lang-q-left { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
    .lang-q-num { font-size: 15px; color: #93B0AC; font-weight: 700; flex-shrink: 0; min-width: 28px; }
    .lang-q-text { font-size: 16px; color: #F0EEEC; line-height: 1.8; }
    .lang-q-text strong { color: #C3DCD8; }
    .lang-example { margin: 4px 0 10px 38px; padding: 8px 14px; background: rgba(195,220,216,0.05);
                    border-left: 3px solid rgba(195,220,216,0.3); border-radius: 0 6px 6px 0;
                    font-size: 14px; color: #A8B5B3; font-style: italic; }
    .lang-q-answer { display: flex; align-items: center; gap: 12px; margin-left: 38px; flex-wrap: wrap; }
    .lang-input { flex: 1; max-width: 280px; padding: 8px 4px; font-size: 16px; color: #F0EEEC;
                  background: transparent; border: none; border-bottom: 2px dotted rgba(195,220,216,0.35);
                  outline: none; font-family: inherit; transition: border-color 0.2s; }
    .lang-input:focus { border-bottom-color: #93B0AC; border-bottom-style: solid; }
    .lang-input::placeholder { color: transparent; }
    .lang-q-actions { display: flex; gap: 6px; flex-shrink: 0; }
    .lang-btn-check { width: 30px; height: 30px; border-radius: 50%; border: 1.5px solid rgba(147,176,172,0.4);
                      background: transparent; color: #93B0AC; font-size: 14px; cursor: pointer;
                      display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
    .lang-btn-check:hover { background: rgba(147,176,172,0.15); border-color: #93B0AC; }
    /* Match-the-following drag & drop */
    .match-bank { display:flex; flex-wrap:wrap; gap:10px; padding:14px; margin:4px 0 18px; background:rgba(147,176,172,0.07);
      border:1.5px dashed rgba(147,176,172,0.35); border-radius:10px; min-height:52px; }
    .match-chip { display:inline-block; padding:8px 18px; background:#2A2F2E; color:#F0EEEC; border:1.5px solid rgba(147,176,172,0.5);
      border-radius:24px; font-size:15px; font-weight:600; cursor:grab; user-select:none; transition:transform .12s, box-shadow .12s, border-color .12s; }
    .match-chip:hover { transform:translateY(-1px); box-shadow:0 2px 8px rgba(0,0,0,0.35); border-color:#93B0AC; }
    .match-chip.sel { outline:2px solid #C5BD96; background:rgba(197,189,150,0.15); }
    .match-grid { display:flex; flex-wrap:wrap; gap:16px; }
    .match-card { flex:1 1 170px; max-width:220px; background:rgba(255,255,255,0.03); border:1px solid rgba(195,220,216,0.18);
      border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:8px; align-items:center; }
    .match-card-label { align-self:flex-start; font-size:12px; font-weight:700; color:#93B0AC; }
    .match-img { background:#fff; border-radius:8px; padding:6px; width:100%; text-align:center; }
    .match-img img { max-width:100%; max-height:130px; border-radius:4px; }
    .match-img-text { background:rgba(255,255,255,0.05); color:#F0EEEC; font-size:13px; padding:12px; }
    .match-slot { width:100%; min-height:46px; border:1.5px dashed rgba(195,220,216,0.45); border-radius:10px; display:flex;
      align-items:center; justify-content:center; padding:4px; cursor:pointer; transition:border-color .15s, background .15s; }
    .match-slot-ph { font-size:12px; color:#7c8a88; pointer-events:none; }
    .match-slot.filled .match-slot-ph { display:none; }
    .match-slot.m-ok { border-style:solid; border-color:#4a9d6e; background:rgba(74,157,110,0.18); }
    .match-slot.m-bad { border-style:solid; border-color:#c9605f; background:rgba(201,96,95,0.14); }
    .lang-btn-hint { width: 30px; height: 30px; border-radius: 50%; border: 1.5px solid rgba(197,189,150,0.4);
                     background: transparent; color: #C5BD96; font-size: 14px; font-weight: 700; cursor: pointer;
                     display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
    .lang-btn-hint:hover { background: rgba(197,189,150,0.1); border-color: #C5BD96; }
    .lang-result { margin: 4px 0 0 38px; font-size: 14px; min-height: 4px; }
    .lang-mcq-opts { display: flex; gap: 8px; flex-wrap: wrap; margin: 6px 0 4px 38px; align-items: center; }
    .lang-mcq-opt { font-size: 14px; color: #F0EEEC; cursor: pointer; padding: 6px 12px;
                    border: 1px solid rgba(195,220,216,0.2); border-radius: 6px; transition: all 0.2s; }
    .lang-mcq-opt:hover { background: rgba(147,176,172,0.1); border-color: #93B0AC; }
    .lang-mcq-opt input { margin-right: 6px; }

    /* ── Responsive ── */
    @media (max-width: 640px) {
      .header { padding: 12px 76px 12px 16px; }
      .header h1 { font-size: 20px; }
      .header-logos img { height: 40px; }
      .container { padding: 0 14px 40px; }
      .q-card { padding: 16px; }
      .lang-q-row { padding: 12px 14px 10px; }
      .lang-q-answer { margin-left: 28px; }
      .lang-result { margin-left: 28px; }
      .lang-example { margin-left: 28px; }
      .score { width: 60px; height: 60px; right: 12px; }
      .score-num { font-size: 18px; }
      .concepts-row { flex-direction: column; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-text">
      <div class="header-sub">${quiz.school || 'Aivorah'} &middot; ${quiz.grade || ''}</div>
      <h1>${fmt(quiz.title || 'Interactive Quiz')}</h1>
      <div class="header-meta">Subject: ${quiz.subject || 'Mathematics'} &nbsp;|&nbsp; Powered by Aivorah</div>
    </div>
    ${(branding.schoolLogoUrl || branding.curriculumLogoUrl) ? `<div class="header-logos">
      ${branding.schoolLogoUrl ? `<img src="${branding.schoolLogoUrl}" alt="School logo">` : ''}
      ${branding.curriculumLogoUrl ? `<img src="${branding.curriculumLogoUrl}" alt="Curriculum logo">` : ''}
    </div>` : ''}
    <div class="score" id="score-badge">
      <span class="score-num" id="score-num">0/${qNum}</span>
      <span class="score-label">Score</span>
    </div>
  </div>

  <div class="container">
    <div class="progress-wrap">
      <div class="progress-title">Quiz Progress</div>
      <div class="progress-bar"><div class="progress-fill" id="pf" style="width:0%"></div></div>
      <div class="progress-pct" id="pp">0% complete</div>
    </div>

    ${(quiz.purpose || quiz.learningOutcomes?.length) ? `<div style="background:rgba(197,165,106,0.08);border:1px solid rgba(197,165,106,0.25);border-radius:10px;padding:16px 20px;margin:16px 0;">
      <h3 style="font-size:14px;color:#C5A56A;margin-bottom:8px;font-weight:700;">&#127919; Learning Outcome</h3>
      ${quiz.purpose ? `<p style="font-size:14px;color:#D8C79A;line-height:1.5;margin:0 0 8px;"><strong>Purpose:</strong> ${fmt(quiz.purpose)}</p>` : ''}
      ${quiz.learningOutcomes?.length ? `<ul style="margin:0;padding-left:20px;">${quiz.learningOutcomes.map(o => `<li style="font-size:14px;color:#D8C79A;margin:4px 0;">${fmt(o)}</li>`).join('')}</ul>` : ''}
    </div>` : ''}
    ${conceptsHTML}
    ${quiz.notes ? `<div style="background:rgba(147,176,172,0.08);border:1px solid rgba(147,176,172,0.2);border-radius:10px;padding:16px 20px;margin:16px 0;">
      <h3 style="font-size:14px;color:#93B0AC;margin-bottom:6px;font-weight:700;">&#128221; Note</h3>
      <p style="font-size:14px;color:#A8B5B3;line-height:1.5;">${fmt(quiz.notes)}</p>
    </div>` : ''}
    ${quiz.successCriteria?.length ? `<div style="background:rgba(147,176,172,0.08);border:1px solid rgba(147,176,172,0.2);border-radius:10px;padding:16px 20px;margin:16px 0;">
      <h3 style="font-size:14px;color:#93B0AC;margin-bottom:8px;font-weight:700;">&#127919; Success Criteria</h3>
      <ul style="margin:0;padding-left:20px;">${quiz.successCriteria.map(c => `<li style="font-size:14px;color:#A8B5B3;margin:4px 0;">${fmt(c)}</li>`).join('')}</ul>
    </div>` : ''}
    ${tasksHTML}
  </div>

  <script>
    let sc = 0;
    const tot = ${qNum};
    const done = new Set(); // questions answered CORRECTLY (drives score credit)
    // Questions ATTEMPTED at least once, right or wrong — drives the progress bar and
    // whether "Submit Assignment" unlocks. Submission must depend on the student having
    // answered every question, NOT on getting every question right — those are different
    // things, and gating submission on a perfect score blocked students who tried
    // everything but got some wrong from ever handing the assignment in.
    const attempted = new Set();
    const answers = ${JSON.stringify(answersMap)};
    const studentAnswers = {}; // { qId: { answer, correct, timeSpent } }
    const questionStartTimes = {}; // { qId: timestamp }

    // ── Effort-based credit: full marks for a clean first-attempt correct answer,
    // half marks if a Hint was used along the way, zero if the student had to
    // reveal the Show Answer before getting it right (that's reading, not solving). ──
    const hintUsed = new Set();
    const revealed = new Set();
    const semanticCredit = new Map(); // qId -> fraction, set when Tier 2 grading returns "partial"
    function creditFor(id) {
      if (revealed.has(id)) return 0;
      const base = hintUsed.has(id) ? 0.5 : 1;
      return semanticCredit.has(id) ? Math.min(base, semanticCredit.get(id)) : base;
    }

    // ── Theory/short-factual answer matching — compares meaningful keywords instead
    // of literal strings, so word order and filler words don't cause a false "wrong".
    // Pure client-side, no network call, no AI dependency. ──
    const STOPWORDS = new Set(['a','an','the','is','was','it','of','in','to','and','or','on','at','for','with','this','that','be','been','were','are','as','by','from']);
    function keywordSet(s) {
      return new Set(
        String(s).toLowerCase().replace(/[^a-z0-9\\s]/g, ' ').split(/\\s+/)
          .filter(function(w) { return w.length > 0 && !STOPWORDS.has(w); })
      );
    }
    function keywordMatch(studentAnswer, correctAnswer) {
      // Many "theory" answers are auto-generated as a full multi-sentence
      // JUSTIFICATION ("New height will be 20. It will reach closer to the football
      // bar. The football bar is at 16, so the difference is 4. The hockey bar is
      // at 12, so the difference is 8...") when the question itself only asks for a
      // choice/short fact ("...closer to the football bar or the hockey bar?"). A
      // student who correctly answers "football" was never asked to reproduce the
      // reasoning — but matching keywords against the WHOLE narrative demands they
      // do (14 keywords → 7 required, "football" only overlaps 1). The decisive
      // conclusion almost always lives in the first sentence or two; later
      // sentences explain/compare and often mention the REJECTED alternative too
      // (here, "hockey"), so pulling keywords from the whole thing also risks
      // marking a WRONG short answer correct just because it names something
      // discussed later in the justification. Limiting the keyword pool to the
      // first couple of sentences fixes both problems at once.
      const sentences = correctAnswer.split(/(?<=[.!?])\\s+/).filter(Boolean);
      const answerSource = sentences.length > 2 ? sentences.slice(0, 2).join(' ') : correctAnswer;
      // Bare numbers (e.g. an intermediate computed value like "20" restated inside
      // "20, closer to football") are narrative filler, not something a student must
      // retype to prove correct reasoning — a purely numeric answer already goes
      // through the isNum exact-match path, so any stray digit token reaching HERE is
      // incidental. Drop it, otherwise a correct short answer ("football") gets
      // penalized for not repeating a number the question never asked for.
      const stripNums = (set) => new Set(Array.from(set).filter(function(w) { return !/^\\d+$/.test(w); }));
      const expected = Array.from(stripNums(keywordSet(answerSource)));
      if (expected.length === 0) return true; // nothing meaningful to check against
      const studentSet = stripNums(keywordSet(studentAnswer));
      const matched = expected.filter(function(w) { return studentSet.has(w); }).length;
      // Short answers (≤3 meaningful words, e.g. "rugby and badminton") still need
      // majority overlap for real discrimination. Anything longer than that — even
      // after narrowing to the first couple of sentences — is asking more than a
      // short answer box should require verbatim, so a single genuine keyword
      // overlap (already scoped to the decisive sentences, so "hockey" can't sneak
      // in from the justification) is accepted. A stricter near-100% threshold
      // marked genuinely correct short answers wrong; a lower bar costs a rare
      // false positive, which is a far smaller problem live than telling a student
      // their right answer is wrong.
      const required = expected.length <= 3 ? Math.max(1, Math.ceil(expected.length * 0.5)) : 1;
      return matched >= required;
    }

    // Track when each question becomes visible / gets focus
    document.addEventListener('focusin', function(e) {
      const inp = e.target.closest('input');
      if (inp && inp.id && inp.id.endsWith('-input')) {
        const qId = inp.id.replace('-input', '');
        if (!questionStartTimes[qId]) questionStartTimes[qId] = Date.now();
      }
    });

    function up() {
      document.getElementById('score-num').textContent = (sc % 1 === 0 ? sc : sc.toFixed(1)) + '/' + tot;
      // Progress bar tracks how many questions have been attempted — completion, not correctness.
      const donePct = Math.round((attempted.size / tot) * 100);
      document.getElementById('pf').style.width = donePct + '%';
      document.getElementById('pp').textContent = donePct + '% complete';
      // Score percentage — what actually gets saved as the assignment's grade — reflects
      // effort-weighted credit (full/half/zero per question), not just attempt count.
      const scorePct = Math.round((sc / tot) * 100);
      // Build per-question answer list
      const answersArr = Object.entries(studentAnswers).map(([qId, data]) => ({
        qId, answer: data.answer, correct: data.correct,
        timeSpent: data.timeSpent || 0,
        question: data.question || ''
      }));
      // Report score + answers to the host — web (iframe, window.parent) and
      // native (react-native-webview, which only accepts a stringified message
      // via a different bridge object) need different delivery mechanisms.
      // "correct" is a partial-credit SCORE (0 for revealed, 0.5 for hinted, 1 for
      // clean), not a count of how many questions have been checked — a host UI
      // showing "correct/total" as if it were "answered/total" undercounts and
      // confuses the student into thinking questions are still outstanding even
      // after they've checked every one. "attemptedCount" is the real signal for
      // how many have actually been checked so far.
      const scoreMsg = { type: 'quiz-score', correct: sc, total: tot, pct: scorePct, completed: attempted.size === tot, attemptedCount: attempted.size, answers: answersArr };
      try { window.parent.postMessage(scoreMsg, '*'); } catch(e) {}
      try { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(scoreMsg)); } catch(e) {}
    }

    async function checkAnswer(id) {
      const a = answers[id];
      if (!a) return;
      const inp = document.getElementById(id + '-input');
      const val = inp.value.trim();
      if (!val) { inp.style.borderColor = '#C5BD96'; return; }
      const r = document.getElementById(id + '-result');
      // Open-ended (reflection) questions have no single correct text — any written
      // response counts as answered, so completion isn't blocked waiting for an exact match.
      if (a.open) {
        const elapsedOpen = questionStartTimes[id] ? Math.round((Date.now() - questionStartTimes[id]) / 1000) : 0;
        studentAnswers[id] = { answer: val, correct: true, timeSpent: elapsedOpen, question: '' };
        attempted.add(id);
        r.innerHTML = '<span style="color:#4a9d6e;font-weight:700">&#10004; Answer recorded</span>';
        inp.style.borderColor = '#4a9d6e';
        inp.style.background = 'rgba(74,157,110,0.14)';
        if (!done.has(id)) { sc += creditFor(id); done.add(id); }
        const openSol = document.getElementById(id + '-solution');
        if (openSol) openSol.style.display = 'block';
        up();
        return;
      }
      // Theory/short-factual answers (multi-word, a real correct answer exists but the
      // student's phrasing won't line up with it exactly). Two tiers:
      // Tier 1 — instant, free, client-side KEYWORD overlap. Catches most valid
      // paraphrases immediately with zero network call.
      // Tier 2 — only when Tier 1 says "wrong": one small server-side semantic
      // check (Groq text model, not vision) that judges MEANING, so a
      // synonym-only rewrite with no shared root words ("Chlorophyll converts
      // solar energy into glucose" for an expected answer about sunlight/food)
      // isn't wrongly marked incorrect just because the words don't overlap.
      if (a.theory) {
        const okTh = keywordMatch(val, String(a.answer));
        const elapsedTh = questionStartTimes[id] ? Math.round((Date.now() - questionStartTimes[id]) / 1000) : 0;
        if (okTh) {
          studentAnswers[id] = { answer: val, correct: true, timeSpent: elapsedTh, question: '' };
          attempted.add(id);
          r.innerHTML = '<span style="color:#4a9d6e;font-weight:700">&#10004; Correct!</span>';
          inp.style.borderColor = '#4a9d6e';
          inp.style.background = 'rgba(74,157,110,0.14)';
          if (!done.has(id)) { sc += creditFor(id); done.add(id); }
          const sol = document.getElementById(id + '-solution');
          if (sol) sol.style.display = 'block';
          up();
          return;
        }
        // Tier 1 says wrong — ask Tier 2 before finalizing, in case it's a
        // valid (or partially valid) paraphrase Tier 1's keyword overlap
        // couldn't recognize. Three-way verdict: correct / partial / incorrect.
        r.innerHTML = '<span style="color:#A8B5B3;font-weight:600">Checking...</span>';
        let semanticResult = { verdict: 'incorrect', reason: '' };
        try {
          const qEl0 = document.getElementById(id + '-card');
          const qText0 = qEl0 ? (qEl0.querySelector('.q-label, strong')?.textContent || '') : '';
          const gRes = await fetch(API_BASE + '/quiz/grade-answer', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expected: String(a.answer), student: val, question: qText0 }),
          });
          if (gRes.ok) semanticResult = await gRes.json();
        } catch (e) { /* network hiccup — fall back to Tier 1's "wrong" */ }
        const verdict = semanticResult.verdict || 'incorrect';
        studentAnswers[id] = { answer: val, correct: verdict !== 'incorrect', partial: verdict === 'partial', timeSpent: elapsedTh, question: '' };
        attempted.add(id);
        if (verdict === 'correct') {
          r.innerHTML = '<span style="color:#4a9d6e;font-weight:700">&#10004; Correct!</span>' + (semanticResult.reason ? '<div style="font-size:12px;color:#A8B5B3;margin-top:4px;">' + fmt(semanticResult.reason) + '</div>' : '');
          inp.style.borderColor = '#4a9d6e';
          inp.style.background = 'rgba(74,157,110,0.14)';
          if (!done.has(id)) { sc += creditFor(id); done.add(id); }
          const sol = document.getElementById(id + '-solution');
          if (sol) sol.style.display = 'block';
        } else if (verdict === 'partial') {
          r.innerHTML = '<span style="color:#C5BD96;font-weight:700">&#9679; Partially Correct</span>' + (semanticResult.reason ? '<div style="font-size:12px;color:#A8B5B3;margin-top:4px;">' + fmt(semanticResult.reason) + '</div>' : '');
          inp.style.borderColor = '#C5BD96';
          inp.style.background = 'rgba(197,189,150,0.14)';
          if (!done.has(id)) { semanticCredit.set(id, 0.5); sc += creditFor(id); done.add(id); }
          const sol2 = document.getElementById(id + '-solution');
          if (sol2) sol2.style.display = 'block';
        } else {
          r.innerHTML = '<span style="color:#c9605f;font-weight:700">Not quite. Try again!</span>' + (semanticResult.reason ? '<div style="font-size:12px;color:#A8B5B3;margin-top:4px;">' + fmt(semanticResult.reason) + '</div>' : '');
          inp.style.borderColor = '#c9605f';
          const sh = document.getElementById(id + '-show');
          if (sh) sh.style.display = 'inline-block';
        }
        up();
        return;
      }
      let ok = false;
      if (a.isNum) {
        const v = parseFloat(val);
        if (isNaN(v)) { inp.style.borderColor = '#C5BD96'; return; }
        ok = a.range ? (v >= a.range[0] && v <= a.range[1]) : Math.abs(v - a.answer) < 0.01;
      } else {
        ok = val.replace(/\\s+/g,'').toLowerCase() === String(a.answer).replace(/\\s+/g,'').toLowerCase();
      }
      // Track student answer + time
      const elapsed = questionStartTimes[id] ? Math.round((Date.now() - questionStartTimes[id]) / 1000) : 0;
      const qEl = document.getElementById(id + '-card');
      const qText = qEl ? qEl.querySelector('.q-label, strong')?.textContent || '' : '';
      studentAnswers[id] = { answer: val, correct: ok, timeSpent: elapsed, question: qText };
      attempted.add(id);
      if (ok) {
        r.innerHTML = '<span style="color:#4a9d6e;font-weight:700">&#10004; Correct!</span>';
        inp.style.borderColor = '#4a9d6e';
        inp.style.background = 'rgba(74,157,110,0.14)';
        if (!done.has(id)) { sc += creditFor(id); done.add(id); }
        document.getElementById(id + '-solution').style.display = 'block';
      } else {
        r.innerHTML = '<span style="color:#c9605f;font-weight:700">Not quite. Try again!</span>';
        inp.style.borderColor = '#c9605f';
        document.getElementById(id + '-show').style.display = 'inline-block';
      }
      up();
    }

    // ── Dedicated validator for missing-digit vertical arithmetic ──
    // Each blank is its own <input> (rendered by digitCell in the server
    // template as id="<qId>-vmb-<row>-<index>"). This function:
    //   1) checks EACH blank digit independently against the deterministically
    //      solved correct digit (not a single flattened string comparison),
    //   2) reconstructs the full top/bottom/result from the student's digits
    //      and independently re-verifies the arithmetic itself (top ± bottom
    //      === result) as a cross-check — so correctness never rests on trusting
    //      the per-digit compare alone,
    //   3) on a wrong answer, re-renders the same vertical column layout with
    //      the correct digits highlighted (not plain text) plus the
    //      step-by-step borrow/carry working already computed server-side.
    function checkVerticalMath(id) {
      const a = answers[id];
      if (!a || !a.vertMath) return;
      const r = document.getElementById(id + '-result');
      const blanks = a.vmBlanks || [];
      let allFilled = true;
      const studentDigits = {}; // "row-idx" -> digit typed
      for (const bl of blanks) {
        const inp = document.getElementById(id + '-vmb-' + bl.row + '-' + bl.index);
        const v = inp ? inp.value.trim() : '';
        if (!/^[0-9]$/.test(v)) { allFilled = false; if (inp) inp.style.borderColor = '#C5BD96'; continue; }
        studentDigits[bl.row + '-' + bl.index] = v;
      }
      if (!allFilled) return;

      // Reconstruct the full strings the student effectively entered.
      const reconstruct = (correctStr, row) => correctStr.split('').map((d, idx) =>
        studentDigits[row + '-' + idx] !== undefined ? studentDigits[row + '-' + idx] : d
      ).join('');
      const studentTop = reconstruct(a.vmTop, 'top');
      const studentBottom = reconstruct(a.vmBottom, 'bottom');
      const studentResult = reconstruct(a.vmResult, 'result');

      // Per-blank check.
      let allDigitsCorrect = true;
      for (const bl of blanks) {
        const typed = studentDigits[bl.row + '-' + bl.index];
        const inp = document.getElementById(id + '-vmb-' + bl.row + '-' + bl.index);
        const correct = typed === bl.digit;
        if (!correct) allDigitsCorrect = false;
        if (inp) {
          inp.style.borderColor = correct ? '#4a9d6e' : '#c9605f';
          inp.style.background = correct ? 'rgba(74,157,110,0.14)' : 'rgba(201,96,95,0.14)';
        }
      }

      // Independent mathematical cross-check — never trust the digit compare alone.
      const tN = parseInt(studentTop, 10), bN = parseInt(studentBottom, 10), rN = parseInt(studentResult, 10);
      const arithmeticOk = a.vmOperator === '+' ? (tN + bN === rN) : (tN - bN === rN);

      const ok = allDigitsCorrect && arithmeticOk;
      const elapsedVm = questionStartTimes[id] ? Math.round((Date.now() - questionStartTimes[id]) / 1000) : 0;
      studentAnswers[id] = { answer: studentTop + ' ' + a.vmOperator + ' ' + studentBottom + ' = ' + studentResult, correct: ok, timeSpent: elapsedVm, question: '' };
      attempted.add(id);

      if (ok) {
        r.innerHTML = '<span style="color:#4a9d6e;font-weight:700">&#10004; Correct!</span>';
        if (!done.has(id)) { sc += creditFor(id); done.add(id); }
        const sol = document.getElementById(id + '-solution');
        if (sol) sol.style.display = 'block';
      } else {
        r.innerHTML = '<span style="color:#c9605f;font-weight:700">Not quite — check the highlighted digit(s).</span>';
        // Show the completed, correct working in the same vertical layout,
        // with each corrected digit highlighted — not plain text.
        const correctedRow = (s, row) => s.split('').map((d, idx) => {
          const wasBlank = blanks.some(function(bl) { return bl.row === row && bl.index === idx; });
          const style = wasBlank
            ? 'display:inline-block;min-width:1.3em;text-align:center;background:rgba(74,157,110,0.22);color:#4a9d6e;border-radius:3px;'
            : 'display:inline-block;min-width:1.3em;text-align:center;';
          return '<span style="' + style + '">' + d + '</span>';
        }).join('');
        const opSp = '<span style="display:inline-block;min-width:1.3em;text-align:center;">&nbsp;</span>';
        const opC = '<span style="display:inline-block;min-width:1.3em;text-align:center;color:#93B0AC;">' + (a.vmOperator || '-') + '</span>';
        const corrected = document.getElementById(id + '-vm-corrected');
        if (corrected) {
          corrected.innerHTML =
            '<div style="font-size:12px;color:#93B0AC;font-family:inherit;font-weight:600;margin-bottom:4px;">Corrected working:</div>' +
            '<div>' + opSp + correctedRow(a.vmTop, 'top') + '</div>' +
            '<div>' + opC + correctedRow(a.vmBottom, 'bottom') + '</div>' +
            '<div style="border-top:2px solid #93B0AC;margin:2px 0;"></div>' +
            '<div>' + opSp + correctedRow(a.vmResult, 'result') + '</div>';
          corrected.style.display = 'block';
        }
        const stepsHtml = (a.vmSteps || []).map(function(s) { return '<li>' + fmt(s) + '</li>'; }).join('');
        const sol = document.getElementById(id + '-solution');
        if (sol) {
          sol.innerHTML = '<strong>&#9989; Step-by-step:</strong><ol style="margin:6px 0 0 18px;padding:0;">' + stepsHtml + '</ol>';
          sol.style.display = 'block';
        }
        const sh = document.getElementById(id + '-show');
        if (sh) sh.style.display = 'none'; // solution is already shown inline above
      }
      up();
    }

    function checkMCQ(id) {
      const a = answers[id];
      if (!a) return;
      const sel = document.querySelector('input[name="' + id + '"]:checked');
      if (!sel) return;
      const r = document.getElementById(id + '-result');
      const ok = sel.value === a.correctLetter;
      // Track student answer + time
      const elapsed = questionStartTimes[id] ? Math.round((Date.now() - questionStartTimes[id]) / 1000) : 0;
      studentAnswers[id] = { answer: sel.value, correct: ok, timeSpent: elapsed, question: '' };
      attempted.add(id);
      if (ok) {
        r.innerHTML = '<span style="color:#4a9d6e;font-weight:700">&#10004; Correct!</span>';
        if (!done.has(id)) { sc += creditFor(id); done.add(id); }
        document.getElementById(id + '-solution').style.display = 'block';
      } else {
        r.innerHTML = '<span style="color:#c9605f;font-weight:700">Not quite. Try again!</span>';
        document.getElementById(id + '-show').style.display = 'inline-block';
      }
      up();
    }

    // ── Drag & drop matching ──
    let mDragChip = null, mSelChip = null;
    function mDragStart(e) {
      mDragChip = e.target;
      try { e.dataTransfer.setData('text/plain', e.target.dataset.word); } catch (err) {}
    }
    function mDrop(e, slotId) {
      e.preventDefault();
      const slot = document.getElementById(slotId);
      if (mDragChip) mPlace(slot, mDragChip);
      mDragChip = null;
    }
    function mChipClick(chip) {
      // Chip sitting in a slot → send it back to the bank
      if (chip.parentElement.classList.contains('match-slot')) { mReturn(chip); return; }
      if (mSelChip === chip) { chip.classList.remove('sel'); mSelChip = null; return; }
      if (mSelChip) mSelChip.classList.remove('sel');
      mSelChip = chip; chip.classList.add('sel');
    }
    function mSlotClick(slot) {
      if (!slot.classList.contains('match-slot')) slot = slot.closest('.match-slot');
      if (!slot) return;
      if (mSelChip) { mSelChip.classList.remove('sel'); mPlace(slot, mSelChip); mSelChip = null; }
    }
    function mPlace(slot, chip) {
      if (!slot || !chip) return;
      const existing = slot.querySelector('.match-chip');
      if (existing) mReturn(existing);
      slot.appendChild(chip);
      slot.classList.add('filled');
      slot.classList.remove('m-ok', 'm-bad');
    }
    function mReturn(chip) {
      const slot = chip.parentElement;
      const bank = document.getElementById(chip.dataset.bank);
      if (bank) bank.appendChild(chip);
      if (slot && slot.classList) slot.classList.remove('filled', 'm-ok', 'm-bad');
    }
    function checkOneMatch(id) {
      const a = answers[id];
      const slot = document.getElementById(id + '-slot');
      const r = document.getElementById(id + '-result');
      const chip = slot ? slot.querySelector('.match-chip') : null;
      if (!a || !slot) return;
      if (!chip) { if (r) r.innerHTML = '<span style="color:#C5BD96;font-size:12px;">Place a word first</span>'; return; }
      const val = chip.dataset.word;
      const ok = String(val).replace(/\\s+/g, '').toLowerCase() === String(a.answer).replace(/\\s+/g, '').toLowerCase();
      studentAnswers[id] = { answer: val, correct: ok, timeSpent: 0, question: '' };
      attempted.add(id);
      if (ok) {
        slot.classList.add('m-ok'); slot.classList.remove('m-bad');
        if (r) r.innerHTML = '<span style="color:#4a9d6e;font-weight:700;font-size:12px;">&#10004; Correct!</span>';
        if (!done.has(id)) { sc += creditFor(id); done.add(id); }
        const sol = document.getElementById(id + '-solution');
        if (sol) sol.style.display = 'block';
      } else {
        slot.classList.add('m-bad'); slot.classList.remove('m-ok');
        if (r) r.innerHTML = '<span style="color:#c9605f;font-size:12px;">Not quite. Try again!</span>';
        const sh = document.getElementById(id + '-show');
        if (sh) sh.style.display = 'inline-block';
      }
      up();
    }

    function checkVenn(id) {
      const a = answers[id];
      if (!a || !a.venn) return;
      // Open-ended Venn (student chose their own data — no fixed correct answer):
      // accept whatever they filled in, same as open-ended text questions.
      if (a.open) {
        var anyFilledOpen = false;
        ['left','center','right'].forEach(function(rg) {
          var inp = document.getElementById(id + '-' + rg);
          if (inp && inp.value.trim()) anyFilledOpen = true;
          if (inp) { inp.style.borderColor = '#4a9d6e'; inp.style.background = 'rgba(74,157,110,0.14)'; }
        });
        if (!anyFilledOpen) return;
        var rOpen = document.getElementById(id + '-result');
        var elapsedOpen2 = questionStartTimes[id] ? Math.round((Date.now() - questionStartTimes[id]) / 1000) : 0;
        studentAnswers[id] = { answer: 'completed', correct: true, timeSpent: elapsedOpen2, question: 'Venn diagram' };
        attempted.add(id);
        rOpen.innerHTML = '<span style="color:#4a9d6e;font-weight:700">&#10004; Answer recorded</span>';
        if (!done.has(id)) { sc += creditFor(id); done.add(id); }
        up();
        return;
      }
      function normItems(s) {
        return String(s || '').replace(/\\band\\b/gi, ',').split(/[,;\\n]/)
          .map(function(x){ return x.trim().toLowerCase(); }).filter(Boolean).sort();
      }
      // Near-match, not exact-set-equality: a long "multiples of N" list (12-15 items)
      // where the student gets all-but-one right shouldn't fail the whole region red —
      // that's the same all-or-nothing problem the theory-answer keyword match already
      // solves elsewhere. Require ~80% recall (most correct items present) AND ~80%
      // precision (not padding with extra/wrong items) so partial credit is fair without
      // letting a student just paste a huge range of numbers to fish for a match.
      function setEq(typed, correct) {
        if (correct.length === 0) return typed.length === 0;
        var matched = typed.filter(function(t) { return correct.indexOf(t) !== -1; }).length;
        var recall = matched / correct.length;
        var precision = typed.length ? matched / typed.length : 0;
        return recall >= 0.8 && precision >= 0.8;
      }
      var regions = ['left', 'center', 'right'];
      var allOk = true, anyFilled = false, snapshot = [];
      regions.forEach(function(rg) {
        var inp = document.getElementById(id + '-' + rg);
        if (!inp) return;
        var val = normItems(inp.value);
        if (val.length) anyFilled = true;
        var correct = normItems((a.answers[rg] || []).join(','));
        var ok = setEq(val, correct);
        inp.style.borderColor = ok ? '#4a9d6e' : '#c9605f';
        inp.style.background = ok ? 'rgba(74,157,110,0.14)' : 'rgba(201,96,95,0.10)';
        if (!ok) allOk = false;
        snapshot.push(rg + ': ' + inp.value.trim());
      });
      if (!anyFilled) return;
      var r = document.getElementById(id + '-result');
      var elapsed = questionStartTimes[id] ? Math.round((Date.now() - questionStartTimes[id]) / 1000) : 0;
      studentAnswers[id] = { answer: snapshot.join(' | '), correct: allOk, timeSpent: elapsed, question: 'Venn diagram' };
      attempted.add(id);
      if (allOk) {
        r.innerHTML = '<span style="color:#4a9d6e;font-weight:700">&#10004; Correct! Every region is right.</span>';
        if (!done.has(id)) { sc += creditFor(id); done.add(id); }
        document.getElementById(id + '-solution').style.display = 'block';
      } else {
        r.innerHTML = '<span style="color:#c9605f;font-weight:700">Not quite — green boxes are right, red boxes need another look.</span>';
        var sh = document.getElementById(id + '-show');
        if (sh) sh.style.display = 'inline-block';
      }
      up();
    }

    function checkOneGroup(id) {
      var a = answers[id];
      var inp = document.getElementById(id + '-input');
      if (!a || !inp) return;
      var val = inp.value.trim();
      if (!val) return;
      var ok;
      if (a.isNum) {
        var v = parseFloat(val);
        ok = !isNaN(v) && (a.range ? (v >= a.range[0] && v <= a.range[1]) : Math.abs(v - a.answer) < 0.01);
      } else {
        ok = val.replace(/\\s+/g, '').toLowerCase() === String(a.answer).replace(/\\s+/g, '').toLowerCase();
      }
      inp.style.borderColor = ok ? '#4a9d6e' : '#c9605f';
      inp.style.background = ok ? 'rgba(74,157,110,0.14)' : 'rgba(201,96,95,0.10)';
      if (ok && !done.has(id)) { sc += creditFor(id); done.add(id); }
      studentAnswers[id] = { answer: val, correct: !!ok, timeSpent: 0, question: 'diagram blank' };
      attempted.add(id);
      up();
    }

    function toggleHint(id) {
      hintUsed.add(id);
      const el = document.getElementById(id + '-hint');
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }

    function toggleSolution(id) {
      // Only an explicit "Show Answer" click reaches this — the auto-reveal after a
      // correct answer sets the solution box's display style directly, so this
      // reliably marks "the student needed the answer handed to them."
      revealed.add(id);
      const el = document.getElementById(id + '-solution');
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }
    // ── Indic language input support ──
    // Students type English phonetically (e.g. "muggulu") → auto-converts to Telugu/Hindi
    // Uses Google Input Tools REST API for transliteration with dropdown suggestions
    ${(hasTeluguScript || hasDevanagari) ? `
    (function() {
      const LANG = '${hasTeluguScript ? 'te' : 'hi'}';
      const IME = 'transliteration_en_' + LANG;
      const LANG_LABEL = '${hasTeluguScript ? 'తె' : 'हि'}';
      const LANG_NAME = '${hasTeluguScript ? 'Telugu' : 'Hindi'}';
      let enabled = true;

      // Transliterate via OUR server proxy (direct inputtools.google.com calls
      // fail CORS inside the student iframe — the dropdown silently never showed).
      // The student app shows this page in a blob: iframe where RELATIVE urls
      // cannot resolve — derive the server origin from the embedding page.
      const API_BASE = (function() {
        try {
          if (location.protocol === 'http:' || location.protocol === 'https:') return '';
          if (location.ancestorOrigins && location.ancestorOrigins.length) return location.ancestorOrigins[0];
          if (document.referrer) return new URL(document.referrer).origin;
        } catch (e) {}
        return '';
      })();
      async function transliterate(word) {
        if (!word || word.length < 1) return [];
        try {
          const res = await fetch(API_BASE + '/quiz/transliterate?text=' + encodeURIComponent(word) + '&lang=' + LANG);
          const data = await res.json();
          return (data && data.suggestions) || [];
        } catch(e) { console.warn('Transliteration failed:', e); }
        return [];
      }

      // Suggestion dropdown
      let dropdown = document.createElement('div');
      dropdown.id = 'translit-dropdown';
      dropdown.style.cssText = 'position:absolute;z-index:9999;background:#1C1C1C;border:1px solid rgba(147,176,172,0.4);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.5);display:none;overflow:hidden;min-width:120px;';
      document.body.appendChild(dropdown);

      let activeInput = null;
      let currentWord = '';
      let wordStart = 0;

      function hideDropdown() { dropdown.style.display = 'none'; dropdown.innerHTML = ''; }

      function showDropdown(suggestions, input) {
        if (!suggestions.length) { hideDropdown(); return; }
        dropdown.innerHTML = '';
        suggestions.forEach(function(s, i) {
          var opt = document.createElement('div');
          opt.textContent = s;
          opt.style.cssText = 'padding:8px 14px;font-size:15px;color:#F0EEEC;cursor:pointer;border-bottom:1px solid rgba(195,220,216,0.08);';
          if (i === 0) opt.style.background = 'rgba(147,176,172,0.15)';
          opt.onmouseenter = function() {
            dropdown.querySelectorAll('div').forEach(function(d) { d.style.background = 'transparent'; });
            opt.style.background = 'rgba(147,176,172,0.15)';
          };
          opt.onmousedown = function(e) {
            e.preventDefault();
            applySelection(s, input);
          };
          dropdown.appendChild(opt);
        });
        // Position near the input. getBoundingClientRect is VIEWPORT-relative but the
        // dropdown is position:absolute (DOCUMENT-relative) — without adding the scroll
        // offset it renders thousands of px above the input once the quiz is scrolled,
        // i.e. invisible. This is why "Telugu typing didn't work" on lower questions.
        var rect = input.getBoundingClientRect();
        dropdown.style.left = (rect.left + window.scrollX) + 'px';
        dropdown.style.top = (rect.bottom + window.scrollY + 4) + 'px';
        dropdown.style.display = 'block';
      }

      function applySelection(text, input) {
        var val = input.value;
        input.value = val.substring(0, wordStart) + text + val.substring(wordStart + currentWord.length);
        currentWord = '';
        hideDropdown();
        input.focus();
      }

      // Extract current English word being typed
      function getCurrentWord(input) {
        var val = input.value;
        var pos = input.selectionStart || val.length;
        var before = val.substring(0, pos);
        var match = before.match(/[a-zA-Z]+$/);
        if (match) {
          wordStart = pos - match[0].length;
          return match[0];
        }
        return '';
      }

      // Debounce
      let debounceTimer = null;

      function onInput(e) {
        if (!enabled) return;
        var input = e.target;
        activeInput = input;
        currentWord = getCurrentWord(input);
        if (currentWord.length >= 2) {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(async function() {
            var suggestions = await transliterate(currentWord);
            showDropdown(suggestions, input);
          }, 200);
        } else {
          hideDropdown();
        }
      }

      function onKeydown(e) {
        if (!enabled) return;
        if (dropdown.style.display === 'none') return;
        var items = dropdown.querySelectorAll('div');
        var active = dropdown.querySelector('div[style*="rgba(147,176,172,0.15)"]');
        var idx = Array.from(items).indexOf(active);

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          items.forEach(function(d) { d.style.background = 'transparent'; });
          var next = (idx + 1) % items.length;
          items[next].style.background = 'rgba(147,176,172,0.15)';
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          items.forEach(function(d) { d.style.background = 'transparent'; });
          var prev = (idx - 1 + items.length) % items.length;
          items[prev].style.background = 'rgba(147,176,172,0.15)';
        } else if (e.key === 'Enter' || e.key === ' ') {
          if (active) {
            e.preventDefault();
            applySelection(active.textContent + (e.key === ' ' ? ' ' : ''), activeInput);
          }
        } else if (e.key === 'Escape') {
          hideDropdown();
        }
      }

      // Attach to all quiz inputs
      document.querySelectorAll('.lang-input, .q-input').forEach(function(inp) {
        inp.setAttribute('lang', LANG);
        inp.addEventListener('input', onInput);
        inp.addEventListener('keydown', onKeydown);
        inp.addEventListener('blur', function() { setTimeout(hideDropdown, 200); });
      });

      // Toggle indicator (fixed bottom-left)
      var indicator = document.createElement('div');
      indicator.id = 'lang-indicator';
      indicator.innerHTML = '<span class="lang-ind-icon">' + LANG_LABEL + '</span><span class="lang-ind-text">' + LANG_NAME + ' ON</span>';
      indicator.style.cssText = 'position:fixed;bottom:20px;left:20px;background:#1C1C1C;color:#93B0AC;padding:8px 16px;border-radius:20px;border:1px solid rgba(147,176,172,0.3);z-index:999;display:flex;align-items:center;gap:8px;font-family:inherit;box-shadow:0 2px 12px rgba(0,0,0,0.4);cursor:pointer;user-select:none;transition:all 0.2s;';
      indicator.onclick = function() {
        enabled = !enabled;
        indicator.querySelector('.lang-ind-text').textContent = enabled ? LANG_NAME + ' ON' : 'English';
        indicator.querySelector('.lang-ind-icon').textContent = enabled ? LANG_LABEL : 'EN';
        indicator.style.borderColor = enabled ? 'rgba(147,176,172,0.3)' : 'rgba(197,189,150,0.3)';
        if (!enabled) hideDropdown();
      };
      document.body.appendChild(indicator);

      // Style for indicator
      var style = document.createElement('style');
      style.textContent = '.lang-ind-icon{font-size:14px;font-weight:800;} .lang-ind-text{font-size:11px;opacity:0.7;} #lang-indicator:hover{transform:scale(1.05);border-color:#93B0AC!important;}';
      document.head.appendChild(style);
    })();
    ` : ''}
    // ── French accent palette ──
    // Floating toolbar with accented characters students can click to insert
    ${isFrench ? `
    (function() {
      const ACCENTS = ['é','è','ê','ë','à','â','ç','ù','û','ü','ô','î','ï','œ','æ','É','È','Ê','Ç','À','Â'];
      let activeInput = null;

      // Build palette
      var palette = document.createElement('div');
      palette.id = 'fr-palette';
      palette.style.cssText = 'position:fixed;bottom:20px;left:20px;background:#1C1C1C;border:1px solid rgba(147,176,172,0.3);border-radius:12px;z-index:999;padding:8px 10px;display:flex;flex-wrap:wrap;gap:4px;max-width:320px;box-shadow:0 4px 16px rgba(0,0,0,0.4);align-items:center;';

      // Label
      var label = document.createElement('span');
      label.textContent = 'FR';
      label.style.cssText = 'font-size:12px;font-weight:800;color:#93B0AC;margin-right:6px;';
      palette.appendChild(label);

      ACCENTS.forEach(function(ch) {
        var btn = document.createElement('button');
        btn.textContent = ch;
        btn.style.cssText = 'width:28px;height:28px;border:1px solid rgba(195,220,216,0.2);border-radius:6px;background:transparent;color:#F0EEEC;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;padding:0;';
        btn.onmouseenter = function() { btn.style.background = 'rgba(147,176,172,0.2)'; btn.style.borderColor = '#93B0AC'; };
        btn.onmouseleave = function() { btn.style.background = 'transparent'; btn.style.borderColor = 'rgba(195,220,216,0.2)'; };
        btn.onmousedown = function(e) {
          e.preventDefault();
          if (!activeInput) return;
          var pos = activeInput.selectionStart || activeInput.value.length;
          var val = activeInput.value;
          activeInput.value = val.substring(0, pos) + ch + val.substring(pos);
          activeInput.selectionStart = activeInput.selectionEnd = pos + ch.length;
          activeInput.focus();
        };
        palette.appendChild(btn);
      });
      document.body.appendChild(palette);

      // Track active input
      document.querySelectorAll('.lang-input, .q-input').forEach(function(inp) {
        inp.setAttribute('lang', 'fr');
        inp.addEventListener('focus', function() { activeInput = inp; });
      });
    })();
    ` : ''}
  </script>
</body>
</html>`;
}

module.exports = router;
module.exports.generateQuizHandler = generateQuizHandler;
module.exports.renderQuizHTML = renderQuizHTML;
module.exports.normalizeVennQuestions = normalizeVennQuestions;
module.exports.docxToPdf = docxToPdf;
module.exports.callQwenVision = callQwenVision;
module.exports.callPixtralVision = callPixtralVision;
