const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');

// ── Helpers ────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function computeLevel(xp) {
  let level = 1, threshold = 500, total = 0;
  while (xp >= total + threshold) { total += threshold; threshold += 250; level++; }
  return level;
}

// Normalise DB row → frontend shape (snake_case → camelCase)
function normalise(row) {
  return {
    studentId:           row.student_id,
    xpPoints:            row.xp_points,
    level:               row.level,
    studyTimeMinutes:    row.study_time_minutes,
    topicsExplored:      row.topics_explored,
    challengesCompleted: row.challenges_completed,
    assignmentsDone:     row.assignments_done,
    currentStreak:       row.current_streak,
    lastActiveDate:      row.last_active_date,
    todayStudyMinutes:   row.today_study_minutes,
    todayXP:             row.today_xp,
    completedTopics:     row.completed_topics ?? [],
    lastLesson:          row.last_lesson ?? '',
  };
}

// Get or create student_stats row
async function getOrCreate(studentId) {
  let { data, error } = await supabase
    .from('student_stats')
    .select('*')
    .eq('student_id', studentId)
    .single();

  if (error || !data) {
    // Auto-create with defaults
    const { data: created, error: createErr } = await supabase
      .from('student_stats')
      .insert({ student_id: studentId, last_active_date: todayISO() })
      .select()
      .single();
    if (createErr) throw createErr;
    data = created;
  }
  return data;
}

// ── GET /student/leaderboard?limit=10 ──────────────────────
// Returns top students ranked by XP from student_stats + users tables

router.get('/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    const { data: stats, error } = await supabase
      .from('student_stats')
      .select('student_id, xp_points, level, current_streak, completed_topics')
      .order('xp_points', { ascending: false })
      .limit(limit);

    if (error) return res.status(500).json({ error: error.message });
    if (!stats || stats.length === 0) return res.json([]);

    const ids = stats.map(s => s.student_id);
    const { data: users } = await supabase
      .from('users')
      .select('id, name, grade')
      .in('id', ids);

    const userMap = {};
    (users ?? []).forEach(u => { userMap[u.id] = u; });

    const leaderboard = stats.map((s, i) => {
      const user = userMap[s.student_id] ?? {};
      return {
        rank:    i + 1,
        id:      s.student_id,
        name:    user.name || 'Student',
        grade:   user.grade || 'Grade 3',
        score:   s.xp_points ?? 0,
        level:   s.level ?? 1,
        streak:  s.current_streak ?? 0,
        topics:  (s.completed_topics ?? []).length,
      };
    });

    res.json(leaderboard);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /student/:id ────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let record = await getOrCreate(id);
    const today = todayISO();

    // Reset today's counters if new day; recalculate streak
    if (record.last_active_date !== today) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yISO = yesterday.toISOString().split('T')[0];
      const newStreak = record.last_active_date === yISO
        ? (record.current_streak || 0) + 1
        : 1;

      const { data: updated } = await supabase
        .from('student_stats')
        .update({
          today_study_minutes: 0,
          today_xp:            0,
          current_streak:      newStreak,
          last_active_date:    today,
          updated_at:          new Date().toISOString(),
        })
        .eq('student_id', id)
        .select()
        .single();
      record = updated ?? record;
    }

    res.json(normalise(record));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /student/:id ────────────────────────────────────────
