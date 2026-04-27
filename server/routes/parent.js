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
      .select('child_id, added_at, users!parent_children_child_id_fkey(id, name, email, grade, school, curriculum)')
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
        grade:            user.grade      || 'Grade 3',
        curriculum:       user.curriculum || 'IB PYP',
        school:           user.school     || '',
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

// ── POST /parent/:parentEmail/children/create-student ────
// Create a new student account on behalf of a parent (for under-14)
// Body: { name, email, password, grade, curriculum, school? }

router.post('/:parentEmail/children/create-student', async (req, res) => {
  try {
    const { parentEmail } = req.params;
    const { name, email, password, grade, curriculum, school = '' } = req.body;

    if (!name || !email || !password || !grade || !curriculum) {
      return res.status(400).json({ error: 'name, email, password, grade and curriculum are required' });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Check if email already registered
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', cleanEmail)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists. Use "Link Existing" instead.' });
    }

    // Create Supabase auth user (service key = admin, no email verification)
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,   // bypass email verification — parent is creating on child's behalf
    });

    if (authErr || !authData?.user) {
      return res.status(500).json({ error: authErr?.message || 'Could not create auth account' });
    }

    const userId = authData.user.id;

    // Insert into users table
    const { error: insertErr } = await supabase.from('users').insert({
      id:         userId,
      name:       name.trim(),
      email:      cleanEmail,
      role:       'student',
      grade,
      curriculum,
      school:     school.trim(),
      created_at: new Date().toISOString(),
    });

    if (insertErr) {
      // Rollback auth user
      await supabase.auth.admin.deleteUser(userId);
      return res.status(500).json({ error: insertErr.message });
    }

    // Link to parent
    const { error: linkErr } = await supabase
      .from('parent_children')
      .insert({ parent_email: parentEmail, child_id: userId });

    if (linkErr && linkErr.code !== '23505') {
      return res.status(500).json({ error: linkErr.message });
    }

    res.json({
      success: true,
      child: { id: userId, name: name.trim(), email: cleanEmail, grade, curriculum, school },
    });
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
