require('dotenv').config();

// Prefer IPv4 — some networks route IPv6/NAT64 (64:ff9b::) to Supabase and time out.
// Without this, outbound fetch() to *.supabase.co intermittently fails with UND_ERR_CONNECT_TIMEOUT.
try { require('dns').setDefaultResultOrder('ipv4first'); } catch (_) {}

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
const supabase          = require('./services/supabase');
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
const brandingRoute    = require('./routes/branding');
const messagesRoute    = require('./routes/messages');
const devlogRoute      = require('./routes/devlog');
const dailyTidbitRoute = require('./routes/daily-tidbit');
const adminRoute       = require('./routes/admin');
const analyticsRoute   = require('./routes/analytics');
const ibpypRoute       = require('./routes/ibpyp');
const mathEngineRoute  = require('./routes/mathEngine');
const worldRoute       = require('./routes/world');
const helpRoute        = require('./routes/help');
const storiesRoute     = require('./routes/stories');
const habitsRoute      = require('./routes/habits');
const shortlinkRoute   = require('./routes/shortlink');
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

// Allow Firebase's Google sign-in popup to keep its window.opener link.
// Without this, the browser's default/edge COOP severs the opener relationship,
// so Firebase can't poll the popup's window.closed and wrongly throws
// auth/popup-closed-by-user ("Google sign-in was cancelled") even when the user
// completed sign-in. 'same-origin-allow-popups' keeps the page isolated while
// still permitting popups it opens to talk back. (Beta SSO flakiness fix.)
app.use((req, res, next) => {
  res.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true })); // for the founder demo-confirm form POST
// Serve saved page images and scene images
app.use('/data/images', express.static(path.join(__dirname, 'data/images')));
// Serve chapter videos
app.use('/data/videos', express.static(path.join(__dirname, 'data/videos')));
// Serve cached TTS audio files
app.use('/data/audio', express.static(path.join(__dirname, 'data/audio')));
// Serve read-aloud audio
app.use('/data/read-aloud/audio', express.static(path.join(__dirname, 'data/read-aloud/audio')));
// Serve message attachments
app.use('/data/uploads', express.static(path.join(__dirname, 'data/uploads')));
// Serve UI sounds
app.use('/sounds', express.static(path.join(__dirname, 'public/sounds')));
// Serve the real NCERT textbook PDFs (for the "real book" pane in the reading experience).
// Local disk is checked first (fast path, and how local dev always worked),
// but data/ncert_books is gitignored and NOT baked into the deployed image -
// on Cloud Run/Vercel it's empty on every fresh instance. The real source of
// truth is Supabase Storage (bucket "ncert-books" - see
// scripts/upload-pdfs-to-supabase.js, which uploads every file under this
// exact grade/subject/file.pdf path). Without this fallback, a missing local
// file fell through to the SPA catch-all further down, which returned
// index.html (200 OK) - the iframe rendered that HTML page instead of a PDF,
// silently showing the landing page where a real book page should be.
app.use('/data/ncert_books', express.static(path.join(__dirname, 'data/ncert_books')));
const NCERT_BOOKS_BUCKET = 'ncert-books';
app.get('/data/ncert_books/*', async (req, res) => {
  const key = req.path.replace(/^\/data\/ncert_books\//, '');
  try {
    const { data, error } = await supabase.storage
      .from(NCERT_BOOKS_BUCKET)
      .createSignedUrl(key, 600); // 10 min - plenty for one page view
    if (error || !data?.signedUrl) {
      return res.status(404).json({ error: 'Book page not found' });
    }
    return res.redirect(302, data.signedUrl);
  } catch (e) {
    return res.status(404).json({ error: 'Book page not found' });
  }
});

// Redirect browser direct-navigation to SPA paths back to index.html
// This prevents API routes from returning errors when user refreshes /assignments, /teacher/assignments, etc.
// Includes '/timetable' so a browser refresh of the (case-insensitive) SPA URL
// serves the app instead of hitting the /timetable API route. API calls from the
// app use Accept: */* (not text/html), so they still reach the JSON endpoints.
const SPA_PATHS = ['/assignments', '/teacher', '/student', '/parent', '/profile', '/schedule', '/progress', '/challenges', '/leaderboard', '/settings', '/help', '/dashboard', '/messages', '/rewards', '/super-admin', '/school-admin', '/classes', '/my-classes', '/class-timetable', '/timetable', '/school-resources', '/resources'];
app.use((req, res, next) => {
  const accept = req.headers.accept || '';
  const lowerPath = req.path.toLowerCase(); // browser URLs may differ in case (/Timetable)
  if (req.method === 'GET' && accept.includes('text/html') && SPA_PATHS.some(p => lowerPath === p || lowerPath.startsWith(p + '/'))) {
    return res.sendFile(path.join(__dirname, '../AIMentorApp/dist2/index.html'));
  }
  next();
});

app.use('/ask',        lazyRoute('./routes/ask'));
app.use('/ingest',     lazyRoute('./routes/ingest'));
app.use('/curriculum', lazyRoute('./routes/curriculum'));
app.use('/curriculum/v2', lazyRoute('./routes/curriculumV2')); // generic CurriculumProvider-backed API — additive, does not replace the routes above
app.use('/curriculum/ingest', lazyRoute('./routes/curriculumIngest')); // ICSE/Cambridge/future-curriculum ingestion pipeline — platform-admin only, CBSE unaffected
app.use('/content-review', lazyRoute('./routes/contentReview'));
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
app.use('/teacher/syllabus', require('./routes/syllabusImport'));
app.use('/user',         userRoute);
app.use('/branding',     brandingRoute);
app.use('/messages',     messagesRoute);
app.use('/devlog',       devlogRoute);
app.use('/daily-tidbit', dailyTidbitRoute);
app.use('/admin',        adminRoute);
app.use('/analytics',    analyticsRoute);
app.use('/ibpyp',        ibpypRoute);
app.use('/math-engine',  mathEngineRoute);
app.use('/world',        worldRoute);
app.use('/help',         helpRoute);
app.use('/stories',      storiesRoute);
app.use('/habits',       habitsRoute);
app.use('/v',            shortlinkRoute);
app.use('/payment',      lazyRoute('./routes/payment'));
app.use('/quiz',         lazyRoute('./routes/quiz'));
app.use('/read-aloud',   lazyRoute('./routes/read-aloud'));
app.use('/super-admin',  require('./routes/super-admin'));
app.use('/announcements', require('./routes/announcements'));
app.use('/classes', require('./routes/classes'));
app.use('/class-portfolio', require('./routes/class-portfolio'));
app.use('/school-admin', require('./routes/school-admin'));
app.use('/timetable', require('./routes/timetable'));
app.use('/resources', require('./routes/resources'));
app.use('/channels', require('./routes/channels'));
app.use('/attendance', require('./routes/attendance'));
app.use('/jobs',         require('./routes/jobs'));
require('./services/jobHandlers'); // register swappable-queue handlers (for /jobs/process)


// Public contact / careers form submission (from the marketing landing page)
const { sendContactEmail } = require('./services/mailer');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, message, topic } = req.body || {};
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email and message are required.' });
    }
    if (!EMAIL_RE.test(String(email))) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (String(message).length > 5000) {
      return res.status(400).json({ error: 'Message is too long.' });
    }
    await sendContactEmail({
      name: String(name).slice(0, 120),
      email: String(email).slice(0, 200),
      message: String(message).slice(0, 5000),
      topic: topic ? String(topic).slice(0, 60) : undefined,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[contact] failed:', err.message);
    res.status(500).json({ error: 'Could not send your message. Please try again later.' });
  }
});

