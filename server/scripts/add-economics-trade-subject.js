require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');
const { pipeline } = require('@xenova/transformers');
const { v4: uuidv4 } = require('uuid');

const client = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY, checkCompatibility: false });

const TOPICS = [
  {
    topic: 'Types of Money',
    description: 'From shells and salt to coins and paper money — how currency evolved across history.',
    chunks: [
      'Types of Money is studied in Grade 4 IB PYP Economics & Trade. Before coins existed, people used commodity money — items that had value themselves. Ancient civilizations used shells (cowrie shells in Africa and Asia), salt (Roman soldiers were paid in salt — the word salary comes from sal, Latin for salt), grain, and livestock as money. These worked better than barter because everyone agreed on their value.',
      'The first coins were made in ancient Lydia (modern Turkey) around 600 BC from a gold-silver alloy called electrum. Coins spread to Greece, Rome, India, and China. In ancient India, punch-marked coins called Karshapana were used. Paper money was invented in China during the Tang Dynasty (618–907 AD). Marco Polo was amazed when he saw paper money in China — Europeans still used coins.',
      'Modern money: Today we have coins, paper notes, and digital money. Each country issues its own currency controlled by a central bank (India: Reserve Bank of India, USA: Federal Reserve). The value of currency changes daily based on trade and economics. Interesting fact: India has the highest denomination note of ₹2000. USA has the $100 bill called the "Benjamin" after Benjamin Franklin whose portrait is on it.',
    ],
  },
  {
    topic: 'Trade Routes',
    description: 'How the Portuguese came to India for spices — ancient and modern trade routes that connected the world.',
    chunks: [
      'Trade Routes are paths used by merchants to exchange goods between countries and regions. The most famous ancient trade route is the Silk Road — a network of routes connecting China to Europe through Central Asia and India. Merchants traded silk, spices, gold, glass, and ideas. The Silk Road was not one road but many routes by land and sea, active from around 200 BC to 1450 AD.',
      'The Spice Trade: Spices like pepper, cardamom, cinnamon, and cloves from India and Southeast Asia were worth more than gold in medieval Europe. They were used to preserve food and add flavour. Arab traders controlled the spice trade for centuries. In 1498, the Portuguese explorer Vasco da Gama sailed around Africa to reach Calicut (Kozhikode) in Kerala, India — opening a direct sea route for Europeans to buy spices. This changed world history and trade forever.',
      'Modern trade routes: Today, goods travel by container ships, aeroplanes, and trucks. The busiest shipping route passes through the Strait of Malacca (between Malaysia and Indonesia). India exports software, textiles, spices, and pharmaceuticals. It imports oil, electronics, and gold. Understanding trade routes helps us understand why countries are interdependent — no country can produce everything it needs on its own.',
    ],
  },
];

async function run() {
  console.log('Loading embedder...');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  const points = [];
  for (const topic of TOPICS) {
    for (let i = 0; i < topic.chunks.length; i++) {
      const output = await embedder(topic.chunks[i], { pooling: 'mean', normalize: true });
      points.push({
        id: uuidv4(),
        vector: Array.from(output.data),
        payload: {
          grade:       'Grade 4',
          subject:     'Economics & Trade',
          curriculum:  'IB_PYP',
          unit:        'How We Organize Ourselves',
          topic:       topic.topic,
          description: topic.description,
          text:        topic.chunks[i],
          chunk_index: i,
          source:      'curated',
        },
      });
      console.log(`  Embedded: ${topic.topic} chunk ${i + 1}/${topic.chunks.length}`);
    }
  }

  // Also move Barter System from Social Studies to Economics & Trade in Qdrant
  // (update existing barter system chunks to new subject)
  const barterResult = await client.scroll('ai_mentor_content', {
    filter: { must: [
      { key: 'grade', match: { value: 'Grade 4' } },
      { key: 'topic', match: { value: 'Barter System' } },
    ]},
    limit: 20, with_payload: true, with_vector: true,
  });

  for (const point of barterResult.points) {
    points.push({
      id: point.id,
      vector: point.vector,
      payload: { ...point.payload, subject: 'Economics & Trade' },
    });
    console.log(`  Updated Barter System point to Economics & Trade (id: ${point.id})`);
  }

  // Also move Currency Conversion from Mathematics to Economics & Trade
  const currencyResult = await client.scroll('ai_mentor_content', {
    filter: { must: [
      { key: 'grade', match: { value: 'Grade 4' } },
      { key: 'topic', match: { value: 'Currency Conversion' } },
    ]},
    limit: 20, with_payload: true, with_vector: true,
  });

  for (const point of currencyResult.points) {
    points.push({
      id: point.id,
      vector: point.vector,
      payload: { ...point.payload, subject: 'Economics & Trade' },
    });
    console.log(`  Updated Currency Conversion point to Economics & Trade (id: ${point.id})`);
  }

  await client.upsert('ai_mentor_content', { wait: true, points });
  console.log(`\nDone. Added Economics & Trade subject with ${points.length} total points.`);
}

run().catch(console.error);
