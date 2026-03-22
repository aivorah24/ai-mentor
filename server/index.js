require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { initCollection, getCollectionInfo } = require('./services/qdrant');

const askRoute = require('./routes/ask');
const ingestRoute = require('./routes/ingest');
const curriculumRoute = require('./routes/curriculum');
const lessonRoute   = require('./routes/lesson');
const studentRoute   = require('./routes/student');
const scheduleRoute  = require('./routes/schedule');
const videosRoute    = require('./routes/videos');
const ncertRoute     = require('./routes/ncert');

const path = require('path');
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
// Serve saved page images
app.use('/data/images', express.static(path.join(__dirname, 'data/images')));
// Serve chapter videos
app.use('/data/videos', express.static(path.join(__dirname, 'data/videos')));

app.use('/ask', askRoute);
app.use('/ingest', ingestRoute);
app.use('/curriculum', curriculumRoute);
app.use('/lesson',  lessonRoute);
app.use('/student',  studentRoute);
app.use('/schedule', scheduleRoute);
app.use('/videos',   videosRoute);
app.use('/ncert',    ncertRoute);

app.get('/health', async (req, res) => {
  try {
    const info = await getCollectionInfo();
    res.json({
      status: 'ok',
      collection: info.result?.status || 'unknown',
      vectors_count: info.result?.vectors_count || 0,
    });
  } catch {
    res.json({ status: 'ok', qdrant: 'checking...' });
  }
});

// Initialize Qdrant collection (runs on cold start in serverless, or at startup locally)
initCollection().catch(err => {
  console.error('Qdrant init warning:', err.message);
});

// Export for Vercel serverless
module.exports = app;

// Local development server
if (require.main === module) {
  const PORT = process.env.PORT || 3006;
  app.listen(PORT, () => {
    console.log(`AI Mentor server running on http://localhost:${PORT}`);
  });
}
