const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const crypto   = require('crypto');
const { embed }                    = require('../services/embeddings');
const { upsertContent }            = require('../services/qdrant');
const { processMultimodalPDF, chunkText } = require('../services/multimodal');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max for image-heavy PDFs
});

// POST /ingest
// Multipart form: file (PDF) + metadata fields
// OR JSON body with { content, ...metadata } for plain text
//
// Query param: ?mode=multimodal  → extract text + images (slower, uses Vision AI)
//              ?mode=text        → text only (default, fast)

router.post('/', upload.single('file'), async (req, res) => {
  try {
    const {
      curriculum   = 'IB_PYP',
      grade,
      subject,
      unit,
      topic,
      content_type = 'explanation',
      school_id    = 'default',
      uploaded_by  = 'teacher',
    } = req.body;

    const mode = req.query.mode || 'text';
    const metadata = { curriculum, grade, subject, unit, topic };

    const points = [];

    // ── Multimodal PDF (text + images) ──────────────────────────────────────
    if (req.file && mode === 'multimodal') {
      const rawChunks = await processMultimodalPDF(req.file.buffer, { topic });

      for (const chunk of rawChunks) {
        const vector  = await embed(chunk.content);
        const payload = {
          curriculum,
          grade,
          subject,
          unit,
          topic,
          content_type: chunk.type,   // "text" or "image"
          content:      chunk.content, // text or vision caption
          school_id,
          uploaded_by,
          ingested_at: new Date().toISOString(),
        };
        if (chunk.type === 'image') {
          payload.image_base64 = chunk.image_base64;
          payload.page         = chunk.page;
        }
        points.push({ id: crypto.randomUUID(), vector, payload });
      }

    // ── Text-only PDF ────────────────────────────────────────────────────────
    } else if (req.file) {
      const pdfParse = require('pdf-parse');
      const pdf      = await pdfParse(req.file.buffer);
      const chunks   = chunkText(pdf.text);

      for (const chunk of chunks) {
        const vector = await embed(chunk);
        points.push({
          id: crypto.randomUUID(),
          vector,
          payload: { curriculum, grade, subject, unit, topic, content_type, content: chunk, school_id, uploaded_by, ingested_at: new Date().toISOString() },
        });
      }

    // ── Plain text ───────────────────────────────────────────────────────────
    } else if (req.body.content) {
      const chunks = chunkText(req.body.content);
      for (const chunk of chunks) {
        const vector = await embed(chunk);
        points.push({
          id: crypto.randomUUID(),
          vector,
          payload: { curriculum, grade, subject, unit, topic, content_type, content: chunk, school_id, uploaded_by, ingested_at: new Date().toISOString() },
        });
      }

    } else {
      return res.status(400).json({ error: 'Provide a PDF file or text content' });
    }

    if (points.length === 0) {
      return res.status(400).json({ error: 'No usable content found in the document' });
    }

    await upsertContent(points);

    const textCount  = points.filter(p => p.payload.content_type !== 'image').length;
    const imageCount = points.filter(p => p.payload.content_type === 'image').length;

    res.json({
      success:        true,
      chunks_ingested: points.length,
      text_chunks:    textCount,
      image_chunks:   imageCount,
      message:        `Ingested ${textCount} text + ${imageCount} image chunks into Qdrant`,
    });

  } catch (err) {
    console.error('Error in /ingest:', err.message);
    res.status(500).json({ error: 'Failed to ingest content. Please try again.' });
  }
});

module.exports = router;
