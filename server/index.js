require('dotenv').config();

let express, cors, initCollection, getCollectionInfo;
try {
  express = require('express');
  cors = require('cors');
  ({ initCollection, getCollectionInfo } = require('./services/qdrant'));
} catch(e) {
  // Return error info for debugging
  module.exports = (req, res) => res.status(500).json({ startup_error: e.message, stack: e.stack });
  return;
}

// Core routes — always loaded
const lessonRoute      = require('./routes/lesson');
const studentRoute     = require('./routes/student');
const scheduleRoute    = require('./routes/schedule');
const videosRoute      = require('./routes/videos');
const ncertRoute       = require('./routes/ncert');
const modulesRoute     = require('./routes/modules');
const assignmentsRoute  = require('./routes/assignments');
const challengesRoute   = require('./routes/challenges');
const parentRoute      = require('./routes/parent');
const userRoute        = require('./routes/user');
const messagesRoute    = require('./routes/messages');
const devlogRoute      = require('./routes/devlog');

// Heavy routes — lazy-loaded on first request to avoid startup crashes
// (ingest uses pdf-parse/@napi-rs/canvas; ask/curriculum use @xenova/transformers)
function lazyRoute(path) {
  return (req, res, next) => require(path)(req, res, next);
}

const path = require('path');
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
// Serve saved page images and scene images
app.use('/data/images', express.static(path.join(__dirname, 'data/images')));
// Serve chapter videos
app.use('/data/videos', express.static(path.join(__dirname, 'data/videos')));
// Serve cached TTS audio files
app.use('/data/audio', express.static(path.join(__dirname, 'data/audio')));

app.use('/ask',        lazyRoute('./routes/ask'));
app.use('/ingest',     lazyRoute('./routes/ingest'));
app.use('/curriculum', lazyRoute('./routes/curriculum'));
app.use('/lesson',  lessonRoute);
app.use('/student',  studentRoute);
app.use('/schedule', scheduleRoute);
app.use('/videos',   videosRoute);
app.use('/ncert',    ncertRoute);
app.use('/modules',      modulesRoute);
app.use('/assignments',  assignmentsRoute);
app.use('/challenges',   challengesRoute);
app.use('/parent',       parentRoute);
app.use('/user',         userRoute);
app.use('/messages',     messagesRoute);
app.use('/devlog',       devlogRoute);

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

// Serve the React Native web frontend (Expo export output)
const FRONTEND_DIR = path.join(__dirname, '../AIMentorApp/dist2');
app.use(express.static(FRONTEND_DIR));
// SPA fallback — all non-API routes serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// Export for Vercel serverless
module.exports = app;

// Local development server
if (require.main === module) {
  const PORT = process.env.PORT || 3006;
  app.listen(PORT, () => {
    console.log(`Aivorah server running on http://localhost:${PORT}`);
  });
}