// Demo booking: visitor request → founder secure confirm link → Meet invite
app.use('/', require('./routes/demo'));

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

// Disable all caching in development
app.use(express.static(FRONTEND_DIR, {
  setHeaders(res) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));
// Marketing landing page (the app's LandingScreen embeds this on web; its
// Login / Early-Access buttons postMessage up to open the real auth modal).
app.get('/landing.html', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public/landing.html'));
});

// SPA fallback — all non-API routes serve index.html
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// Export for Vercel serverless
module.exports = app;

// Always start the server (Cloud Run runs node index.js directly)
const PORT = process.env.PORT || 3006;
const server = app.listen(PORT, () => {
  console.log(`Aivorah server running on http://localhost:${PORT}`);
});
// Quiz generation with fallback chains (Gemini retries → Qwen → Pixtral) can exceed
// Node's default 5-min request timeout, which kills the connection AFTER the quiz was
// successfully generated. Allow up to 10 minutes end-to-end.
server.requestTimeout = 600000;
server.headersTimeout = 610000;

// ── Job queue draining ──────────────────────────────────────────────────────
// db driver: nothing was draining `upload_jobs` locally (only an external Cloud
// Scheduler hitting POST /jobs/process was assumed) — jobs published via
// extract-questions-async would enqueue and then sit "pending" forever. Poll
// locally every few seconds so the queue is genuinely operational without
// depending on that external cron being configured. Cheap when empty (one
// indexed SELECT ... LIMIT), and every claim is still atomic (jobQueue.js
// processJobById), so this is safe to run alongside a real Cloud Scheduler hit
// too — whichever gets there first wins, no double-processing.
// kafka driver: this loop is skipped — the always-on consumer (startConsumer)
// handles draining instead, started right below.
const { DRIVER: QUEUE_DRIVER, runWorkerOnce, startConsumer } = require('./services/jobQueue');
if (QUEUE_DRIVER === 'kafka') {
  startConsumer().catch(err => console.error('[jobQueue] Kafka consumer failed to start:', err.message));
} else {
  setInterval(() => {
    runWorkerOnce(5).catch(err => console.error('[jobQueue] drain tick failed:', err.message));
  }, 4000);
  console.log('[jobQueue] local drain loop started (QUEUE_DRIVER=db, every 4s)');
}
server.setTimeout(600000);

// ── Graceful Shutdown & Fatal Error Trapping ────────────────────────────────
let isShuttingDown = false;
function gracefulShutdown(signal, err = null) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  if (err) {
    console.error(`[FATAL] ${signal} triggered due to error:`, err && err.stack || err);
  } else {
    console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);
  }
  server.close(() => {
    console.log('[Server] HTTP server closed cleanly. Port released.');
    process.exit(err ? 1 : 0);
  });
  // Force-exit backstop if connections don't drain in time. MUST have an explicit
  // delay — setTimeout() with no delay fires at ~0ms and would force-exit
  // immediately every time, defeating the graceful drain. 9s keeps us just under
  // Cloud Run's default 10s SIGTERM→SIGKILL grace window so we log cleanly first.
  setTimeout(() => {
    console.error('[Server] Could not close connections in time. Forcing exit.');
    process.exit(err ? 1 : 0);
  }, 9000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => gracefulShutdown('uncaughtException', err));
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason && reason.stack || reason);
});
