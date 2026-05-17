require('dotenv').config();

let express, cors, initCollection, getCollectionInfo;
try {
  express = require('express');
  cors = require('cors');
  ({ initCollection, getCollectionInfo } = require('./services/qdrant'));
} catch(e) {
  // Return error info for debugging
  console.error('STARTUP ERROR:', e.message, e.stack);
  module.exports = (req, res) => res.status(500).json({ startup_error: e.message, stack: e.stack });
  // Don't return — start a minimal server so Cloud Run health check passes
  const http = require('http');
  http.createServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ startup_error: e.message }));
  }).listen(process.env.PORT || 3006, () => {
    console.error('Minimal error server listening on port', process.env.PORT || 3006);
  });
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
const teacherRoute     = require('./routes/teacher');
const userRoute        = require('./routes/user');
const messagesRoute    = require('./routes/messages');
const devlogRoute      = require('./routes/devlog');
const dailyTidbitRoute = require('./routes/daily-tidbit');
const adminRoute       = require('./routes/admin');
const analyticsRoute   = require('./routes/analytics');
const ibpypRoute       = require('./routes/ibpyp');
const worldRoute       = require('./routes/world');
const helpRoute        = require('./routes/help');
const storiesRoute     = require('./routes/stories');
const habitsRoute      = require('./routes/habits');
// Payment route — lazy-loaded to avoid crash if Razorpay env vars missing
// const paymentRoute  = require('./routes/payment');

// Heavy routes — lazy-loaded on first request to avoid startup crashes
// (ingest uses pdf-parse/@napi-rs/canvas; ask/curriculum use @xenova/transformers)
function lazyRoute(modPath) {
  let cached;
  return (req, res, next) => {
    try {
      if (!cached) cached = require(modPath);
      cached(req, res, next);
    } catch (err) {
      console.error(`[lazyRoute] Failed to load ${modPath}:`, err.message);
      res.status(500).json({ error: `Route module failed to load: ${err.message}` });
    }
  };
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
// Serve message attachments
app.use('/data/uploads', express.static(path.join(__dirname, 'data/uploads')));

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
app.use('/teacher',      teacherRoute);
app.use('/user',         userRoute);
app.use('/messages',     messagesRoute);
app.use('/devlog',       devlogRoute);
app.use('/daily-tidbit', dailyTidbitRoute);
app.use('/admin',        adminRoute);
app.use('/analytics',    analyticsRoute);
app.use('/ibpyp',        ibpypRoute);
app.use('/world',        worldRoute);
app.use('/help',         helpRoute);
app.use('/stories',      storiesRoute);
app.use('/habits',       habitsRoute);
app.use('/payment',      lazyRoute('./routes/payment'));
app.use('/quiz',         lazyRoute('./routes/quiz'));


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

// Serve icon fonts from server/public/fonts — committed directly to avoid
// Docker .dockerignore node_modules exclusion issues
app.use(
  '/assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts',
  express.static(path.join(__dirname, 'public/fonts'), { maxAge: '1y', immutable: true })
);

// Static assets (JS/CSS) are hashed — cache forever; HTML must not be cached
app.use(express.static(FRONTEND_DIR, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));
// SPA fallback — all non-API routes serve index.html
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// Export for Vercel serverless
module.exports = app;

// Always start the server (Cloud Run runs node index.js directly)
const PORT = process.env.PORT || 3006;
app.listen(PORT, () => {
  console.log(`Aivorah server running on http://localhost:${PORT}`);
});
