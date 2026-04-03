const express  = require('express');
const router   = express.Router();
const fs       = require('fs');
const path     = require('path');
const supabase = require('../services/supabase');

const CHALLENGES_PATH  = path.join(__dirname, '../data/challenges.json');
const CLOUDINARY_URLS  = path.join(__dirname, '../data/cloudinary_urls.json');

function readChallenges() { try { return JSON.parse(fs.readFileSync(CHALLENGES_PATH, 'utf8')); } catch { return []; } }
function readCloudinaryUrls() { try { return JSON.parse(fs.readFileSync(CLOUDINARY_URLS, 'utf8')); } catch { return {}; } }

function attachImageUrl(challenge) {
  const urlMap = readCloudinaryUrls();
  const key = `challenges/${challenge.id}.png`;
  return { ...challenge, imageUrl: urlMap[key] || null };
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
  let challenges = readChallenges();
  if (grade)      challenges = challenges.filter(c => c.grade === grade);
  if (curriculum) challenges = challenges.filter(c => c.curriculum === curriculum);

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

  const challenges = readChallenges();
  const result = (assignments ?? []).map(a => {
    const ch = challenges.find(c => c.id === a.challenge_id);
    if (!ch) return null;
    return { ...ch, assignmentId: a.id, status: a.status, score: a.score, xpAwarded: a.xp_awarded, dueDate: a.due_date, assignedByRole: a.assigned_by_role };
  }).filter(Boolean);

  res.json(result);
});

// ── POST /challenges/assign ──────────────────────────────────────

router.post('/assign', async (req, res) => {
  const { challengeId, studentId, assignedById, assignedByRole = 'teacher', dueDate } = req.body;
  if (!challengeId || !studentId) return res.status(400).json({ error: 'challengeId and studentId required' });

  const challenges = readChallenges();
  if (!challenges.find(c => c.id === challengeId)) return res.status(404).json({ error: 'Challenge not found' });

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
  res.json({ ...data, assignmentId: data.id });
});

// ── POST /challenges/unassign ────────────────────────────────────

router.post('/unassign', async (req, res) => {
  const { challengeId, studentId } = req.body;
  if (!challengeId || !studentId) return res.status(400).json({ error: 'challengeId and studentId required' });

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

  const challenge  = readChallenges().find(c => c.id === assignment.challenge_id);
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

    const ranked = studentIds
      .map(id => ({
        id,
        name:     userMap[id]?.name  || 'Student',
        grade:    userMap[id]?.grade || 'Grade 3',
        xp:       xpMap[id],
        avgScore: countMap[id] > 0 ? Math.round(scoreMap[id] / countMap[id]) : 0,
        count:    countMap[id],
      }))
      .sort((a, b) => b.xp - a.xp)
      .slice(0, limit)
      .map((s, i) => ({ ...s, rank: i + 1 }));

    res.json(ranked);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
