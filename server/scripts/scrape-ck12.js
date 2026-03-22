require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const axios = require('axios');
const { embed } = require('../services/embeddings');
const { upsertContent, initCollection } = require('../services/qdrant');

// IB PYP Grade 3, 4, 5 topics → Wikipedia article titles
const TOPICS = [
  // ─── GRADE 3 ───────────────────────────────────────────────────
  { wiki: 'Addition',               grade: 'Grade 3', subject: 'Mathematics',    unit: 'How the World Works',          topic: 'Addition' },
  { wiki: 'Subtraction',            grade: 'Grade 3', subject: 'Mathematics',    unit: 'How the World Works',          topic: 'Subtraction' },
  { wiki: 'Multiplication',         grade: 'Grade 3', subject: 'Mathematics',    unit: 'How the World Works',          topic: 'Multiplication' },
  { wiki: 'Fraction',               grade: 'Grade 3', subject: 'Mathematics',    unit: 'How the World Works',          topic: 'Introduction to Fractions' },
  { wiki: 'Perimeter',              grade: 'Grade 3', subject: 'Mathematics',    unit: 'How We Organize Ourselves',    topic: 'Perimeter' },
  { wiki: 'Food_chain',             grade: 'Grade 3', subject: 'Science',        unit: 'Sharing the Planet',           topic: 'Food Chains' },
  { wiki: 'Water_cycle',            grade: 'Grade 3', subject: 'Science',        unit: 'How the World Works',          topic: 'Water Cycle' },
  { wiki: 'Plant',                  grade: 'Grade 3', subject: 'Science',        unit: 'Sharing the Planet',           topic: 'Plants' },
  { wiki: 'State_of_matter',        grade: 'Grade 3', subject: 'Science',        unit: 'How the World Works',          topic: 'States of Matter' },
  { wiki: 'Weather',                grade: 'Grade 3', subject: 'Science',        unit: 'How the World Works',          topic: 'Weather' },
  { wiki: 'Community',              grade: 'Grade 3', subject: 'Social Studies', unit: 'How We Organize Ourselves',    topic: 'Communities' },
  { wiki: 'Map',                    grade: 'Grade 3', subject: 'Social Studies', unit: 'Where We Are in Place and Time', topic: 'Maps and Globes' },

  // ─── GRADE 4 ───────────────────────────────────────────────────
  { wiki: 'Division_(mathematics)', grade: 'Grade 4', subject: 'Mathematics',    unit: 'How the World Works',          topic: 'Division' },
  { wiki: 'Equivalent_fractions',   grade: 'Grade 4', subject: 'Mathematics',    unit: 'How the World Works',          topic: 'Equivalent Fractions' },
  { wiki: 'Decimal',                grade: 'Grade 4', subject: 'Mathematics',    unit: 'How We Organize Ourselves',    topic: 'Decimals' },
  { wiki: 'Area',                   grade: 'Grade 4', subject: 'Mathematics',    unit: 'How We Organize Ourselves',    topic: 'Area' },
  { wiki: 'Divisor',                grade: 'Grade 4', subject: 'Mathematics',    unit: 'How the World Works',          topic: 'Factors and Multiples' },
  { wiki: 'Ecosystem',              grade: 'Grade 4', subject: 'Science',        unit: 'Sharing the Planet',           topic: 'Ecosystems' },
  { wiki: 'Force',                  grade: 'Grade 4', subject: 'Science',        unit: 'How the World Works',          topic: 'Force and Motion' },
  { wiki: 'Energy',                 grade: 'Grade 4', subject: 'Science',        unit: 'How the World Works',          topic: 'Energy' },
  { wiki: 'Rock_(geology)',         grade: 'Grade 4', subject: 'Science',        unit: 'Where We Are in Place and Time', topic: 'Rocks and Minerals' },
  { wiki: 'Adaptation',             grade: 'Grade 4', subject: 'Science',        unit: 'Sharing the Planet',           topic: 'Animal Adaptations' },
  { wiki: 'Ancient_history',        grade: 'Grade 4', subject: 'Social Studies', unit: 'Where We Are in Place and Time', topic: 'Ancient Civilizations' },
  { wiki: 'Government',             grade: 'Grade 4', subject: 'Social Studies', unit: 'How We Organize Ourselves',    topic: 'Government' },

  // ─── GRADE 5 ───────────────────────────────────────────────────
  { wiki: 'Photosynthesis',         grade: 'Grade 5', subject: 'Science',        unit: 'How the World Works',          topic: 'Photosynthesis' },
  { wiki: 'Solar_System',           grade: 'Grade 5', subject: 'Science',        unit: 'Where We Are in Place and Time', topic: 'Solar System' },
  { wiki: 'Matter',                 grade: 'Grade 5', subject: 'Science',        unit: 'How the World Works',          topic: 'Properties of Matter' },
  { wiki: 'Climate',                grade: 'Grade 5', subject: 'Science',        unit: 'Sharing the Planet',           topic: 'Climate' },
  { wiki: 'Human_body',             grade: 'Grade 5', subject: 'Science',        unit: 'Who We Are',                   topic: 'Human Body' },
  { wiki: 'Volume',                 grade: 'Grade 5', subject: 'Mathematics',    unit: 'How We Organize Ourselves',    topic: 'Volume' },
  { wiki: 'Order_of_operations',    grade: 'Grade 5', subject: 'Mathematics',    unit: 'How the World Works',          topic: 'Order of Operations' },
  { wiki: 'Statistics',             grade: 'Grade 5', subject: 'Mathematics',    unit: 'How We Organize Ourselves',    topic: 'Graphs and Data' },
  { wiki: 'Culture',                grade: 'Grade 5', subject: 'Social Studies', unit: 'Who We Are',                   topic: 'World Cultures' },
  { wiki: 'Economics',              grade: 'Grade 5', subject: 'Social Studies', unit: 'How We Organize Ourselves',    topic: 'Economics' },
  { wiki: 'Geometry',               grade: 'Grade 5', subject: 'Mathematics',    unit: 'How We Organize Ourselves',    topic: 'Geometry' },
  { wiki: 'Biodiversity',           grade: 'Grade 5', subject: 'Science',        unit: 'Sharing the Planet',           topic: 'Biodiversity' },
];

