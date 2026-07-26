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

// teacher_student.subject is meant to scope a teacher to a real subject
// (Mathematics, English, ...), but many existing rows were populated with the
// curriculum name instead (e.g. "IB PYP", "CBSE"). Treat those as "no subject
// restriction" so we don't silently zero out every teacher's dashboard until
// links are recreated with real subjects.
const CURRICULUM_NAME_SET = new Set([
  'ib pyp', 'ib_pyp', 'ibpyp', 'ncert', 'cbse', 'cambridge', 'oxford', 'pearson',
  'singapore moe', 'singapore_moe', 'general',
]);
function isRealSubject(subject) {
  const s = String(subject || '').trim().toLowerCase();
  return s.length > 0 && !CURRICULUM_NAME_SET.has(s);
}

// Module-level cache for topic counts — avoids repeated Qdrant pagination on every page load
const _topicCountCache = new Map(); // key → { count, expiresAt }
const TOPIC_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function fetchTotalTopicsFromQdrant(curriculum, grade, subject) {
  const cacheKey = `${curriculum}|${grade}|${subject || ''}`;
  const cached = _topicCountCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.count;

  try {
    const normCurr = normalizeCurriculum(curriculum, 'IB PYP');
    const { collection, qdrantCurriculum, qdrantGrade } = resolveCollection(normCurr, grade);
    const mustFilters = [
      { key: 'curriculum', match: { value: qdrantCurriculum } },
      { key: 'grade',      match: { value: qdrantGrade } },
    ];
    if (isRealSubject(subject)) mustFilters.push({ key: 'subject', match: { value: subject } });
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
    const count = seen.size;
    _topicCountCache.set(cacheKey, { count, expiresAt: Date.now() + TOPIC_CACHE_TTL_MS });
    return count;
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
    learningPathMinutes: row.learning_path_minutes,
    assignmentTimeMinutes: row.assignment_time_minutes ?? 0,
    challengeTimeMinutes:  row.challenge_time_minutes ?? 0,
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

// ── GET /student/leaderboard?limit=10&teacherEmail=xxx ──────
// Returns top students ranked by XP from student_stats + users tables.
// When teacherEmail is supplied, it becomes a *class* leaderboard scoped to
// that teacher: only their linked students, in the same school + curriculum
// and the grade(s) the teacher actually teaches.

router.get('/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const teacherEmail = String(req.query.teacherEmail || '').toLowerCase().trim();
    // Parent view: scope the board relative to one child via any combination of
    // grade / school / curriculum (the leaderboard tabs):
    //   Grade tab      → grade + school   School tab → school
    //   Curriculum tab → curriculum       Overall   → no filters
    const gradeFilter = String(req.query.grade || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const schoolFilter = String(req.query.school || '').trim();
    const curriculumFilter = String(req.query.curriculum || '').trim();

    // When scoped to a teacher, resolve the set of students that belong to their
    // class. allowedUsers maps student_id → { name, grade } for those students.
    let allowedUsers = null;
    if (!teacherEmail && (gradeFilter.length > 0 || schoolFilter || curriculumFilter)) {
      // Scoped (parent) leaderboard: students matching ALL provided filters.
      let uq = supabase
        .from('users')
        .select('id, name, grade, school, curriculum')
        .eq('role', 'student');
      if (gradeFilter.length > 0) uq = uq.in('grade', gradeFilter);
      if (schoolFilter)           uq = uq.eq('school', schoolFilter);
      if (curriculumFilter)       uq = uq.eq('curriculum', curriculumFilter);
      const { data: us } = await uq;
      allowedUsers = {};
      (us || []).forEach(u => { allowedUsers[u.id] = u; });
    }
    if (teacherEmail) {
      const { data: teacher } = await supabase
        .from('users')
        .select('id, grade, curriculum, school')
        .eq('email', teacherEmail)
        .maybeSingle();

      // Grades the teacher teaches: teaches[] (authoritative) → users.grade
      let scopeGrades = null;
      const { data: prefs } = await supabase
        .from('user_preferences')
        .select('data')
        .eq('user_email', teacherEmail)
        .maybeSingle();
      const teaches = prefs?.data?.teaches;
      if (Array.isArray(teaches) && teaches.length > 0) {
        const g = [...new Set(teaches.map(t => t.grade).filter(Boolean))];
        if (g.length) scopeGrades = g;
      } else if (teacher?.grade) {
        scopeGrades = [teacher.grade];
      }

      // Class leaderboard = every student in the teacher's school + curriculum
      // across the grade(s) they teach (NOT only their linked students), so the
      // board is populated like the reference rather than just a handful of links.
      let uq = supabase
        .from('users')
        .select('id, name, grade')
        .eq('role', 'student');
      if (scopeGrades)          uq = uq.in('grade', scopeGrades);
      if (teacher?.curriculum)  uq = uq.eq('curriculum', teacher.curriculum);
      if (teacher?.school)      uq = uq.eq('school', teacher.school);

      const { data: us } = await uq;
      allowedUsers = {};
      (us || []).forEach(u => { allowedUsers[u.id] = u; });
    }

    let sq = supabase
      .from('student_stats')
      .select('student_id, xp_points, level, current_streak, completed_topics')
      .order('xp_points', { ascending: false });
    if (allowedUsers) {
      const allowedIds = Object.keys(allowedUsers);
      if (allowedIds.length === 0) return res.json([]);
      sq = sq.in('student_id', allowedIds);
    }
    sq = sq.limit(limit);

    const { data: stats, error } = await sq;
    if (error) return res.status(500).json({ error: error.message });
    if (!stats || stats.length === 0) return res.json([]);

    let userMap = allowedUsers;
    if (!userMap) {
      const ids = stats.map(s => s.student_id);
      const { data: users } = await supabase
        .from('users')
        .select('id, name, grade')
        .in('id', ids);
      userMap = {};
      (users ?? []).forEach(u => { userMap[u.id] = u; });
    }

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
    const { curriculum, school } = req.query;
    let query = supabase
      .from('users')
      .select('id, name, email, grade, curriculum, photo_url')
      .eq('role', 'student');
    if (curriculum) query = query.eq('curriculum', curriculum);
    // School scoping: restrict to the teacher's school when provided.
    if (school) query = query.eq('school', String(school));
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

    // Resolve teacher record (optional — used for grade/curriculum/school filtering)
    const { data: teacher } = await supabase
      .from('users')
      .select('id, grade, curriculum, school')
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

    // 1. Grades passed directly from frontend (the teacher's actual grades). Accept
    //    them as-is — don't drop grades outside the old pilot set (UKG, Grade 6, etc.).
    const gradesParam = req.query.grades
      ? String(req.query.grades).split(',').map(g => decodeURIComponent(g.trim())).filter(Boolean)
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
        const fromPrefs = teaches.map(t => t.grade).filter(Boolean);
        if (fromPrefs.length > 0) gradesToShow = fromPrefs;
      } else if (teacher?.grade) {
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
    // School scoping: a teacher can only link students from their OWN school —
    // same curriculum + grade but a different school must not appear here.
    if (teacher?.school) query = query.eq('school', teacher.school);

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

    // Compute challenges-completed LIVE from challenge_assignments so the count is
    // always accurate (the student_stats counter isn't reliably incremented on
    // completion — caused the parent "0 Done" even after the child completed some).
    const { count: completedChallenges } = await supabase
      .from('challenge_assignments')
      .select('id', { head: true, count: 'exact' })
      .eq('student_id', id)
      .eq('status', 'completed');

    res.json({
      ...normalise(record),
      totalTopics,
      challengesCompleted: Number.isFinite(completedChallenges) ? Number(completedChallenges) : (normalise(record).challengesCompleted ?? 0),
    });
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
    if (body.topicsExplored      != null) patch.topics_explored      = body.topicsExplored;
    if (body.challengesCompleted != null) patch.challenges_completed = body.challengesCompleted;
    if (body.assignmentsDone     != null) patch.assignments_done     = body.assignmentsDone;
    if (body.currentStreak       != null) patch.current_streak       = body.currentStreak;
    if (body.todayXP             != null) patch.today_xp             = body.todayXP;
    // NOTE: completed_topics AND all study-time fields (study_time_minutes,
    // today_study_minutes, learning_path_minutes, assignment_time_minutes,
    // challenge_time_minutes) are intentionally excluded here — they're managed
    // exclusively by POST /complete-lesson and POST /:id/study-time (the latter
    // uses an atomic DB-side increment specifically to avoid a read-then-write
    // race). This blind full-state PUT fires from any client tab whenever its
    // local `stats` changes for ANY reason — a parent's session viewing a stale
    // snapshot could silently overwrite the child's freshly-incremented real
    // study time back down, which is exactly what was being reported.
    if (body.lastLesson          != null) patch.last_lesson          = body.lastLesson;
    // last_active_date is ALSO excluded from this blind sync — it's the field
    // the atomic study-time RPC and the GET day-boundary reset both use to
    // decide "same day, keep accumulating" vs "new day, reset today's minutes
    // to 0". A stale client write here (e.g. a tab that loaded before midnight,
    // or before the child's most recent study session) would silently make the
    // NEXT real study-time increment look like a new day and wipe today's
    // count — exactly the "753 min total but 0 today" contradiction seen in
    // the data. It's now updated exclusively by POST /:id/study-time and the
    // GET /:id day-rollover check.
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

    // Build current calendar week (Mon → Sun), zeros for future days
    const today = new Date();
    const todayDay = today.getDay(); // 0=Sun,1=Mon,...,6=Sat
    const mondayOffset = todayDay === 0 ? -6 : 1 - todayDay; // days back to Monday
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);

    const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push({
        date:   d.toISOString().split('T')[0],
        day:    DAY_NAMES[d.getDay()],
        future: d > today,
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
        studyMinutes:    d.future ? 0 : (logMap[d.date]?.study_minutes    ?? 0),
        xp:              d.future ? 0 : (logMap[d.date]?.xp_earned        ?? 0),
        topicsCompleted: d.future ? 0 : (logMap[d.date]?.topics_completed ?? 0),
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
    const { topic, subject, grade, curriculum } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic required' });

    const record = await getOrCreate(id);
    const today  = todayISO();
    const alreadyDone = (record.completed_topics ?? []).includes(topic);

    // Record topic → subject so the teacher dashboard can scope this completion
    // to the right subject even when it came from the Learn/Practice flow rather
    // than a quiz (which already logs this via /track-attempt). subject is
    // required — but grade/curriculum fall back to the student's own profile
    // rather than silently skipping the whole insert when the calling screen
    // didn't pass them (that gap is exactly what left completions untagged).
    if (subject) {
      const { data: userRow } = await supabase.from('users').select('grade, curriculum').eq('id', id).maybeSingle();
      const resolvedGrade = grade || userRow?.grade;
      if (resolvedGrade) {
        supabase.from('topic_attempts').insert({
          student_id: id, topic, subject, grade: resolvedGrade,
          curriculum: curriculum || userRow?.curriculum || '',
          attempt_number: 1, total_questions: 0, correct_answers: 0,
          score: 100, passed: true, time_spent_seconds: 0, per_question_results: [],
        }).then(() => {}).catch(() => {});
      }
    }

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
    const { minutes = 1, source, subject } = req.body;
    const today = todayISO();

    // Atomic DB-side increment — the previous read-then-write (SELECT the row,
    // compute new totals in JS, then UPDATE) raced whenever two study-time calls
    // landed close together (e.g. a lesson's 15s tracker + a quiz timer firing
    // around the same moment): both reads saw the same "before" value, and
    // whichever write finished last silently discarded the other's minutes.
    // That's how a student's real study time under-counted or appeared "stuck".
    const { data: updated, error } = await supabase
      .rpc('increment_student_study_time', { p_student_id: id, p_minutes: minutes, p_source: source || null, p_today: today })
      .single();
    if (error) return res.status(500).json({ error: error.message });

    const totalMins = updated.study_time_minutes;
    const todayMins = updated.today_study_minutes;
    const learningPathMins = updated.learning_path_minutes;
    const assignmentMins = updated.assignment_time_minutes;
    const challengeMins = updated.challenge_time_minutes;

    // Upsert daily log
    await supabase.from('student_daily_log').upsert({
      student_id:    id,
      log_date:      today,
      study_minutes: todayMins,
    }, { onConflict: 'student_id,log_date', ignoreDuplicates: false });

    // Per-subject Learning Path time — lets a teacher scoped to specific
    // subjects (e.g. Maths + English) see only their subjects' time, with
    // time spent on other subjects (PE, Art, ...) tracked separately.
    if (source === 'learningPath' && subject) {
      await supabase.rpc('increment_student_subject_time', {
        p_student_id: id, p_subject: subject, p_minutes: minutes, p_today: today,
      });
    }

    res.json({ studyTimeMinutes: totalMins, todayStudyMinutes: todayMins, learningPathMinutes: learningPathMins, assignmentTimeMinutes: assignmentMins, challengeTimeMinutes: challengeMins });
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

// ── GET /student/recent-activity/by-teacher/:teacherId ──────
// Live event feed (topic completed / assignment submitted / challenge completed)
// across a teacher's students — replaces the old static "Xh total study time"
// row with real, timestamped events, industry-dashboard style.
router.get('/recent-activity/by-teacher/:teacherId', async (req, res) => {
  try {
    const rawId = req.params.teacherId;
    const teacherId = await resolveTeacherId(rawId);
    // "Recent Activity" means today's activity, not a running history — a short,
    // high-signal list of what happened today, capped at 3 so it never crowds
    // out the rest of the dashboard.
    const limit = Math.min(parseInt(req.query.limit) || 3, 30);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    const { data: links } = await supabase
      .from('teacher_student')
      .select('student_id')
      .eq('teacher_id', teacherId ?? rawId);
    const studentIds = [...new Set((links ?? []).map(l => l.student_id))];
    if (studentIds.length === 0) return res.json([]);

    const { data: usersRows } = await supabase
      .from('users')
      .select('id, name')
      .in('id', studentIds);
    const nameMap = {};
    (usersRows ?? []).forEach(u => { nameMap[u.id] = u.name; });

    const [{ data: attempts }, { data: assignments }, { data: challAssigns }, { data: statsRows }] = await Promise.all([
      supabase.from('topic_attempts')
        .select('student_id, topic, subject, created_at')
        .in('student_id', studentIds).eq('passed', true)
        .order('created_at', { ascending: false }).limit(limit),
      supabase.from('assignments')
        .select('student_id, title, subject, completed_at')
        .in('student_id', studentIds).eq('status', 'completed').not('completed_at', 'is', null)
        .order('completed_at', { ascending: false }).limit(limit),
      supabase.from('challenge_assignments')
        .select('student_id, challenge_id, completed_at')
        .in('student_id', studentIds).eq('status', 'completed').not('completed_at', 'is', null)
        .order('completed_at', { ascending: false }).limit(limit),
      // Fallback for topics completed via a path that didn't log topic_attempts
      // (e.g. before subject tracking was wired up) — last_lesson + updated_at
      // is the best signal available so a real completion never silently
      // vanishes from the feed.
      supabase.from('student_stats')
        .select('student_id, last_lesson, updated_at')
        .in('student_id', studentIds).not('last_lesson', 'is', null).neq('last_lesson', ''),
    ]);

    const challengeIds = [...new Set((challAssigns ?? []).map(c => c.challenge_id))];
    let challengeTitleMap = {};
    if (challengeIds.length > 0) {
      const { data: challenges } = await supabase.from('challenges').select('id, title').in('id', challengeIds);
      (challenges ?? []).forEach(c => { challengeTitleMap[c.id] = c.title; });
    }

    // Topics already represented by a topic_attempts row (per student) — skip
    // these in the fallback so a topic isn't shown twice.
    const attemptedTopicsByStudent = {};
    (attempts ?? []).forEach(a => {
      if (!attemptedTopicsByStudent[a.student_id]) attemptedTopicsByStudent[a.student_id] = new Set();
      attemptedTopicsByStudent[a.student_id].add(a.topic);
    });
    const fallbackTopicEvents = (statsRows ?? [])
      .filter(s => !(attemptedTopicsByStudent[s.student_id]?.has(s.last_lesson)))
      .map(s => ({
        studentId: s.student_id,
        name: nameMap[s.student_id] || 'Student',
        type: 'topic',
        // prefix/title/suffix let the frontend render the title in bold
        // instead of quoted — text is kept only as a plain-text fallback.
        prefix: 'Completed ', title: s.last_lesson, suffix: '',
        text: `Completed "${s.last_lesson}"`,
        timestamp: s.updated_at,
      }));

    const events = [
      ...(attempts ?? []).map(a => ({
        studentId: a.student_id,
        name: nameMap[a.student_id] || 'Student',
        type: 'topic',
        prefix: 'Completed ', title: a.topic, suffix: a.subject ? ` in ${a.subject}` : '',
        text: `Completed "${a.topic}"${a.subject ? ` in ${a.subject}` : ''}`,
        timestamp: a.created_at,
      })),
      ...fallbackTopicEvents,
      ...(assignments ?? []).map(a => ({
        studentId: a.student_id,
        name: nameMap[a.student_id] || 'Student',
        type: 'assignment',
        prefix: 'Completed assignment ', title: a.title, suffix: '',
        text: `Completed assignment "${a.title}"`,
        timestamp: a.completed_at,
      })),
      ...(challAssigns ?? []).map(c => ({
        studentId: c.student_id,
        name: nameMap[c.student_id] || 'Student',
        type: 'challenge',
        prefix: 'Completed challenge ', title: challengeTitleMap[c.challenge_id] || 'Challenge', suffix: '',
        text: `Completed challenge "${challengeTitleMap[c.challenge_id] || 'Challenge'}"`,
        timestamp: c.completed_at,
      })),
    ]
      .filter(e => e.timestamp && new Date(e.timestamp) >= todayStart)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
      .select('student_id, subject, users!teacher_student_student_id_fkey(id, name, email, grade, school, curriculum, photo_url, created_at)')
      .eq('teacher_id', teacherId ?? rawId);

    if (error) return res.status(500).json({ error: error.message });

    // The real source of "which subjects does this teacher teach" is the
    // admin-curated Staff Subject Mapping (StaffSubjectMappingScreen), stored as
    // teacher.user_preferences.data.teaches = [{ grade, curriculum, subjects[] }].
    // teacher_student.subject is a separate, mostly-unused field that in practice
    // holds the curriculum name, not a real subject — so it's only a fallback.
    const { data: teacherUser } = await supabase.from('users').select('email').eq('id', teacherId ?? rawId).maybeSingle();
    let teacherTeaches = [];
    if (teacherUser?.email) {
      const { data: teacherPrefs } = await supabase
        .from('user_preferences')
        .select('data')
        .eq('user_email', teacherUser.email)
        .maybeSingle();
      teacherTeaches = teacherPrefs?.data?.teaches || [];
    }
    // Resolve real subjects for a given grade+curriculum from the teaches mapping.
    function subjectsForGradeCurriculum(grade, curriculum) {
      const subjects = new Set();
      teacherTeaches.forEach(entry => {
        if (entry.grade === grade && entry.curriculum === curriculum) {
          (entry.subjects || []).forEach(s => subjects.add(s));
        }
      });
      return subjects;
    }

    // A student can have multiple subject-scoped links to the same teacher (e.g.
    // "Mathematics" + "English") — collect all real subjects per student before
    // deduplicating to a single row, so we know exactly which subjects this
    // teacher is scoped to for that student. Prefer the Staff Subject Mapping;
    // fall back to teacher_student.subject only when it holds a real subject.
    const teacherSubjectsByStudent = {};
    links.forEach(l => {
      const info = l.users ?? {};
      const fromMapping = subjectsForGradeCurriculum(info.grade, info.curriculum);
      if (fromMapping.size > 0) {
        teacherSubjectsByStudent[l.student_id] = fromMapping;
      } else if (isRealSubject(l.subject) && !teacherSubjectsByStudent[l.student_id]) {
        teacherSubjectsByStudent[l.student_id] = new Set([l.subject]);
      }
    });

    // Deduplicate links by student_id — a student can have multiple subjects assigned
    // (e.g., "General" + "Mathematics") but should only appear once in the list
    const seenStudentIds = new Set();
    const uniqueLinks = links.filter(l => {
      if (seenStudentIds.has(l.student_id)) return false;
      seenStudentIds.add(l.student_id);
      return true;
    });

    const studentIds = uniqueLinks.map(l => l.student_id);
    if (studentIds.length === 0) return res.json([]);

    const { data: stats } = await supabase
      .from('student_stats')
      .select('*')
      .in('student_id', studentIds);

    const statsMap = {};
    (stats ?? []).forEach(s => { statsMap[s.student_id] = s; });

    // Fetch topic_attempts (all, not just passed) — supplements student_stats.completed_topics
    // and gives us topic → subject so completed topics can be scoped to the teacher's subjects.
    const { data: allAttempts } = await supabase
      .from('topic_attempts')
      .select('student_id, topic, subject, passed')
      .in('student_id', studentIds);
    const passedTopicsMap = {};
    const topicSubjectMap = {}; // student_id → { topic → subject }
    (allAttempts ?? []).forEach(a => {
      if (!topicSubjectMap[a.student_id]) topicSubjectMap[a.student_id] = {};
      if (a.subject) topicSubjectMap[a.student_id][a.topic] = a.subject;
      if (a.passed) {
        if (!passedTopicsMap[a.student_id]) passedTopicsMap[a.student_id] = new Set();
        passedTopicsMap[a.student_id].add(a.topic);
      }
    });

    // Per-subject Learning Path time (Maths: Xm, English: Ym, ...) tracked going
    // forward via student_subject_time — used both for the scoped-subject display
    // and to surface "other subjects" time separately, never blended in.
    // today_minutes/today_date give today's per-subject time (reset when the date
    // rolls over) for the leaderboard's "Today" column.
    const today = todayISO();
    const { data: subjectTimeRows } = await supabase
      .from('student_subject_time')
      .select('student_id, subject, minutes, today_minutes, today_date')
      .in('student_id', studentIds);
    const subjectTimeMap = {}; // student_id → { subject → minutes }
    const subjectTimeTodayMap = {}; // student_id → { subject → minutes today }
    (subjectTimeRows ?? []).forEach(r => {
      if (!subjectTimeMap[r.student_id]) subjectTimeMap[r.student_id] = {};
      subjectTimeMap[r.student_id][r.subject] = r.minutes;
      if (!subjectTimeTodayMap[r.student_id]) subjectTimeTodayMap[r.student_id] = {};
      subjectTimeTodayMap[r.student_id][r.subject] = r.today_date === today ? (r.today_minutes || 0) : 0;
    });

    // Pre-fetch totalTopics once per unique curriculum+grade(+subject) combo — avoids
    // N Qdrant queries. Includes one combo per teacher-scoped subject per student.
    const combos = new Set();
    uniqueLinks.forEach(l => {
      const curriculum = l.users?.curriculum ?? '';
      const grade = l.users?.grade ?? '';
      const subjects = teacherSubjectsByStudent[l.student_id];
      if (subjects && subjects.size > 0) {
        subjects.forEach(subj => combos.add(`${curriculum}|${grade}|${subj}`));
      } else {
        combos.add(`${curriculum}|${grade}|`);
      }
    });
    const topicsCache = {};
    await Promise.all([...combos].map(async key => {
      const [curriculum, grade, subject] = key.split('|');
      topicsCache[key] = await fetchTotalTopicsFromQdrant(curriculum, grade, subject || undefined);
    }));

    // ── Per-student Assignments + Challenges completion (for the composite score used
    // by "needs attention" — a student should only be flagged when they're behind
    // across ALL activity streams, not just one, e.g. skipping Learning Path while
    // being highly active on assignments/challenges shouldn't trigger a flag alone).
    const { data: subs } = await supabase
      .from('assignment_submissions')
      .select('student_id, assignment_id')
      .in('student_id', studentIds);
    const submittedMap = {};
    (subs ?? []).forEach(sub => { submittedMap[sub.student_id] = (submittedMap[sub.student_id] || 0) + 1; });

    const { data: teacherAssignments } = await supabase
      .from('assignments')
      .select('id, student_id, grade, curriculum')
      .eq('created_by_id', teacherId ?? rawId);
    const assignedCountMap = {};
    studentIds.forEach(id => { assignedCountMap[id] = 0; });
    (teacherAssignments ?? []).forEach(a => {
      if (a.student_id) {
        if (assignedCountMap[a.student_id] !== undefined) assignedCountMap[a.student_id] += 1;
      } else {
        uniqueLinks.forEach(l => {
          const info = l.users ?? {};
          const gradeMatch = !a.grade || info.grade === a.grade;
          const curriculumMatch = !a.curriculum || info.curriculum === a.curriculum;
          if (gradeMatch && curriculumMatch) assignedCountMap[l.student_id] += 1;
        });
      }
    });

    const { data: challengeAssigns } = await supabase
      .from('challenge_assignments')
      .select('student_id, status')
      .in('student_id', studentIds);
    const challengeMap = {};
    (challengeAssigns ?? []).forEach(c => {
      if (!challengeMap[c.student_id]) challengeMap[c.student_id] = { assigned: 0, completed: 0 };
      challengeMap[c.student_id].assigned += 1;
      if (c.status === 'completed') challengeMap[c.student_id].completed += 1;
    });

    const students = await Promise.all(uniqueLinks.map(async link => {
      const s = statsMap[link.student_id] ?? {};
      const user = link.users ?? {};

      // Merge completed_topics from student_stats + passed topics from topic_attempts
      const statsTopics = s.completed_topics ?? [];
      const attemptsPassed = passedTopicsMap[link.student_id] ?? new Set();
      const allMergedTopics = [...new Set([...statsTopics, ...attemptsPassed])];

      const curriculum = user.curriculum ?? '';
      const grade      = user.grade ?? '';
      const scopedSubjects = teacherSubjectsByStudent[link.student_id]
        ? [...teacherSubjectsByStudent[link.student_id]]
        : [];

      // When this teacher is scoped to real subjects, count ONLY topics known to
      // belong to those subjects — other subjects (PE, Art, Science, ...) are
      // handled by other staff and must never inflate this teacher's Maths/English
      // progress, even when a topic's subject isn't on record yet.
      const topicSubjects = topicSubjectMap[link.student_id] ?? {};
      const mergedTopics = scopedSubjects.length > 0
        ? allMergedTopics.filter(t => scopedSubjects.includes(topicSubjects[t]))
        : allMergedTopics;
      const topicsCount = mergedTopics.length;
      // Per-topic subject label — lets the teacher see exactly which subject each
      // completed topic belongs to (falls back to "—" when not yet on record).
      const completedTopicsDetailed = mergedTopics.map(t => ({ topic: t, subject: topicSubjects[t] || null }));

      const totalTopics = scopedSubjects.length > 0
        ? scopedSubjects.reduce((sum, subj) => sum + (topicsCache[`${curriculum}|${grade}|${subj}`] ?? 0), 0)
        : (topicsCache[`${curriculum}|${grade}|`] ?? 0);
      const progressPct = totalTopics > 0
        ? Math.min(100, Math.round((topicsCount / totalTopics) * 100))
        : 0;

      // Per-subject time: scoped subjects only when the teacher has real subjects,
      // otherwise every subject the student has logged time in.
      const subjectTimes = subjectTimeMap[link.student_id] ?? {};
      const scopedSubjectTime = scopedSubjects.length > 0
        ? Object.fromEntries(scopedSubjects.map(subj => [subj, subjectTimes[subj] || 0]))
        : subjectTimes;
      const otherSubjectTime = scopedSubjects.length > 0
        ? Object.fromEntries(Object.entries(subjectTimes).filter(([subj]) => !scopedSubjects.includes(subj)))
        : {};

      // Today's Learning Path time, scoped to the teacher's subject(s) the same
      // way as the cumulative total above. scopedSubjectTimeToday exposes the
      // per-subject breakdown (Mathematics: Xm, English: Ym) for today specifically.
      const subjectTimesToday = subjectTimeTodayMap[link.student_id] ?? {};
      const scopedSubjectTimeToday = scopedSubjects.length > 0
        ? Object.fromEntries(scopedSubjects.map(subj => [subj, subjectTimesToday[subj] || 0]))
        : subjectTimesToday;
      const learningPathTimeToday = scopedSubjects.length > 0
        ? scopedSubjects.reduce((sum, subj) => sum + (subjectTimesToday[subj] || 0), 0)
        : Object.values(subjectTimesToday).reduce((sum, m) => sum + m, 0);

      // Per-student Assignments % and Challenges % — same volumetric completion-rate
      // logic as the class-wide insights endpoint (completed ÷ assigned), so a student
      // who's actively submitting isn't penalized just for a 0-populated denominator.
      const assignedCount  = assignedCountMap[link.student_id] || 0;
      const submittedCount = submittedMap[link.student_id] || 0;
      const assignPct = assignedCount > 0 ? Math.round((submittedCount / assignedCount) * 100) : 0;

      const chall = challengeMap[link.student_id] || { assigned: 0, completed: 0 };
      const challPct = chall.assigned > 0 ? Math.round((chall.completed / chall.assigned) * 100) : 0;

      // Deterministic "needs attention" — flagged solely by Learning Path progress
      // < 20% (not inactivity, not streak, not Assignments/Challenges — those are
      // tracked separately in their own columns/UI).
      // When totalTopics is a known, non-zero denominator we use the real %; when
      // it's unknown (e.g. Qdrant lookup miss for that curriculum/grade), fall back
      // to "has completed zero topics" so the flag can't be silently defeated by a
      // missing topic count.
      //
      // GRACE for freshly-added students: a student who has NEVER engaged (no
      // last-active, no XP, no completed topics) and whose account is younger
      // than NEW_STUDENT_GRACE_DAYS is NOT flagged — otherwise every student a
      // teacher adds shows "Attention" the instant they're created, before they
      // ever had a chance to log in. After the grace window a still-untouched
      // account does surface (they genuinely need a nudge).
      const NEW_STUDENT_GRACE_DAYS = 7;
      const hasStarted = Boolean(s.last_active_date) || (s.xp_points ?? 0) > 0 || topicsCount > 0;
      const accountAgeDays = user.created_at
        ? (Date.now() - new Date(user.created_at).getTime()) / 86400000
        : 999;
      const inNewGrace = !hasStarted && accountAgeDays < NEW_STUDENT_GRACE_DAYS;
      const needsAttention = inNewGrace
        ? false
        : (totalTopics > 0 ? progressPct < 20 : topicsCount === 0);

      return {
        id:             link.student_id,
        name:           user.name,
        email:          user.email,
        grade:          user.grade,
        school:         user.school,
        curriculum:     user.curriculum ?? null,
        subject:        link.subject,
        scopedSubjects,
        totalTopics,
        createdAt:      user.created_at ?? null,
        hasStarted,
        xpPoints:       s.xp_points        ?? 0,
        level:          s.level            ?? 1,
        currentStreak:  s.current_streak   ?? 0,
        studyTime:      s.study_time_minutes ?? 0,
        // learningPathTime is subject-scoped once real subjects are tracked (via
        // student_subject_time); falls back to the pre-existing combined total
        // for teachers/students without subject-tagged history yet.
        learningPathTime: scopedSubjects.length > 0
          ? Object.values(scopedSubjectTime).reduce((a, b) => a + b, 0)
          : (s.learning_path_minutes ?? 0),
        // Today's Learning Path time, scoped the same way as learningPathTime —
        // falls back to 0 for students with no per-subject time logged today yet.
        learningPathTimeToday: learningPathTimeToday,
        subjectTimeToday: scopedSubjectTimeToday, // e.g. { Mathematics: 4, English: 0 } — today only
        subjectTime:      scopedSubjectTime, // e.g. { Mathematics: 12, English: 8 } — cumulative total
        otherSubjectTime: otherSubjectTime,  // subjects outside this teacher's scope, shown separately
        assignmentTime: s.assignment_time_minutes ?? 0,
        challengeTime:  s.challenge_time_minutes ?? 0,
        completedTopics: mergedTopics,
        completedTopicsDetailed, // [{ topic, subject }] — which subject each completed topic belongs to
        progressPct,
        assignmentsDone: s.assignments_done ?? 0,
        lastActive:     s.last_active_date,
        needsAttention,
        photoUrl:       user.photo_url ?? null,
      };
    }));

    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /student/by-teacher/:teacherId/heatmap ─────────────
// Class heatmap grid: for every student the teacher is linked to, a per-topic
// mastery status computed from topic_attempts (+ completed_topics fallback).
// Status classification lives in utils/topicStatus.js (mastered/trying/
// dropped/stuck/not_started) — kept dependency-free so it's unit-testable
// without a live DB connection; see server/tests/compute-topic-status.test.js.
//
// Query params: ?subject=Mathematics (scope columns to one subject, for a
// subject-teacher view) and ?grade=Grade 3.
const { computeTopicStatus } = require('../utils/topicStatus');

router.get('/by-teacher/:teacherId/heatmap', async (req, res) => {
  try {
    const rawId = req.params.teacherId;
    const teacherId = await resolveTeacherId(rawId);
    const subjectFilter = req.query.subject && isRealSubject(req.query.subject) ? req.query.subject : null;
    const gradeFilter   = req.query.grade || null;

    const { data: links, error } = await supabase
      .from('teacher_student')
      .select('student_id, subject, users!teacher_student_student_id_fkey(id, name, grade, curriculum, photo_url)')
      .eq('teacher_id', teacherId ?? rawId);
    if (error) return res.status(500).json({ error: error.message });

    // Which real subjects does this teacher teach? (Staff Subject Mapping first,
    // teacher_student.subject as fallback) — same source of truth as the main
    // by-teacher route so scoping stays consistent across screens.
    const { data: teacherUser } = await supabase.from('users').select('email').eq('id', teacherId ?? rawId).maybeSingle();
    let teacherTeaches = [];
    if (teacherUser?.email) {
      const { data: teacherPrefs } = await supabase
        .from('user_preferences').select('data').eq('user_email', teacherUser.email).maybeSingle();
      teacherTeaches = teacherPrefs?.data?.teaches || [];
    }
    function subjectsForGradeCurriculum(grade, curriculum) {
      const subjects = new Set();
      teacherTeaches.forEach(entry => {
        if (entry.grade === grade && entry.curriculum === curriculum) {
          (entry.subjects || []).forEach(s => subjects.add(s));
        }
      });
      return subjects;
    }
    const teacherSubjectsByStudent = {};
    links.forEach(l => {
      const info = l.users ?? {};
      const fromMapping = subjectsForGradeCurriculum(info.grade, info.curriculum);
      if (fromMapping.size > 0) teacherSubjectsByStudent[l.student_id] = fromMapping;
      else if (isRealSubject(l.subject) && !teacherSubjectsByStudent[l.student_id]) {
        teacherSubjectsByStudent[l.student_id] = new Set([l.subject]);
      }
    });

    // Deduplicate to one row per student, honoring the optional grade filter.
    const seen = new Set();
    const uniqueLinks = links.filter(l => {
      if (seen.has(l.student_id)) return false;
      if (gradeFilter && (l.users?.grade ?? '') !== gradeFilter) return false;
      seen.add(l.student_id);
      return true;
    });
    const studentIds = uniqueLinks.map(l => l.student_id);
    if (studentIds.length === 0) return res.json({ students: [], topics: [] });

    // Full attempt history (need score / attempt_number / created_at for the composite).
    const { data: allAttempts } = await supabase
      .from('topic_attempts')
      .select('student_id, topic, subject, grade, score, passed, attempt_number, created_at')
      .in('student_id', studentIds);

    // completed_topics from student_stats — topics finished via the Learning Path
    // that may never have generated a quiz attempt row.
    const { data: stats } = await supabase
      .from('student_stats').select('student_id, completed_topics').in('student_id', studentIds);
    const completedMap = {};
    (stats ?? []).forEach(s => { completedMap[s.student_id] = new Set(s.completed_topics ?? []); });

    // student_id → topic → { subject, attempts[] }
    const byStudentTopic = {};
    const topicSubject = {}; // topic → subject (for the column list)
    (allAttempts ?? []).forEach(a => {
      if (!byStudentTopic[a.student_id]) byStudentTopic[a.student_id] = {};
      if (!byStudentTopic[a.student_id][a.topic]) byStudentTopic[a.student_id][a.topic] = { subject: a.subject || null, attempts: [] };
      byStudentTopic[a.student_id][a.topic].attempts.push({
        score: a.score != null ? parseFloat(a.score) : null,
        passed: a.passed,
        attemptNumber: a.attempt_number,
        date: a.created_at,
      });
      if (a.subject && !topicSubject[a.topic]) topicSubject[a.topic] = a.subject;
    });

    // Union of topic columns across the whole class (so a topic only one student
    // has touched still appears as a column, gray for everyone else).
    const topicSet = new Set();

    const students = uniqueLinks.map(link => {
      const user = link.users ?? {};
      const scoped = teacherSubjectsByStudent[link.student_id]
        ? [...teacherSubjectsByStudent[link.student_id]] : [];
      const topicMap = byStudentTopic[link.student_id] ?? {};
      const completed = completedMap[link.student_id] ?? new Set();

      // Every topic this student has any signal for.
      const topicNames = new Set([...Object.keys(topicMap), ...completed]);
      const topicStatus = {};
      topicNames.forEach(topic => {
        const entry = topicMap[topic];
        const subj = entry?.subject || topicSubject[topic] || null;
        // Subject scoping: an explicit ?subject= wins; otherwise a subject-teacher
        // only sees their scoped subjects; a class teacher (no scope) sees all.
        if (subjectFilter && subj !== subjectFilter) return;
        if (!subjectFilter && scoped.length > 0 && subj && !scoped.includes(subj)) return;
        const attempts = (entry?.attempts ?? []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
        const st = computeTopicStatus(attempts, { completedViaPath: completed.has(topic) });
        topicStatus[topic] = { ...st, subject: subj };
        topicSet.add(topic);
      });

      return {
        id: link.student_id,
        name: user.name,
        grade: user.grade ?? null,
        curriculum: user.curriculum ?? null,
        photoUrl: user.photo_url ?? null,
        scopedSubjects: scoped,
        topicStatus,
      };
    });

    const topics = [...topicSet].map(t => ({ topic: t, subject: topicSubject[t] || null }));
    res.json({ students, topics });
  } catch (err) {
    console.error('GET /student/by-teacher/:teacherId/heatmap error:', err.message);
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

    // Get student names + grade/curriculum (grade/curriculum needed to resolve how many
    // students each class-wide "All students" assignment broadcast actually reaches)
    const { data: users } = await supabase
      .from('users')
      .select('id, name, grade, curriculum')
      .in('id', studentIds);
    const nameMap = {};
    const studentInfoMap = {};
    (users || []).forEach(u => {
      nameMap[u.id] = u.name;
      studentInfoMap[u.id] = { grade: u.grade || null, curriculum: u.curriculum || null };
    });

    // Fetch this teacher's own assignments (personal + class-wide broadcasts) to compute
    // a true "total assigned" count — mirrors the visibility logic in GET /assignments:
    // personal assignments reach exactly 1 student; broadcasts reach every linked student
    // whose grade+curriculum matches the assignment.
    const { data: teacherAssignments } = await supabase
      .from('assignments')
      .select('id, student_id, grade, curriculum, subject')
      .eq('created_by_id', teacherId ?? rawId);

    // Real subject mapping (same Staff Subject Mapping source used for Learning Path
    // scoping) — lets Assignments be scoped/broken-down by subject too (Mathematics
    // assigned/submitted vs English assigned/submitted), not just a combined count.
    const { data: teacherUserForAssign } = await supabase.from('users').select('email').eq('id', teacherId ?? rawId).maybeSingle();
    let teacherTeachesForAssign = [];
    if (teacherUserForAssign?.email) {
      const { data: prefs } = await supabase.from('user_preferences').select('data').eq('user_email', teacherUserForAssign.email).maybeSingle();
      teacherTeachesForAssign = prefs?.data?.teaches || [];
    }
    function assignSubjectsFor(grade, curriculum) {
      const set = new Set();
      teacherTeachesForAssign.forEach(entry => {
        if (entry.grade === grade && entry.curriculum === curriculum) (entry.subjects || []).forEach(s => set.add(s));
      });
      return set;
    }

    let totalAssignmentsAssigned = 0;
    const assignedCountMap = {};
    const assignedBySubjectMap = {}; // student_id → { subject → count }
    const assignmentIdSubjectMap = {}; // assignment_id → subject (for scoping submissions)
    studentIds.forEach(id => { assignedCountMap[id] = 0; assignedBySubjectMap[id] = {}; });
    (teacherAssignments || []).forEach(a => {
      if (a.subject) assignmentIdSubjectMap[a.id] = a.subject;
      const bump = (id) => {
        totalAssignmentsAssigned += 1;
        assignedCountMap[id] += 1;
        if (a.subject) assignedBySubjectMap[id][a.subject] = (assignedBySubjectMap[id][a.subject] || 0) + 1;
      };
      if (a.student_id) {
        if (studentIds.includes(a.student_id)) bump(a.student_id);
      } else {
        studentIds.forEach(id => {
          const info = studentInfoMap[id];
          if (!info) return;
          const gradeMatch = !a.grade || info.grade === a.grade;
          const curriculumMatch = !a.curriculum || info.curriculum === a.curriculum;
          if (gradeMatch && curriculumMatch) bump(id);
        });
      }
    });

    // Aggregate assignment stats per student
    const assignMap = {};
    const submittedBySubjectMap = {}; // student_id → { subject → count }
    studentIds.forEach(id => { submittedBySubjectMap[id] = {}; });
    (subs || []).forEach(s => {
      if (!assignMap[s.student_id]) assignMap[s.student_id] = { submitted: 0, totalScore: 0, scored: 0 };
      assignMap[s.student_id].submitted++;
      if (typeof s.score === 'number') {
        assignMap[s.student_id].totalScore += s.score;
        assignMap[s.student_id].scored++;
      }
      const subj = assignmentIdSubjectMap[s.assignment_id];
      if (subj && submittedBySubjectMap[s.student_id]) {
        submittedBySubjectMap[s.student_id][subj] = (submittedBySubjectMap[s.student_id][subj] || 0) + 1;
      }
    });

    const assignmentStats = studentIds.map(id => {
      const info = studentInfoMap[id] || {};
      const scopedSubjects = [...assignSubjectsFor(info.grade, info.curriculum)];
      return {
        id,
        name: nameMap[id] || 'Unknown',
        assigned: assignedCountMap[id] || 0,
        submitted: assignMap[id]?.submitted || 0,
        avgScore: assignMap[id]?.scored > 0 ? Math.round(assignMap[id].totalScore / assignMap[id].scored) : null,
        scopedSubjects,
        // e.g. { Mathematics: { assigned: 3, submitted: 1 }, English: { assigned: 2, submitted: 2 } }
        bySubject: Object.fromEntries(scopedSubjects.map(subj => [subj, {
          assigned: assignedBySubjectMap[id]?.[subj] || 0,
          submitted: submittedBySubjectMap[id]?.[subj] || 0,
        }])),
      };
    });

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
        totalAssignmentsAssigned,
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

// ── POST /student/track-attempt ───────────────────────────
// Save a quiz attempt to topic_attempts table (Issue #121)
router.post('/track-attempt', async (req, res) => {
  try {
    const {
      studentId,
      topic,
      subject,
      grade,
      curriculum = '',
      totalQuestions,
      correctAnswers,
      score,                  // 0-100
      timeSpentSeconds = 0,
      perQuestionResults = [],// [{ question, studentAnswer, correctAnswer, isCorrect, timeSeconds }]
      attemptNumber = 1,
    } = req.body;

    if (!studentId || !topic || !subject || !grade || score == null) {
      return res.status(400).json({ error: 'studentId, topic, subject, grade, score are required' });
    }

    const passed = score >= 60;

    const { data, error } = await supabase
      .from('topic_attempts')
      .insert({
        student_id:           studentId,
        topic,
        subject,
        grade,
        curriculum,
        attempt_number:       attemptNumber,
        total_questions:      totalQuestions || perQuestionResults.length || 0,
        correct_answers:      correctAnswers ?? perQuestionResults.filter(q => q.isCorrect).length,
        score:                parseFloat(score),
        passed,
        time_spent_seconds:   timeSpentSeconds,
        per_question_results: perQuestionResults,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ ok: true, passed, attempt: data });
  } catch (err) {
    console.error('POST /student/track-attempt error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /student/:id/mistake-trends ──────────────────────
// Returns practice insights: per-topic attempts, score trends, struggling topics, time spent
router.get('/:id/mistake-trends', async (req, res) => {
  try {
    const { id } = req.params;
    const { subject, grade, limit: rowLimit } = req.query;

    let query = supabase
      .from('topic_attempts')
      .select('*')
      .eq('student_id', id)
      .order('created_at', { ascending: false });

    if (subject) query = query.eq('subject', subject);
    if (grade)   query = query.eq('grade', grade);
    if (rowLimit) query = query.limit(parseInt(rowLimit) || 200);

    const { data: attempts, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Group by topic
    const byTopic = {};
    for (const a of (attempts || [])) {
      if (!byTopic[a.topic]) {
        byTopic[a.topic] = {
          topic:          a.topic,
          subject:        a.subject,
          grade:          a.grade,
          attempts:       [],
          totalAttempts:  0,
          bestScore:      0,
          latestScore:    0,
          passed:         false,
          totalTimeSeconds: 0,
        };
      }
      const t = byTopic[a.topic];
      t.attempts.push({
        attemptNumber:    a.attempt_number,
        score:            parseFloat(a.score),
        passed:           a.passed,
        correctAnswers:   a.correct_answers,
        totalQuestions:    a.total_questions,
        timeSpentSeconds: a.time_spent_seconds,
        date:             a.created_at,
        perQuestionResults: a.per_question_results || [],
      });
      t.totalAttempts++;
      t.bestScore       = Math.max(t.bestScore, parseFloat(a.score));
      t.totalTimeSeconds += a.time_spent_seconds || 0;
      if (a.passed) t.passed = true;
    }

    // Set latest score and sort attempts chronologically within each topic
    const topics = Object.values(byTopic).map(t => {
      t.attempts.sort((a, b) => new Date(a.date) - new Date(b.date));
      t.latestScore = t.attempts[t.attempts.length - 1]?.score || 0;
      t.improving   = t.attempts.length >= 2 &&
        t.attempts[t.attempts.length - 1].score > t.attempts[t.attempts.length - 2].score;
      t.struggling  = t.totalAttempts >= 2 && !t.passed;
      return t;
    });

    // Find most-missed questions across all attempts
    const wrongQuestions = [];
    for (const a of (attempts || [])) {
      for (const q of (a.per_question_results || [])) {
        if (!q.isCorrect) {
          wrongQuestions.push({
            topic:         a.topic,
            question:      q.question,
            studentAnswer: q.studentAnswer,
            correctAnswer: q.correctAnswer,
            date:          a.created_at,
          });
        }
      }
    }

    // Summary stats
    const totalPracticeTime = topics.reduce((s, t) => s + t.totalTimeSeconds, 0);
    const struggling = topics.filter(t => t.struggling);
    const mastered   = topics.filter(t => t.passed);

    res.json({
      topics,
      summary: {
        totalTopicsPracticed: topics.length,
        mastered:             mastered.length,
        struggling:           struggling.length,
        totalPracticeTimeSeconds: totalPracticeTime,
        totalAttempts:        (attempts || []).length,
      },
      strugglingTopics: struggling.map(t => ({ topic: t.topic, subject: t.subject, attempts: t.totalAttempts, bestScore: t.bestScore })),
      recentMistakes:   wrongQuestions.slice(0, 20),
    });
  } catch (err) {
    console.error('GET /student/:id/mistake-trends error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.fetchTotalTopicsFromQdrant = fetchTotalTopicsFromQdrant;
module.exports.computeTopicStatus = computeTopicStatus;
