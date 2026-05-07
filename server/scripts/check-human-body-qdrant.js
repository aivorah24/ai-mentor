require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');
const client = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY, checkCompatibility: false });

async function run() {
  const result = await client.scroll('ai_mentor_content', {
    filter: { must: [{ key: 'topic', match: { value: 'Human Body Systems' } }] },
    limit: 20, with_payload: true, with_vector: false,
  });
  result.points.forEach(p => console.log(`grade=${p.payload.grade} subject=${p.payload.subject} unit="${p.payload.unit}" topic="${p.payload.topic}"`));
  console.log(`Total: ${result.points.length} points`);
}
run().catch(console.error);
