/**
 * ingest-ncert-grade3-book.js
 * Pushes all chapters of NCERT Maths Mela Class 3 PDFs into Qdrant.
 *
 * Usage: node scripts/ingest-ncert-grade3-book.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const { embed }        = require('../services/embeddings');
const { upsertContent, initCollection } = require('../services/qdrant');

// ── Chapter metadata for NCERT Maths Mela Class 3 ────────────────────────────
const CHAPTERS = [
  { file: 'cemm1ps.pdf', topic: 'Prelims',                    unit: 'Introduction',   type: 'intro' },
  { file: 'cemm101.pdf', topic: 'Where to Look for Numbers',  unit: 'Numbers',        type: 'explanation' },
  { file: 'cemm102.pdf', topic: 'Fun with Numbers',           unit: 'Numbers',        type: 'explanation' },
  { file: 'cemm103.pdf', topic: 'Give and Take',              unit: 'Addition & Subtraction', type: 'explanation' },
  { file: 'cemm104.pdf', topic: 'Long and Short',             unit: 'Measurement',    type: 'explanation' },
  { file: 'cemm105.pdf', topic: 'Shapes and Designs',         unit: 'Geometry',       type: 'explanation' },
  { file: 'cemm106.pdf', topic: 'How Much Can You Carry?',    unit: 'Weight & Mass',  type: 'explanation' },
  { file: 'cemm107.pdf', topic: 'Time Goes On',               unit: 'Time',           type: 'explanation' },
  { file: 'cemm108.pdf', topic: 'Who is Heavier?',            unit: 'Weight & Mass',  type: 'explanation' },
  { file: 'cemm109.pdf', topic: 'How Many Times?',            unit: 'Multiplication & Division', type: 'explanation' },
  { file: 'cemm110.pdf', topic: 'Play with Patterns',         unit: 'Patterns',       type: 'explanation' },
  { file: 'cemm111.pdf', topic: 'Jugs and Mugs',              unit: 'Capacity',       type: 'explanation' },
  { file: 'cemm112.pdf', topic: 'Can We Share?',              unit: 'Division & Fractions', type: 'explanation' },
  { file: 'cemm113.pdf', topic: 'Smart Charts',               unit: 'Data Handling',  type: 'explanation' },
  { file: 'cemm114.pdf', topic: 'Rupees and Paise',           unit: 'Money',          type: 'explanation' },
];

const PDF_DIR    = 'C:/Users/Asus/Downloads/cemm1dd_extracted/cemm1dd';
const CURRICULUM = 'NCERT';
const GRADE      = 'Class 3';
const SUBJECT    = 'Mathematics';
const BOOK       = 'Maths Mela';

// ── Chunk text into overlapping windows ──────────────────────────────────────
function chunkText(text, size = 350, overlap = 70) {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const chunks = [];
  for (let i = 0; i < words.length; i += size - overlap) {
    const chunk = words.slice(i, i + size).join(' ');
    if (chunk.trim().length >= 50) chunks.push(chunk.trim());
  }
  return chunks;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n📚 NCERT Maths Mela — Class 3 Ingestor');
  console.log(`   Book : ${BOOK} | Grade: ${GRADE} | Curriculum: ${CURRICULUM}`);
  console.log('─'.repeat(55));

  await initCollection();

  let totalChunks = 0;

  for (const ch of CHAPTERS) {
    const filePath = path.join(PDF_DIR, ch.file);

    if (!fs.existsSync(filePath)) {
      console.log(`  ⚠️  Missing: ${ch.file} — skipping`);
      continue;
    }

    process.stdout.write(`  ⏳ ${ch.topic} ...`);

    try {
      const buffer = fs.readFileSync(filePath);
      const pdf    = await pdfParse(buffer);
      const chunks = chunkText(pdf.text);

      if (chunks.length === 0) {
        console.log(' ⚠️  No text extracted (may be image-only PDF)');
        continue;
      }

      const points = [];
      for (const chunk of chunks) {
        const vector = await embed(chunk);
        points.push({
          id: crypto.randomUUID(),
          vector,
          payload: {
            curriculum,
            grade:        GRADE,
            subject:      SUBJECT,
            unit:         ch.unit,
            topic:        ch.topic,
            content_type: ch.type,
            content:      chunk,
            book:         BOOK,
            source_file:  ch.file,
            school_id:    'default',
            uploaded_by:  'ncert_seed',
            ingested_at:  new Date().toISOString(),
          },
        });
      }

      await upsertContent(points);
      totalChunks += points.length;
      console.log(` ✅ ${points.length} chunks`);

    } catch (err) {
      console.log(` ❌ ${err.message}`);
    }
  }

  console.log('─'.repeat(55));
  console.log(`✅ Done! ${totalChunks} chunks ingested into Qdrant.`);
  console.log(`   Collection: ai_mentor_content | Curriculum: ${CURRICULUM}`);
  process.exit(0);
}

const curriculum = CURRICULUM; // used in payload
run().catch(err => { console.error('Fatal:', err); process.exit(1); });
