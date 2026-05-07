require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');
const { pipeline } = require('@xenova/transformers');
const { v4: uuidv4 } = require('uuid');

const client = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY, checkCompatibility: false });

const CHUNKS = [
  {
    text: 'Indian Place Value Chart is studied in Grade 4 IB PYP Mathematics. India uses its own unique place value system different from the international system. Digits are grouped from the right: the first group has 3 digits (Ones, Tens, Hundreds), then every group after that has 2 digits. The groups are: Ones period (H, T, O), Thousands period (Th, TTh), Lakhs period (L, TL), and Crores period (C, TC). For example: 5,23,45,678 is read as five crore twenty-three lakh forty-five thousand six hundred and seventy-eight.',
    chunk_index: 0,
  },
  {
    text: 'Indian place values and their worth: Ones = 1, Tens = 10, Hundreds = 100, Thousands = 1,000, Ten Thousands = 10,000, Lakhs = 1,00,000, Ten Lakhs = 10,00,000, Crores = 1,00,00,000, Ten Crores = 10,00,00,000. One lakh has 6 digits. One crore has 8 digits. Commas are placed after every 2 digits from the right (after the first 3). Example: 3,45,67,890 = Three crore forty-five lakh sixty-seven thousand eight hundred and ninety.',
    chunk_index: 1,
  },
  {
    text: 'Indian vs International number system comparison: 1 Lakh (Indian) = 1,00,000 = 100 Thousand (International). 10 Lakh = 10,00,000 = 1 Million. 1 Crore = 1,00,00,000 = 10 Million. 10 Crore = 10,00,00,000 = 100 Million. 1 Arab (Indian) = 1,00,00,00,000 = 1 Billion. Understanding both systems helps read international news, cricket statistics, government budgets, and business reports. When news says a company earned 50 million dollars, that is 5 crore dollars.',
    chunk_index: 2,
  },
  {
    text: 'How to read and write large numbers in the Indian system: Step 1 — mark groups from the right (first 3, then pairs of 2). Step 2 — label each group: ones, thousands, lakhs, crores. Step 3 — read each group with its period name. Example: 2,34,56,789 — mark groups: 789 (ones), 56 (thousands), 34 (lakhs), 2 (crores). Read as: two crore thirty-four lakh fifty-six thousand seven hundred and eighty-nine. Expanded form: 2,00,00,000 + 34,00,000 + 56,000 + 700 + 89.',
    chunk_index: 3,
  },
  {
    text: 'Practice questions for Indian Place Value Chart Grade 4: (1) Write 45,67,890 in words — Forty-five lakh sixty-seven thousand eight hundred and ninety. (2) What is the place value of 3 in 3,45,678? — 3 is in the lakhs place, value = 3,00,000. (3) How many digits does one crore have? — 8 digits: 1,00,00,000. (4) Write in figures: Seven crore five lakh three thousand two hundred and nine — 7,05,03,209. (5) What is 10 lakhs in international terms? — 1 million.',
    chunk_index: 4,
  },
];

async function run() {
  console.log('Loading embedder...');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  const points = [];
  for (const chunk of CHUNKS) {
    const output = await embedder(chunk.text, { pooling: 'mean', normalize: true });
    points.push({
      id: uuidv4(),
      vector: Array.from(output.data),
      payload: {
        grade:       'Grade 4',
        subject:     'Mathematics',
        curriculum:  'IB_PYP',
        unit:        'Number',
        topic:       'Indian Place Value Chart',
        description: 'Ones, tens, hundreds, thousands, ten-thousands, lakhs, ten-lakhs, crores — the Indian number system.',
        text:        chunk.text,
        chunk_index: chunk.chunk_index,
        source:      'curated',
      },
    });
    console.log(`  Embedded chunk ${chunk.chunk_index + 1}/${CHUNKS.length}`);
  }

  await client.upsert('ai_mentor_content', { wait: true, points });
  console.log(`\nDone. Added Indian Place Value Chart → Grade 4 Mathematics.`);
}

run().catch(console.error);
