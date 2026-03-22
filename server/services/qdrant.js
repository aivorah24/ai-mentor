const { QdrantClient } = require('@qdrant/js-client-rest');

const COLLECTION = 'ai_mentor_content';
const VECTOR_SIZE = 384; // all-MiniLM-L6-v2 (local, no API key)

const client = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

async function initCollection() {
  const { collections } = await client.getCollections();
  const exists = collections.some(c => c.name === COLLECTION);

  if (!exists) {
    await client.createCollection(COLLECTION, {
      vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
    });

    // Payload indexes for fast filtering during search
    const indexFields = ['curriculum', 'grade', 'subject', 'content_type', 'school_id'];
    for (const field of indexFields) {
      await client.createPayloadIndex(COLLECTION, {
        field_name: field,
        field_schema: 'keyword',
      });
    }

    console.log('✅ Qdrant collection created:', COLLECTION);
  } else {
    console.log('✅ Qdrant collection ready:', COLLECTION);
  }
}

async function searchContent({ vector, curriculum, grade, subject, limit = 5 }) {
  const must = [];

  if (curriculum) must.push({ key: 'curriculum', match: { value: curriculum } });
  if (grade) must.push({ key: 'grade', match: { value: grade } });
  if (subject) must.push({ key: 'subject', match: { value: subject } });

  const results = await client.search(COLLECTION, {
    vector,
    limit,
    filter: must.length > 0 ? { must } : undefined,
    with_payload: true,
  });

  return results;
}

async function upsertContent(points) {
  await client.upsert(COLLECTION, { points, wait: true });
}

async function getCollectionInfo() {
  return client.getCollection(COLLECTION);
}

module.exports = { initCollection, searchContent, upsertContent, getCollectionInfo, client, COLLECTION };
