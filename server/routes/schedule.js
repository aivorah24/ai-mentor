const express  = require('express');
const router   = express.Router();
const fs       = require('fs');
const path     = require('path');
const supabase = require('../services/supabase');

function uuidv4() {
  return 'ev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const ASGN_PATH = path.join(__dirname, '../data/assignments.json');

function readAssignments() {
  try { return JSON.parse(fs.readFileSync(ASGN_PATH, 'utf8')); }
  catch { return []; }
}

// ── Row mapper: Supabase snake_case → camelCase ──────────────
function mapRow(e) {
  return {
    id:           e.id,
    title:        e.title,
    date:         e.event_date,
    startTime:    e.start_time,
    endTime:      e.end_time   || '',
    type:         e.type       || 'study',
    note:         e.note       || '',
    studentId:    e.student_id,
    createdBy:    e.created_by || e.student_id,
    tag:          e.tag        || null,
    assignmentId: e.assignment_id ?? null,
    createdAt:    e.created_at,
  };
}

// ── GET /schedule/teacher?date=YYYY-MM-DD ────────────────────
router.get('/teacher', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    const { data, error } = await supabase
      .from('schedule_events')
      .select('*')
      .eq('event_date', date)
      .eq('created_by', 'teacher');
    if (error) throw error;
    res.json((data ?? []).map(mapRow));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /schedule?studentId=xxx&date=YYYY-MM-DD ──────────────
router.get('/', async (req, res) => {
  const { studentId, date } = req.query;
  if (!studentId || !date) return res.status(400).json({ error: 'studentId and date required' });
  try {
    const { data, error } = await supabase
      .from('schedule_events')
      .select('*')
      .eq('event_date', date)
      .or(`student_id.eq.${studentId},student_id.eq.all`);
    if (error) throw error;
    res.json((data ?? []).map(mapRow));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /schedule/month?studentId=xxx&year=2026&month=4 ──────
router.get('/month', async (req, res) => {
  const { studentId, year, month } = req.query;
  if (!studentId || !year || !month) return res.status(400).json({ error: 'studentId, year, month required' });
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  try {
    const { data, error } = await supabase
      .from('schedule_events')
      .select('event_date')
      .like('event_date', `${prefix}%`)
      .or(`student_id.eq.${studentId},student_id.eq.all`);
    if (error) throw error;
    const dates = [...new Set((data ?? []).map(e => e.event_date))];
    res.json({ dates });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /schedule/upcoming?studentId=xxx ────────────────────
router.get('/upcoming', async (req, res) => {
  const { studentId } = req.query;
  if (!studentId) return res.status(400).json({ error: 'studentId required' });
  const today = new Date().toISOString().split('T')[0];
  try {
    const { data, error } = await supabase
      .from('schedule_events')
      .select('*')
      .eq('type', 'deadline')
      .gte('event_date', today)
      .or(`student_id.eq.${studentId},student_id.eq.all`)
      .order('event_date', { ascending: true })
      .limit(5);
    if (error) throw error;

    // Filter out completed assignments
    const assignments = readAssignments();
    const completedIds = new Set(
      assignments
        .filter(a => a.status === 'completed' && (a.studentId === studentId || a.studentId === 'all'))
        .map(a => a.id)
    );

    const rows = (data ?? []).map(mapRow);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /schedule ───────────────────────────────────────────
router.post('/', async (req, res) => {
  const { title, date, startTime, endTime, type = 'study', note, studentId, createdBy, tag, assignmentId } = req.body;
  if (!title || !date || !startTime || !studentId) {
    return res.status(400).json({ error: 'title, date, startTime, studentId required' });
  }
  const id = uuidv4();
  try {
    const { data, error } = await supabase
      .from('schedule_events')
      .insert({
        id,
        title,
        event_date:    date,
        start_time:    startTime,
        end_time:      endTime    || '',
        type,
        note:          note       || '',
        student_id:    studentId,
        created_by:    createdBy  || studentId,
        tag:           tag        || null,
      })
      .select()
      .single();
    if (error) throw error;
    res.json(mapRow(data));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /schedule/:id ─────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase.from('schedule_events').delete().eq('id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
