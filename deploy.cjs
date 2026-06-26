#!/usr/bin/env node
/**
 * Aivorah — SAFE DEPLOY  (the one command to ship to the live URL)
 * ===============================================================
 *   node deploy.cjs "your commit message"
 *   node deploy.cjs "msg" --dry      # do everything EXCEPT commit & push
 *
 * Why this exists: the live site (Cloud Run) is built from the Dockerfile, which
 * COPIES the pre-built  AIMentorApp/dist2/  — it does NOT rebuild from source.
 * So a source fix only reaches the founder's live URL if dist2 is rebuilt AND
 * committed. This script makes that impossible to forget, and refuses to push if
 * the smoke test fails — so a "fixed" bug can never silently come back live.
 *
 * Flow:  rebuild dist2 → restart local server → SMOKE TEST → (only if green)
 *        stage source + the CORRECT dist2 (never the decoys) → commit → push
 *        → GitHub Actions auto-deploys to Cloud Run.
 */
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const APP = path.join(ROOT, 'AIMentorApp');
const SERVER = path.join(ROOT, 'server');
const SERVED_DIST = 'AIMentorApp/dist2';           // the ONLY dist2 the Dockerfile copies
const DECOY_DISTS = ['server/dist2', 'server/public/dist2']; // never shipped — must stay out of the commit

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const message = args.filter(a => !a.startsWith('--')).join(' ').trim();

function die(msg) { console.error(`\n❌ ABORTED: ${msg}\n`); process.exit(1); }
function step(msg) { console.log(`\n▶ ${msg}`); }
function sh(cmd, opts = {}) { return execSync(cmd, { stdio: 'inherit', ...opts }); }
function shOut(cmd, opts = {}) { return execSync(cmd, { encoding: 'utf8', ...opts }).trim(); }

if (!message && !dry) die('commit message required.  Usage: node deploy.cjs "what changed"');

// ── 0. Must be on master (the branch GitHub Actions deploys) ────────────────
const branch = shOut('git rev-parse --abbrev-ref HEAD', { cwd: ROOT });
if (branch !== 'master') die(`you are on "${branch}", but the live deploy only ships from "master". Switch branches first.`);

function bundleHash() {
  const html = fs.readFileSync(path.join(APP, 'dist2', 'index.html'), 'utf8');
  const m = html.match(/index-([a-f0-9]+)\.js/);
  return m ? m[1] : null;
}

// ── 1. Rebuild the frontend bundle that actually ships ──────────────────────
const before = (() => { try { return bundleHash(); } catch { return null; } })();
step('Rebuilding AIMentorApp/dist2 (this is what the live site serves)…');
try {
  sh('npx expo export --platform web --output-dir dist2', { cwd: APP });
} catch { die('frontend build failed — fix the build error before deploying.'); }
const after = bundleHash();
if (!after) die('build produced no bundle hash in dist2/index.html — build is broken.');
console.log(`   bundle: ${before || 'none'} → ${after}${before === after ? '  (no frontend source changes)' : '  (updated)'}`);

// ── 2. Restart the local server so the smoke test hits the NEW bundle ───────
step('Restarting local server (pm2 aivorah)…');
try { sh('npx pm2 restart aivorah --update-env', { cwd: SERVER }); }
catch { console.warn('   (pm2 restart failed — is the server running under pm2? continuing to smoke test)'); }

// wait for health
step('Waiting for server health…');
let healthy = false;
for (let i = 0; i < 20; i++) {
  try { execSync('curl -sf http://localhost:3006/health', { stdio: 'ignore' }); healthy = true; break; }
  catch { execSync(process.platform === 'win32' ? 'ping -n 2 127.0.0.1 >NUL' : 'sleep 1', { stdio: 'ignore' }); }
}
if (!healthy) die('local server never became healthy on :3006 — cannot smoke test. Start it (pm2 start) and retry.');
console.log('   server healthy.');

// ── 3. SMOKE TEST — the gate. No green, no push. ────────────────────────────
step('Running smoke test (critical flows on the built bundle)…');
const smoke = spawnSync('node', ['smoke-test.js'], { cwd: APP, stdio: 'inherit' });
if (smoke.status !== 0) die('SMOKE TEST FAILED — not pushing. Fix the failing flow above, then run deploy again. This is the guard that stops fixed bugs from regressing live.');

if (dry) { console.log('\n✅ Dry run complete. Build + smoke test green. (Skipped commit & push.)\n'); process.exit(0); }

// ── 4. Stage the CORRECT files only — never the decoy dist2 folders ─────────
step('Staging changes (source + the served dist2, excluding decoy dist2 folders)…');
sh('git add -A', { cwd: ROOT });
// Keep the two non-shipped dist2 folders OUT of the commit so they can never
// cause confusion about "which dist2 is live".
for (const d of DECOY_DISTS) {
  try { execSync(`git reset -q -- "${d}"`, { cwd: ROOT, stdio: 'ignore' }); } catch {}
}
const staged = shOut('git diff --cached --name-only', { cwd: ROOT });
if (!staged) die('nothing to commit (no changes staged).');
// Guard: a huge staged set means junk (models/data/caches) leaked in and will
// break the push on a flaky network — exactly what happened on 2026-06-26.
const stagedFiles = staged.split('\n').filter(Boolean);
const junk = stagedFiles.filter(f => /(^|\/)(models|ncert_books|__pycache__)\//.test(f) || /\.(png|jpg|mp3|mp4)$/i.test(f) || /^qd\d*\.json$|server\/qd\.json$/.test(f) || /^server\/(public\/)?dist2\//.test(f));
if (junk.length) die(`refusing to commit — ${junk.length} junk/large files staged (e.g. ${junk.slice(0,3).join(', ')}). Fix .gitignore; do NOT push these.`);
if (stagedFiles.length > 250) die(`refusing to commit — ${stagedFiles.length} files staged looks like accidental bloat. Review 'git status' before deploying.`);
console.log(`   ${stagedFiles.length} files staged (clean).`);
if (!staged.split('\n').some(f => f.startsWith(SERVED_DIST))) {
  console.warn(`   ⚠ note: no changes under ${SERVED_DIST} — only backend/source changed. That is fine if you changed only server code.`);
}

// ── 5. Commit & push → GitHub Actions auto-deploys to Cloud Run ─────────────
step('Committing & pushing to master…');
const commitMsg = `${message}\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`;
const c = spawnSync('git', ['commit', '-m', commitMsg], { cwd: ROOT, stdio: 'inherit' });
if (c.status !== 0) die('git commit failed.');
const p = spawnSync('git', ['push', 'origin', 'master'], { cwd: ROOT, stdio: 'inherit' });
if (p.status !== 0) die('git push failed — resolve the push error and retry (your commit is saved locally).');

console.log(`
✅ DEPLOYED.
   • Pushed to master → GitHub Actions is now building & deploying to Cloud Run (~5–10 min).
   • Watch it:  https://github.com/saimohan24092003/ai-mentor/actions
   • The live URL is printed at the end of that Action's log.
   • The shipped bundle is ${after} (from ${SERVED_DIST}).

   Tell your founder to HARD-REFRESH (Ctrl+Shift+R) once the Action finishes,
   so the browser drops any cached old bundle.
`);
