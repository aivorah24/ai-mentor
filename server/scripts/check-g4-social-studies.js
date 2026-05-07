require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');
const client = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY, checkCompatibility: false });

async function run() {
  const result = await client.scroll('ai_mentor_content', {
    filter: { must: [
      { key: 'grade', match: { value: 'Grade 4' } },
      { key: 'subject', match: { value: 'Social Studies' } },
      { key: 'curriculum', match: { value: 'IB_PYP' } },
    ]},
    limit: 100, with_payload: true, with_vector: false,
  });
  const topics = [...new Set(result.points.map(p => `"${p.payload.topic}" — ${p.payload.unit}`))];
  topics.sort();
  console.log(`Grade 4 Social Studies topics in Qdrant (${topics.length} unique):`);
  topics.forEach(t => console.log(' ', t));
}
run().catch(console.error);
