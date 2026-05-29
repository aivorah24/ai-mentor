const express  = require('express');
const router   = express.Router();
const fs       = require('fs');
const path     = require('path');
const supabase = require('../services/supabase');

const CLOUDINARY_URLS  = path.join(__dirname, '../data/cloudinary_urls.json');

function readCloudinaryUrls() { try { return JSON.parse(fs.readFileSync(CLOUDINARY_URLS, 'utf8')); } catch { return {}; } }

// Map snake_case DB row → camelCase challenge object
function rowToChallenge(row) {
  return {
    id:               row.id,
    title:            row.title,
    description:      row.description,
    subject:          row.subject,
    topic:            row.topic || '',
    grade:            row.grade,
    curriculum:       row.curriculum,
    category:         row.category,
    difficulty:       row.difficulty,
    xpReward:         row.xp_reward,
    questionCount:    row.question_count,
    timeLimitMinutes: row.time_limit_minutes,
    type:             row.type || '',
    tags:             row.tags,
    isPublished:      row.is_published,
    created_at:       row.created_at,
    thumbnailUrl:     row.thumbnail_url || null,
  };
}

// Fetch all challenges with optional grade/curriculum filters
async function getChallenges(grade, curriculum) {
  let query = supabase.from('challenges').select('*').eq('is_published', true);
  if (grade)      query = query.eq('grade', grade);
  if (curriculum) query = query.eq('curriculum', curriculum);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(rowToChallenge);
}

// Fetch a single challenge by id
async function getChallengeById(id) {
  const { data, error } = await supabase.from('challenges').select('*').eq('id', id).single();
  if (error || !data) return null;
  return rowToChallenge(data);
}

function attachImageUrl(challenge) {
  const urlMap = readCloudinaryUrls();
  // Try exact key first
  const key = `challenges/${challenge.id}.png`;
  if (urlMap[key]) return { ...challenge, imageUrl: urlMap[key] };

  // Check if local file exists
  const localPath = path.join(__dirname, `../data/images/challenges/${challenge.id}.png`);
  if (fs.existsSync(localPath)) {
    return { ...challenge, imageUrl: `/data/images/challenges/${challenge.id}.png` };
  }

  return { ...challenge, imageUrl: null };
}
function uuidv4() { return 'ca_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function computeLevel(xp) {
  let level = 1, threshold = 500, total = 0;
  while (xp >= total + threshold) { total += threshold; threshold += 250; level++; }
  return level;
}

// ── GET /challenges?grade=Grade3&curriculum=NCERT&studentId=xxx ──

router.get('/', async (req, res) => {
  const { grade, curriculum = 'NCERT', studentId } = req.query;
  let challenges;
  try { challenges = await getChallenges(grade, curriculum); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  if (!studentId) return res.json(challenges.map(attachImageUrl));

  const { data: assignments } = await supabase
    .from('challenge_assignments')
    .select('*')
    .eq('student_id', studentId);

  const asgMap = {};
  (assignments ?? []).forEach(a => { asgMap[a.challenge_id] = a; });

  const result = challenges.map(c => {
    const a = asgMap[c.id];
    return {
      ...attachImageUrl(c),
      assignmentId:   a?.id             ?? null,
      status:         a?.status         ?? 'available',
      score:          a?.score          ?? null,
      xpAwarded:      a?.xp_awarded     ?? null,
      dueDate:        a?.due_date       ?? null,
      assignedByRole: a?.assigned_by_role ?? null,
    };
  });
  res.json(result);
});

// ── GET /challenges/assigned?studentId=xxx ───────────────────────

router.get('/assigned', async (req, res) => {
  const { studentId } = req.query;
  if (!studentId) return res.status(400).json({ error: 'studentId required' });

  const { data: assignments } = await supabase
    .from('challenge_assignments')
    .select('*')
    .eq('student_id', studentId);

  let challenges;
  try { challenges = await getChallenges(); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  const result = (assignments ?? []).map(a => {
    const ch = challenges.find(c => c.id === a.challenge_id);
    if (!ch) return null;
    return { ...attachImageUrl(ch), assignmentId: a.id, status: a.status, score: a.score, xpAwarded: a.xp_awarded, dueDate: a.due_date, assignedByRole: a.assigned_by_role };
  }).filter(Boolean);

  res.json(result);
});

// ── GET /challenges/new-count?studentId=xxx&since=ISO_DATE ──────
router.get('/new-count', async (req, res) => {
  const { studentId, since } = req.query;
  if (!studentId) return res.status(400).json({ error: 'studentId required' });

  // Resolve email → UUID if needed
  let resolvedId = studentId;
  if (studentId.includes('@')) {
    const { data: userRow } = await supabase.from('users').select('id').eq('email', studentId.toLowerCase().trim()).maybeSingle();
    if (!userRow?.id) return res.json({ count: 0 });
    resolvedId = userRow.id;
  }

  let query = supabase
    .from('challenge_assignments')
    .select('id')
    .eq('student_id', resolvedId)
    .neq('status', 'completed');

  if (since) query = query.gt('created_at', since);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ count: (data || []).length });
});

// ── POST /challenges/assign ──────────────────────────────────────

