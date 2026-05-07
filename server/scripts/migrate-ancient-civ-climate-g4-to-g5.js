/**
 * Migration: Move Ancient Civilizations + Climate Zones and Geography
 * from Grade 4 to Grade 5 in Qdrant (IB PYP Social Studies)
 *
 * Confirmed by Ela (Reddy E) on 05-05-2026 — these are Grade 5 topics.
 *
 * Run: node server/scripts/migrate-ancient-civ-climate-g4-to-g5.js
 */
require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');

const COLLECTION = 'ai_mentor_content';
const client = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
  checkCompatibility: false,
});

const TOPICS_TO_MOVE = ['Ancient Civilizations', 'Climate Zones and Geography'];

async function run() {
  let moved = 0;
  let offset = null;

  console.log('Scanning Qdrant for Grade 4 IB PYP Social Studies points...');

  const pointsToUpdate = [];

  do {
    const result = await client.scroll(COLLECTION, {
      filter: {
        must: [
          { key: 'curriculum', match: { value: 'IB_PYP' } },
          { key: 'grade',      match: { value: 'Grade 4' } },
          { key: 'subject',    match: { value: 'Social Studies' } },
        ],
      },
      limit: 100,
      offset: offset ?? undefined,
      with_payload: true,
      with_vector: true,
    });

    for (const point of result.points) {
      if (TOPICS_TO_MOVE.includes(point.payload.topic)) {
        pointsToUpdate.push(point);
      }
    }

    offset = result.next_page_offset ?? null;
  } while (offset !== null);

  console.log(`Found ${pointsToUpdate.length} point(s) to move to Grade 5.`);

  for (const point of pointsToUpdate) {
    const updatedPayload = { ...point.payload, grade: 'Grade 5' };

    // Upsert with updated grade (keeps same ID, same vector, updated payload)
    await client.upsert(COLLECTION, {
      wait: true,
      points: [{
        id:      point.id,
        vector:  point.vector,
        payload: updatedPayload,
      }],
    });

    console.log(`  Moved: [${point.payload.topic}] Grade 4 → Grade 5 (id: ${point.id})`);
    moved++;
  }

  console.log(`\nDone. ${moved} point(s) moved to Grade 5.`);
}

run().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
