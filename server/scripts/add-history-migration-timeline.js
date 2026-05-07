require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');
const { pipeline } = require('@xenova/transformers');
const { v4: uuidv4 } = require('uuid');

const client = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY, checkCompatibility: false });

const TOPICS = [
  {
    topic: 'History of Migration',
    description: 'Why people have moved across the world throughout history — trade routes, conquests, famines, and the search for better lives.',
    chunks: [
      'History of Migration is studied under the Where We Are in Place and Time transdisciplinary theme in IB PYP Grade 4 Social Studies. Migration is the movement of people from one place to another. Throughout history, people have migrated for many reasons: to find food, escape war, seek trade opportunities, or build new communities. Examples include the Portuguese coming to India for spices, the movement of people along the Silk Road, and the migration of communities during famines.',
      'Historical migration shaped cultures around the world. When people move, they bring their language, food, traditions, and ideas with them. This mixing of cultures creates new societies. Push factors force people to leave — war, drought, poverty, persecution. Pull factors attract people to a new place — safety, jobs, fertile land, and opportunity. Students study real historical examples of migration and how they shaped the world we live in today.',
      'Key examples of historical migration for Grade 4: The Portuguese explorers who sailed to India for spices in the 1400s. The ancient Silk Road traders who connected China to Europe. The movement of people during the Mughal Empire in India. In modern times, migration continues — people move between cities, countries, and continents. Understanding why people migrate helps us understand history, geography, and our own community.',
    ],
  },
  {
    topic: 'Historical Timeline',
    description: 'How to read, create, and understand timelines — placing events in chronological order to understand how history progressed.',
    chunks: [
      'Historical Timeline is studied under the Where We Are in Place and Time transdisciplinary theme in IB PYP Grade 4 Social Studies. A timeline is a visual representation of events arranged in chronological order — from earliest to most recent. Timelines help us understand how history progressed, how events are connected, and how the world has changed over time. Students learn to read timelines, place events correctly, and create their own.',
      'Key timeline concepts for Grade 4: BC (Before Christ) and AD (Anno Domini) — how years are numbered. Chronological order means earliest event first. Timelines can cover a few years or thousands of years. Landmark events on a world history timeline include: Ancient Egypt (3000 BC), Ancient Greece (500 BC), Roman Empire (27 BC–476 AD), Portuguese exploration of India (1498), Mughal Empire in India (1526), and Independence of India (1947).',
      'Creating a timeline helps students understand cause and effect in history. When students place events like the barter system, ancient trade routes, the introduction of coins, and modern banking in order, they can see how economic systems evolved. Timelines connect to other Social Studies topics — migration, civilizations, government, and trade — showing how all of history is interconnected.',
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
          subject:     'Social Studies',
          curriculum:  'IB_PYP',
          unit:        'Where We Are in Place and Time',
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

  await client.upsert('ai_mentor_content', { wait: true, points });
  console.log(`\nDone. Added ${points.length} chunks for History of Migration + Historical Timeline → Grade 4 Social Studies (Where We Are in Place and Time).`);
}

run().catch(console.error);
