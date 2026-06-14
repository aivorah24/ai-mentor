require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');
const { pipeline } = require('@xenova/transformers');
const { v4: uuidv4 } = require('uuid');

const client = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY, checkCompatibility: false });

const CHUNKS = [
  {
    text: 'LCM (Least Common Multiple) is studied in Grade 4 IB PYP Mathematics. The LCM of two or more numbers is the smallest number that is a multiple of all of them. A multiple is what you get by counting up by a number — multiples of 4 are 4, 8, 12, 16, 20, and multiples of 6 are 6, 12, 18, 24. The smallest number that appears in both lists is 12, so the LCM of 4 and 6 is 12.',
    chunk_index: 0,
  },
  {
    text: 'Listing Multiples Method for finding LCM: Step 1 — write out the multiples of each number in order. Step 2 — circle the multiples that appear in every list. Step 3 — pick the smallest circled number, that is the LCM. Example: Find the LCM of 3 and 5. Multiples of 3: 3, 6, 9, 12, 15, 18. Multiples of 5: 5, 10, 15, 20. The smallest common multiple is 15, so LCM(3, 5) = 15.',
    chunk_index: 1,
  },
  {
    text: 'Prime Factorisation Method for finding LCM: Step 1 — write each number as a product of its prime factors. Step 2 — for each prime factor, take the highest power that appears in any number. Step 3 — multiply these highest powers together to get the LCM. Example: Find the LCM of 8 and 12. 8 = 2 x 2 x 2. 12 = 2 x 2 x 3. The highest power of 2 is 2 x 2 x 2 = 8, and the highest power of 3 is 3. LCM = 8 x 3 = 24.',
    chunk_index: 2,
  },
  {
    text: 'LCM in real life: LCM helps solve everyday problems about repeating events. Bus schedules — Bus A leaves every 4 minutes and Bus B leaves every 6 minutes; both buses leave together every LCM(4, 6) = 12 minutes. Party planning — hot dogs come in packs of 8 and buns come in packs of 12; to have equal numbers of each with no leftovers you need LCM(8, 12) = 24 of each, so 3 packs of hot dogs and 2 packs of buns. Tiling a floor — tiles that are 4 cm and 6 cm wide line up evenly every LCM(4, 6) = 12 cm.',
    chunk_index: 3,
  },
  {
    text: 'Practice questions for LCM Grade 4: (1) Find the LCM of 6 and 8 using listing — multiples of 6: 6, 12, 18, 24, 30; multiples of 8: 8, 16, 24, 32 — LCM = 24. (2) Find the LCM of 9 and 12 using prime factorisation — 9 = 3 x 3, 12 = 2 x 2 x 3 — LCM = 2 x 2 x 3 x 3 = 36. (3) Two friends jog around a track, one every 5 minutes and the other every 7 minutes — after how many minutes will they meet again at the start? LCM(5, 7) = 35 minutes. (4) What is the LCM of 4 and 5? 20. (5) Why is the LCM never smaller than the larger of the two numbers? Because the LCM must be a multiple of every number, and the smallest multiple of a number that is at least as big as it is the number itself.',
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
        topic:       'LCM (Least Common Multiple)',
        description: 'Finding the LCM using the listing-multiples and prime-factorisation methods, with real-life examples.',
        text:        chunk.text,
        chunk_index: chunk.chunk_index,
        source:      'curated',
      },
    });
    console.log(`  Embedded chunk ${chunk.chunk_index + 1}/${CHUNKS.length}`);
  }

  await client.upsert('ai_mentor_content', { wait: true, points });
  console.log(`\nDone. Added LCM (Least Common Multiple) → Grade 4 Mathematics.`);
}

run().catch(console.error);
