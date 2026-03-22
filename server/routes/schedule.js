const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
function uuidv4() {
  return 'ev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const DB_PATH = path.join(__dirname, '../data/schedule.json');

// ── Helpers ─────────────────────────────────────────────────

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return []; }
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ── GET /schedule?studentId=xxx&date=YYYY-MM-DD ──────────────
// Returns events for a given student on a given date.
// Includes events for 'all' students (teacher-assigned global events).

router.get('/', (req, res) => {
  const { studentId, date } = req.query;
  if (!studentId || !date) return res.status(400).json({ error: 'studentId and date required' });

  const all = readDB();
  const events = all.filter(e =>
    e.date === date &&
    (e.studentId === studentId || e.studentId === 'all')
  );
  res.json(events);
});

// ── GET /schedule/month?studentId=xxx&year=2024&month=10 ─────
// Returns all event dates in a month (for mini-calendar dots).

router.get('/month', (req, res) => {
  const { studentId, year, month } = req.query;
  if (!studentId || !year || !month) return res.status(400).json({ error: 'studentId, year, month required' });

  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const all = readDB();
  const dates = [...new Set(
    all
      .filter(e => e.date.startsWith(prefix) && (e.studentId === studentId || e.studentId === 'all'))
      .map(e => e.date)
  )];
  res.json({ dates });
});

// ── GET /schedule/upcoming?studentId=xxx ────────────────────
// Returns upcoming deadlines (type=deadline) from today onwards.

router.get('/upcoming', (req, res) => {
  const { studentId } = req.query;
  if (!studentId) return res.status(400).json({ error: 'studentId required' });

  const today = new Date().toISOString().split('T')[0];
  const all = readDB();
  const deadlines = all
    .filter(e =>
      e.type === 'deadline' &&
      e.date >= today &&
      (e.studentId === studentId || e.studentId === 'all')
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);
  res.json(deadlines);
});

// ── POST /schedule ───────────────────────────────────────────
// Create a new event.
// Body: { title, date, startTime, endTime, type, note, studentId, createdBy, tag }

router.post('/', (req, res) => {
  const { title, date, startTime, endTime, type = 'study', note, studentId, createdBy, tag } = req.body;
  if (!title || !date || !startTime || !studentId) {
    return res.status(400).json({ error: 'title, date, startTime, studentId required' });
  }

  const event = {
    id:         uuidv4(),
    title,
    date,
    startTime,
    endTime:    endTime || '',
    type,
    note:       note || '',
    studentId,
    createdBy:  createdBy || studentId,
    tag:        tag || null,
    createdAt:  new Date().toISOString(),
  };

  const all = readDB();
  all.push(event);
  writeDB(all);
  res.json(event);
});

// ── DELETE /schedule/:id ─────────────────────────────────────

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const all = readDB();
  const idx = all.findIndex(e => e.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  all.splice(idx, 1);
  writeDB(all);
  res.json({ ok: true });
});

module.exports = router;