async function fetchWikipedia(title) {
  try {
    // Wikipedia REST API — returns clean plain text extract
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'AIMentorApp/1.0 (educational project)' },
      timeout: 10000,
    });
    return data.extract || null;
  } catch {
    return null;
  }
}

async function fetchWikipediaFull(title) {
  try {
    // Full article text via MediaWiki API
    const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=true&titles=${encodeURIComponent(title)}&format=json&exsectionformat=plain`;
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'AIMentorApp/1.0 (educational project)' },
      timeout: 10000,
    });
    const pages = data.query.pages;
    const page = pages[Object.keys(pages)[0]];
    return page.extract || null;
  } catch {
    return null;
  }
}

function chunkText(text, chunkSize = 250, overlap = 50) {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim().length >= 80) chunks.push(chunk);
    i += chunkSize - overlap;
  }
  return chunks;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('\n🚀 AI Mentor — Wikipedia Scraper for IB PYP Grade 3, 4, 5\n');
  await initCollection();

  let totalChunks = 0;
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < TOPICS.length; i++) {
    const t = TOPICS[i];
    process.stdout.write(`[${i + 1}/${TOPICS.length}] ${t.grade} ${t.subject} — ${t.topic} ... `);

    // Try full article first, fallback to summary
    let text = await fetchWikipediaFull(t.wiki);
    if (!text || text.length < 200) {
      text = await fetchWikipedia(t.wiki);
    }

    if (!text || text.length < 100) {
      console.log('❌ No content');
      failCount++;
      continue;
    }

    // Keep first 2000 words (most relevant, intro sections)
    const words = text.split(/\s+/);
    const trimmed = words.slice(0, 2000).join(' ');

    const chunks = chunkText(trimmed);
    const points = [];

    for (const chunk of chunks) {
      const vector = await embed(chunk);
      points.push({
        id: crypto.randomUUID(),
        vector,
        payload: {
          curriculum: 'IB_PYP',
          grade: t.grade,
          subject: t.subject,
          unit: t.unit,
          topic: t.topic,
          content_type: 'explanation',
          content: chunk,
          school_id: 'demo',
          uploaded_by: 'wikipedia',
          source: `https://en.wikipedia.org/wiki/${t.wiki}`,
          ingested_at: new Date().toISOString(),
        },
      });
    }

    await upsertContent(points);
    totalChunks += points.length;
    successCount++;
    console.log(`✅ ${points.length} chunks`);

    await sleep(500); // Polite delay
  }

  console.log('\n─────────────────────────────────────────');
  console.log(`✅ ${successCount}/${TOPICS.length} topics ingested`);
  console.log(`📦 Total chunks in Qdrant: ${totalChunks}`);
  console.log('─────────────────────────────────────────\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
