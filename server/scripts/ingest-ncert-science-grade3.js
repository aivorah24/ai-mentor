/**
 * ingest-ncert-science-grade3.js
 * Ingests NCERT Class 3 EVS "Our Wondrous World" into Qdrant.
 * Usage: node scripts/ingest-ncert-science-grade3.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const pdfParse = require('pdf-parse');
const { embed }                         = require('../services/embeddings');
const { upsertContent, initCollection } = require('../services/qdrant');

const CHAPTERS = [
  { file: 'ceev101.pdf', topic: 'Our Families and Communities',  unit: 'Unit 1 — Our Families and Communities' },
  { file: 'ceev102.pdf', topic: 'Going to the Mela',            unit: 'Unit 1 — Our Families and Communities' },
  { file: 'ceev103.pdf', topic: 'Celebrating Festivals',        unit: 'Unit 1 — Our Families and Communities' },
  { file: 'ceev104.pdf', topic: 'Life Around Us',               unit: 'Unit 2 — Living Together' },
  { file: 'ceev105.pdf', topic: 'Plants and Animals Live Together', unit: 'Unit 2 — Living Together' },
  { file: 'ceev106.pdf', topic: 'Living in Harmony',            unit: 'Unit 2 — Living Together' },
  { file: 'ceev107.pdf', topic: 'Gifts of Nature',              unit: 'Unit 3 — Gifts of Nature' },
  { file: 'ceev108.pdf', topic: 'Food We Eat',                  unit: 'Unit 3 — Gifts of Nature' },
  { file: 'ceev109.pdf', topic: 'Staying Healthy and Happy',    unit: 'Unit 3 — Gifts of Nature' },
  { file: 'ceev110.pdf', topic: 'Things Around Us',             unit: 'Unit 4 — Things Around Us' },
  { file: 'ceev111.pdf', topic: 'Making Things',                unit: 'Unit 4 — Things Around Us' },
  { file: 'ceev112.pdf', topic: 'Taking Charge of Waste',       unit: 'Unit 4 — Things Around Us' },
];

const PDF_DIR    = 'C:/Users/Asus/Downloads/ncert_science_grade3';
const CURRICULUM = 'NCERT';
const GRADE      = 'Grade 3';
const SUBJECT    = 'Science';
const BOOK       = 'Our Wondrous World';

function chunkText(text, size = 350, overlap = 70) {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const chunks = [];
  for (let i = 0; i < words.length; i += size - overlap) {
    const chunk = words.slice(i, i + size).join(' ');
    if (chunk.trim().length >= 50) chunks.push(chunk.trim());
  }
  return chunks;
}

async function run() {
  console.log('\n📗 NCERT Our Wondrous World — Class 3 Science/EVS Ingestor');
  console.log(`   Book: ${BOOK} | Grade: ${GRADE} | Curriculum: ${CURRICULUM}`);
  console.log('─'.repeat(60));

  await initCollection();

  let totalChunks = 0;

  for (const ch of CHAPTERS) {
    const filePath = path.join(PDF_DIR, ch.file);

    if (!fs.existsSync(filePath)) {
      console.log(`  ⚠  Missing: ${ch.file} — skipping`);
      continue;
    }

    process.stdout.write(`  Ingesting: "${ch.topic}" ...`);

    try {
      const buffer = fs.readFileSync(filePath);
      const parsed = await pdfParse(buffer);
      const chunks = chunkText(parsed.text);

      if (chunks.length === 0) {
        console.log(' (no text extracted, skipping)');
        continue;
      }

      const points = [];
      for (const chunk of chunks) {
        const vector = await embed(chunk);
        points.push({
          id: crypto.randomUUID(),
          vector,
          payload: {
            curriculum:   CURRICULUM,
            grade:        GRADE,
            subject:      SUBJECT,
            unit:         ch.unit,
            topic:        ch.topic,
            content_type: 'explanation',
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
      console.log(` done (${points.length} chunks)`);

    } catch (err) {
      console.log(` ERROR: ${err.message}`);
    }
  }

  console.log('─'.repeat(60));
  console.log(`Done! ${totalChunks} chunks ingested into Qdrant.`);
  console.log(`Collection: ai_mentor_content | Subject: ${SUBJECT} | Grade: ${GRADE}`);
  process.exit(0);
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
