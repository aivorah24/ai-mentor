require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');
const { pipeline } = require('@xenova/transformers');
const { v4: uuidv4 } = require('uuid');

const client = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY, checkCompatibility: false });

const CHUNKS = [
  {
    text: 'The Barter System is the earliest form of trade, studied in Grade 4 IB PYP Social Studies under Economic Activities (How We Organize Ourselves). Before money existed, people exchanged goods directly — this is called bartering. For example, a farmer might trade 10 kg of rice for a pot made by a potter. No money changes hands — just goods for goods or services for services.',
    chunk_index: 0,
  },
  {
    text: 'History of the Barter System: The barter system began thousands of years ago. Ancient civilizations in Mesopotamia (around 6000 BC) used barter to trade grain, livestock, and tools. In ancient India, people traded spices, cloth, and food. The Portuguese came to India in the 1400s and 1500s specifically to trade for spices like pepper, cardamom, and cinnamon, which were more valuable than gold in Europe at that time.',
    chunk_index: 1,
  },
  {
    text: 'Problems with the Barter System: Barter worked well in small communities but had limitations. The biggest problem was the "double coincidence of wants" — both people had to want exactly what the other had. For example, if you had rice but wanted cloth, you needed to find someone who had cloth AND wanted rice. This was difficult and time-consuming, which is why money was eventually invented.',
    chunk_index: 2,
  },
  {
    text: 'Evolution from Barter to Currency: As trade grew, people needed something everyone would accept. First, commodity money was used — items with value like shells, salt, and gold. The word "salary" comes from the Latin word for salt (sal) because Roman soldiers were sometimes paid in salt. Over time, coins were minted from gold and silver. Paper money came later, and today we also use digital payments.',
    chunk_index: 3,
  },
  {
    text: 'Barter System today: Even today, barter still happens in some situations. Countries sometimes trade goods with each other without using money — called countertrade. In villages and communities, people still exchange services. For example, a doctor might treat a farmer in exchange for vegetables. Online barter platforms also exist. Understanding barter helps students understand the origin of economics and why money was invented.',
    chunk_index: 4,
  },
  {
    text: 'Barter System practice questions for Grade 4: (1) What is the barter system? (Exchanging goods or services without using money). (2) What was the main problem with barter? (Double coincidence of wants). (3) Why did the Portuguese come to India? (To trade for spices like pepper and cardamom). (4) What did people use before coins? (Shells, salt, and gold as commodity money). (5) Give one example of barter happening today. (Countries trading goods, or a doctor treating a farmer for vegetables).',
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
        subject:     'Social Studies',
        curriculum:  'IB_PYP',
        unit:        'How We Organize Ourselves',
        topic:       'Barter System',
        description: 'The earliest form of trade — exchanging goods without money, its history, problems, and evolution into modern currency.',
        text:        chunk.text,
        chunk_index: chunk.chunk_index,
        source:      'curated',
      },
    });
    console.log(`  Embedded chunk ${chunk.chunk_index + 1}/${CHUNKS.length}`);
  }

  await client.upsert('ai_mentor_content', { wait: true, points });
  console.log(`\nDone. Added Barter System → Grade 4 Social Studies (How We Organize Ourselves).`);
}

run().catch(console.error);
