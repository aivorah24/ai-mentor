require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { client, COLLECTION } = require('../services/qdrant');

async function deleteOldCBSE() {
  console.log('Deleting old CBSE seed data from Qdrant...');
  const result = await client.delete(COLLECTION, {
    filter: {
      must: [
        { key: 'curriculum', match: { value: 'CBSE' } },
      ],
    },
  });
  console.log('Delete result:', JSON.stringify(result, null, 2));
  console.log('Done — old CBSE data removed.');
}

deleteOldCBSE().catch(console.error);
