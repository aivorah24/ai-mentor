const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');

function uuidv4() {
  return 'ev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ── Row mapper: Supabase snake_case → camelCase ──────────────
function mapRow(e) {
  const startDate = (e.type === 'deadline' || e.type === 'challenge') && e.created_at
    ? e.created_at.split('T')[0]
    : e.event_date;

  let tag = e.tag || null;
  let tagCategory = 'assignment';
  if (!tag) {
    if (e.type === 'challenge') tag = 'AI Challenge';
    else if (e.type === 'deadline') tag = 'Worksheet';
    else if (e.type === 'lesson') tag = 'Live Class';
    else if (e.type === 'break') { tag = 'Working Day'; tagCategory = 'event'; }
    else tag = 'Quick task';
  } else {
    const eventTags = ['Holidays and vacations', 'School holidays', 'Whole school events', 'Curriculum Unit Timeline', 'MYP Unit Timeline', 'Special Assembly', 'Working Day', 'Rotation Day Cycle', 'SmartTask Cycle Tim...'];
    if (eventTags.some(t => String(tag).toLowerCase().includes(t.toLowerCase()))) {
      tagCategory = 'event';
    }
  }

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
    tag:          tag,
    tagCategory:  tagCategory,
    assignmentId: e.assignment_id ?? null,
    createdAt:    e.created_at,
    isCompleted:  !!e.isCompleted,
    startDate,
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
    let rawEvents = data ?? [];
    // Scope to events THIS teacher created — never every teacher's events in the
    // system. Must filter on the raw created_by_id (a real user id) BEFORE
    // mapRow(), since mapRow's "createdBy" field only carries the role string
    // ('teacher'/'parent'/'student'), not an id — comparing that to teacherId
    // was always false and silently fell through to "any teacher-created event",
    // leaking every teacher's schedule onto every other teacher's calendar.
    if (email && teacherId) {
      const { data: tlinks } = await supabase.from('teacher_student').select('student_id').eq('teacher_id', teacherId);
      const linkedStudents = new Set((tlinks || []).map(l => l.student_id).filter(Boolean));

      rawEvents = rawEvents.filter(e => {
        if (e.created_by_id === teacherId || (e.created_by === 'teacher' && !e.created_by_id)) return true;
        if (['school_admin', 'school-admin', 'super_admin'].includes(String(e.created_by || '').toLowerCase())) return true;
        if (e.student_id && e.student_id !== 'all' && linkedStudents.has(e.student_id)) return true;
        return false;
      });
    }
    let manualEvents = rawEvents.map(mapRow);

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
// THIS student. Instead of deleting the row, we mark it with isCompleted = true
// so the calendar can render it in pastel green with strikethrough OR hide it depending on the toggle.
async function filterCompleted(rows, userId) {
  if (!userId) {
    (rows || []).forEach(e => { e.isCompleted = false; });
    return rows;
  }
  const asgnIds = (rows || []).filter(e => e.type === 'deadline' && e.assignment_id).map(e => e.assignment_id);
  const chalIds = (rows || []).filter(e => e.type === 'challenge' && e.assignment_id).map(e => e.assignment_id);
  if (asgnIds.length === 0 && chalIds.length === 0) {
    (rows || []).forEach(e => { e.isCompleted = false; });
    return rows;
  }

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

  (rows || []).forEach(e => {
    if (e.type === 'deadline' && e.assignment_id) {
      e.isCompleted = completedAsgn.has(e.assignment_id);
    } else if (e.type === 'challenge' && e.assignment_id) {
      e.isCompleted = completedChal.has(e.assignment_id);
    } else {
      e.isCompleted = false;
    }
  });

  return rows;
}

// ── GET /schedule?studentId=xxx&date=YYYY-MM-DD ──────────────
router.get('/', async (req, res) => {
  const { studentId, date, hideCompleted } = req.query;
  if (!studentId || !date) return res.status(400).json({ error: 'studentId and date required' });
  try {
    const [{ data: exactData, error: err1 }, { data: activeDeadlines, error: err2 }, profile] = await Promise.all([
      supabase.from('schedule_events').select('*').eq('event_date', date).or(`student_id.eq.${studentId},student_id.eq.all`),
      supabase.from('schedule_events').select('*').in('type', ['deadline', 'challenge']).gte('event_date', date).or(`student_id.eq.${studentId},student_id.eq.all`),
      getStudentProfile(studentId),
    ]);
    if (err1) throw err1;
    if (err2) throw err2;

    const allMap = new Map();
    (exactData || []).forEach(e => allMap.set(e.id, e));
    (activeDeadlines || []).forEach(e => {
      const start = e.created_at ? e.created_at.split('T')[0] : e.event_date;
      if (start <= date && e.event_date >= date) {
        allMap.set(e.id, e);
      }
    });
    let rows = Array.from(allMap.values());

    let scopedData = await scopeAllEvents(rows, profile.userId);
    scopedData = await filterCompleted(scopedData, profile.userId);
    if (String(hideCompleted) === 'true') {
      scopedData = scopedData.filter(e => !e.isCompleted);
    }
    res.json((scopedData ?? []).map(mapRow));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /schedule/month?studentId=xxx&year=2026&month=4 ──────
router.get('/month', async (req, res) => {
  const { studentId, year, month, hideCompleted } = req.query;
  if (!studentId || !year || !month) return res.status(400).json({ error: 'studentId, year, month required' });
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  try {
    const [{ data, error }, profile] = await Promise.all([
      supabase.from('schedule_events').select('id,event_date,start_time,end_time,type,note,student_id,created_by,created_by_id,assignment_id,created_at').like('event_date', `${prefix}%`).or(`student_id.eq.${studentId},student_id.eq.all`),
      getStudentProfile(studentId),
    ]);
    if (error) throw error;

    let scopedData = await scopeAllEvents(data, profile.userId);
    scopedData = await filterCompleted(scopedData, profile.userId);
    if (String(hideCompleted) === 'true') {
      scopedData = scopedData.filter(e => !e.isCompleted);
    }
    const dates = [...new Set((scopedData ?? []).map(e => e.event_date))];
    res.json({ dates });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /schedule/upcoming?studentId=xxx ────────────────────
router.get('/upcoming', async (req, res) => {
  const { studentId, hideCompleted } = req.query;
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
    if (String(hideCompleted) === 'true') {
      scopedData = scopedData.filter(e => !e.isCompleted);
    }
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

// ── PATCH / PUT /schedule/:id ────────────────────────────────
async function handleUpdateSchedule(req, res) {
  const { id } = req.params;
  const { startTime, endTime, title, date, event_date, type, note, tag, isCompleted, studentId } = req.body;
  try {
    const updates = {};
    if (startTime !== undefined) updates.start_time = startTime;
    if (endTime !== undefined) updates.end_time = endTime;
    if (title !== undefined) updates.title = title;
    if (date !== undefined) updates.event_date = date;
    if (event_date !== undefined) updates.event_date = event_date;
    if (type !== undefined) updates.type = type;
    if (note !== undefined) updates.note = note;
    if (tag !== undefined) updates.tag = tag;
    if (isCompleted !== undefined) updates.isCompleted = !!isCompleted;
    if (studentId !== undefined) updates.student_id = studentId;
    const { data, error } = await supabase.from('schedule_events').update(updates).eq('id', id).select().single();
    if (error) throw error;
    res.json(mapRow(data));
  } catch (err) { res.status(500).json({ error: err.message }); }
}

router.patch('/:id', handleUpdateSchedule);
router.put('/:id', handleUpdateSchedule);

// ── DELETE /schedule/:id ─────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase.from('schedule_events').delete().eq('id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/tags', (req, res) => {
  res.json({
    assignmentTags: [
      { key: 'learning_experience', label: 'Learning experience', color: '#7FC29B' },
      { key: 'quick_task', label: 'Quick task', color: '#7FB2D6' },
      { key: 'worksheet', label: 'Worksheet', color: '#E3B24C' },
      { key: 'ai_tutor', label: 'AI Tutor', color: '#9B8FE8' },
      { key: 'video_meeting', label: 'Video meeting', color: '#E58AA6' },
      { key: 'ai_challenge', label: 'AI Challenge', color: '#E58AA6' },
      { key: 'live_class', label: 'Live Class', color: '#7FC29B' },
    ],
    eventTags: [
      { key: 'holidays_and_vacations', label: 'Holidays and vacations', color: '#E58AA6' },
      { key: 'whole_school_events', label: 'Whole school events', color: '#7FC29B' },
      { key: 'curriculum_unit_timeline', label: 'MYP Unit Timeline', color: '#E58AA6' },
      { key: 'special_assembly', label: 'Special Assembly', color: '#7FC29B' },
      { key: 'working_day', label: 'Working Day', color: '#C4BCA9' },
      { key: 'rotation_day_cycle', label: 'Rotation Day Cycle', color: '#7FB2D6' },
      { key: 'smarttask_cycle', label: 'SmartTask Cycle Timeline', color: '#E58AA6' },
    ],
  });
});

router.get('/ical', async (req, res) => {
  try {
    const { studentId, email, role } = req.query;

    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 30);
    const dateStr = pastDate.toISOString().split('T')[0];

    let query = supabase.from('schedule_events').select('*').gte('event_date', dateStr);

    if (studentId) {
      query = query.or(`student_id.eq.${studentId},student_id.eq.all`);
    }

    if (role === 'teacher' && email) {
      const { data: userData, error: userError } = await supabase.from('users').select('id').eq('email', email).single();
      if (!userError && userData) {
        query = query.eq('created_by_id', userData.id);
      }
    }

    const { data: events, error } = await query;
    if (error) throw error;

    const mappedEvents = (events || []).map(mapRow);

    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth()+1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

    let ical = 'BEGIN:VCALENDAR\r\n';
    ical += 'VERSION:2.0\r\n';
    ical += 'PRODID:-//Aivorah//Schedule//EN\r\n';
    ical += 'CALSCALE:GREGORIAN\r\n';
    ical += 'METHOD:PUBLISH\r\n';
    ical += 'X-WR-CALNAME:Aivorah Schedule\r\n';
    ical += 'X-WR-TIMEZONE:Asia/Kolkata\r\n';

    for (const ev of mappedEvents) {
      if (!ev.date) continue;
      const dateVal = ev.date.replace(/-/g, '');
      let stTime = ev.startTime;
      let enTime = ev.endTime;
      
      let startStr = '';
      let endStr = '';
      
      if (!stTime) {
        stTime = '00:00';
      }
      
      if (stTime === '23:59') {
        const nextDate = new Date(ev.date);
        nextDate.setDate(nextDate.getDate() + 1);
        const nextDateStr = nextDate.toISOString().split('T')[0].replace(/-/g, '');
        startStr = `DTSTART;VALUE=DATE:${dateVal}\r\n`;
        endStr = `DTEND;VALUE=DATE:${nextDateStr}\r\n`;
      } else {
        if (!enTime) {
          const [h, m] = stTime.split(':').map(Number);
          enTime = `${pad((h+1)%24)}:${pad(m)}`;
        }
        const stTimeVal = stTime.replace(/:/g, '') + '00';
        const enTimeVal = enTime.replace(/:/g, '') + '00';
        startStr = `DTSTART;TZID=Asia/Kolkata:${dateVal}T${stTimeVal}\r\n`;
        endStr = `DTEND;TZID=Asia/Kolkata:${dateVal}T${enTimeVal}\r\n`;
      }

      ical += 'BEGIN:VEVENT\r\n';
      ical += `UID:${ev.id}@aivorah.com\r\n`;
      ical += `DTSTAMP:${dtstamp}\r\n`;
      ical += startStr;
      ical += endStr;
      ical += `SUMMARY:${ev.title || ''}\r\n`;
      if (ev.note) {
        ical += `DESCRIPTION:${ev.note.replace(/\r?\n/g, '\\n')}\r\n`;
      } else {
        ical += `DESCRIPTION:\r\n`;
      }
      if (ev.tag) {
        ical += `CATEGORIES:${ev.tag}\r\n`;
      }
      ical += 'STATUS:CONFIRMED\r\n';
      ical += 'END:VEVENT\r\n';
    }

    ical += 'END:VCALENDAR';

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="aivorah-schedule.ics"');
    res.send(ical);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