// Full stats sync from client

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;

    const patch = {};
    if (body.xpPoints            != null) patch.xp_points            = body.xpPoints;
    if (body.level               != null) patch.level                = body.level;
    if (body.studyTimeMinutes    != null) patch.study_time_minutes   = body.studyTimeMinutes;
    if (body.topicsExplored      != null) patch.topics_explored      = body.topicsExplored;
    if (body.challengesCompleted != null) patch.challenges_completed = body.challengesCompleted;
    if (body.assignmentsDone     != null) patch.assignments_done     = body.assignmentsDone;
    if (body.currentStreak       != null) patch.current_streak       = body.currentStreak;
    if (body.todayStudyMinutes   != null) patch.today_study_minutes  = body.todayStudyMinutes;
    if (body.todayXP             != null) patch.today_xp             = body.todayXP;
    if (body.completedTopics     != null) patch.completed_topics     = body.completedTopics;
    if (body.lastLesson          != null) patch.last_lesson          = body.lastLesson;
    if (body.lastActiveDate      != null) patch.last_active_date     = body.lastActiveDate;
    patch.updated_at = new Date().toISOString();

    // Upsert — creates if not exists
    const { data, error } = await supabase
      .from('student_stats')
      .upsert({ student_id: id, ...patch }, { onConflict: 'student_id' })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(normalise(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /student/:id/weekly ─────────────────────────────────
// Returns last 7 days activity from student_daily_log

router.get('/:id/weekly', async (req, res) => {
  try {
    const { id } = req.params;

    // Build date range
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push({
        date: d.toISOString().split('T')[0],
        day:  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()],
      });
    }
    const from = days[0].date;
    const to   = days[days.length - 1].date;

    const { data: logs } = await supabase
      .from('student_daily_log')
      .select('*')
      .eq('student_id', id)
      .gte('log_date', from)
      .lte('log_date', to);

    const logMap = {};
    (logs ?? []).forEach(l => { logMap[l.log_date] = l; });

    res.json({
      days: days.map(d => ({
        date:            d.date,
        day:             d.day,
        studyMinutes:    logMap[d.date]?.study_minutes    ?? 0,
        xp:              logMap[d.date]?.xp_earned        ?? 0,
        topicsCompleted: logMap[d.date]?.topics_completed ?? 0,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /student/:id/complete-lesson ──────────────────────

router.post('/:id/complete-lesson', async (req, res) => {
  try {
    const { id } = req.params;
    const { topic } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic required' });

    const record = await getOrCreate(id);
    const today  = todayISO();
    const alreadyDone = (record.completed_topics ?? []).includes(topic);

    const patch = { last_lesson: topic, last_active_date: today, updated_at: new Date().toISOString() };

    if (!alreadyDone) {
      const newXP      = (record.xp_points  || 0) + 150;
      patch.xp_points            = newXP;
      patch.today_xp             = (record.today_xp    || 0) + 150;
      patch.topics_explored      = (record.topics_explored || 0) + 1;
      patch.level                = computeLevel(newXP);
      patch.completed_topics     = [...(record.completed_topics ?? []), topic];

      // Upsert daily log
      await supabase.from('student_daily_log').upsert({
        student_id:       id,
        log_date:         today,
        xp_earned:        (record.today_xp || 0) + 150,
        topics_completed: 1,
      }, { onConflict: 'student_id,log_date', ignoreDuplicates: false });
    }

    const { data: updated, error } = await supabase
      .from('student_stats')
      .update(patch)
      .eq('student_id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(normalise(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /student/:id/study-time ───────────────────────────

router.post('/:id/study-time', async (req, res) => {
  try {
    const { id } = req.params;
    const { minutes = 1 } = req.body;
    const record = await getOrCreate(id);
    const today  = todayISO();

    const todayMins = record.last_active_date === today
      ? (record.today_study_minutes || 0) + minutes
      : minutes;

    const totalMins = (record.study_time_minutes || 0) + minutes;

    await supabase.from('student_stats').update({
      study_time_minutes:  totalMins,
      today_study_minutes: todayMins,
      last_active_date:    today,
      updated_at:          new Date().toISOString(),
    }).eq('student_id', id);

    // Upsert daily log
    await supabase.from('student_daily_log').upsert({
      student_id:    id,
      log_date:      today,
      study_minutes: todayMins,
    }, { onConflict: 'student_id,log_date', ignoreDuplicates: false });

    res.json({ studyTimeMinutes: totalMins, todayStudyMinutes: todayMins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helpers ─────────────────────────────────────────────────
const TEACHER_ID_MAP = {
  'teacher@demo.com': '00000000-0000-0000-0000-000000000004',
};

async function resolveTeacherId(id) {
  if (!id) return null;
  if (TEACHER_ID_MAP[id]) return TEACHER_ID_MAP[id];
  if (/^[0-9a-f-]{36}$/.test(id)) return id;
  // Lookup by email in users table
  const { data } = await supabase.from('users').select('id').eq('email', id).single();
  return data?.id || id;
}

// ── GET /student/by-teacher/:teacherId ─────────────────────
// Returns all students linked to a teacher with their stats

router.get('/by-teacher/:teacherId', async (req, res) => {
  try {
    const rawId = req.params.teacherId;
    const teacherId = await resolveTeacherId(rawId);

    const { data: links, error } = await supabase
      .from('teacher_student')
      .select('student_id, subject, users!teacher_student_student_id_fkey(id, name, email, grade, school, photo_url)')
      .eq('teacher_id', teacherId ?? rawId);

    if (error) return res.status(500).json({ error: error.message });

    const studentIds = links.map(l => l.student_id);
    if (studentIds.length === 0) return res.json([]);

    const { data: stats } = await supabase
      .from('student_stats')
      .select('*')
      .in('student_id', studentIds);

    const statsMap = {};
    (stats ?? []).forEach(s => { statsMap[s.student_id] = s; });

    const students = links.map(link => {
      const s = statsMap[link.student_id] ?? {};
      const user = link.users ?? {};
      const topicsCount = (s.completed_topics ?? []).length;
      const totalTopics = 14; // NCERT Grade 3 chapters
      const progressPct = Math.round((topicsCount / totalTopics) * 100);

      return {
        id:             link.student_id,
        name:           user.name,
        email:          user.email,
        grade:          user.grade,
        school:         user.school,
        subject:        link.subject,
        xpPoints:       s.xp_points        ?? 0,
        level:          s.level            ?? 1,
        currentStreak:  s.current_streak   ?? 0,
        studyTime:      s.study_time_minutes ?? 0,
        completedTopics: s.completed_topics ?? [],
        progressPct,
        assignmentsDone: s.assignments_done ?? 0,
        lastActive:     s.last_active_date,
        needsAttention: progressPct < 30 || (s.current_streak ?? 0) < 2,
        photoUrl:       user.photo_url ?? null,
      };
    });

    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
