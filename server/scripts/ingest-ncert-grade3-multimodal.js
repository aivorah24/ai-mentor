/**
 * ingest-ncert-grade3-multimodal.js
 * Full multimodal ingestion of NCERT Maths Mela Class 3.
 * Extracts TEXT + IMAGES (with Groq Vision captions) and stores both in Qdrant.
 *
 * Usage: node scripts/ingest-ncert-grade3-multimodal.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { processMultimodalPDF } = require('../services/multimodal');
const { embed }                = require('../services/embeddings');
const { upsertContent, initCollection } = require('../services/qdrant');

const PDF_DIR    = 'C:/Users/Asus/Downloads/cemm1dd_extracted/cemm1dd';
const CURRICULUM = 'NCERT';
const GRADE      = 'Class 3';
const SUBJECT    = 'Mathematics';
const BOOK       = 'Maths Mela';

const CHAPTERS = [
  { file: 'cemm1ps.pdf', topic: 'Prelims',                    unit: 'Introduction'            },
  { file: 'cemm101.pdf', topic: 'Where to Look for Numbers',  unit: 'Numbers'                 },
  { file: 'cemm102.pdf', topic: 'Fun with Numbers',           unit: 'Numbers'                 },
  { file: 'cemm103.pdf', topic: 'Give and Take',              unit: 'Addition & Subtraction'  },
  { file: 'cemm104.pdf', topic: 'Long and Short',             unit: 'Measurement'             },
  { file: 'cemm105.pdf', topic: 'Shapes and Designs',         unit: 'Geometry',               skip: true },
  { file: 'cemm106.pdf', topic: 'How Much Can You Carry?',    unit: 'Weight & Mass',           skip: true },
  { file: 'cemm107.pdf', topic: 'Time Goes On',               unit: 'Time',                    skip: true },
  { file: 'cemm108.pdf', topic: 'Who is Heavier?',            unit: 'Weight & Mass',           skip: true },
  { file: 'cemm109.pdf', topic: 'How Many Times?',            unit: 'Multiplication & Division',skip: true},
  { file: 'cemm110.pdf', topic: 'Play with Patterns',         unit: 'Patterns',                skip: true },
  { file: 'cemm111.pdf', topic: 'Jugs and Mugs',              unit: 'Capacity',                skip: true },
  { file: 'cemm112.pdf', topic: 'Can We Share?',              unit: 'Division & Fractions',    skip: true },
  { file: 'cemm113.pdf', topic: 'Smart Charts',               unit: 'Data Handling',           skip: true },
  { file: 'cemm114.pdf', topic: 'Rupees and Paise',           unit: 'Money',                   skip: true },
];

async function run() {
  console.log('\n📚 NCERT Maths Mela Class 3 — Multimodal Ingestor');
  console.log('   Extracts: TEXT + IMAGES (Vision-captioned)');
  console.log('─'.repeat(58));

  await initCollection();

  let totalText  = 0;
  let totalImage = 0;

  for (const ch of CHAPTERS) {
    if (ch.skip) { console.log(`  ⏭️  Skipping (already done): ${ch.topic}`); continue; }
    const filePath = path.join(PDF_DIR, ch.file);
    if (!fs.existsSync(filePath)) {
      console.log(`  ⚠️  Missing: ${ch.file}`);
      continue;
    }

    console.log(`\n  📄 [${ch.topic}]`);
    const buffer = fs.readFileSync(filePath);

    // Extract text + image chunks
    const rawChunks = await processMultimodalPDF(buffer, { topic: ch.topic });

    const points = [];
    for (const chunk of rawChunks) {
      const vector = await embed(chunk.content);

      const payload = {
        curriculum,
        grade:        GRADE,
        subject:      SUBJECT,
        unit:         ch.unit,
        topic:        ch.topic,
        content_type: chunk.type,           // "text" or "image"
        content:      chunk.content,        // text chunk OR vision caption
        book:         BOOK,
        source_file:  ch.file,
        school_id:    'default',
        uploaded_by:  'ncert_multimodal',
        ingested_at:  new Date().toISOString(),
      };

      // Save image to disk; store only path in Qdrant (avoids large payload)
      if (chunk.type === 'image') {
        const imgDir  = path.join(__dirname, '../data/images/ncert/grade3');
        fs.mkdirSync(imgDir, { recursive: true });
        const imgFile = `${ch.file.replace('.pdf', '')}_page${chunk.page}.png`;
        fs.writeFileSync(path.join(imgDir, imgFile), Buffer.from(chunk.image_base64, 'base64'));
        payload.image_path = `/data/images/ncert/grade3/${imgFile}`;
        payload.page       = chunk.page;
        totalImage++;
      } else {
        totalText++;
      }

      points.push({ id: crypto.randomUUID(), vector, payload });
    }

    if (points.length > 0) {
      await upsertContent(points);
      const tCount = rawChunks.filter(c => c.type === 'text').length;
      const iCount = rawChunks.filter(c => c.type === 'image').length;
      console.log(`  ✅ Stored: ${tCount} text chunks + ${iCount} image chunks`);
    }
  }

  console.log('\n' + '─'.repeat(58));
  console.log(`✅ Complete!`);
  console.log(`   Text chunks  : ${totalText}`);
  console.log(`   Image chunks : ${totalImage}`);
  console.log(`   Total        : ${totalText + totalImage} points in Qdrant`);
  process.exit(0);
}

const curriculum = CURRICULUM;
run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
