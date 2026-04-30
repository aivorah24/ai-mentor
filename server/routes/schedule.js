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

// ── GET /schedule/teacher?date=YYYY-MM-DD&email=... ──────────────────────────
router.get('/teacher', async (req, res) => {
  const { date, email } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    // 1. Manual schedule events created by teacher
    const { data, error } = await supabase
      .from('schedule_events')
      .select('*')
      .eq('event_date', date)
      .eq('created_by', 'teacher');
    if (error) throw error;
    const manualEvents = (data ?? []).map(mapRow);

    // 2. Assignment deadlines on this date (created by this teacher)
    let assignmentEvents = [];
    try {
      let asnQuery = supabase
        .from('assignments')
        .select('id,title,subject,chapter,due_date,type,grade,curriculum,student_id,created_by_id')
        .eq('due_date', date);

      // Filter by teacher email if provided
      if (email) {
        const { data: teacherRow } = await supabase.from('users').select('id').eq('email', email.toLowerCase().trim()).maybeSingle();
        if (teacherRow?.id) asnQuery = asnQuery.eq('created_by_id', teacherRow.id);
      }

      const { data: assignments } = await asnQuery;
      const existingAssignmentIds = new Set(manualEvents.filter(e => e.assignmentId).map(e => e.assignmentId));

      assignmentEvents = (assignments || [])
        .filter(a => !existingAssignmentIds.has(a.id) && a.due_date)
        .map(a => ({
          id:          'asgn_' + a.id,
          title:       a.title + ' — Due',
          date:        a.due_date,
          startTime:   '23:59',
          endTime:     '23:59',
          type:        'deadline',
          note:        `${a.subject || ''}${a.chapter ? ' · ' + a.chapter : ''}${a.grade ? ' · ' + a.grade : ''}`,
          studentId:   a.student_id || 'all',
          createdBy:   'teacher',
          tag:         a.subject || null,
          assignmentId: a.id,
        }));
    } catch (_) {}

    res.json([...manualEvents, ...assignmentEvents]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Helper: fetch pending assignments for a student as deadline events ──
async function getAssignmentDeadlines(userId, studentCurriculum, studentGrade, filterDate = null) {
  const orFilter = userId
    ? `student_id.eq.${userId},student_id.is.null`
    : `student_id.is.null`;

  let query = supabase.from('assignments').select('id,title,subject,chapter,due_date,type,grade,curriculum,student_id').or(orFilter);
  if (filterDate) query = query.eq('due_date', filterDate);

  const { data: allData } = await query;

  // Filter by grade+curriculum for class-wide, exclude already-completed via submissions
  const filtered = (allData || []).filter(a => {
    if (a.student_id !== null) return true;
    if (a.curriculum && studentCurriculum && a.curriculum !== studentCurriculum) return false;
    if (a.grade && studentGrade && a.grade !== studentGrade) return false;
    return true;
  });

  // Exclude assignments student already submitted
  let completedIds = new Set();
  if (userId && filtered.length > 0) {
    const { data: subs } = await supabase
      .from('assignment_submissions')
      .select('assignment_id')
      .eq('student_id', userId)
      .eq('status', 'completed')
      .in('assignment_id', filtered.map(a => a.id));
    (subs || []).forEach(s => completedIds.add(s.assignment_id));
  }

  return filtered
    .filter(a => !completedIds.has(a.id) && a.due_date)
    .map(a => ({
      id:           'asgn_' + a.id,
      title:        a.title + ' — Due',
      date:         a.due_date,
      startTime:    '23:59',
      endTime:      '23:59',
      type:         'deadline',
      note:         `${a.subject || ''}${a.chapter ? ' · ' + a.chapter : ''}${a.grade ? ' · ' + a.grade : ''}`,
      studentId:    a.student_id || 'all',
      createdBy:    'teacher',
      tag:          a.subject || null,
      assignmentId: a.id,
    }));
}

// ── Helper: fetch student profile (curriculum + grade) ──────────
async function getStudentProfile(studentId) {
  if (!studentId) return { userId: null, curriculum: null, grade: null };
  // UUID format
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(studentId)) {
    const { data } = await supabase.from('users').select('id,curriculum,grade').eq('id', studentId).single();
    return { userId: data?.id || null, curriculum: data?.curriculum || null, grade: data?.grade || null };
  }
  if (studentId.includes('@')) {
    const { data } = await supabase.from('users').select('id,curriculum,grade').eq('email', studentId).single();
    return { userId: data?.id || null, curriculum: data?.curriculum || null, grade: data?.grade || null };
  }
  return { userId: null, curriculum: null, grade: null };
}

// ── GET /schedule?studentId=xxx&date=YYYY-MM-DD ──────────────
router.get('/', async (req, res) => {
  const { studentId, date } = req.query;
  if (!studentId || !date) return res.status(400).json({ error: 'studentId and date required' });
  try {
    const [{ data, error }, profile] = await Promise.all([
      supabase.from('schedule_events').select('*').eq('event_date', date).or(`student_id.eq.${studentId},student_id.eq.all`),
      getStudentProfile(studentId),
    ]);
    if (error) throw error;

    const deadlines = await getAssignmentDeadlines(profile.userId, profile.curriculum, profile.grade, date);

    // Merge, deduplicate by assignmentId
    const existingAssignmentIds = new Set((data ?? []).filter(e => e.assignment_id).map(e => e.assignment_id));
    const newDeadlines = deadlines.filter(d => !existingAssignmentIds.has(d.assignmentId));

    res.json([...(data ?? []).map(mapRow), ...newDeadlines]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /schedule/month?studentId=xxx&year=2026&month=4 ──────
router.get('/month', async (req, res) => {
  const { studentId, year, month } = req.query;
  if (!studentId || !year || !month) return res.status(400).json({ error: 'studentId, year, month required' });
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  try {
    const [{ data, error }, profile] = await Promise.all([
      supabase.from('schedule_events').select('event_date').like('event_date', `${prefix}%`).or(`student_id.eq.${studentId},student_id.eq.all`),
      getStudentProfile(studentId),
    ]);
    if (error) throw error;

    const deadlines = await getAssignmentDeadlines(profile.userId, profile.curriculum, profile.grade);
    const deadlineDates = deadlines
      .filter(d => d.date && d.date.startsWith(prefix))
      .map(d => d.date);

    const dates = [...new Set([...(data ?? []).map(e => e.event_date), ...deadlineDates])];
    res.json({ dates });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /schedule/upcoming?studentId=xxx ────────────────────
router.get('/upcoming', async (req, res) => {
  const { studentId } = req.query;
  if (!studentId) return res.status(400).json({ error: 'studentId required' });
  const today = new Date().toISOString().split('T')[0];
  try {
    const [{ data, error }, profile] = await Promise.all([
      supabase.from('schedule_events').select('*').eq('type', 'deadline').gte('event_date', today).or(`student_id.eq.${studentId},student_id.eq.all`).order('event_date', { ascending: true }),
      getStudentProfile(studentId),
    ]);
    if (error) throw error;

    const deadlines = await getAssignmentDeadlines(profile.userId, profile.curriculum, profile.grade);
    const futureDeadlines = deadlines.filter(d => d.date >= today);

    // Merge, deduplicate by assignmentId, sort by date, take top 5
    const existingAssignmentIds = new Set((data ?? []).filter(e => e.assignment_id).map(e => e.assignment_id));
    const newDeadlines = futureDeadlines.filter(d => !existingAssignmentIds.has(d.assignmentId));

    const all = [...(data ?? []).map(mapRow), ...newDeadlines]
      .sort((a, b) => (a.date > b.date ? 1 : -1))
      .slice(0, 5);

    res.json(all);
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
