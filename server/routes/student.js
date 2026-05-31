const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { client: qdrant, resolveCollection } = require('../services/qdrant');
const { normalizeCurriculum } = require('../utils/curriculum');

// ── Helpers ────────────────────────────────────────────────

/**
 * Query Qdrant for the number of unique topics for a given curriculum + grade.
 * Returns 0 if Qdrant is unreachable (graceful fallback — caller can show "—").
 */
/**
 * Normalize grade to match Qdrant payload format.
 * Supabase stores "grade 4", Qdrant stores "Grade 4".
 */
function normalizeGrade(grade) {
  const g = String(grade || '').trim();
  // Plain integer string → integer (Qdrant stores grade as integer)
  if (/^\d+$/.test(g)) return parseInt(g, 10);
  // "grade 4", "Grade 4", "GRADE 4" → integer 4
  const m = g.match(/^grade\s+(\d+)$/i);
  if (m) return parseInt(m[1], 10);
  return g; // pass through as-is (fallback)
}

async function fetchTotalTopicsFromQdrant(curriculum, grade) {
  try {
    const normCurr = normalizeCurriculum(curriculum, 'IB PYP');
    const { collection, qdrantCurriculum, qdrantGrade } = resolveCollection(normCurr, grade);
    const mustFilters = [
      { key: 'curriculum', match: { value: qdrantCurriculum } },
      { key: 'grade',      match: { value: qdrantGrade } },
    ];
    const seen   = new Set();
    let offset   = null;
    do {
      const result = await qdrant.scroll(collection, {
        filter:       { must: mustFilters },
        limit:        100,
        offset:       offset ?? undefined,
        with_payload: true,
        with_vector:  false,
      });
      for (const point of result.points) {
        const p = point.payload;
        seen.add(`${p.subject}|${p.topic}`);
      }
      offset = result.next_page_offset ?? null;
    } while (offset !== null);
    return seen.size;
  } catch {
    return 0;
  }
}

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
  let { data } = await supabase
    .from('student_stats')
    .select('*')
    .eq('student_id', studentId)
    .maybeSingle();

  if (!data) {
    // Verify the user exists before inserting (avoids FK violation)
    const { data: userExists } = await supabase
      .from('users')
      .select('id')
      .eq('id', studentId)
      .maybeSingle();

    if (!userExists) {
      // Return default stats object without persisting
      return {
        student_id: studentId, xp_points: 0, level: 1, current_streak: 0,
        completed_topics: [], study_time_minutes: 0, today_study_minutes: 0,
        today_xp: 0, assignments_done: 0, last_active_date: todayISO(),
      };
    }

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
        topics:  [...new Set(s.completed_topics ?? [])].length,
      };
    });

    res.json(leaderboard);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /student/by-curriculum?curriculum=IB PYP ────────────
// Must be before /:id to avoid being caught by the parameterized route

