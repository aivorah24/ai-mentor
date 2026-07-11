const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');

function uuidv4() {
  return 'ev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
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
// schedule_events is the single source of truth for the calendar — assignment
// and challenge deadlines are materialized into it at creation time (see
// assignments.js POST / and challenges.js POST /assign), so this route no
// longer needs to separately re-derive deadline events from those tables.
router.get('/teacher', async (req, res) => {
  const { date, email } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    // Resolve THIS teacher, so the schedule only shows events for the teacher's
    // OWN class — not every event in the system.
    let teacherId = null;
    if (email) {
      const { data: tRow } = await supabase.from('users').select('id').eq('email', String(email).toLowerCase().trim()).maybeSingle();
      teacherId = tRow?.id || null;
    }

    const { data, error } = await supabase
      .from('schedule_events')
      .select('*')
      .eq('event_date', date);
    if (error) throw error;
    let manualEvents = (data ?? []).map(mapRow);
    // Scope to the teacher's own class: events for a student they teach, class-wide
    // ('all') events, or events the teacher themselves created. (No email → no scope.)
    // Teacher's schedule only shows events the teacher created — never events a
    // student or parent self-scheduled (even for a student in the teacher's class).
    if (email && teacherId) {
      manualEvents = manualEvents.filter(e =>
        e.createdBy === teacherId || e.createdBy === 'teacher'
      );
    }

    // Resolve student names for non-'all' events
    const studentIds = [...new Set(manualEvents.filter(e => e.studentId && e.studentId !== 'all').map(e => e.studentId))];
    const studentNameMap = {};
    if (studentIds.length > 0) {
      const { data: userRows } = await supabase.from('users').select('id,name').in('id', studentIds);
      (userRows || []).forEach(u => { studentNameMap[u.id] = u.name; });
    }
    manualEvents.forEach(e => {
      if (e.studentId && e.studentId !== 'all') {
        e.studentName = studentNameMap[e.studentId] || null;
      }
    });

    res.json(manualEvents);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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

// A teacher's "'all' students" schedule event must only reach the students under
// THAT teacher — not every student in the database. A broadcast whose creator (or
// this student's own profile) can't be resolved is never attributable to "this
// student's teacher" — exclude it rather than falling back to showing it to
// literally everyone (that fallback was the cause of orphaned/unresolved
// broadcasts leaking to the whole database).
async function scopeAllEvents(rows, userId) {
  const teacherAllRows = (rows || []).filter(e => e.student_id === 'all' && e.created_by === 'teacher');
  if (teacherAllRows.length === 0) return rows;

  const linkedTeacherIds = new Set();
  if (userId) {
    const { data: tlinks } = await supabase.from('teacher_student').select('teacher_id').eq('student_id', userId);
    (tlinks || []).forEach(l => { if (l.teacher_id) linkedTeacherIds.add(l.teacher_id); });
  }

  return (rows || []).filter(e => {
    if (e.student_id !== 'all' || e.created_by !== 'teacher') return true;
    if (!e.created_by_id || !userId) return false;
    return linkedTeacherIds.has(e.created_by_id);
  });
}

// A deadline event's underlying assignment/challenge may already be completed by
// THIS student — a class-wide (student_id='all') deadline row is shared across
// every student in the class, so it can't just be deleted on completion; it has
// to be filtered out per-student at read time instead.
async function filterCompleted(rows, userId) {
  if (!userId) return rows;
  const asgnIds = (rows || []).filter(e => e.type === 'deadline' && e.assignment_id).map(e => e.assignment_id);
  const chalIds = (rows || []).filter(e => e.type === 'challenge' && e.assignment_id).map(e => e.assignment_id);
  if (asgnIds.length === 0 && chalIds.length === 0) return rows;

  const [{ data: subs }, { data: chals }] = await Promise.all([
    asgnIds.length > 0
      ? supabase.from('assignment_submissions').select('assignment_id').eq('student_id', userId).eq('status', 'completed').in('assignment_id', asgnIds)
      : Promise.resolve({ data: [] }),
    chalIds.length > 0
      ? supabase.from('challenge_assignments').select('id').eq('status', 'completed').in('id', chalIds)
      : Promise.resolve({ data: [] }),
  ]);
  const completedAsgn = new Set((subs || []).map(s => s.assignment_id));
  const completedChal = new Set((chals || []).map(c => c.id));

  return (rows || []).filter(e => {
    if (e.type === 'deadline' && e.assignment_id) return !completedAsgn.has(e.assignment_id);
    if (e.type === 'challenge' && e.assignment_id) return !completedChal.has(e.assignment_id);
    return true;
  });
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

    let scopedData = await scopeAllEvents(data, profile.userId);
    scopedData = await filterCompleted(scopedData, profile.userId);
    res.json((scopedData ?? []).map(mapRow));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /schedule/month?studentId=xxx&year=2026&month=4 ──────
router.get('/month', async (req, res) => {
  const { studentId, year, month } = req.query;
  if (!studentId || !year || !month) return res.status(400).json({ error: 'studentId, year, month required' });
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  try {
    const [{ data, error }, profile] = await Promise.all([
      supabase.from('schedule_events').select('event_date,student_id,created_by,created_by_id,type,assignment_id').like('event_date', `${prefix}%`).or(`student_id.eq.${studentId},student_id.eq.all`),
      getStudentProfile(studentId),
    ]);
    if (error) throw error;

    let scopedData = await scopeAllEvents(data, profile.userId);
    scopedData = await filterCompleted(scopedData, profile.userId);
    const dates = [...new Set((scopedData ?? []).map(e => e.event_date))];
    res.json({ dates });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /schedule/upcoming?studentId=xxx ────────────────────
router.get('/upcoming', async (req, res) => {
  const { studentId } = req.query;
  if (!studentId) return res.status(400).json({ error: 'studentId required' });
  const today = new Date().toISOString().split('T')[0];
  try {
    // Assignment deadlines are type='deadline', challenge deadlines are type='challenge'.
    const [{ data, error }, profile] = await Promise.all([
      supabase.from('schedule_events').select('*').in('type', ['deadline', 'challenge']).gte('event_date', today).or(`student_id.eq.${studentId},student_id.eq.all`).order('event_date', { ascending: true }),
      getStudentProfile(studentId),
    ]);
    if (error) throw error;

    let scopedData = await scopeAllEvents(data, profile.userId);
    scopedData = await filterCompleted(scopedData, profile.userId);
    const all = (scopedData ?? []).map(mapRow)
      .sort((a, b) => (a.date > b.date ? 1 : -1))
      .slice(0, 5);

    res.json(all);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /schedule ───────────────────────────────────────────
router.post('/', async (req, res) => {
  const { title, date, startTime, endTime, type = 'study', note, studentId, createdBy, tag, assignmentId, creatorEmail } = req.body;
  if (!title || !date || !startTime || !studentId) {
    return res.status(400).json({ error: 'title, date, startTime, studentId required' });
  }
  const id = uuidv4();
  try {
    // Needed to scope 'all'-student events to just this creator's own linked
    // students (see GET /schedule etc.) — without it, a teacher's "all students"
    // event was visible to every student in the database, not just their class.
    let creatorId = null;
    if (creatorEmail) {
      const { data: creatorRow } = await supabase.from('users').select('id').eq('email', creatorEmail.toLowerCase().trim()).maybeSingle();
      creatorId = creatorRow?.id || null;
    }

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
        created_by_id: creatorId,
        tag:           tag        || null,
      })
      .select()
      .single();
    if (error) throw error;
    res.json(mapRow(data));

    // Fire-and-forget notifications for events scheduled by teacher or parent.
    // For specific student: the student sees it via notifications-summary (schedule_events query);
    // parents get a message card in their inbox.
    // For 'all': only the teacher's own linked students (scoped by creatorEmail) are notified.
    const actorRole = String(createdBy || '').toLowerCase();
    const isTeacher = actorRole === 'teacher';
    const isParent  = actorRole === 'parent';
    if ((isTeacher || isParent) && studentId) {
      (async () => {
        try {
          const creatorLabel = isParent ? 'Your parent' : 'Your teacher';
          const msgContent = `${creatorLabel} scheduled "${title}" on ${date}${startTime ? ' at ' + startTime : ''}.`;

          // Students get bell-only notifications (via notifications-summary schedule_events query).
          // Parents get a rich card message in their inbox.
          const notifyParents = async (childId, childName) => {
            const { data: parents } = await supabase.from('parent_children').select('parent_email').eq('child_id', childId);
            // Rich card format: parseable by MessagesScreen renderScheduleCard
            // Format: "SCHEDULE_CARD|childName|title|date|startTime|type"
            const cardContent = `SCHEDULE_CARD|${childName || 'Your child'}|${title}|${date}|${startTime || ''}|${type}`;
            for (const { parent_email } of parents || []) {
              await supabase.from('messages').insert({
                sender_email:    'system@aivorah.com',
                sender_name:     'Aivorah',
                sender_role:     'teacher',
                recipient_email: parent_email,
                recipient_name:  parent_email,
                content:         cardContent,
              });
            }
          };

          if (studentId !== 'all') {
            const { data: stu } = await supabase.from('users').select('id,name').eq('id', studentId).maybeSingle();
            await notifyParents(studentId, stu?.name || 'Your child');
          } else if (isTeacher && creatorEmail) {
            const { data: tRow } = await supabase.from('users').select('id').eq('email', creatorEmail.toLowerCase().trim()).maybeSingle();
            if (tRow?.id) {
              const { data: links } = await supabase.from('teacher_student').select('student_id').eq('teacher_id', tRow.id);
              const sIds = (links || []).map(l => l.student_id).filter(Boolean);
              if (sIds.length > 0) {
                const { data: studs } = await supabase.from('users').select('id,name').in('id', sIds);
                for (const s of studs || []) await notifyParents(s.id, s.name);
              }
            }
          }
        } catch (_) {}
      })();
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /schedule/:id ──────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { startTime, endTime } = req.body;
  try {
    const updates = {};
    if (startTime !== undefined) updates.start_time = startTime;
    if (endTime !== undefined) updates.end_time = endTime;
    const { data, error } = await supabase.from('schedule_events').update(updates).eq('id', id).select().single();
    if (error) throw error;
    res.json(data);
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
