const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');

const DB_PATH = path.join(__dirname, '../data/students.json');

// ── Helpers ────────────────────────────────────────────────

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return {}; }
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

// Log activity for a given date into record.dailyLog[date]
function logDaily(record, date, { studyMinutes = 0, xp = 0, topics = 0 } = {}) {
  if (!record.dailyLog) record.dailyLog = {};
  if (!record.dailyLog[date]) record.dailyLog[date] = { studyMinutes: 0, xp: 0, topicsCompleted: 0 };
  record.dailyLog[date].studyMinutes  += studyMinutes;
  record.dailyLog[date].xp            += xp;
  record.dailyLog[date].topicsCompleted += topics;
}

const DEFAULT_STATS = {
  studyTimeMinutes:    0,
  topicsExplored:      0,
  xpPoints:            0,
  level:               1,
  challengesCompleted: 0,
  assignmentsDone:     0,
  currentStreak:       1,
  lastActiveDate:      todayISO(),
  todayStudyMinutes:   0,
  todayXP:             0,
  completedTopics:     [],
  lastLesson:          '',
  dailyLog:            {},
};

// ── GET /student/:id ────────────────────────────────────────

router.get('/:id', (req, res) => {
  const { id } = req.params;
  const db = readDB();

  if (!db[id]) {
    db[id] = { studentId: id, ...DEFAULT_STATS };
    writeDB(db);
  } else {
    const today = todayISO();
    const record = db[id];
    if (record.lastActiveDate !== today) {
      record.todayStudyMinutes = 0;
      record.todayXP = 0;
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yISO = yesterday.toISOString().split('T')[0];
      record.currentStreak = record.lastActiveDate === yISO
        ? (record.currentStreak || 0) + 1
        : 1;
      record.lastActiveDate = today;
      db[id] = record;
      writeDB(db);
    }
  }

  res.json(db[id]);
});

// ── PUT /student/:id ────────────────────────────────────────

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const db = readDB();
  // Preserve dailyLog — don't let client overwrite it
  const existingLog = db[id]?.dailyLog ?? {};
  db[id] = { studentId: id, ...DEFAULT_STATS, ...db[id], ...req.body, studentId: id, dailyLog: existingLog };
  writeDB(db);
  res.json(db[id]);
});

// ── GET /student/:id/weekly ─────────────────────────────────
// Returns last 7 days of activity from dailyLog

router.get('/:id/weekly', (req, res) => {
  const { id } = req.params;
  const db = readDB();
  const record = db[id] ?? {};
  const log = record.dailyLog ?? {};

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().split('T')[0];
    const shortDay = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
    days.push({
      date:             iso,
      day:              shortDay,
      studyMinutes:     log[iso]?.studyMinutes     ?? 0,
      xp:               log[iso]?.xp               ?? 0,
      topicsCompleted:  log[iso]?.topicsCompleted   ?? 0,
    });
  }
  res.json({ days });
});

// ── POST /student/:id/complete-lesson ──────────────────────

router.post('/:id/complete-lesson', (req, res) => {
  const { id } = req.params;
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic required' });

  const db = readDB();
  if (!db[id]) db[id] = { studentId: id, ...DEFAULT_STATS };

  const record = db[id];
  if (!record.completedTopics) record.completedTopics = [];

  const alreadyDone = record.completedTopics.includes(topic);
  const today = todayISO();

  if (!alreadyDone) {
    record.completedTopics.push(topic);
    record.xpPoints       = (record.xpPoints       || 0) + 150;
    record.todayXP        = (record.todayXP         || 0) + 150;
    record.topicsExplored = (record.topicsExplored   || 0) + 1;
    record.level          = computeLevel(record.xpPoints);
    logDaily(record, today, { xp: 150, topics: 1 });
  }
  record.lastLesson     = topic;
  record.lastActiveDate = today;
  db[id] = record;
  writeDB(db);
  res.json(record);
});

// ── POST /student/:id/study-time ───────────────────────────

router.post('/:id/study-time', (req, res) => {
  const { id } = req.params;
  const { minutes = 1 } = req.body;

  const db = readDB();
  if (!db[id]) db[id] = { studentId: id, ...DEFAULT_STATS };

  const record = db[id];
  const today = todayISO();
  if (record.lastActiveDate !== today) {
    record.todayStudyMinutes = 0;
    record.todayXP = 0;
    record.lastActiveDate = today;
  }
  record.studyTimeMinutes  = (record.studyTimeMinutes  || 0) + minutes;
  record.todayStudyMinutes = (record.todayStudyMinutes || 0) + minutes;
  logDaily(record, today, { studyMinutes: minutes });
  db[id] = record;
  writeDB(db);
  res.json({ studyTimeMinutes: record.studyTimeMinutes, todayStudyMinutes: record.todayStudyMinutes });
});

function computeLevel(xp) {
  let level = 1, threshold = 500, total = 0;
  while (xp >= total + threshold) { total += threshold; threshold += 250; level++; }
  return level;
}

module.exports = router;