router.get('/by-curriculum', async (req, res) => {
  try {
    const { curriculum } = req.query;
    let query = supabase
      .from('users')
      .select('id, name, email, grade, curriculum, photo_url')
      .eq('role', 'student');
    if (curriculum) query = query.eq('curriculum', curriculum);
    const { data, error } = await query.order('name');
    if (error) return res.status(500).json({ error: error.message });
    res.json((data || []).map(u => ({
      id: u.id, name: u.name, email: u.email,
      grade: u.grade, curriculum: u.curriculum, photoUrl: u.photo_url ?? null,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /student/available-to-link?teacherEmail=xxx ────────
// Returns students NOT already linked to this teacher.
// If teacher record has grade/curriculum, filters to matching students.

router.get('/available-to-link', async (req, res) => {
  try {
    const teacherEmail = String(req.query.teacherEmail || '').toLowerCase().trim();
    if (!teacherEmail) return res.status(400).json({ error: 'teacherEmail required' });

    // Resolve teacher record (optional — used for grade/curriculum filtering)
    const { data: teacher } = await supabase
      .from('users')
      .select('id, grade, curriculum')
      .eq('email', teacherEmail)
      .maybeSingle();

    // Get already-linked student IDs (works even if teacher not in users table)
    let linkedIds = [];
    if (teacher?.id) {
      const { data: linked } = await supabase
        .from('teacher_student')
        .select('student_id')
        .eq('teacher_id', teacher.id);
      linkedIds = (linked || []).map(l => l.student_id);
    }

    // Grades to filter by — priority: ?grades param → user_preferences teaches → teacher.grade → all pilot grades
    const VALID_GRADES = ['Grade 3', 'Grade 4', 'Grade 5'];
    let gradesToShow = VALID_GRADES;

    // 1. Grades passed directly from frontend (from user.teaches in auth context)
    const gradesParam = req.query.grades
      ? String(req.query.grades).split(',').map(g => decodeURIComponent(g.trim())).filter(g => VALID_GRADES.includes(g))
      : [];

    if (gradesParam.length > 0) {
      gradesToShow = gradesParam;
    } else {
      // 2. Look up teaches[] from user_preferences in Supabase
      const { data: prefs } = await supabase
        .from('user_preferences')
        .select('data')
        .eq('user_email', teacherEmail)
        .maybeSingle();
      const teaches = prefs?.data?.teaches;
      if (Array.isArray(teaches) && teaches.length > 0) {
        const fromPrefs = teaches.map(t => t.grade).filter(g => VALID_GRADES.includes(g));
        if (fromPrefs.length > 0) gradesToShow = fromPrefs;
      } else if (teacher?.grade && VALID_GRADES.includes(teacher.grade)) {
        // 3. Single grade from users table
        gradesToShow = [teacher.grade];
      }
    }

    let query = supabase
      .from('users')
      .select('id, name, email, grade, curriculum, photo_url, role')
      .neq('role', 'teacher')
      .in('grade', gradesToShow);

    if (teacher?.curriculum) query = query.eq('curriculum', teacher.curriculum);

    const { data: candidates } = await query;

    const available = (candidates || [])
      .filter(s => !linkedIds.includes(s.id) && s.name && s.role !== 'teacher')
      .map(s => ({ id: s.id, name: s.name, email: s.email, grade: s.grade, curriculum: s.curriculum, photoUrl: s.photo_url }));

    res.json(available);
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

    // Fetch user profile to get curriculum + grade for dynamic totalTopics
    const { data: userRow } = await supabase
      .from('users')
      .select('curriculum, grade')
      .eq('id', id)
      .single();

    const curriculum  = userRow?.curriculum ?? '';
    const grade       = userRow?.grade ?? '';
    const totalTopics = await fetchTotalTopicsFromQdrant(curriculum, grade);

    res.json({ ...normalise(record), totalTopics });
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
    // NOTE: completed_topics is intentionally excluded here — it is managed
    // exclusively by POST /complete-lesson to avoid race-condition overwrites.
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

// ── GET /student/by-curriculum?curriculum=IB PYP ────────────
// Returns all students with a given curriculum (for teacher student picker fallback)

// ── GET /student/by-teacher/:teacherId ─────────────────────
// Returns all students linked to a teacher with their stats

router.get('/by-teacher/:teacherId', async (req, res) => {
  try {
    const rawId = req.params.teacherId;
    const teacherId = await resolveTeacherId(rawId);

    const { data: links, error } = await supabase
      .from('teacher_student')
      .select('student_id, subject, users!teacher_student_student_id_fkey(id, name, email, grade, school, curriculum, photo_url)')
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

    const students = await Promise.all(links.map(async link => {
      const s = statsMap[link.student_id] ?? {};
      const user = link.users ?? {};
      const topicsCount = [...new Set(s.completed_topics ?? [])].length;

      const curriculum = user.curriculum ?? '';
      const grade      = user.grade ?? '';
      const totalTopics = await fetchTotalTopicsFromQdrant(curriculum, grade);
      const progressPct = totalTopics > 0
        ? Math.min(100, Math.round((topicsCount / totalTopics) * 100))
        : 0;

      return {
        id:             link.student_id,
        name:           user.name,
        email:          user.email,
        grade:          user.grade,
        school:         user.school,
        curriculum:     user.curriculum ?? null,
        subject:        link.subject,
        totalTopics,
        xpPoints:       s.xp_points        ?? 0,
        level:          s.level            ?? 1,
        currentStreak:  s.current_streak   ?? 0,
        studyTime:      s.study_time_minutes ?? 0,
        completedTopics: s.completed_topics ?? [],
        progressPct,
        assignmentsDone: s.assignments_done ?? 0,
        lastActive:     s.last_active_date,
        needsAttention: (() => {
          const studyTime = s.study_time_minutes ?? 0;
          const xp = s.xp_points ?? 0;
          const chapters = (s.completed_topics ?? []).length;
          if (studyTime === 0 && xp === 0 && chapters === 0) return false;
          return progressPct < 30 || (s.current_streak ?? 0) < 2;
        })(),
        photoUrl:       user.photo_url ?? null,
      };
    }));

    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /student/by-teacher/:teacherId/insights ─────────────
// Returns aggregated assignment + challenge data for all students of a teacher.
// Used by TeacherDashboardScreen to populate Assignment & Challenge insight tiles.

router.get('/by-teacher/:teacherId/insights', async (req, res) => {
  try {
    const rawId = req.params.teacherId;
    const teacherId = await resolveTeacherId(rawId);

    const { data: links } = await supabase
      .from('teacher_student')
      .select('student_id')
      .eq('teacher_id', teacherId ?? rawId);

    const studentIds = (links || []).map(l => l.student_id);
    if (studentIds.length === 0) return res.json({ assignments: [], challenges: [] });

    // Fetch all assignment submissions for these students
    const { data: subs } = await supabase
      .from('assignment_submissions')
      .select('student_id, assignment_id, score, status, completed_at')
      .in('student_id', studentIds);

    // Fetch all challenge assignments for these students
    const { data: challengeAssigns } = await supabase
      .from('challenge_assignments')
      .select('student_id, challenge_id, status, score, xp_awarded, created_at')
      .in('student_id', studentIds);

    // Get student names
    const { data: users } = await supabase
      .from('users')
      .select('id, name')
      .in('id', studentIds);
    const nameMap = {};
    (users || []).forEach(u => { nameMap[u.id] = u.name; });

    // Aggregate assignment stats per student
    const assignMap = {};
    (subs || []).forEach(s => {
      if (!assignMap[s.student_id]) assignMap[s.student_id] = { submitted: 0, totalScore: 0, scored: 0 };
      assignMap[s.student_id].submitted++;
      if (typeof s.score === 'number') {
        assignMap[s.student_id].totalScore += s.score;
        assignMap[s.student_id].scored++;
      }
    });

    const assignmentStats = studentIds.map(id => ({
      id,
      name: nameMap[id] || 'Unknown',
      submitted: assignMap[id]?.submitted || 0,
      avgScore: assignMap[id]?.scored > 0 ? Math.round(assignMap[id].totalScore / assignMap[id].scored) : null,
    }));

    // Aggregate challenge stats per student
    const challMap = {};
    (challengeAssigns || []).forEach(c => {
      if (!challMap[c.student_id]) challMap[c.student_id] = { assigned: 0, completed: 0, totalScore: 0, scored: 0 };
      challMap[c.student_id].assigned++;
      if (c.status === 'completed') challMap[c.student_id].completed++;
      if (typeof c.score === 'number') {
        challMap[c.student_id].totalScore += c.score;
        challMap[c.student_id].scored++;
      }
    });

    const challengeStats = studentIds.map(id => ({
      id,
      name: nameMap[id] || 'Unknown',
      assigned: challMap[id]?.assigned || 0,
      completed: challMap[id]?.completed || 0,
      avgScore: challMap[id]?.scored > 0 ? Math.round(challMap[id].totalScore / challMap[id].scored) : null,
    }));

    // Totals
    const totalSubmissions = (subs || []).length;
    const allScores = (subs || []).filter(s => typeof s.score === 'number').map(s => s.score);
    const classAvgScore = allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : null;

    const totalChallengesAssigned = (challengeAssigns || []).length;
    const totalChallengesCompleted = (challengeAssigns || []).filter(c => c.status === 'completed').length;

    res.json({
      assignments: assignmentStats,
      challenges: challengeStats,
      totals: {
        totalSubmissions,
        classAvgScore,
        totalChallengesAssigned,
        totalChallengesCompleted,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /student/:id/performance?email= ────────────────────
// Returns per-topic quiz scores from analytics events for the student's dashboard.
// Uses email (not UUID) to match analytics events since they're keyed by email.

router.get('/:id/performance', async (req, res) => {
  try {
    const email = String(req.query.email || '').toLowerCase().trim();
    if (!email) return res.json({ topics: {}, avgScore: null, topicCount: 0 });

    const { readEvents } = require('../services/analytics');
    const childEvents = await readEvents({ userEmail: email });

    const topicMap = {};
    const allScores = [];

    for (const e of childEvents) {
      const topic = e.topic || '';
      if (!topic) continue;

      if (!topicMap[topic]) {
        topicMap[topic] = { subject: e.subject || '', grade: e.grade || '', quizScores: [], sessions: 0, lastActivity: '' };
      }
      const t = topicMap[topic];

      if ((e.eventType === 'ibpyp_quiz_result' || e.eventType === 'ncert_quiz_result') && typeof e.score === 'number') {
        t.quizScores.push(e.score);
        allScores.push(e.score);
      }
      if (e.eventType === 'ai_lesson_script' || e.eventType === 'lesson_started') {
        t.sessions++;
      }
      if (e.timestamp && e.timestamp > t.lastActivity) t.lastActivity = e.timestamp;
    }

    const topics = {};
    for (const [topic, t] of Object.entries(topicMap)) {
      const avgScore = t.quizScores.length > 0
        ? Math.round(t.quizScores.reduce((a, b) => a + b, 0) / t.quizScores.length)
        : null;
      topics[topic] = {
        subject: t.subject, grade: t.grade,
        avgScore, quizCount: t.quizScores.length, sessions: t.sessions, lastActivity: t.lastActivity,
      };
    }

    const avgScore = allScores.length > 0
      ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
      : null;

    res.json({ topics, avgScore, topicCount: Object.keys(topics).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /student/idle-logout ─────────────────────────────────────────────
// Called when student is auto-logged out due to inactivity — notifies linked parent via message
router.post('/idle-logout', async (req, res) => {
  const { studentEmail, studentName } = req.body;
  if (!studentEmail) return res.status(400).json({ error: 'studentEmail required' });
  try {
    // Find student's user ID
    const { data: studentUser } = await supabase
      .from('users')
      .select('id, name')
      .eq('email', studentEmail.toLowerCase().trim())
      .maybeSingle();

    const name = studentName || studentUser?.name || studentEmail;

    // Find linked parent via parent_children table
    let parentEmail = null;
    if (studentUser?.id) {
      const { data: link } = await supabase
        .from('parent_children')
        .select('parent_email')
        .eq('child_id', studentUser.id)
        .maybeSingle();
      parentEmail = link?.parent_email || null;
    }

    if (parentEmail) {
      const now = new Date().toISOString();
      const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
      await supabase.from('messages').insert({
        sender_email: 'system@aivorah.com',
        sender_name: 'Aivorah',
        sender_role: 'teacher',
        recipient_email: parentEmail,
        recipient_name: parentEmail,
        content: `[Auto-Logout] ${name} was automatically logged out of Aivorah at ${timeStr} after 5 minutes of inactivity. If this seems unexpected, you may want to check in with them.`,
        created_at: now,
      });
      console.log(`[idle-logout] Message sent to parent ${parentEmail} for student ${studentEmail}`);
    }

    res.json({ success: true, parentNotified: !!parentEmail });
  } catch (e) {
    console.error('[idle-logout]', e.message);
    res.json({ success: true }); // never block the logout
  }
});

module.exports = router;
module.exports.fetchTotalTopicsFromQdrant = fetchTotalTopicsFromQdrant;
