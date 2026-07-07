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

// ── Templates for the real heavy jobs — wire these incrementally ──────────────
//
// registerHandler('content_ingest', async (payload) => {
//   // payload: { fileUrl, grade, subject, ... }
//   // 1. download fileUrl from Cloudinary/GCS
//   // 2. parse (pdf-parse) → chunk → embed → upsert to Qdrant
//   // 3. return a small summary, e.g. { chunks: 232 }
// });

module.exports = {};
