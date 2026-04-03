const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');

const MEMORY_DIR  = path.join(process.env.USERPROFILE || 'C:/Users/Asus', '.claude/projects/C--Users-Asus-Desktop-AI-Mentor/memory');
const DATA_DIR    = path.join(__dirname, '../data');

function readMd(filename) {
  try { return fs.readFileSync(path.join(MEMORY_DIR, filename), 'utf8'); } catch {}
  // fallback: check server/data/ (for Vercel / non-local environments)
  try { return fs.readFileSync(path.join(DATA_DIR, filename), 'utf8'); } catch { return null; }
}

// ── GET /devlog ──────────────────────────────────────────────────
// Returns all project memory files as structured JSON

router.get('/', (req, res) => {
  const worklog  = readMd('session_worklog.md');
  const meeting1 = readMd('project_meeting_2026_03_27.md');
  const meeting2 = readMd('project_meeting_2026_03_29.md');
  const tasks    = readMd('project_tasks_2026_03_28.md');

  // Parse worklog session table rows
  const sessionRows = [];
  if (worklog) {
    const lines = worklog.split('\n');
    let inTable = false;
    for (const line of lines) {
      if (line.startsWith('| Date')) { inTable = true; continue; }
      if (line.startsWith('|---'))   { continue; }
      if (inTable && line.startsWith('|')) {
        const cols = line.split('|').map(c => c.trim()).filter(Boolean);
        if (cols.length >= 5 && cols[0] !== 'Date') {
          sessionRows.push({ date: cols[0], start: cols[1], end: cols[2], hours: cols[3], milestone: cols[4] });
        }
      } else if (inTable && !line.startsWith('|')) {
        inTable = false;
      }
    }
  }

  // Parse readiness bars
  const readiness = [];
  if (worklog) {
    const lines = worklog.split('\n');
    for (const line of lines) {
      const m = line.match(/^\s{2}(.+?)\s+(█+░*)\s+(\d+)%/);
      if (m) readiness.push({ label: m[1].trim(), pct: parseInt(m[3]) });
    }
  }

  // Parse pending tasks table
  const pending = [];
  if (worklog) {
    const lines = worklog.split('\n');
    let inPending = false;
    for (const line of lines) {
      if (line.includes('Pending for Demo')) { inPending = true; continue; }
      if (inPending && line.startsWith('| Priority')) { continue; }
      if (inPending && line.startsWith('|---')) { continue; }
      if (inPending && line.startsWith('|')) {
        const cols = line.split('|').map(c => c.trim()).filter(Boolean);
        if (cols.length >= 3 && cols[0] !== 'Priority') {
          pending.push({ priority: cols[0], feature: cols[1], hours: cols[2] });
        }
      } else if (inPending && line.startsWith('**Remaining')) {
        break;
      }
    }
  }

  // Parse client feedback from meeting notes
  const feedback = [];
  [meeting1, meeting2].forEach(md => {
    if (!md) return;
    const lines = md.split('\n');
    lines.forEach(line => {
      const m = line.match(/^##\s+\d+\.\s+(.+)/);
      if (m) feedback.push(m[1]);
    });
  });

  res.json({ sessionRows, readiness, pending, feedback, raw: { worklog, tasks } });
});

module.exports = router;
