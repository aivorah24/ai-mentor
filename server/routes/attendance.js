const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');
const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, '..', 'data', 'attendance.json');

// Helper to read JSON database safely
function readDB() {
  try {
    if (!fs.existsSync(FILE_PATH)) {
      fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
      fs.writeFileSync(FILE_PATH, JSON.stringify({}));
      return {};
    }
    const data = fs.readFileSync(FILE_PATH, 'utf8');
    return JSON.parse(data || '{}');
  } catch (err) {
    console.error('Error reading attendance database:', err);
    return {};
  }
}

// Helper to write JSON database safely
function writeDB(data) {
  try {
    fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
    fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error writing attendance database:', err);
  }
}

// ── GET /attendance/class ──────────────────────────────────────────────────
// Returns the list of students in the class/section along with their attendance status
router.get('/class', async (req, res) => {
  try {
    const { grade, section, school = '', date } = req.query;
    if (!grade || !section || !date) {
      return res.status(400).json({ error: 'grade, section, and date are required' });
    }

    // 1. Fetch all students in this grade & section
    const { data: students, error: studentErr } = await supabase
      .from('users')
      .select('id, name, email, photo_url')
      .eq('grade', grade)
      .eq('section', section)
      .eq('role', 'student');

    if (studentErr) throw studentErr;

    // 2. Load attendance records for this date
    const db = readDB();
    const records = db[date] || {};

    const list = (students || []).map(student => ({
      id: student.id,
      name: student.name,
      email: student.email,
      photoUrl: student.photo_url,
      status: records[student.id] || null // null means unmarked (default)
    }));

    res.json({ date, students: list });
  } catch (err) {
    console.error('[GET /attendance/class] error:', err.message);
    res.status(500).json({ error: 'Failed to fetch class attendance' });
  }
});

// ── POST /attendance/save ──────────────────────────────────────────────────
// Saves (upserts) attendance records for a class on a given date
router.post('/save', async (req, res) => {
  try {
    const { date, records, teacherEmail } = req.body;
    if (!date || !records) {
      return res.status(400).json({ error: 'date and records map are required' });
    }

    const db = readDB();
    if (!db[date]) {
      db[date] = {};
    }

    // records is an object mapping: studentId -> 'present' | 'absent' | 'late'
    Object.keys(records).forEach(studentId => {
      db[date][studentId] = records[studentId];
    });

    writeDB(db);
    res.json({ success: true, date });
  } catch (err) {
    console.error('[POST /attendance/save] error:', err.message);
    res.status(500).json({ error: 'Failed to save attendance' });
  }
});

// ── GET /attendance/student/:studentId/summary ─────────────────────────────
// Returns attendance summary (rate, status breakdown) and history for a child
router.get('/student/:studentId/summary', async (req, res) => {
  try {
    const { studentId } = req.params;
    const db = readDB();

    let present = 0;
    let absent = 0;
    let late = 0;
    const history = [];

    // Iterate through dates sorted chronologically
    const dates = Object.keys(db).sort();
    dates.forEach(date => {
      if (db[date][studentId]) {
        const status = db[date][studentId];
        if (status === 'present') present++;
        else if (status === 'absent') absent++;
        else if (status === 'late') late++;

        history.push({ date, status });
      }
    });

    const total = present + absent + late;
    const ratePct = total > 0 ? Math.round(((present + late * 0.5) / total) * 100) : 100; // late counts as half attendance

    res.json({
      studentId,
      summary: {
        present,
        absent,
        late,
        total,
        ratePct
      },
      history: history.reverse().slice(0, 30) // last 30 days
    });
  } catch (err) {
    console.error('[GET /attendance/student/summary] error:', err.message);
    res.status(500).json({ error: 'Failed to get student attendance summary' });
  }
});

module.exports = router;
