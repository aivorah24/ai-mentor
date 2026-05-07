require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');
const { pipeline } = require('@xenova/transformers');
const { v4: uuidv4 } = require('uuid');

const client = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY, checkCompatibility: false });

const CHUNKS = [
  {
    text: 'Human Body Systems is studied under the Who We Are transdisciplinary theme in IB PYP Grade 4 Social Studies. Students explore how the human body works — the digestive system breaks down food for energy, the circulatory system pumps blood through the heart and vessels, and the respiratory system brings oxygen into the body. Understanding our bodies connects to identity and self-awareness: who we are as living beings.',
    chunk_index: 0,
  },
  {
    text: 'The human body has organ systems that work together. The digestive system: mouth, stomach, intestines — breaks food into nutrients. The circulatory system: heart, blood, veins, arteries — delivers oxygen and nutrients. The respiratory system: lungs, trachea — exchanges oxygen and carbon dioxide. Each system depends on the others to keep us healthy and alive.',
    chunk_index: 1,
  },
  {
    text: 'In IB PYP Grade 4, Human Body Systems is connected to the central idea of identity and self-awareness under the Who We Are unit of inquiry. Students reflect on how understanding their own body helps them make healthy choices, understand emotions, and recognise that all humans share the same biological systems regardless of background or culture.',
    chunk_index: 2,
  },
];

async function run() {
  console.log('Loading embedder...');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  const points = [];
  for (const chunk of CHUNKS) {
    const output = await embedder(chunk.text, { pooling: 'mean', normalize: true });
    const vector = Array.from(output.data);
    points.push({
      id: uuidv4(),
      vector,
      payload: {
        grade:       'Grade 4',
        subject:     'Social Studies',
        curriculum:  'IB_PYP',
        unit:        'Who We Are',
        topic:       'Human Body Systems',
        description: 'How the digestive, circulatory, and respiratory systems work — connecting to identity and self-awareness.',
        text:        chunk.text,
        chunk_index: chunk.chunk_index,
        source:      'curated',
      },
    });
    console.log(`  Embedded chunk ${chunk.chunk_index + 1}/${CHUNKS.length}`);
  }

  await client.upsert('ai_mentor_content', { wait: true, points });
  console.log(`\nDone. Added ${points.length} chunks for Human Body Systems → Grade 4 Social Studies (Who We Are).`);
}

run().catch(console.error);
