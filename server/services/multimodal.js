/**
 * multimodal.js
 * Extracts TEXT and IMAGES from a PDF, captions images via Groq Vision,
 * then returns chunks ready for embedding + Qdrant storage.
 *
 * Uses pdfjs-dist v3 (legacy Node.js build) + node-canvas for rendering.
 */

const pdfParse = require('pdf-parse');
const Groq     = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Chunk text into overlapping windows ──────────────────────────────────────
function chunkText(text, size = 350, overlap = 70) {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const chunks = [];
  for (let i = 0; i < words.length; i += size - overlap) {
    const chunk = words.slice(i, i + size).join(' ');
    if (chunk.trim().length >= 40) chunks.push(chunk.trim());
  }
  return chunks;
}

// ── Caption a page image via Groq Vision ─────────────────────────────────────
async function captionImage(imageBase64, context = '') {
  try {
    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${imageBase64}` },
          },
          {
            type: 'text',
            text: `You are analyzing a page from an NCERT Grade 3 Mathematics textbook.
${context ? `Topic context: ${context}` : ''}

Describe ALL visual content visible on this page:
- Mathematical diagrams (shapes, figures, geometric constructions)
- Charts, tables, number lines, arrays
- Counting illustrations (objects grouped for counting)
- Activity illustrations that teach a math concept
- Labels, numbers, or annotations on diagrams

Be specific and educational — your description helps students find this content by search.
If this page has NO significant diagrams (mostly text/exercises only), reply with exactly: TEXT_ONLY`,
          },
        ],
      }],
    });
    const caption = response.choices[0]?.message?.content?.trim() || '';
    return caption === 'TEXT_ONLY' ? null : caption;
  } catch (err) {
    console.error('  Vision error:', err.message);
    return null;
  }
}

// ── Polyfills required by pdfjs-dist in Node.js ───────────────────────────────
function applyPolyfills() {
  const { createCanvas, Image, ImageData } = require('@napi-rs/canvas');
  if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor(init) {
        this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0;
        if (Array.isArray(init) && init.length===6) {
          [this.a,this.b,this.c,this.d,this.e,this.f]=init;
        }
        this.is2D=true;this.isIdentity=true;
      }
      multiply()  { return new globalThis.DOMMatrix(); }
      translate() { return new globalThis.DOMMatrix(); }
      scale()     { return new globalThis.DOMMatrix(); }
      rotate()    { return new globalThis.DOMMatrix(); }
      inverse()   { return new globalThis.DOMMatrix(); }
      transformPoint(p) { return p || { x:0, y:0 }; }
    };
  }
  if (typeof globalThis.ImageData === 'undefined') globalThis.ImageData = ImageData;
  if (typeof globalThis.Image    === 'undefined') globalThis.Image     = Image;
  return createCanvas;
}

// ── Render one PDF page → PNG base64 ─────────────────────────────────────────
async function renderPage(pdfDoc, pageNum) {
  try {
    const createCanvas = applyPolyfills();
    const page         = await pdfDoc.getPage(pageNum);
    const viewport     = page.getViewport({ scale: 1.5 });
    const canvas       = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx          = canvas.getContext('2d');

    const NodeCanvasFactory = {
      create(w, h)        { const c=createCanvas(w,h); return {canvas:c,context:c.getContext('2d')}; },
      reset(obj,w,h)      { obj.canvas.width=w; obj.canvas.height=h; },
      destroy()           {},
    };

    await page.render({ canvasContext: ctx, viewport, canvasFactory: NodeCanvasFactory }).promise;
    const buf = await canvas.encode('png');
    return buf.toString('base64');
  } catch {
    return null;
  }
}

// ── Main: extract text chunks + image chunks from a PDF buffer ────────────────
/**
 * Returns an array of:
 *   { type:'text',  content: string }
 *   { type:'image', content: caption_string, image_base64: string, page: number }
 */
async function processMultimodalPDF(buffer, metadata = {}) {
  const chunks = [];

  // ── 1. Full text extraction ────────────────────────────────────────────────
  const parsed     = await pdfParse(buffer);
  const textChunks = chunkText(parsed.text);
  chunks.push(...textChunks.map(c => ({ type: 'text', content: c })));

  // ── 2. Page-by-page image extraction via pdfjs-dist v3 ────────────────────
  applyPolyfills();
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  // Disable worker for Node.js
  pdfjsLib.GlobalWorkerOptions = pdfjsLib.GlobalWorkerOptions || {};
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';

  let pdfDoc;
  try {
    pdfDoc = await pdfjsLib.getDocument({
      data:           new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts:  true,
    }).promise;
  } catch (err) {
    console.log(`    ⚠️  pdfjs failed (${err.message}) — text only`);
    return chunks;
  }

  console.log(`    Pages: ${pdfDoc.numPages}`);

  for (let p = 1; p <= pdfDoc.numPages; p++) {
    process.stdout.write(`    Page ${p}/${pdfDoc.numPages} `);
    try {
      const page   = await pdfDoc.getPage(p);
      const opList = await page.getOperatorList();

      // Image operation codes in pdfjs-dist v3
      const IMG_OPS = new Set([pdfjsLib.OPS.paintImageXObject, pdfjsLib.OPS.paintInlineImageXObject, 82, 83, 84, 85]);
      const hasImages = opList.fnArray.some(fn => IMG_OPS.has(fn));

      if (!hasImages) { process.stdout.write('(text)\n'); continue; }

      const base64 = await renderPage(pdfDoc, p);
      if (!base64)  { process.stdout.write('(render failed)\n'); continue; }

      const caption = await captionImage(base64, metadata.topic || '');
      if (!caption) { process.stdout.write('(no diagram)\n'); continue; }

      chunks.push({ type: 'image', content: caption, image_base64: base64, page: p });
      process.stdout.write(`✅ captioned\n`);
    } catch (err) {
      process.stdout.write(`❌ ${err.message}\n`);
    }
  }

  return chunks;
}

module.exports = { processMultimodalPDF, chunkText, captionImage };
