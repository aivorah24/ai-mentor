/**
 * ingest-cbse-official.js
 * Downloads and ingests official CBSE Student Handbooks (2026-27) for Grade 3-6
 * Source: cbseacademic.nic.in
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const pdfParse = require('pdf-parse');
const { embed }                         = require('../services/embeddings');
const { upsertContent, initCollection } = require('../services/qdrant');

const CURRICULUM = 'CBSE';

const DATA_DIR = path.resolve(__dirname, '..', 'data', 'cbse_books');
const BOOKS = [
  { grade: 'Grade 3', file: path.join(DATA_DIR, 'cbse_grade3.pdf') },
  { grade: 'Grade 4', file: path.join(DATA_DIR, 'cbse_grade4.pdf') },
  { grade: 'Grade 5', file: path.join(DATA_DIR, 'cbse_grade5.pdf') },
  { grade: 'Grade 6', file: path.join(DATA_DIR, 'cbse_grade6.pdf') },
];

// Split text into overlapping chunks
function chunkText(text, size = 300, overlap = 60) {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const chunks = [];
  for (let i = 0; i < words.length; i += size - overlap) {
    const chunk = words.slice(i, i + size).join(' ');
    if (chunk.trim().length >= 80) chunks.push(chunk.trim());
  }
  return chunks;
}

// Detect subject from chunk text
function detectSubject(text) {
  const t = text.toLowerCase();
  if (t.includes('math') || t.includes('number') || t.includes('addition') ||
      t.includes('subtract') || t.includes('multiply') || t.includes('divide') ||
      t.includes('fraction') || t.includes('geometry') || t.includes('algebra')) {
    return 'Mathematics';
  }
  if (t.includes('science') || t.includes('plant') || t.includes('animal') ||
      t.includes('force') || t.includes('light') || t.includes('sound') ||
      t.includes('cell') || t.includes('matter') || t.includes('environment')) {
    return 'Science';
  }
  if (t.includes('english') || t.includes('grammar') || t.includes('poem') ||
      t.includes('story') || t.includes('comprehension') || t.includes('writing')) {
    return 'English';
  }
  if (t.includes('hindi') || t.includes('हिंदी') || t.includes('पाठ')) {
    return 'Hindi';
  }
  if (t.includes('social') || t.includes('history') || t.includes('geography') ||
      t.includes('civics') || t.includes('evs') || t.includes('environment')) {
    return 'EVS/Social Studies';
  }
  return 'General';
}

async function ingestBook({ grade, file }) {
  console.log(`\n📚 Processing ${grade} — ${path.basename(file)}`);

  const buffer = fs.readFileSync(file);
  const parsed = await pdfParse(buffer);
  const text   = parsed.text
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E\n]/g, ' ')
    .trim();

  console.log(`   Extracted ${text.length} chars, ${parsed.numpages} pages`);

  const chunks = chunkText(text);
  console.log(`   Split into ${chunks.length} chunks`);

  let success = 0;
  for (let i = 0; i < chunks.length; i++) {
    try {
      const chunk   = chunks[i];
      const subject = detectSubject(chunk);
      const vector  = await embed(chunk);
      const id      = parseInt(
        crypto.createHash('md5')
          .update(`cbse_official|${grade}|${i}|${chunk.slice(0, 50)}`).digest('hex').slice(0, 8),
        16
      );

      await upsertContent([{
        id,
        vector,
        payload: {
          curriculum: CURRICULUM,
          grade,
          subject,
          topic:   `${grade} — ${subject}`,
          unit:    'Official CBSE Curriculum',
          text:    chunk,
          source:  'cbse_official_handbook_2026_27',
          seeder:  'ingest_cbse_official',
          type:    'curriculum',
          page:    Math.floor(i / 3) + 1,
        },
      }]);

      success++;
      if (i % 20 === 0) process.stdout.write(`   Progress: ${i}/${chunks.length}\r`);
    } catch (err) {
      console.error(`   ✗ Chunk ${i}: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`   ✓ ${success}/${chunks.length} chunks ingested for ${grade}`);
  return success;
}

async function run() {
  console.log('🚀 CBSE Official Handbook Ingestor (2026-27)');
  console.log('   Source: cbseacademic.nic.in');
  console.log('='.repeat(50));

  await initCollection();

  let total = 0;
  for (const book of BOOKS) {
    if (!fs.existsSync(book.file)) {
      console.error(`✗ File not found: ${book.file}`);
      continue;
    }
    total += await ingestBook(book);
  }

  console.log(`\n✅ Done! Total chunks ingested: ${total}`);
}

run().catch(console.error);
