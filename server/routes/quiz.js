/**
 * quiz.js — PDF-to-Interactive-Quiz generation via Gemini Vision (primary) + Pixtral (fallback)
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
const { extractDiagrams, extractDiagramsFromImage, matchDiagramsToQuestions, ocrFullPDF, ocrRegion } = require('../services/diagram-extractor');

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
    const timeout = setTimeout(() => controller.abort(), 120000); // 120s timeout (model cold-load can take 30-60s)
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
function layoutResultToDiagramFormat(layoutResult) {
  if (!layoutResult || !layoutResult.pages) return null;

  const diagrams = [];
  const fullPageImages = [];

  for (const page of layoutResult.pages) {
    fullPageImages.push({ pageNum: page.pageNum, imageUrl: page.fullPageUrl });

    for (const crop of (page.crops || [])) {
      // Only include FIGURE crops as question-level diagrams.
      // TABLE crops contain question text/rows — showing them as images
      // duplicates the interactive inputs below. Skip them.
      if (crop.type === 'figure') {
        diagrams.push({
          id: crop.filename,
          pageNum: page.pageNum,
          imageUrl: crop.imageUrl,
          bbox: { x: crop.bbox.x1, y: crop.bbox.y1, w: crop.bbox.width, h: crop.bbox.height },
          area: crop.bbox.width * crop.bbox.height,
          contentType: 'diagram',
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

// Gemini Vision (primary engine — free, excellent vision)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

const QUIZ_COLLECTION = 'school_quizzes';
const QUIZ_IMG_DIR = path.join(__dirname, '..', 'data', 'images', 'quiz');
// Ensure quiz image directory exists
if (!fs.existsSync(QUIZ_IMG_DIR)) fs.mkdirSync(QUIZ_IMG_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

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
      // Payload indexes for filtering
      for (const field of ['school_id', 'grade', 'subject', 'teacher_id', 'status']) {
        await client.createPayloadIndex(QUIZ_COLLECTION, {
          field_name: field, field_schema: 'keyword',
        });
      }
      console.log('✅ Qdrant quiz collection created:', QUIZ_COLLECTION);
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




// ── Gemini Vision — primary engine (free, excellent accuracy) ────────────────
async function callGeminiVision(parts, { grade, subject, school } = {}) {
  if (!genAI) throw new Error('GEMINI_API_KEY not configured');
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const prompt = buildQuizVisionPrompt({ grade, subject, school });

  const result = await model.generateContent([
    ...parts,
    { text: prompt },
  ]);
  return result.response.text();
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
  }], 'pixtral-large-latest', 16000);

  return result;
}

// ── Shared quiz vision prompt (used by both Claude and Pixtral) ────────────
function buildQuizVisionPrompt({ grade, subject, school } = {}) {
  return `You are an expert quiz generator for ${grade || 'IB PYP Grade 4'} ${subject || 'Mathematics'}.

STEP 1: CAREFULLY examine the worksheet image(s). Read EVERY number, word, symbol, shape, table, and layout element.

STEP 2: For each task/section in the worksheet, extract:
- The exact title/heading
- Every single question with exact numbers
- Any diagrams, tables, or visual elements
- The operation being performed (+, -, ×, ÷)

STEP 3: Generate quiz JSON that is a PERFECT REPLICA of the worksheet.

RULES:
1. Each Task from the worksheet = one task in JSON. Keep EXACT task title and instructions.
2. Label questions EXACTLY as worksheet does (a, b, c, d, e — NOT q1, q2).
3. Use the EXACT SAME NUMBERS from the worksheet. Do NOT substitute different numbers.
4. Every question MUST have a correct "answer" field. YOU MUST SOLVE each problem. Think step by step, compute the answer, and write the final result. NEVER write "Not provided in the text" or "N/A" — you are the solver, not just an extractor.
5. Pay careful attention to UNITS.
6. Every question MUST have a "solution" field with a clear step-by-step explanation. NEVER write "Not provided" — work through the problem and explain how to get the answer.
7. Every question MUST have a "hint" field — a short clue that guides the student without giving the full answer. NEVER leave hint empty or omit it.
8. For questions that have a diagram/shape/image in the worksheet, set "hasImage": true. For text-only word problems, set "hasImage": false.
   When "hasImage": true, also include:
   - "diagramDescription": a short description of the diagram (e.g. "regular octagon inside a square", "L-shaped polygon with sides 5m, 6m, 8m, 3m", "irregular closed shape on a grid")
   - "diagramPosition": approximate position on the page: "top-left", "top-right", "top-center", "middle-left", "middle-right", "middle-center", "bottom-left", "bottom-right", "bottom-center"
   These fields are used by the server to match cropped images to the correct questions.
9. Do NOT generate SVG, HTML diagrams, or diagramHTML. The server handles all image rendering separately.
10. For questions that reference a graph/chart/image: READ the visual data from the image to compute the answer. For example, if a bar graph shows football=16, tennis=8 and the Y-axis goes 0,2,4,6... then the scale is 2.

LAYOUT EXTRACTION (CRITICAL — replicate the worksheet's visual layout):
- Look at how questions are arranged: single column, two columns side-by-side, grid, etc.
- For each task, include a "layout" object describing the visual arrangement.
- "layout.type": "single-column" (one column of questions), "two-column" (two side-by-side columns like conversion tables), "grid" (grid of cells), "list" (numbered list)
- "layout.columns": number of columns (1 or 2 typically)
- "layout.columnGroups": array of column groups, each with "questionIds" listing which questions belong to that column (in order, top to bottom)
- If a column group has a diagram/image above its questions, set "hasDiagram": true on that group
- Questions in column 0 are LEFT side, column 1 are RIGHT side

Return this EXACT JSON structure:
{
  "title": "worksheet title",
  "subject": "${subject || 'Mathematics'}",
  "grade": "${grade || 'PYP 4'}",
  "school": "${school || ''}",
  "concepts": [{ "term": "name", "definition": "short child-friendly definition", "unit": "unit" }],
  "tasks": [
    {
      "tier": "MUST DO",
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
    }
  ]
}

NOTE on layout:
- For simple single-column worksheets, use: "layout": { "type": "single-column", "columns": 1 }
- For two-column conversion tables (like kg/gm on left, l/ml on right), use "two-column" with columnGroups
- The "hasImage" on questions refers to per-question diagrams. The "hasDiagram" on columnGroups refers to shared diagrams above a group of questions (like conversion arrows).
- ALWAYS include layout — it is used to render the quiz in the same visual format as the worksheet.

QUESTION TYPES:
- "numeric" — number answer (integer or decimal)
- "text" — text answers, fractions like "14/25", comparisons like "<", mixed like "1 km 800 m"
- "long" — open-ended written response (sentences/paragraphs). Use textarea, NO "Answer =" label.
- "mcq" — multiple choice (include "options" array with {label, correct} objects)
- "activity" — drawing, colouring, pasting, constructing tasks (NO typed answer — student does it on paper)

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

Tiers: "MUST DO", "COULD DO", "ENRICHMENT"

NOTES & SUCCESS CRITERIA:
- If the worksheet includes a "Note to Parents", "Teacher's Note", instructions, or learning objectives at the top/bottom, extract them into a top-level "notes" field (string).
- If the worksheet includes "Success Criteria", "Learning Goals", "I can..." statements, or rubric, extract them into a top-level "successCriteria" array of strings.
- Example: "notes": "Dear Parents, please help your child with these activities...", "successCriteria": ["I can convert between units of measurement", "I can solve word problems involving fractions"]

Return ONLY valid JSON, no markdown fences, no extra text.`;
}

// ── Validation: check LLM output against OCR ground truth ───────────────────
function validateQuizAgainstOCR(quiz, ocrText) {
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

  return { valid: missingTasks.length === 0, missingTasks, detectedTiers, detectedTaskHeaders };
}

// ── POST /quiz/generate — PDF upload → quiz JSON (Claude Vision primary, Mistral fallback) ──
router.post('/generate', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });

    const { grade, subject, school } = req.body;
    const quizId = uuidv4().slice(0, 8);

    // Guard: reject PDFs > 4MB to prevent OOM on Cloud Run (2GB)
    if (req.file.buffer.length > 4 * 1024 * 1024) {
      return res.status(400).json({ error: 'PDF too large (max 4MB). Please upload a smaller worksheet.' });
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
    // Priority: Gemini reads the PDF best. OCR text is fallback.
    // Images come from ML layout crops (primary) or OpenCV crops (fallback).
    // ══════════════════════════════════════════════════════════════════════

    const parallelTasks = [];

    // A) Tesseract OCR — extract all text from PDF pages (no LLM)
    parallelTasks.push(
      ocrFullPDF(req.file.buffer, 1.5)
        .then(r => ({ type: 'tesseract', result: r }))
        .catch(err => { console.log('[quiz] Tesseract OCR failed:', err.message); return { type: 'tesseract', result: null }; })
    );

    // B) Python ML layout detection (primary) — DocLayout-YOLO for precise figure/table cropping
    parallelTasks.push(
      callLayoutService(req.file.buffer, quizId, { filename: req.file.originalname || 'worksheet.pdf', mime: 'application/pdf' })
        .then(r => ({ type: 'layout-ml', result: r }))
        .catch(err => { console.log('[quiz] ML layout failed:', err.message); return { type: 'layout-ml', result: null }; })
    );

    // C) Gemini Vision — generate structured quiz JSON (LLM, primary)
    if (genAI) {
      parallelTasks.push(
        callGeminiVision([geminiPdfPart(req.file.buffer)], { grade, subject, school })
          .then(r => ({ type: 'gemini', result: r }))
          .catch(err => { console.log('[quiz] Gemini failed:', err.message); return { type: 'gemini', result: null }; })
      );
    }

    console.log(`[quiz] Running ${parallelTasks.length} tasks in parallel: Tesseract OCR + ML Layout${genAI ? ' + Gemini' : ''}...`);
    const parallelResults = await Promise.all(parallelTasks);

    let ocrText = null;
    let layoutMLResult = null;
    for (const pr of parallelResults) {
      if (pr.type === 'gemini' && pr.result) result = pr.result;
      if (pr.type === 'layout-ml' && pr.result) layoutMLResult = pr.result;
      if (pr.type === 'tesseract' && pr.result) ocrText = pr.result;
    }

    // Convert ML layout result to diagram format (or fall back to heuristic OpenCV)
    if (layoutMLResult) {
      diagramExtraction = layoutResultToDiagramFormat(layoutMLResult);
      console.log(`[quiz] ML Layout: ${diagramExtraction?.diagrams?.length || 0} figures/tables detected`);
    }
    if (!diagramExtraction) {
      console.log('[quiz] ML Layout unavailable, falling back to heuristic OpenCV...');
      try {
        const opencvResult = await extractDiagrams(req.file.buffer, quizId, { scale: 1.5, doOCR: false });
        diagramExtraction = opencvResult;
        console.log(`[quiz] OpenCV fallback: ${opencvResult.diagrams.length} diagrams`);
      } catch (err) {
        console.log('[quiz] OpenCV fallback also failed:', err.message);
      }
    }

    console.log(`[quiz] Gemini: ${result ? result.length + ' chars' : 'N/A'} | OCR: ${ocrText ? ocrText.fullText.length + ' chars' : 'failed'} | Diagrams: ${diagramExtraction ? diagramExtraction.diagrams.length + ' crops' : 'none'}`);

    // ══════════════════════════════════════════════════════════════════════
    // FALLBACK CHAIN: Send page IMAGES (not OCR text) to vision LLMs.
    // Vision LLMs see the actual layout, tables, diagrams — far more accurate
    // than sending flat OCR text where structure is lost.
    //
    // Priority: Gemini Vision → Pixtral Vision → Groq Vision → OCR text fallback
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

      // FALLBACK 1: Pixtral Vision (sees images → understands layout)
      if (!result && MISTRAL_API_KEY && hasPageImages) {
        try {
          console.log('[quiz] Trying Pixtral Vision with page images...');
          result = await callPixtralVision(pageImageBuffers, { grade, subject, school });
          if (result) { usedEngine = 'pixtral'; console.log(`[quiz] Pixtral Vision returned ${result.length} chars`); }
        } catch (e) { console.log('[quiz] Pixtral Vision failed:', e.message); }
      }

      // FALLBACK 2: Groq Vision (llama-4-scout sees images)
      if (!result && groq && hasPageImages) {
        try {
          console.log('[quiz] Trying Groq Vision (llama-4-scout) with page images...');
          const visionPrompt = buildQuizVisionPrompt({ grade, subject, school });
          result = await callGroq(visionPrompt, { vision: true, imageBuffers: pageImageBuffers });
          if (result) { usedEngine = 'groq'; console.log(`[quiz] Groq Vision returned ${result.length} chars`); }
        } catch (e) { console.log('[quiz] Groq Vision failed:', e.message); }
      }

      // FALLBACK 3: OCR text + LLM (last resort — text only, may miss layout)
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

    // Parse JSON response
    let quiz;
    try {
      let cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      cleaned = cleaned.replace(/"answer":\s*(\d+\/\d+)/g, '"answer": "$1"');
      quiz = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'AI returned invalid JSON', raw: result });
    }

    // ── VALIDATION: Check LLM output against OCR ground truth ──
    const ocrFullText = ocrText ? ocrText.fullText : '';
    const validation = validateQuizAgainstOCR(quiz, ocrFullText);
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
      if (genAI) {
        try { const m = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }); retryResult = (await m.generateContent([{ text: retryPrompt }])).response.text(); }
        catch (e) { /* skip */ }
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
          let cleaned = retryResult.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
          cleaned = cleaned.replace(/"answer":\s*(\d+\/\d+)/g, '"answer": "$1"');
          const retryQuiz = JSON.parse(cleaned);
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
    }

    // ── Extract sub-figures from table crops (diagrams embedded inside tables) ──
    if (diagramExtraction && diagramExtraction.tableCrops && diagramExtraction.tableCrops.length > 0) {
      console.log(`[quiz] Checking ${diagramExtraction.tableCrops.length} table crops for embedded diagrams...`);
      await extractSubfiguresFromTables(quiz, diagramExtraction.tableCrops, quizId);
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

    // ── Post-process: auto-detect MCQ questions the LLM missed ──
    autoDetectMCQ(quiz);

    // ── Embed all images as base64 data URIs (so quiz works on Cloud Run / any server) ──
    embedQuizImages(quiz);

    // Add metadata
    quiz.engine = usedEngine;
    quiz.sourceFile = req.file.originalname;
    quiz.generatedAt = new Date().toISOString();
    quiz.status = 'draft';

    res.json({ quiz });
  } catch (err) {
    console.error('Quiz generate error:', err);
    res.status(500).json({ error: err.message });
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
      diagramExtraction = layoutResultToDiagramFormat(layoutMLResult);
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
          const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
          const r = await model.generateContent([{ text: prompt }]);
          result = r.response.text();
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
      const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      quiz = JSON.parse(cleaned);
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

    res.json({ quiz });
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
          school_id: schoolId || '',
          teacher_id: teacherId || '',
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

// ── GET /quiz/list — List quizzes from Qdrant ──────────────────────────────
router.get('/list', async (req, res) => {
  try {
    await ensureQuizCollection();
    const { schoolId, grade, subject, search } = req.query;

    // If search query provided, do semantic search
    if (search) {
      const vector = await embed(search);
      const must = [{ key: 'status', match: { value: 'published' } }];
      if (schoolId) must.push({ key: 'school_id', match: { value: schoolId } });
      if (grade)    must.push({ key: 'grade', match: { value: grade } });
      if (subject)  must.push({ key: 'subject', match: { value: subject } });

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
        school_id: r.payload.school_id,
        source_file: r.payload.source_file,
        status: r.payload.status,
        created_at: r.payload.created_at,
        score: r.score,
      }));
      return res.json({ quizzes });
    }

    // Otherwise, scroll/filter
    const must = [{ key: 'status', match: { value: 'published' } }];
    if (schoolId) must.push({ key: 'school_id', match: { value: schoolId } });
    if (grade)    must.push({ key: 'grade', match: { value: grade } });
    if (subject)  must.push({ key: 'subject', match: { value: subject } });

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
      school_id: p.payload.school_id,
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

// ── POST /quiz/render-preview — Accept quiz JSON, return fully rendered interactive HTML ──
// Used by frontend to show Student Preview (rich server-rendered HTML with two-column layouts, SVGs, etc.)
router.post('/render-preview', express.json({ limit: '5mb' }), (req, res) => {
  try {
    const quiz = req.body.quiz || req.body;
    if (!quiz || !quiz.tasks) return res.status(400).json({ error: 'No quiz data provided' });
    autoDetectMCQ(quiz);
    const html = renderQuizHTML(quiz);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
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

    const quiz = results[0].payload.quiz_data;
    const html = renderQuizHTML(quiz);
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

// ── Post-process: auto-detect MCQ questions the LLM returned as text ──────
function autoDetectMCQ(quiz) {
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
function renderQuizHTML(quiz) {
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

  const totalQ = quiz.tasks?.reduce((s, t) => s + (t.questions?.length || 0), 0) || 0;

  const tierStyles = {
    'MUST DO':     { bg: 'rgba(147,176,172,0.08)', border: '#93B0AC', label: '#93B0AC', labelBg: 'rgba(147,176,172,0.15)' },
    'COULD DO':    { bg: 'rgba(197,189,150,0.08)', border: '#C5BD96', label: '#C5BD96', labelBg: 'rgba(197,189,150,0.15)' },
    'ENRICHMENT':  { bg: 'rgba(239,209,212,0.08)', border: '#EFD1D4', label: '#EFD1D4', labelBg: 'rgba(239,209,212,0.15)' },
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

  let tasksHTML = '';
  let qNum = 0;
  const answersMap = {};

  // ── Helper: register a question in answersMap, return its qId ──
  function registerQuestion(q) {
    qNum++;
    const qId = `q${qNum}`;
    const ansRaw = q.answer;
    const isActivity = q.type === 'activity' || (q.type === 'text' && /\b(draw|sketch|create|construct|design|colour|color|paste|cut)\b/i.test(q.question));
    const isFraction = typeof ansRaw === 'string' && /^\d+\/\d+$/.test(ansRaw);
    const ansIsNumber = typeof ansRaw === 'number' || (typeof ansRaw === 'string' && !isNaN(parseFloat(ansRaw)) && isFinite(ansRaw));
    const isNum = !isFraction && ansIsNumber;
    const isMcq = q.type === 'mcq' && Array.isArray(q.options);

    if (isMcq) {
      const correctIdx = (q.options || []).findIndex(o => o.correct);
      const correctLetter = correctIdx >= 0 ? String.fromCharCode(65 + correctIdx) : '';
      answersMap[qId] = { answer: ansRaw, isNum: false, mcq: true, correctLetter };
    } else if (isActivity) {
      answersMap[qId] = { answer: ansRaw, isNum: false, activity: true };
    } else {
      answersMap[qId] = { answer: ansRaw, isNum, range: q.acceptRange || null };
    }
    return qId;
  }

  // ── Helper: render a single question cell (for table or card layout) ──
  function renderQuestionCell(q, qId, isTableCell = false) {
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
      html += `<div class="ws-cell" id="${qId}-card" style="padding:10px 14px;border-bottom:1px solid rgba(195,220,216,0.15);display:flex;align-items:center;gap:8px;flex-wrap:wrap;">`;
      html += `<span style="font-size:14px;color:#F0EEEC;flex-shrink:0;"><strong style="color:#C3DCD8">${qLabel}</strong> ${fmtQuestion(questionText)}</span>`;

      if (!isActivity && !isMcq) {
        html += `<input type="text" id="${qId}-input" class="q-input" style="width:90px;padding:6px 8px;font-size:14px;" placeholder="?">`;
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
        html += `<button class="btn-show" style="display:inline-block;padding:6px 14px;font-size:12px;" onclick="toggleSolution('${qId}'); if(!done.has('${qId}')){sc++;done.add('${qId}');up();}">Show</button>`;
      }

      html += `</div>`;
      // Feedback row (hidden by default, spans full width)
      const solutionText = (q.solution || '').replace(/Step (\d)/g, '<br>Step $1').replace(/Answer:/g, '<br><strong>Answer:</strong>');
      html += `<div id="${qId}-hint" class="hint-box" style="display:none;margin:0 14px;font-size:13px;">${fmt(q.hint || '')}</div>`;
      html += `<div id="${qId}-result" class="result-box" style="margin:0 14px;"></div>`;
      html += `<div id="${qId}-solution" class="solution-box" style="display:none;margin:0 14px;font-size:13px;"><strong>&#9989;</strong> ${fmt(solutionText)}</div>`;
      html += `<button id="${qId}-show" class="btn-show" style="display:none;margin:4px 14px;font-size:11px;" onclick="toggleSolution('${qId}')">Show Answer</button>`;
    } else {
      // Card layout (existing style)
      html += `<div class="q-card" id="${qId}-card">
        <p class="q-text"><strong>${qLabel}</strong> ${fmtQuestion(q.question)}</p>`;

      // Show example if present
      if (q.example) {
        html += `<div style="margin:8px 0 12px;padding:10px 14px;background:rgba(195,220,216,0.07);border-left:3px solid rgba(195,220,216,0.4);border-radius:0 8px 8px 0;font-size:13px;color:#A8B5B3;font-style:italic;">${fmt(q.example)}</div>`;
      }

      if (q.imageUrl) {
        html += `<div class="q-image" style="margin:0 0 14px;text-align:center"><img src="${embedImage(q.imageUrl)}" alt="${q.diagramDescription || 'Worksheet diagram'}" style="max-width:320px;border-radius:8px;border:1px solid rgba(195,220,216,0.2);background:#fff;padding:8px;"></div>`;
      }

      if (isActivity) {
        html += `
        <div class="activity-box" style="margin:12px 0;padding:18px 20px;background:linear-gradient(135deg,rgba(147,176,172,0.08),rgba(197,189,150,0.08));border-radius:12px;border:1px solid rgba(147,176,172,0.25)">
          <p style="font-size:13px;color:#A8B5B3;margin:0 0 12px;line-height:1.5">This is a hands-on activity. Try it on paper!</p>
        </div>
        <div class="q-actions" style="display:flex;gap:10px;margin-top:10px">
          <button class="btn-show" style="display:inline-block" onclick="toggleSolution('${qId}'); if(!done.has('${qId}')){sc++;done.add('${qId}');up();}">Show Answer</button>
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
          <textarea id="${qId}-input" class="q-input" rows="3" placeholder="Write your answer here..." style="width:100%;min-height:80px;resize:vertical;font-size:14px;padding:10px;border-radius:8px;border:1.5px solid rgba(195,220,216,0.3);background:rgba(255,255,255,0.05);color:#F0EEEC;font-family:inherit;"></textarea>
          <div style="display:flex;gap:10px;">
            <button class="btn-check" onclick="checkAnswer('${qId}')">Check</button>
            ${q.hint ? `<button class="btn-hint" onclick="toggleHint('${qId}')">Hint</button>` : ''}
          </div>
        </div>`;
        } else {
          html += `
        <div class="q-input-row">
          <span class="q-label">${labelText}</span>
          <input type="text" id="${qId}-input" class="q-input" placeholder="${placeholder}">
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
    const s = tierStyles[task.tier] || tierStyles['MUST DO'];
    const taskTitle = (task.title || '').replace(/^(Task\s*\d+)\s*[:\.]\s*/i, '$1 &middot; ').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const layout = task.layout || { type: 'single-column', columns: 1 };
    const questions = task.questions || [];

    tasksHTML += `
    <div class="task-block" style="border-left:5px solid ${s.border}; background:${s.bg}; border-radius:12px; padding:20px 24px; margin:28px 0;">
      <span class="tier-badge" style="display:inline-block;background:${s.labelBg};color:${s.label};font-weight:800;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;padding:4px 12px;border-radius:4px;margin-bottom:6px;">${task.tier}</span>
      <h2 style="font-size:18px;color:${s.label};margin:6px 0 18px;font-weight:700;">${taskTitle}</h2>
      ${task.passage ? `<div style="margin:0 0 20px;padding:16px 20px;background:rgba(255,255,255,0.04);border:1px solid rgba(195,220,216,0.2);border-radius:10px;font-size:14px;color:#D8E8E6;line-height:1.8;">${fmt(task.passage)}</div>` : ''}`;

    // ── PAGE IMAGE FALLBACK: show worksheet page when individual crops are missing ──
    const anyQuestionNeedsImage = questions.some(q => q.hasImage && !q.imageUrl);
    if (anyQuestionNeedsImage && task.pageImageUrl) {
      tasksHTML += `<div style="text-align:center;margin:0 0 16px;"><img src="${embedImage(task.pageImageUrl)}" alt="Worksheet reference" style="max-width:100%;max-height:500px;border-radius:8px;border:1px solid rgba(195,220,216,0.2);background:#fff;padding:8px;"></div>`;
    }

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

      // Diagram row (show cropped images if available)
      const hasAnyImage = leftQuestions.some(q => q.imageUrl) || rightQuestions.some(q => q.imageUrl);
      if (hasAnyImage) {
        tasksHTML += `<tr>`;
        for (let col = 0; col < 2; col++) {
          const colQ = col === 0 ? leftQuestions : rightQuestions;
          tasksHTML += `<td style="width:50%;padding:12px;text-align:center;vertical-align:middle;border:1px solid rgba(195,220,216,0.15);background:rgba(28,28,28,0.6);">`;
          const firstQ = colQ[0];
          if (firstQ && firstQ.imageUrl) {
            tasksHTML += `<img src="${embedImage(firstQ.imageUrl)}" alt="Diagram" style="max-width:240px;max-height:200px;border-radius:6px;background:#fff;padding:6px;">`;
          }
          tasksHTML += `</td>`;
        }
        tasksHTML += `</tr>`;
      }

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
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${quiz.title || 'Quiz'} - Aivorah</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0F0F0F; color: #F0EEEC; line-height: 1.6; }

    /* ── Header — Aivorah Enchanted Forest ── */
    .header { background: linear-gradient(135deg, #1C1C1C 0%, #252525 100%); color: #F0EEEC; padding: 28px 40px; position: relative; border-bottom: 1px solid rgba(195,220,216,0.12); }
    .header-sub { font-size: 13px; color: #5A6B69; margin-bottom: 4px; }
    .header h1 { font-size: 26px; font-weight: 800; letter-spacing: -0.5px; color: #C3DCD8; }
    .header-meta { font-size: 13px; color: #5A6B69; margin-top: 4px; }

    /* ── Score Badge ── */
    .score { position: fixed; top: 20px; right: 24px; width: 76px; height: 76px; border-radius: 50%;
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
    .solution-box { margin-top: 12px; padding: 16px 18px; background: rgba(147,176,172,0.1); border-radius: 8px;
                    border-left: 4px solid #93B0AC; color: #93B0AC; font-size: 14px; line-height: 1.7; }

    /* ── Activity boxes ── */
    .activity-box { background: linear-gradient(135deg, rgba(147,176,172,0.08), rgba(197,189,150,0.08)) !important;
                    border-color: rgba(147,176,172,0.25) !important; }

    /* ── Responsive ── */
    @media (max-width: 640px) {
      .header { padding: 20px; }
      .header h1 { font-size: 20px; }
      .container { padding: 0 14px 40px; }
      .q-card { padding: 16px; }
      .score { width: 60px; height: 60px; top: 14px; right: 14px; }
      .score-num { font-size: 18px; }
      .concepts-row { flex-direction: column; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-sub">${quiz.school || 'Aivorah'} &middot; ${quiz.grade || ''}</div>
    <h1>${fmt(quiz.title || 'Interactive Quiz')}</h1>
    <div class="header-meta">Subject: ${quiz.subject || 'Mathematics'} &nbsp;|&nbsp; Powered by Aivorah</div>
  </div>

  <div class="score" id="score-badge">
    <span class="score-num" id="score-num">0/${totalQ}</span>
    <span class="score-label">Score</span>
  </div>

  <div class="container">
    <div class="progress-wrap">
      <div class="progress-title">Quiz Progress</div>
      <div class="progress-bar"><div class="progress-fill" id="pf" style="width:0%"></div></div>
      <div class="progress-pct" id="pp">0% complete</div>
    </div>

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
    const tot = ${totalQ};
    const done = new Set();
    const answers = ${JSON.stringify(answersMap)};
    const studentAnswers = {}; // { qId: { answer, correct, timeSpent } }
    const questionStartTimes = {}; // { qId: timestamp }

    // Track when each question becomes visible / gets focus
    document.addEventListener('focusin', function(e) {
      const inp = e.target.closest('input');
      if (inp && inp.id && inp.id.endsWith('-input')) {
        const qId = inp.id.replace('-input', '');
        if (!questionStartTimes[qId]) questionStartTimes[qId] = Date.now();
      }
    });

    function up() {
      document.getElementById('score-num').textContent = sc + '/' + tot;
      const pct = Math.round((done.size / tot) * 100);
      document.getElementById('pf').style.width = pct + '%';
      document.getElementById('pp').textContent = pct + '% complete';
      // Build per-question answer list
      const answersArr = Object.entries(studentAnswers).map(([qId, data]) => ({
        qId, answer: data.answer, correct: data.correct,
        timeSpent: data.timeSpent || 0,
        question: data.question || ''
      }));
      // Report score + answers to parent window (for student assignment iframe)
      try { window.parent.postMessage({ type: 'quiz-score', correct: sc, total: tot, pct: pct, completed: done.size === tot, answers: answersArr }, '*'); } catch(e) {}
    }

    function checkAnswer(id) {
      const a = answers[id];
      if (!a) return;
      const inp = document.getElementById(id + '-input');
      const val = inp.value.trim();
      if (!val) { inp.style.borderColor = '#C5BD96'; return; }
      const r = document.getElementById(id + '-result');
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
      if (ok) {
        r.innerHTML = '<span style="color:#93B0AC;font-weight:700">&#10004; Correct!</span>';
        inp.style.borderColor = '#93B0AC';
        inp.style.background = 'rgba(147,176,172,0.1)';
        if (!done.has(id)) { sc++; done.add(id); }
        document.getElementById(id + '-solution').style.display = 'block';
      } else {
        r.innerHTML = '<span style="color:#EFD1D4;font-weight:700">Not quite. Try again!</span>';
        inp.style.borderColor = '#EFD1D4';
        document.getElementById(id + '-show').style.display = 'inline-block';
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
      if (ok) {
        r.innerHTML = '<span style="color:#93B0AC;font-weight:700">&#10004; Correct!</span>';
        if (!done.has(id)) { sc++; done.add(id); }
        document.getElementById(id + '-solution').style.display = 'block';
      } else {
        r.innerHTML = '<span style="color:#EFD1D4;font-weight:700">Not quite. Try again!</span>';
        document.getElementById(id + '-show').style.display = 'inline-block';
      }
      up();
    }

    function toggleHint(id) {
      const el = document.getElementById(id + '-hint');
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }

    function toggleSolution(id) {
      const el = document.getElementById(id + '-solution');
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }
  </script>
</body>
</html>`;
}

module.exports = router;
