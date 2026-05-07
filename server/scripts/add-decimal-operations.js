require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');
const { pipeline } = require('@xenova/transformers');
const { v4: uuidv4 } = require('uuid');

const client = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY, checkCompatibility: false });

const CHUNKS = [
  {
    text: 'Decimal Operations is a key topic in Grade 4 IB PYP Mathematics under the Number unit. A decimal number has a whole part and a fractional part separated by a decimal point. Example: 3.75 — the 3 is the whole number, .75 is the decimal part (75 hundredths). Decimals are used in money, measurements, and currency conversion. Students learn to add, subtract, and multiply decimals.',
    chunk_index: 0,
  },
  {
    text: 'Adding Decimals — Grade 4: Line up the decimal points and add column by column. Example: 12.45 + 3.6 = 16.05. Always line up the decimal points before adding. Add zeros as placeholders if needed: 12.45 + 3.60 = 16.05. Real-life example: You have ₹45.50 and earn ₹23.75 more. Total = 45.50 + 23.75 = ₹69.25.',
    chunk_index: 1,
  },
  {
    text: 'Subtracting Decimals — Grade 4: Line up the decimal points and subtract column by column. Example: 20.00 − 7.35 = 12.65. Use borrowing just like with whole numbers. Real-life example: You have ₹100.00 and spend ₹34.50. Change = 100.00 − 34.50 = ₹65.50. Always line up decimal points first before subtracting.',
    chunk_index: 2,
  },
  {
    text: 'Multiplying a Decimal by a Whole Number — Grade 4: Multiply as normal whole numbers, then place the decimal point in the answer. Count the decimal places in the original number. Example: 3.5 × 4 = 14.0. Method: 35 × 4 = 140, then place decimal = 14.0. Another example: 2.25 × 3 = 6.75. Method: 225 × 3 = 675, then place decimal (2 places) = 6.75.',
    chunk_index: 3,
  },
  {
    text: 'Decimal Conversion — Grade 4: Converting decimals to fractions and back. 0.5 = 1/2, 0.25 = 1/4, 0.75 = 3/4, 0.1 = 1/10. Converting fractions to decimals: divide the numerator by the denominator. 1 ÷ 4 = 0.25. Real-life connection: Currency conversion uses decimal multiplication. If 1 USD = 84.50 INR, then 3 USD = 3 × 84.50 = 253.50 INR. Decimals and currency go hand in hand.',
    chunk_index: 4,
  },
  {
    text: 'Practice problems for Decimal Operations Grade 4: (1) Add: 14.7 + 8.35 = ? (Answer: 23.05). (2) Subtract: 50.00 − 17.45 = ? (Answer: 32.55). (3) Multiply: 6.5 × 4 = ? (Answer: 26.0). (4) Multiply: 3.25 × 5 = ? (Answer: 16.25). (5) Convert: What is 0.75 as a fraction? (Answer: 3/4). (6) Real-world: A pen costs ₹12.50. How much do 6 pens cost? (6 × 12.50 = ₹75.00).',
    chunk_index: 5,
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
        topic:       'Decimal Operations',
        description: 'Adding, subtracting, and multiplying decimals — including multiplying a decimal by a whole number.',
        text:        chunk.text,
        chunk_index: chunk.chunk_index,
        source:      'curated',
      },
    });
    console.log(`  Embedded chunk ${chunk.chunk_index + 1}/${CHUNKS.length}`);
  }

  await client.upsert('ai_mentor_content', { wait: true, points });
  console.log(`\nDone. Added Decimal Operations → Grade 4 Mathematics (Number).`);
}

run().catch(console.error);
