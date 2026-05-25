const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { randomUUID, randomInt, randomBytes } = require('crypto');
const { sendCredentialsEmail, sendVerificationEmail, sendPasswordResetEmail } = require('../services/mailer');

function toTitleCase(str) {
  return String(str || '').replace(/\b\w/g, c => c.toUpperCase());
}

function generateSecureChildPassword() {
  const groups = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
    '#@$%&*?',
  ];
  const all = groups.join('');
  const chars = groups.map((group) => group[randomInt(group.length)]);
  while (chars.length < 12) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function generateChildLoginId(name) {
  const slug = String(name || 'student')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '') || 'student';
  return `${slug}.${Date.now()}${randomInt(1000, 9999)}@aivorah.student`;
}

// ── POST /parent/children/init-auth ────────────────────────
// Prepare child credentials for onboarding Step 4
// This route handles both /parent/children/init-auth and legacy /parent/:email/children/init-auth
router.post(['/children/init-auth', '/:parentEmail/children/init-auth'], async (req, res) => {
  try {
    const { name, email, studentId, password: customPassword } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    const emailProvided = Boolean(email && String(email).trim());
    const cleanEmail = emailProvided
      ? String(email).toLowerCase().trim()
      : generateChildLoginId(name);

    const resolvedStudentId = String(studentId || '').trim() || `STU-${Date.now()}-${randomInt(1000, 9999)}`;

    // Check if email already registered
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const trimmedCustom = customPassword && String(customPassword).trim();
    const generatedPassword = (trimmedCustom && trimmedCustom.length >= 6)
      ? trimmedCustom
      : generateSecureChildPassword();

    res.json({
      success: true,
      childEmail: cleanEmail,
      message: "Login credentials generated",
      // Frontend compatibility fields
      email: cleanEmail,
      password: generatedPassword,
      studentId: resolvedStudentId,
      emailProvided,
      // Parent-created accounts are always immediately active.
      // A verification email is still sent to real Gmail addresses for
      // "Forgot Password" capability — but it is NOT a login barrier.
      verificationRequired: false,
    });
  } catch (err) {
    console.error('[ParentRouter] init-auth error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function setStudentMeta(email, studentId, parentEmail, firebaseUid, status = 'active', age, initialPassword) {
  const emailKey = String(email || '').toLowerCase().trim();
  if (!emailKey) return;

  const { data: existing } = await supabase
    .from('user_preferences')
    .select('data')
    .eq('user_email', emailKey)
    .maybeSingle();

  const merged = {
    ...(existing?.data || {}),
    studentId,
    createdByParent: String(parentEmail || '').toLowerCase().trim(),
    firebaseUid: String(firebaseUid || '').trim() || undefined,
    accountStatus: status,
    emailVerificationRequired: status === 'pending_verification',
    activatedAt: status === 'active' ? (existing?.data?.activatedAt || new Date().toISOString()) : existing?.data?.activatedAt,
    updatedAt: new Date().toISOString(),
    ...(age !== undefined ? { age: Number(age) } : {}),
    // Only store initial password for auto-generated accounts (not real emails)
    ...(initialPassword ? { initialPassword, passwordSavedAt: new Date().toISOString(), mustChangePassword: true } : {}),
  };

  await supabase.from('user_preferences').upsert(
    { user_email: emailKey, data: merged, updated_at: new Date().toISOString() },
    { onConflict: 'user_email' }
  );
}

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
        topicsExplored:   s.topics_explored   ?? 0,
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

// Links a Firebase-created student account into app DB + parent linkage
// Body: { firebaseUid, studentId, name, email, grade, curriculum, school? }
router.post('/:parentEmail/children/link-created', async (req, res) => {
  try {
    const { parentEmail } = req.params;
    const { firebaseUid, studentId, name, email, grade, curriculum, school = '', verificationRequired = false, age, initialPassword } = req.body || {};

    if (!firebaseUid || !name || !email || !grade || !curriculum) {
      return res.status(400).json({ error: 'firebaseUid, name, email, grade, curriculum are required' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanName = toTitleCase(String(name).trim());
    const cleanParentEmail = String(parentEmail).toLowerCase().trim();
    const resolvedStudentId = String(studentId || '').trim() || `STU-${Date.now()}`;
    const resolvedUserId = randomUUID();
    const accountStatus = verificationRequired ? 'pending_verification' : 'active';

    // ── Duplicate child check ─────────────────────────────────────────────────
    // Prevent creating the same child (same name + grade) more than once under this parent
    const { data: existingChildren } = await supabase
      .from('parent_children')
      .select('child_id, users!parent_children_child_id_fkey(name, grade)')
      .eq('parent_email', cleanParentEmail);
    if (existingChildren?.length) {
      const duplicate = existingChildren.find(row => {
        const child = row.users;
        return child &&
          String(child.name || '').toLowerCase().trim() === cleanName.toLowerCase() &&
          String(child.grade || '').toLowerCase().trim() === String(grade || '').toLowerCase().trim();
      });
      if (duplicate) {
        return res.status(409).json({
          error: `A child named "${cleanName}" in ${grade} is already linked to your account. If this is a different child, use a slightly different name to distinguish them.`,
          code: 'DUPLICATE_CHILD',
        });
      }
    }

    const { data: existingByEmail } = await supabase
      .from('users')
      .select('id')
      .eq('email', cleanEmail)
      .maybeSingle();

    const userId = existingByEmail?.id || resolvedUserId;

    const { error: userUpsertErr } = await supabase
      .from('users')
      .upsert({
        id: userId,
        name: cleanName,
        email: cleanEmail,
        role: 'student',
        grade,
        curriculum,
        school: String(school || '').trim(),
        onboarding_complete: !verificationRequired,
      }, { onConflict: 'id' });
    if (userUpsertErr) return res.status(500).json({ error: userUpsertErr.message });

    const { error: linkErr } = await supabase
      .from('parent_children')
      .insert({ parent_email: cleanParentEmail, child_id: userId });
    if (linkErr && linkErr.code !== '23505') return res.status(500).json({ error: linkErr.message });

    await supabase.from('student_stats')
      .upsert({ student_id: userId }, { onConflict: 'student_id', ignoreDuplicates: true });

    const passwordToStore = initialPassword || undefined;
    await setStudentMeta(cleanEmail, resolvedStudentId, cleanParentEmail, firebaseUid, accountStatus, age, passwordToStore);

    // Email credentials to parent
    await sendCredentialsEmail({
      to: cleanParentEmail,
      childName: cleanName,
      loginId: cleanEmail,
      password: initialPassword || undefined,
      studentId: resolvedStudentId,
    });

    // Send verification email to child's real Gmail (fire-and-forget)
    if (verificationRequired) {
      const token = randomBytes(32).toString('hex');
      const expiry = Date.now() + 24 * 60 * 60 * 1000;
      const { data: existingPref } = await supabase
        .from('user_preferences').select('data').eq('user_email', cleanEmail).maybeSingle();
      const currentData = existingPref?.data || {};
      await supabase.from('user_preferences').upsert({
        user_email: cleanEmail,
        data: { ...currentData, verifyToken: token, verifyTokenExpiry: expiry, accountStatus: 'pending_verification' },
      }, { onConflict: 'user_email' });
      const serverBase = `${req.protocol}://${req.get('host')}`;
      const appBase = req.headers.origin || 'http://localhost:8081';
      const redirect = encodeURIComponent(appBase + '/verify-success');
      const verifyUrl = `${serverBase}/user/verify/${token}?email=${encodeURIComponent(cleanEmail)}&redirect=${redirect}`;
      sendVerificationEmail({ to: cleanEmail, name: cleanName, verifyUrl }).catch(() => {});
    }

    res.json({
      success: true,
      child: {
        id: userId,
        studentId: resolvedStudentId,
        name: cleanName,
        email: cleanEmail,
        grade,
        curriculum,
        school: String(school || '').trim(),
        firebaseUid,
        onboardingComplete: !verificationRequired,
        verificationRequired: Boolean(verificationRequired),
        accountStatus,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /parent/:parentEmail/children/create-student ────
// Create a new student account on behalf of a parent (for under-14)
// Body: { name, email?, password?, grade, curriculum, school?, studentId? }
router.post('/:parentEmail/children/create-student', async (req, res) => {
  try {
    const { parentEmail } = req.params;
    const { name, email, password, grade, curriculum, school = '', studentId } = req.body;

    if (!name || !grade || !curriculum) {
      return res.status(400).json({ error: 'name, grade and curriculum are required' });
    }

    // Email is optional — auto-generate a placeholder if not provided
    const emailProvided = Boolean(email && email.trim());
    const cleanEmail = emailProvided
      ? email.trim().toLowerCase()
      : generateChildLoginId(name);
    const resolvedStudentId = String(studentId || '').trim() || `STU-${Date.now()}`;
    // Password is optional — default if not provided
    const hasPasswordInput = Boolean(password && password.trim());
    const cleanPassword = hasPasswordInput ? password.trim() : generateSecureChildPassword();

    // Check if email already registered
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists. Use "Link Existing" instead.' });
    }

    // Create Supabase auth user (service key = admin)
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email: cleanEmail,
      password: cleanPassword,
      email_confirm: !emailProvided,   // bypass verification ONLY if we auto-generated the email
    });

    if (authErr || !authData?.user) {
      return res.status(500).json({ error: authErr?.message || 'Could not create auth account' });
    }

    const userId = authData.user.id;

    // Insert into users table
    const { error: insertErr } = await supabase.from('users').insert({
      id:         userId,
      name:       toTitleCase(name.trim()),
      email:      cleanEmail,
      role:       'student',
      grade,
      curriculum,
      school:     school.trim(),
      onboarding_complete: !emailProvided,
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

    await supabase.from('student_stats')
      .upsert({ student_id: userId }, { onConflict: 'student_id', ignoreDuplicates: true });
    await setStudentMeta(cleanEmail, resolvedStudentId, parentEmail, undefined, emailProvided ? 'pending_verification' : 'active');

    // Send verification email to the child's real Gmail (fire-and-forget)
    if (emailProvided) {
      const token = randomBytes(32).toString('hex');
      const expiry = Date.now() + 24 * 60 * 60 * 1000;
      const { data: existingPref } = await supabase
        .from('user_preferences').select('data').eq('user_email', cleanEmail).maybeSingle();
      const currentData = existingPref?.data || {};
      await supabase.from('user_preferences').upsert({
        user_email: cleanEmail,
        data: { ...currentData, verifyToken: token, verifyTokenExpiry: expiry, accountStatus: 'pending_verification' },
      }, { onConflict: 'user_email' });
      const serverBase = `${req.protocol}://${req.get('host')}`;
      const appBase = req.headers.origin || 'http://localhost:8081';
      const redirect = encodeURIComponent(appBase + '/verify-success');
      const verifyUrl = `${serverBase}/user/verify/${token}?email=${encodeURIComponent(cleanEmail)}&redirect=${redirect}`;
      sendVerificationEmail({ to: cleanEmail, name: name.trim(), verifyUrl }).catch(() => {});
    }

    res.json({
      success: true,
      child: {
        id: userId, studentId: resolvedStudentId, name: name.trim(), email: cleanEmail, grade, curriculum, school,
        // Return generated password only when it was auto-generated.
        generatedPassword: !hasPasswordInput ? cleanPassword : undefined,
        onboardingComplete: !emailProvided,
        verificationRequired: emailProvided,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /parent/:parentEmail/children ───────────────────
// Link a student to a parent by child's email

// Called after Firebase reports a real child email is verified.
router.post('/children/activate-verified', async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const firebaseUid = String(req.body?.firebaseUid || '').trim();
    if (!email) return res.status(400).json({ error: 'email required' });

    const { data: prefRow } = await supabase
      .from('user_preferences')
      .select('data')
      .eq('user_email', email)
      .maybeSingle();
    const existing = prefRow?.data || {};

    if (existing.firebaseUid && firebaseUid && existing.firebaseUid !== firebaseUid) {
      return res.status(403).json({ error: 'Firebase account mismatch.' });
    }

    const { error: userErr } = await supabase
      .from('users')
      .update({ onboarding_complete: true })
      .eq('email', email);
    if (userErr) return res.status(500).json({ error: userErr.message });

    await supabase.from('user_preferences').upsert({
      user_email: email,
      data: {
        ...existing,
        firebaseUid: firebaseUid || existing.firebaseUid,
        accountStatus: 'active',
        emailVerificationRequired: false,
        activatedAt: existing.activatedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_email' });

    res.json({ success: true, accountStatus: 'active' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// ── GET /parent/:parentEmail/children/:childId/credentials ──
// Returns stored login ID and initial password for parent to re-view

router.get('/:parentEmail/children/:childId/credentials', async (req, res) => {
  try {
    const { parentEmail, childId } = req.params;

    const { data: link } = await supabase
      .from('parent_children')
      .select('child_id')
      .eq('parent_email', parentEmail.toLowerCase())
      .eq('child_id', childId)
      .maybeSingle();
    if (!link) return res.status(403).json({ error: 'Not authorised.' });

    const { data: child } = await supabase
      .from('users')
      .select('email, name')
      .eq('id', childId)
      .maybeSingle();
    if (!child) return res.status(404).json({ error: 'Child not found.' });

    const { data: pref } = await supabase
      .from('user_preferences')
      .select('data')
      .eq('user_email', child.email)
      .maybeSingle();

    const meta = pref?.data || {};

    res.json({
      loginId: child.email,
      studentId: meta.studentId || null,
      initialPassword: meta.initialPassword || null,
      passwordSavedAt: meta.passwordSavedAt || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /parent/:parentEmail/children/:childId/reset-password ──
// Generates a Firebase password reset link for the child and emails it to the parent
router.post('/:parentEmail/children/:childId/reset-password', async (req, res) => {
  try {
    const { parentEmail, childId } = req.params;
    const { frontendOrigin } = req.body;
    const appBase = frontendOrigin || 'https://aivorah.ai';

    // Verify this child belongs to this parent
    const { data: link } = await supabase
      .from('parent_children')
      .select('child_id')
      .eq('parent_email', parentEmail.toLowerCase())
      .eq('child_id', childId)
      .maybeSingle();
    if (!link) return res.status(403).json({ error: 'Not authorised.' });

    const { data: child } = await supabase
      .from('users')
      .select('email, name')
      .eq('id', childId)
      .maybeSingle();
    if (!child) return res.status(404).json({ error: 'Child not found.' });

    // Generate Firebase password reset link using API key (no admin SDK needed)
    const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
    let resetLink = null;

    if (FIREBASE_API_KEY) {
      const fbRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FIREBASE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: child.email, returnOobLink: true }),
        }
      );
      const fbData = await fbRes.json();
      if (fbData.oobLink) resetLink = fbData.oobLink;
    }

    if (!resetLink) {
      return res.status(500).json({ error: 'Could not generate reset link. Please try again.' });
    }

    // Send reset link to parent's email (child has no real mailbox)
    await sendPasswordResetEmail({ to: parentEmail.toLowerCase(), resetLink, childName: child.name });
    res.json({ ok: true });
  } catch (err) {
    console.error('[reset-child-password]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /parent/:parentEmail/children/:childId/resend-credentials ──
// Re-sends the credentials email to the parent for an existing child account
router.post('/:parentEmail/children/:childId/resend-credentials', async (req, res) => {
  try {
    const { parentEmail, childId } = req.params;

    const { data: link } = await supabase
      .from('parent_children')
      .select('child_id')
      .eq('parent_email', parentEmail.toLowerCase())
      .eq('child_id', childId)
      .maybeSingle();
    if (!link) return res.status(403).json({ error: 'Not authorised.' });

    const { data: child } = await supabase
      .from('users')
      .select('email, name')
      .eq('id', childId)
      .maybeSingle();
    if (!child) return res.status(404).json({ error: 'Child not found.' });

    const { data: pref } = await supabase
      .from('user_preferences')
      .select('data')
      .eq('user_email', child.email)
      .maybeSingle();

    const meta = pref?.data || {};
    if (!meta.initialPassword) {
      return res.status(400).json({ error: 'No saved credentials found for this account.' });
    }

    await sendCredentialsEmail({
      to: parentEmail,
      childName: child.name,
      loginId: child.email,
      password: meta.initialPassword,
      studentId: meta.studentId || null,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /parent/:parentEmail/children/:childId ─────────
// Edit a child's name, grade, curriculum, school
router.patch('/:parentEmail/children/:childId', async (req, res) => {
  try {
    const { parentEmail, childId } = req.params;
    const { name, grade, curriculum, school } = req.body;

    // Verify this child belongs to this parent
    const { data: link } = await supabase
      .from('parent_children')
      .select('child_id')
      .eq('parent_email', parentEmail.toLowerCase())
      .eq('child_id', childId)
      .maybeSingle();
    if (!link) return res.status(403).json({ error: 'Not authorised to edit this child.' });

    const patch = {};
    if (name)       patch.name       = name.trim();
    if (grade)      patch.grade      = grade;
    if (curriculum) patch.curriculum = curriculum;
    if (school !== undefined) patch.school = school;

    const { data, error } = await supabase
      .from('users')
      .update(patch)
      .eq('id', childId)
      .select('id, name, email, grade, curriculum, school')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, child: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Parse "HH:MM" string or plain number to integer hour
function parseHourField(val) {
  if (val == null) return null;
  if (typeof val === 'string' && val.includes(':')) return parseInt(val.split(':')[0], 10);
  return Number(val);
}

// ── POST /parent/:parentEmail/children/:childId/screen-time ─────────
// Save all parental controls for a child
router.post('/:parentEmail/children/:childId/screen-time', async (req, res) => {
  try {
    const { parentEmail, childId } = req.params;
    const {
      dailyLimitMinutes, enabled, lockWhenReached,
      weeklyCapEnabled, weeklyCapMinutes,
      allowedHoursEnabled, allowedHoursStart, allowedHoursEnd,
      breakEnforcerEnabled, breakIntervalMinutes, breakDurationMinutes,
      homeworkFirstEnabled,
      subjectFilterEnabled, blockedSubjects,
    } = req.body;

    // Verify parent-child link
    const { data: link } = await supabase
      .from('parent_children')
      .select('child_id')
      .eq('parent_email', parentEmail)
      .eq('child_id', childId)
      .maybeSingle();
    if (!link) return res.status(403).json({ error: 'Child not linked to this parent' });

    const { data: child } = await supabase.from('users').select('email').eq('id', childId).maybeSingle();
    if (!child) return res.status(404).json({ error: 'Child not found' });

    const { data: existing } = await supabase
      .from('user_preferences')
      .select('data')
      .eq('user_email', child.email)
      .maybeSingle();

    const ex = existing?.data || {};
    const exSt = ex.screen_time || {};

    const controls = {
      // Daily screen time
      daily_limit_minutes: dailyLimitMinutes != null ? Number(dailyLimitMinutes) : (exSt.daily_limit_minutes ?? 60),
      enabled: enabled != null ? Boolean(enabled) : (exSt.enabled ?? true),
      lock_when_reached: lockWhenReached != null ? Boolean(lockWhenReached) : (exSt.lock_when_reached ?? false),
      // Weekly cap
      weekly_cap_enabled: weeklyCapEnabled != null ? Boolean(weeklyCapEnabled) : (exSt.weekly_cap_enabled ?? false),
      weekly_cap_minutes: weeklyCapMinutes != null ? Number(weeklyCapMinutes) : (exSt.weekly_cap_minutes ?? 300),
      // Allowed hours
      allowed_hours_enabled: allowedHoursEnabled != null ? Boolean(allowedHoursEnabled) : (exSt.allowed_hours_enabled ?? false),
      allowed_hours_start: allowedHoursStart != null ? parseHourField(allowedHoursStart) : (exSt.allowed_hours_start ?? 14),
      allowed_hours_end: allowedHoursEnd != null ? parseHourField(allowedHoursEnd) : (exSt.allowed_hours_end ?? 21),
      // Break enforcer
      break_enforcer_enabled: breakEnforcerEnabled != null ? Boolean(breakEnforcerEnabled) : (exSt.break_enforcer_enabled ?? false),
      break_interval_minutes: breakIntervalMinutes != null ? Number(breakIntervalMinutes) : (exSt.break_interval_minutes ?? 25),
      break_duration_minutes: breakDurationMinutes != null ? Number(breakDurationMinutes) : (exSt.break_duration_minutes ?? 5),
      // Homework first
      homework_first_enabled: homeworkFirstEnabled != null ? Boolean(homeworkFirstEnabled) : (exSt.homework_first_enabled ?? false),
      // Subject filter
      subject_filter_enabled: subjectFilterEnabled != null ? Boolean(subjectFilterEnabled) : (exSt.subject_filter_enabled ?? false),
      blocked_subjects: blockedSubjects != null ? blockedSubjects : (exSt.blocked_subjects ?? []),
      // Meta
      set_by: parentEmail,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('user_preferences')
      .upsert({ user_email: child.email, data: { ...ex, screen_time: controls } }, { onConflict: 'user_email' });

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true, controls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /parent/:parentEmail/children/:childId/screen-time ──────────
// Get all parental controls for a child
router.get('/:parentEmail/children/:childId/screen-time', async (req, res) => {
  try {
    const { parentEmail, childId } = req.params;

    const { data: link } = await supabase
      .from('parent_children')
      .select('child_id')
      .eq('parent_email', parentEmail)
      .eq('child_id', childId)
      .maybeSingle();
    if (!link) return res.status(403).json({ error: 'Child not linked to this parent' });

    const { data: child } = await supabase.from('users').select('email').eq('id', childId).maybeSingle();
    if (!child) return res.status(404).json({ error: 'Child not found' });

    const { data: pref } = await supabase
      .from('user_preferences')
      .select('data')
      .eq('user_email', child.email)
      .maybeSingle();

    const st = pref?.data?.screen_time || {};

    const { data: stats } = await supabase
      .from('student_stats')
      .select('today_study_minutes')
      .eq('student_id', childId)
      .maybeSingle();

    // Weekly usage from daily log (last 7 days)
    const today = new Date();
    const weekStart = new Date(); weekStart.setDate(today.getDate() - 6);
    const { data: weekLogs } = await supabase
      .from('student_daily_log')
      .select('log_date, study_minutes')
      .eq('student_id', childId)
      .gte('log_date', weekStart.toISOString().split('T')[0])
      .lte('log_date', today.toISOString().split('T')[0]);
    const weeklyUsageMinutes = (weekLogs ?? []).reduce((sum, r) => sum + (r.study_minutes ?? 0), 0);

    res.json({
      // Daily limit
      dailyLimitMinutes: st.daily_limit_minutes ?? null,
      isEnabled: st.enabled ?? false,
      lockWhenReached: st.lock_when_reached ?? false,
      // Weekly cap
      weeklyCapEnabled: st.weekly_cap_enabled ?? false,
      weeklyCapMinutes: st.weekly_cap_minutes ?? 300,
      // Allowed hours
      allowedHoursEnabled: st.allowed_hours_enabled ?? false,
      allowedHoursStart: st.allowed_hours_start ?? 14,
      allowedHoursEnd: st.allowed_hours_end ?? 21,
      // Break enforcer
      breakEnforcerEnabled: st.break_enforcer_enabled ?? false,
      breakIntervalMinutes: st.break_interval_minutes ?? 25,
      breakDurationMinutes: st.break_duration_minutes ?? 5,
      // Homework first
      homeworkFirstEnabled: st.homework_first_enabled ?? false,
      // Subject filter
      subjectFilterEnabled: st.subject_filter_enabled ?? false,
      blockedSubjects: st.blocked_subjects ?? [],
      // Usage
      todayUsageMinutes: stats?.today_study_minutes ?? 0,
      weeklyUsageMinutes,
      setBy: st.set_by ?? null,
      updatedAt: st.updated_at ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /parent/screen-time-status/:studentEmail ─────────────────────
// Student checks all active restrictions (called by ScreenLayout every 2 min)
router.get('/screen-time-status/:studentEmail', async (req, res) => {
  try {
    const { studentEmail } = req.params;

    const { data: pref } = await supabase
      .from('user_preferences')
      .select('data')
      .eq('user_email', studentEmail)
      .maybeSingle();

    const st = pref?.data?.screen_time || null;
// Return hasLimit:false only if no controls at all are configured
    const anyControlActive = st && (
      st.enabled ||
      st.allowed_hours_enabled ||
      st.break_enforcer_enabled ||
      st.homework_first_enabled ||
      st.subject_filter_enabled ||
      st.weekly_cap_enabled
    );
    if (!anyControlActive) {
      return res.json({ hasLimit: false });
    }

    const { data: userRow } = await supabase.from('users').select('id').eq('email', studentEmail).maybeSingle();
    const { data: stats } = await supabase
      .from('student_stats')
      .select('today_study_minutes')
      .eq('student_id', userRow?.id)
      .maybeSingle();

    const used = stats?.today_study_minutes ?? 0;
    const limit = st.daily_limit_minutes;
    const remaining = Math.max(0, limit - used);

    // Compute current hour for allowed-hours check (UTC; client also checks locally)
    const nowHour = new Date().getUTCHours();

    res.json({
      hasLimit: true,
      // Daily
      dailyLimitMinutes: limit,
      usedMinutes: used,
      remainingMinutes: remaining,
      isLocked: st.lock_when_reached && remaining <= 0,
      // Weekly cap
      weeklyCap: st.weekly_cap_enabled ? {
        enabled: true,
        weeklyLimitMinutes: st.weekly_cap_minutes ?? 300,
        weeklyUsedMinutes: used, // proxy: replace with real weekly tracking when session log exists
        isOverWeeklyCap: used >= (st.weekly_cap_minutes ?? 300),
      } : { enabled: false },
      // Allowed hours
      allowedHours: st.allowed_hours_enabled ? {
        enabled: true,
        startHour: st.allowed_hours_start ?? 14,
        endHour: st.allowed_hours_end ?? 21,
      } : { enabled: false },
      // Break enforcer
      breakEnforcer: st.break_enforcer_enabled ? {
        enabled: true,
        intervalMinutes: st.break_interval_minutes ?? 25,
        breakDurationMinutes: st.break_duration_minutes ?? 5,
      } : { enabled: false },
      // Homework first
      homeworkFirst: { enabled: st.homework_first_enabled ?? false },
      // Subject filter
      subjectFilter: st.subject_filter_enabled ? {
        enabled: true,
        blockedSubjects: st.blocked_subjects ?? [],
      } : { enabled: false },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
