// ── Job handlers ────────────────────────────────────────────────────────────
// Register one async handler per job type: (payload, job) => result.
// Required in index.js at startup so POST /jobs/process (db mode) and worker.js
// (kafka mode) both have the handlers available.
//
// Golden rule: the heavy file lives in storage (Cloudinary/GCS); the payload
// carries its URL + metadata, never raw bytes.

const { registerHandler } = require('./jobQueue');

// Demo handler — proves the queue end-to-end (enqueue → drain → status). Safe to remove.
registerHandler('demo', async (payload) => {
  return { echoed: payload, processedAt: new Date().toISOString() };
});

// Real worksheet-extraction job — lets a teacher fire off several worksheet
// uploads back-to-back (or several teachers upload at once) without each
// browser tab blocking on a synchronous AI call. Reuses the exact same
// extraction function as the synchronous /assignments/extract-questions
// endpoint (which the demo path still uses directly) — this queued path is
// opt-in via /assignments/extract-questions-async, so it changes nothing
// about today's working flow.
registerHandler('worksheet_extract', async (payload) => {
  const { extractWorksheetContent } = require('../routes/assignments');
  return extractWorksheetContent(payload.fileList);
});

// Real quiz-generation job — the "Generating Interactive Quiz..." step reuses
// the exact same handler as the synchronous POST /quiz/generate (Gemini vision
// pipeline, diagram matching, etc.) via a mock req/res, so this queued path
// can never drift from what the synchronous endpoint does. Opt-in via
// POST /quiz/generate-async — the synchronous route is untouched.
registerHandler('quiz_generate', async (payload) => {
  const { generateQuizHandler } = require('../routes/quiz');
  const mockReq = {
    file: {
      buffer: Buffer.from(payload.fileBase64, 'base64'),
      originalname: payload.filename || 'worksheet.pdf',
      mimetype: payload.mimeType || 'application/pdf',
    },
    body: { grade: payload.grade, subject: payload.subject, school: payload.school, engine: payload.engine },
    query: {},
  };
  return new Promise((resolve, reject) => {
    const mockRes = {
      _status: 200,
      status(code) { this._status = code; return this; },
      json(body) {
        if (this._status >= 400) reject(new Error(body?.error || `quiz generation failed (${this._status})`));
        else resolve(body);
      },
    };
    generateQuizHandler(mockReq, mockRes).catch(reject);
  });
});

// Syllabus PDF extraction job — lets a teacher upload several PDFs (e.g. a
// book split across "Unit 1-5.pdf", "Unit 6-10.pdf") in one go without each
// one blocking a browser tab on a 15-30s AI call. Reuses the exact same
// canonical-extraction pipeline as the synchronous POST /teacher/syllabus/extract
// (services/syllabusExtraction.js) — this queued path can never drift from it.
registerHandler('syllabus_extract', async (payload) => {
  const { runExtraction } = require('./syllabusExtraction');
  const buffer = Buffer.from(payload.fileBase64, 'base64');
  const extractRawText = async (buf) => {
    const name = (payload.filename || '').toLowerCase();
    if (name.endsWith('.pdf')) return (await require('pdf-parse')(buf)).text;
    if (name.endsWith('.docx')) return (await require('mammoth').extractRawText({ buffer: buf })).value;
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const XLSX = require('xlsx');
      const wb = XLSX.read(buf, { type: 'buffer' });
      return wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n');
    }
    throw new Error('Unsupported file type — upload a PDF, DOCX, or XLSX.');
  };
  const { jobId, canonical, cached } = await runExtraction(buffer, extractRawText, {
    grade: payload.grade, subject: payload.subject, curriculum: payload.curriculum,
  });
  return { extractionJobId: jobId, canonical, cached, filename: payload.filename };
});

// ── Templates for the real heavy jobs — wire these incrementally ──────────────
//
// registerHandler('content_ingest', async (payload) => {
//   // payload: { fileUrl, grade, subject, ... }
//   // 1. download fileUrl from Cloudinary/GCS
//   // 2. parse (pdf-parse) → chunk → embed → upsert to Qdrant
//   // 3. return a small summary, e.g. { chunks: 232 }
// });

module.exports = {};
