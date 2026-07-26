// ocr-ingest.cjs — OCR the image/legacy-font NCERT books (Urdu, Hindi, Sanskrit)
// with Gemini Vision and ingest the REAL text into Qdrant, so they can be
// grounded + lesson-generated like any other subject. pdf-parse can't read these
// (Urdu=scanned images, Hindi/Sanskrit=legacy Kruti-Dev font → mojibake); OCR of
// the RENDERED page gives correct Unicode. ~₹0.04/page, shares the batch ledger.
//
//   node scripts/ocr-ingest.cjs --grade 2 --subject Urdu --folder urdu
//
// Resumable: skips PDFs already OCR-ingested (per checkpoint). Budget-guarded via
// the shared batch-spend-ledger so it can't blow the Gemini cap.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { embed } = require('../services/embeddings');
const { upsertContent } = require('../services/qdrant');
const crypto = require('crypto');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const GEMINI_KEY = (process.env.GEMINI_API_KEY || '').trim();
const BOOKS = path.resolve(__dirname, '..', 'data', 'ncert_books');
const CKPT = path.resolve(__dirname, '..', 'data', 'ocr-checkpoint.json');
const LEDGER = path.resolve(__dirname, '..', 'data', 'batch-spend-ledger.json');
const readSpend = () => { try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')).spend || 0; } catch { return 0; } };
const addSpend = r => { const c = readSpend() + r; try { fs.writeFileSync(LEDGER, JSON.stringify({ spend: c, updated: new Date().toISOString() })); } catch {} return c; };
const ckpt = (() => { try { return JSON.parse(fs.readFileSync(CKPT, 'utf8')); } catch { return { files: {} }; } })();
const saveCkpt = () => fs.writeFileSync(CKPT, JSON.stringify(ckpt, null, 1));

async function ocrPage(pngBuf, langLabel) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
  const body = JSON.stringify({
    contents: [{ parts: [
      { text: `This is a page from an NCERT ${langLabel} textbook. Transcribe ALL the ${langLabel} text on this page exactly, in natural reading order. Output ONLY the transcribed text — no translation, no commentary. If the page has no readable body text (cover/full illustration), output an empty string.` },
      { inline_data: { mime_type: 'image/png', data: pngBuf.toString('base64') } },
    ] }],
    generationConfig: { temperature: 0, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
  });
  for (let a = 0; a < 4; a++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (res.status === 429) { await new Promise(r => setTimeout(r, 10000 * (a + 1))); continue; }
    if (!res.ok) throw new Error(`gemini ${res.status}`);
    const d = await res.json();
    const text = d?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    const toks = d?.usageMetadata?.totalTokenCount || 300;
    return { text: text.trim(), rupees: toks / 1e6 * 80 };
  }
  throw new Error('gemini rate-limited out');
}

function chunkText(text, size = 350, overlap = 70) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
  const out = [];
  for (let i = 0; i < words.length; i += (size - overlap)) { const c = words.slice(i, i + size).join(' '); if (c.trim()) out.push(c); }
  return out;
}

(async () => {
  const grade = arg('--grade'), subject = arg('--subject'), folder = arg('--folder');
  const budget = parseFloat(arg('--budget', '200'));
  if (!GEMINI_KEY || !grade || !subject || !folder) { console.error('need --grade --subject --folder'); process.exit(1); }
  const dir = path.join(BOOKS, `grade${grade}`, folder);
  if (!fs.existsSync(dir)) { console.error(`no folder ${dir}`); process.exit(1); }

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = require('@napi-rs/canvas');
  const pdfs = fs.readdirSync(dir).filter(f => f.endsWith('.pdf')).sort();
  console.log(`OCR ${subject} G${grade}: ${pdfs.length} PDFs`);

  let pageCount = 0;
  for (const file of pdfs) {
    const key = `grade${grade}/${folder}/${file}`;
    if (ckpt.files[key]) { continue; }
    if (readSpend() >= budget) { console.log(`💰 budget ₹${budget} hit — stopping.`); break; }
    const topic = file.replace('.pdf', '');
    let allText = '';
    try {
      const raw = fs.readFileSync(path.join(dir, file));
      // FAST PATH: if pdf-parse already yields real Devanagari/Arabic script text,
      // skip OCR entirely (free + instant). Only OCR mojibake/scanned pages.
      try {
        const parsed = await require('pdf-parse')(raw);
        const script = (parsed.text.match(/[ऀ-ॿ؀-ۿ]/g) || []).length;
        const latin = (parsed.text.match(/[a-zA-Z]/g) || []).length;
        if (script > 100 && script > latin) {
          allText = parsed.text;
          const chunks = chunkText(allText);
          const points = [];
          for (const c of chunks) { points.push({ id: crypto.randomUUID(), vector: await embed(c), payload: { curriculum: 'NCERT', grade: Number(grade), subject, topic, content_type: 'explanation', content: c, source: `TEXT:${file}` } }); }
          if (points.length) await upsertContent(points);
          ckpt.files[key] = { chunks: points.length, mode: 'text', at: new Date().toISOString() }; saveCkpt();
          console.log(`  ✅ ${file}: ${points.length} chunks (direct text, ₹0) · GLOBAL ₹${readSpend().toFixed(2)}`);
          continue;
        }
      } catch {}
      // OCR PATH: render + Gemini Vision.
      const data = new Uint8Array(raw);
      const doc = await pdfjs.getDocument({ data, disableWorker: true }).promise;
      for (let pg = 1; pg <= doc.numPages; pg++) {
        if (readSpend() >= budget) break;
        const page = await doc.getPage(pg);
        const vp = page.getViewport({ scale: 2.0 });
        const canvas = createCanvas(vp.width, vp.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        const { text, rupees } = await ocrPage(canvas.toBuffer('image/png'), subject);
        addSpend(rupees); pageCount++;
        if (text.length > 20) allText += text + '\n';
      }
      // chunk + embed + upsert
      const chunks = chunkText(allText);
      const points = [];
      for (let i = 0; i < chunks.length; i++) {
        const vector = await embed(chunks[i]);
        points.push({ id: crypto.randomUUID(), vector, payload: {
          curriculum: 'NCERT', grade: Number(grade), subject, topic,
          content_type: 'explanation', content: chunks[i], source: `OCR:${file}`,
        } });
      }
      if (points.length) await upsertContent(points);
      ckpt.files[key] = { chunks: points.length, at: new Date().toISOString() }; saveCkpt();
      console.log(`  ✅ ${file}: ${chunks.length} chunks · GLOBAL ₹${readSpend().toFixed(2)}`);
    } catch (e) { console.log(`  ❌ ${file}: ${e.message}`); }
  }
  console.log(`=== ${subject} G${grade} DONE: ${pageCount} pages OCR'd · GLOBAL ₹${readSpend().toFixed(2)} ===`);
})();
