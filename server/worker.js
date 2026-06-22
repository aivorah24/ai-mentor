// ── Kafka consumer worker (scale mode) ──────────────────────────────────────
// Deploy this as a SEPARATE Cloud Run service with:
//   QUEUE_DRIVER=kafka, --min-instances=1, --no-cpu-throttling
// so it stays alive to poll the topic. Start command: `node worker.js`.
//
// The beta (QUEUE_DRIVER=db) does NOT need this — jobs are drained by the
// Cloud Scheduler cron hitting POST /jobs/process instead.

require('dotenv').config();
require('./services/jobHandlers');                 // register handlers
const { startConsumer, DRIVER } = require('./services/jobQueue');

console.log(`[worker] starting (QUEUE_DRIVER=${DRIVER})`);
startConsumer().catch(err => {
  console.error('[worker] consumer failed to start:', err);
  process.exit(1);
});
