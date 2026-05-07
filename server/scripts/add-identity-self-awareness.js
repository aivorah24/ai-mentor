require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');
const { pipeline } = require('@xenova/transformers');
const { v4: uuidv4 } = require('uuid');

const client = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY, checkCompatibility: false });

const CHUNKS = [
  {
    text: 'Identity and Self-Awareness is a core topic under the Who We Are transdisciplinary theme in IB PYP Grade 4 Social Studies. Students explore who they are — their values, beliefs, cultures, and what makes each person unique. They reflect on their personal identity, family background, cultural heritage, and how their experiences shape who they are becoming.',
    chunk_index: 0,
  },
  {
    text: 'Self-awareness means understanding your own emotions, strengths, and weaknesses. In Grade 4, students learn to recognise their feelings, manage emotions, and understand how their identity connects to their community and the wider world. They explore questions like: What makes me who I am? How am I similar to and different from others?',
    chunk_index: 1,
  },
  {
    text: 'Identity includes cultural identity — language, traditions, food, festivals, and values passed down through families. In IB PYP, students celebrate diversity and learn that all identities deserve respect. They also learn about personal responsibility: how our choices and actions reflect our values and shape our identity over time.',
    chunk_index: 2,
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
        unit:        'Who We Are',
        topic:       'Identity and Self-Awareness',
        description: 'Who we are — exploring personal identity, cultural heritage, emotions, and self-awareness.',
        text:        chunk.text,
        chunk_index: chunk.chunk_index,
        source:      'curated',
      },
    });
    console.log(`  Embedded chunk ${chunk.chunk_index + 1}/${CHUNKS.length}`);
  }

  await client.upsert('ai_mentor_content', { wait: true, points });
  console.log(`\nDone. Added Identity and Self-Awareness → Grade 4 Social Studies (Who We Are).`);
}

run().catch(console.error);