router.post('/assign', async (req, res) => {
  const { challengeId, studentId, assignedById, assignedByRole = 'teacher', dueDate } = req.body;
  if (!challengeId || !studentId) return res.status(400).json({ error: 'challengeId and studentId required' });

  const challengeCheck = await getChallengeById(challengeId);
  if (!challengeCheck) return res.status(404).json({ error: 'Challenge not found' });

  // Return existing if already assigned
  const { data: existing } = await supabase
    .from('challenge_assignments')
    .select('*')
    .eq('challenge_id', challengeId)
    .eq('student_id', studentId)
    .single();
  if (existing) return res.json({ ...existing, assignmentId: existing.id });

  const { data, error } = await supabase
    .from('challenge_assignments')
    .insert({
      id:               uuidv4(),
      challenge_id:     challengeId,
      student_id:       studentId,
      assigned_by_id:   assignedById || '',
      assigned_by_role: assignedByRole,
      due_date:         dueDate || null,
      status:           'assigned',
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Auto-add to schedule if dueDate provided
  const challenge = challengeCheck;
  if (dueDate && challenge) {
    try {
      await supabase.from('schedule_events').insert({
        title:         `${challenge.title} — Due`,
        event_date:    dueDate,
        start_time:    '23:59',
        end_time:      '23:59',
        type:          'challenge',
        note:          `${challenge.category} · ${challenge.subject}${challenge.grade ? ' · ' + challenge.grade : ''}`,
        student_id:    studentId,
        created_by:    assignedByRole,
        tag:           challenge.subject || null,
        assignment_id: data.id,
      });
    } catch (_) {}
  }

  res.json({ ...data, assignmentId: data.id });
});

// ── POST /challenges/unassign ────────────────────────────────────

router.post('/unassign', async (req, res) => {
  const { challengeId, studentId } = req.body;
  if (!challengeId || !studentId) return res.status(400).json({ error: 'challengeId and studentId required' });

  // Remove schedule event linked to this challenge assignment
  const { data: existing } = await supabase
    .from('challenge_assignments')
    .select('id')
    .eq('challenge_id', challengeId)
    .eq('student_id', studentId)
    .single();
  if (existing) {
    await supabase.from('schedule_events').delete().eq('assignment_id', existing.id);
  }

  await supabase
    .from('challenge_assignments')
    .delete()
    .eq('challenge_id', challengeId)
    .eq('student_id', studentId);

  res.json({ ok: true });
});

// ── POST /challenges/:assignmentId/complete ──────────────────────

router.post('/:assignmentId/complete', async (req, res) => {
  const { assignmentId } = req.params;
  const { studentId, score = 0 } = req.body;
  if (!studentId) return res.status(400).json({ error: 'studentId required' });

  const { data: assignment } = await supabase
    .from('challenge_assignments')
    .select('*')
    .eq('id', assignmentId)
    .single();

  if (!assignment)                          return res.status(404).json({ error: 'Assignment not found' });
  if (assignment.student_id !== studentId)  return res.status(403).json({ error: 'Forbidden' });
  if (assignment.status === 'completed')    return res.json({ ...assignment, xpAwarded: assignment.xp_awarded });

  const challenge  = await getChallengeById(assignment.challenge_id);
  const xpAwarded  = Math.round((challenge?.xpReward ?? 100) * (score / 100));

  const { data: updated } = await supabase
    .from('challenge_assignments')
    .update({ status: 'completed', score: Math.round(score), xp_awarded: xpAwarded, completed_at: new Date().toISOString() })
    .eq('id', assignmentId)
    .select()
    .single();

  // Update student_stats XP in Supabase
  try {
    const { data: stats } = await supabase.from('student_stats').select('*').eq('student_id', studentId).single();
    if (stats) {
      const newXP = (stats.xp_points || 0) + xpAwarded;
      await supabase.from('student_stats').update({
        xp_points:            newXP,
        today_xp:             (stats.today_xp || 0) + xpAwarded,
        challenges_completed: (stats.challenges_completed || 0) + 1,
        level:                computeLevel(newXP),
        last_active_date:     new Date().toISOString().split('T')[0],
        updated_at:           new Date().toISOString(),
      }).eq('student_id', studentId);
    }
  } catch (e) { console.error('XP award error:', e.message); }

  res.json({ ...(updated ?? assignment), xpAwarded });
});

// ── GET /challenges/leaderboard?grade=xxx&limit=10 ──────────────

router.get('/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const { grade } = req.query;

    const { data: assignments } = await supabase
      .from('challenge_assignments')
      .select('student_id, xp_awarded, score')
      .eq('status', 'completed');

    if (!assignments || assignments.length === 0) return res.json([]);

    const xpMap = {}, scoreMap = {}, countMap = {};
    assignments.forEach(a => {
      xpMap[a.student_id]    = (xpMap[a.student_id]    || 0) + (a.xp_awarded || 0);
      scoreMap[a.student_id] = (scoreMap[a.student_id] || 0) + (a.score      || 0);
      countMap[a.student_id] = (countMap[a.student_id] || 0) + 1;
    });

    const studentIds = Object.keys(xpMap);
    let query = supabase.from('users').select('id, name, grade').in('id', studentIds);
    if (grade) query = query.eq('grade', grade);
    const { data: users } = await query;
    const userMap = {};
    (users ?? []).forEach(u => { userMap[u.id] = u; });

    const allRanked = studentIds
      .map(id => ({
        id,
        name:     userMap[id]?.name  || 'Student',
        grade:    userMap[id]?.grade || 'Grade 3',
        xp:       xpMap[id],
        avgScore: countMap[id] > 0 ? Math.round(scoreMap[id] / countMap[id]) : 0,
        count:    countMap[id],
      }))
      .sort((a, b) => b.xp - a.xp);

    const totalStudents = allRanked.length;
    const ranked = allRanked
      .slice(0, limit)
      .map((s, i) => ({ ...s, rank: i + 1, totalStudents }));

    res.json({ leaderboard: ranked, totalStudents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
