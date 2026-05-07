require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');
const { pipeline } = require('@xenova/transformers');
const { v4: uuidv4 } = require('uuid');

const client = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY, checkCompatibility: false });

const CHUNKS = [
  {
    text: 'Currency Conversion is studied in Grade 4 IB PYP under both Mathematics and Social Studies (Economic Activities). Currency is the money used in a country. Every country has its own currency. India uses Indian Rupees (INR), the USA uses US Dollars (USD), Great Britain uses Pounds (GBP), Singapore uses Singapore Dollars (SGD), and Canada uses Canadian Dollars (CAD). To convert currencies, we multiply the amount by the exchange rate.',
    chunk_index: 0,
  },
  {
    text: 'Exchange rate examples for Grade 4: 1 British Pound (GBP) = approximately 107 Indian Rupees. 1 US Dollar (USD) = approximately 84 Indian Rupees. 1 Singapore Dollar (SGD) = approximately 63 Indian Rupees. 1 Canadian Dollar (CAD) = approximately 62 Indian Rupees. If you have 1000 Indian Rupees and want to convert to US Dollars, divide 1000 by 84 to get approximately 11.9 USD.',
    chunk_index: 1,
  },
  {
    text: 'Currency conversion connects mathematics (multiplication and division of decimals) with social studies (global trade and economics). Example problem: If 1 GBP = 107 INR, how many rupees is 5 British Pounds? Answer: 5 × 107 = 535 INR. Another example: A toy costs 20 USD. How much is that in Indian Rupees? 20 × 84 = 1680 INR. Students practice multiplying whole numbers and decimals by exchange rates.',
    chunk_index: 2,
  },
  {
    text: 'Why do countries have different currencies? Each country controls its own economy and money supply. The value of a currency changes based on trade, tourism, and economic strength. When India imports goods from the USA, it pays in US Dollars. When India exports goods like spices and textiles, it receives foreign currency. This is why understanding currency conversion is important for understanding global trade and economics.',
    chunk_index: 3,
  },
  {
    text: 'Currency conversion word problems for Grade 4: Problem 1 — Priya has 500 INR. How many US Dollars can she get? (500 ÷ 84 = 5.95 USD). Problem 2 — Rahul wants to buy a book from the UK that costs 3 GBP. How many rupees does he need? (3 × 107 = 321 INR). Problem 3 — A family travelling to Singapore needs 1000 SGD. How many rupees must they exchange? (1000 × 63 = 63,000 INR). These problems combine multiplication, division, and decimal operations.',
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
        topic:       'Currency Conversion',
        description: 'Converting between Indian Rupees and foreign currencies (GBP, USD, SGD, CAD) using multiplication and division.',
        text:        chunk.text,
        chunk_index: chunk.chunk_index,
        source:      'curated',
      },
    });
    console.log(`  Embedded chunk ${chunk.chunk_index + 1}/${CHUNKS.length}`);
  }

  await client.upsert('ai_mentor_content', { wait: true, points });
  console.log(`\nDone. Added Currency Conversion → Grade 4 Mathematics (Number).`);
}

run().catch(console.error);
