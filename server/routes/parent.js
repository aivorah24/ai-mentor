const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');

// ── GET /parent/:parentEmail/children ────────────────────
// Returns all children linked to this parent with their live stats

router.get('/:parentEmail/children', async (req, res) => {
  try {
    const { parentEmail } = req.params;

    // Get linked child IDs + user info
    const { data: links, error } = await supabase
      .from('parent_children')
      .select('child_id, added_at, users!parent_children_child_id_fkey(id, name, email, grade, school)')
      .eq('parent_email', parentEmail);

    if (error) return res.status(500).json({ error: error.message });
    if (!links || links.length === 0) return res.json([]);

    const childIds = links.map(l => l.child_id);

    // Fetch stats for all children
    const { data: stats } = await supabase
      .from('student_stats')
      .select('*')
      .in('student_id', childIds);

    const statsMap = {};
    (stats ?? []).forEach(s => { statsMap[s.student_id] = s; });

    const children = links.map(link => {
      const user = link.users ?? {};
      const s    = statsMap[link.child_id] ?? {};
      const completedCount = (s.completed_topics ?? []).length;
      return {
        id:               link.child_id,
        name:             user.name    || 'Student',
        email:            user.email   || '',
        grade:            user.grade   || 'Grade 3',
        school:           user.school  || '',
        xpPoints:         s.xp_points         ?? 0,
        level:            s.level             ?? 1,
        currentStreak:    s.current_streak    ?? 0,
        studyTimeMinutes: s.study_time_minutes ?? 0,
        completedTopics:  s.completed_topics  ?? [],
        assignmentsDone:  s.assignments_done  ?? 0,
        lastLesson:       s.last_lesson       || '',
        lastActive:       s.last_active_date  || null,
        addedAt:          link.added_at,
      };
    });

    res.json(children);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /parent/:parentEmail/children ───────────────────
// Link a student to a parent by child's email

router.post('/:parentEmail/children', async (req, res) => {
  try {
    const { parentEmail } = req.params;
    const { childEmail }  = req.body;

    if (!childEmail) return res.status(400).json({ error: 'childEmail required' });

    // Look up child in users table
    const { data: child, error: lookupErr } = await supabase
      .from('users')
      .select('id, name, email, grade, school')
      .eq('email', childEmail.toLowerCase().trim())
      .single();

    if (lookupErr || !child) {
      return res.status(404).json({ error: 'No student found with that email. Ask your child to register first.' });
    }

    // Link them
    const { error: linkErr } = await supabase
      .from('parent_children')
      .insert({ parent_email: parentEmail, child_id: child.id });

    if (linkErr) {
      if (linkErr.code === '23505') return res.status(409).json({ error: 'This child is already linked to your account.' });
      return res.status(500).json({ error: linkErr.message });
    }

    res.json({ success: true, child: { id: child.id, name: child.name, email: child.email, grade: child.grade, school: child.school } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /parent/:parentEmail/children/:childId ────────
// Unlink a child from a parent

router.delete('/:parentEmail/children/:childId', async (req, res) => {
  try {
    const { parentEmail, childId } = req.params;

    const { error } = await supabase
      .from('parent_children')
      .delete()
      .eq('parent_email', parentEmail)
      .eq('child_id', childId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /parent/search-student?q= ───────────────────────
// Search students by name or email (for linking)

router.get('/search-student', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);

    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, grade, school')
      .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(10);

    if (error) return res.status(500).json({ error: error.message });
    res.json(data ?? []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
