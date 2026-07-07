const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { randomUUID, randomInt, randomBytes } = require('crypto');
const { fetchTotalTopicsFromQdrant } = require('./student');
const { sendCredentialsEmail, sendVerificationEmail, sendPasswordResetEmail } = require('../services/mailer');
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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

async function generateChildLoginId(parentEmail) {
  if (parentEmail) {
    const localPart = parentEmail.split('@')[0].toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    for (let n = 1; n < 100; n++) {
      const candidate = `${localPart}_ch${n}@aivorah.student`;
      const { data: existing } = await supabase.from('users').select('id').eq('email', candidate).maybeSingle();
      if (!existing) return candidate;
    }
  }
  for (let n = 1; n < 100000; n++) {
    const candidate = `ch${n}@aivorah.student`;
    const { data: existing } = await supabase.from('users').select('id').eq('email', candidate).maybeSingle();
    if (!existing) return candidate;
  }
  // Extremely unlikely fallback if somehow 99999 are taken
  return `ch${Date.now()}@aivorah.student`;
}

// ── POST /parent/children/init-auth ────────────────────────
// Prepare child credentials for onboarding Step 4
// This route handles both /parent/children/init-auth and legacy /parent/:email/children/init-auth
router.post(['/children/init-auth', '/:parentEmail/children/init-auth'], async (req, res) => {
  try {
    const { name, email, studentId, password: customPassword, parentEmail: bodyParentEmail } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    const parentEmail = req.params.parentEmail || bodyParentEmail || '';
    const emailProvided = Boolean(email && String(email).trim());
    const cleanEmail = emailProvided
      ? String(email).toLowerCase().trim()
      : await generateChildLoginId(parentEmail);

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

    const children = await Promise.all(links.map(async (link) => {
      const user = link.users ?? {};
      const s    = statsMap[link.child_id] ?? {};
      const totalTopics = await fetchTotalTopicsFromQdrant(user.curriculum || 'IB PYP', user.grade || 'Grade 3');
      return {
        id:               link.child_id,
        name:             user.name    || 'Student',
        email:            user.email   || '',
        grade:            user.grade      || 'Grade 3',
        curriculum:       user.curriculum || 'IB PYP',
        school:           user.school     || '',
        totalTopics,
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
    }));

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
    const { firebaseUid, studentId, name, email, grade, curriculum, school = '', verificationRequired = false, age, initialPassword, otpVerified = false } = req.body || {};

    if (!firebaseUid || !name || !email || !grade || !curriculum) {
      return res.status(400).json({ error: 'firebaseUid, name, email, grade, curriculum are required' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanName = toTitleCase(String(name).trim());
    const cleanParentEmail = String(parentEmail).toLowerCase().trim();
    const resolvedStudentId = String(studentId || '').trim() || `STU-${Date.now()}`;
    const resolvedUserId = randomUUID();

    const isRealEmail = !cleanEmail.endsWith('@aivorah.student') && !otpVerified;
    const actualVerificationRequired = isRealEmail || verificationRequired;
    const accountStatus = actualVerificationRequired ? 'pending_verification' : 'active';

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
        onboarding_complete: !actualVerificationRequired,
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

    // When the parent supplied the child's OWN real email (not an auto-generated
    // @aivorah.student placeholder), send the login credentials directly to that
    // address too — previously only a bare verification link went there, so a
    // child with their own email never actually received their login ID/password.
    if (!cleanEmail.endsWith('@aivorah.student') && cleanEmail !== cleanParentEmail) {
      sendCredentialsEmail({
        to: cleanEmail,
        childName: cleanName,
        loginId: cleanEmail,
        password: initialPassword || undefined,
        studentId: resolvedStudentId,
      }).catch(err => console.log('[parent/children] child credentials email failed (non-fatal):', err.message));
    }

    // Send verification email to child's real Gmail (fire-and-forget)
    if (actualVerificationRequired) {
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
      : await generateChildLoginId(parentEmail);
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
// Edit a child's name, email, grade, curriculum, school
router.patch('/:parentEmail/children/:childId', async (req, res) => {
  try {
    const { parentEmail, childId } = req.params;
    const { name, email, grade, curriculum, school, otpVerified = false } = req.body;

    // Verify this child belongs to this parent
    const { data: link } = await supabase
      .from('parent_children')
      .select('child_id')
      .eq('parent_email', parentEmail.toLowerCase())
      .eq('child_id', childId)
      .maybeSingle();
    if (!link) return res.status(403).json({ error: 'Not authorised to edit this child.' });

    const { data: childUser } = await supabase
      .from('users')
      .select('id, name, email, grade, curriculum, school')
      .eq('id', childId)
      .single();
    if (!childUser) return res.status(404).json({ error: 'Child user not found.' });

    const patch = {};
    if (name)       patch.name       = name.trim();
    if (grade)      patch.grade      = grade;
    if (curriculum) patch.curriculum = curriculum;
    if (school !== undefined) patch.school = school;

    let emailChanged = false;
    let cleanEmail = '';
    if (email && email.trim().toLowerCase() !== childUser.email.toLowerCase()) {
      cleanEmail = email.trim().toLowerCase();
      emailChanged = true;

      // Check if email already registered to another user
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', cleanEmail)
        .maybeSingle();
      if (existingUser && existingUser.id !== childId) {
        return res.status(409).json({ error: 'This email is already in use by another account.' });
      }
    }

    if (emailChanged) {
      // 1. Initialize Firebase Admin if not initialized
      const admin = require('firebase-admin');
      const path = require('path');
      const fs = require('fs');
      if (!admin.apps.length) {
        let credential = null;
        if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
          credential = admin.credential.cert(JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8')));
        } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
          credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
        } else {
          const svcPath = path.join(__dirname, '../firebase-service-account.json');
          if (fs.existsSync(svcPath)) credential = admin.credential.cert(require(svcPath));
        }
        if (credential) {
          admin.initializeApp({ credential });
        }
      }

      // 2. Update Firebase Auth user email
      if (admin.apps.length) {
        const { data: pref } = await supabase
          .from('user_preferences')
          .select('data')
          .eq('user_email', childUser.email.toLowerCase())
          .maybeSingle();
        const firebaseUid = pref?.data?.firebaseUid;
        try {
          if (firebaseUid) {
            await admin.auth().updateUser(firebaseUid, { email: cleanEmail });
          } else {
            const firebaseUser = await admin.auth().getUserByEmail(childUser.email);
            await admin.auth().updateUser(firebaseUser.uid, { email: cleanEmail });
          }
        } catch (firebaseErr) {
          console.warn('[PATCH /children/:childId] Firebase Auth email update failed/skipped:', firebaseErr.message);
        }
      }

      // 3. Update primary key user_email in user_preferences table
      await supabase
        .from('user_preferences')
        .update({ user_email: cleanEmail })
        .eq('user_email', childUser.email.toLowerCase());

      const isRealEmail = !cleanEmail.endsWith('@aivorah.student') && !otpVerified;
      if (isRealEmail) {
        // Send verification email to the new address
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
        sendVerificationEmail({ to: cleanEmail, name: (name || childUser.name).trim(), verifyUrl }).catch(() => {});

        patch.onboarding_complete = false;
      } else {
        patch.onboarding_complete = true;
      }
      patch.email = cleanEmail;
    }

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

// ── HELPER: Compute learning pattern signal from raw data ─────────────────
function computeLearningProfile(data) {
  const {
    completedTopics, assignmentsDone, challengesCompleted,
    streak, activeDays, studyMinutes, subjectSummaries,
    assignmentScores, challengeScores,
  } = data;

  const hasQuizScores = subjectSummaries.some(s => s.quizCount > 0);
  const totalTopics = completedTopics.length;

  // ── Learning pattern ──────────────────────────────────────────────────
  let learningPattern;
  if (totalTopics === 0 && assignmentsDone === 0) {
    learningPattern = 'just_started';
  } else if (totalTopics >= 5 && assignmentsDone === 0 && !hasQuizScores) {
    learningPattern = 'broad_explorer'; // exploring widely, not yet assessed
  } else if (hasQuizScores && assignmentsDone >= 2) {
    learningPattern = 'active_learner';  // both exploring and being assessed
  } else if (assignmentsDone >= 3 && totalTopics < 5) {
    learningPattern = 'assignment_focused';
  } else {
    learningPattern = 'developing';
  }

  // ── Consistency signal ────────────────────────────────────────────────
  let consistencySignal;
  if (streak >= 7 && activeDays >= 10) consistencySignal = 'highly_consistent';
  else if (streak >= 3 && activeDays >= 5) consistencySignal = 'building_habit';
  else if (activeDays >= 3) consistencySignal = 'occasional';
  else consistencySignal = 'irregular';

  // ── Assessment signal ─────────────────────────────────────────────────
  const strongTopics = [], weakTopics = [], mediumTopics = [];
  for (const s of subjectSummaries) {
    for (const t of s.strongTopics) strongTopics.push({ ...t, subject: s.subject });
    for (const t of s.weakTopics)   weakTopics.push({ ...t, subject: s.subject });
    for (const t of s.topicDetails) {
      if (t.avgScore != null && t.avgScore >= 60 && t.avgScore < 75) {
        mediumTopics.push({ ...t, subject: s.subject });
      }
    }
  }

  // ── Risk flags ────────────────────────────────────────────────────────
  const riskFlags = [];
  if (assignmentsDone === 0)    riskFlags.push('no_assignments');
  if (consistencySignal === 'irregular') riskFlags.push('irregular_study');
  if (weakTopics.length > 0)    riskFlags.push('weak_quiz_topics');
  if (!hasQuizScores && totalTopics >= 3) riskFlags.push('unassessed');

  // ── Positive signals ──────────────────────────────────────────────────
  const positiveSignals = [];
  if (strongTopics.length > 0)  positiveSignals.push('strong_quiz_topics');
  if (streak >= 3)               positiveSignals.push('active_streak');
  if (totalTopics >= 10)         positiveSignals.push('broad_coverage');
  if (challengesCompleted > 0)   positiveSignals.push('challenge_taker');
  if (assignmentsDone >= 3)      positiveSignals.push('assignment_completer');

  // ── Next recommended topic (based on what they completed) ─────────────
  // Group completed topics by subject area
  const subjectGroups = {};
  for (const topic of completedTopics) {
    for (const s of subjectSummaries) {
      if (s.topicDetails.some(t => t.topic === topic)) {
        if (!subjectGroups[s.subject]) subjectGroups[s.subject] = [];
        subjectGroups[s.subject].push(topic);
      }
    }
  }

  return {
    learningPattern, consistencySignal, hasQuizScores,
    strongTopics, weakTopics, mediumTopics,
    riskFlags, positiveSignals,
    totalTopics, assignmentsDone, challengesCompleted,
    streak, activeDays, studyMinutes,
    subjectSummaries,
    avgAssignmentScore: assignmentScores.length
      ? Math.round(assignmentScores.reduce((a, b) => a + b, 0) / assignmentScores.length) : null,
    avgChallengeScore: challengeScores.length
      ? Math.round(challengeScores.reduce((a, b) => a + b, 0) / challengeScores.length) : null,
  };
}

// ── GET /parent/:parentEmail/children/:childId/ai-report ──
// Two-stage pipeline: deterministic signals → AI mentor reasoning
router.get('/:parentEmail/children/:childId/ai-report', async (req, res) => {
  try {
    const { parentEmail, childId } = req.params;
    const { readEvents } = require('../services/analytics');

    // Verify parent-child link
    const { data: link } = await supabase
      .from('parent_children')
      .select('child_id')
      .eq('parent_email', parentEmail.toLowerCase())
      .eq('child_id', childId)
      .maybeSingle();
    if (!link) return res.status(403).json({ error: 'Not authorised.' });

    // Fetch student profile (need email to query analytics_events)
    const { data: student } = await supabase
      .from('users')
      .select('name, email, grade, curriculum, school')
      .eq('id', childId)
      .maybeSingle();
    if (!student) return res.status(404).json({ error: 'Student not found.' });

    const today = new Date();

    // ── STAGE 1: Fetch all raw data in parallel ────────────────────────────
    const [statsRes, dailyLogsRes, submissionsRes, challengesRes, analyticsEvents] = await Promise.all([
      supabase.from('student_stats').select('*').eq('student_id', childId).maybeSingle(),
      supabase.from('student_daily_log')
        .select('log_date, study_minutes, xp_earned, topics_completed')
        .eq('student_id', childId)
        .gte('log_date', (() => { const d = new Date(); d.setDate(d.getDate() - 13); return d.toISOString().split('T')[0]; })())
        .order('log_date', { ascending: true }),
      supabase.from('assignment_submissions')
        .select('score, status, completed_at')
        .eq('student_id', childId)
        .order('completed_at', { ascending: false })
        .limit(20),
      supabase.from('challenge_assignments')
        .select('score, status, completed_at')
        .eq('student_id', childId)
        .order('completed_at', { ascending: false })
        .limit(10),
      readEvents({ userEmail: student.email, limit: 500 }),
    ]);

    const stats       = statsRes.data;
    const dailyLogs   = dailyLogsRes.data   || [];
    const submissions = submissionsRes.data  || [];
    const challenges  = challengesRes.data   || [];

    // ── Core stats ─────────────────────────────────────────────────────────
    const xp               = stats?.xp_points         ?? 0;
    const streak           = stats?.current_streak    ?? 0;
    const studyMinutes     = stats?.study_time_minutes ?? 0;
    const completedTopics  = stats?.completed_topics   ?? [];
    const assignmentsDone  = stats?.assignments_done   ?? 0;
    const challengesCompleted = stats?.challenges_completed ?? 0;
    const level            = stats?.level ?? 1;

    const activeDays       = dailyLogs.filter(d => (d.study_minutes ?? 0) > 0).length;
    const totalRecentMinutes = dailyLogs.reduce((s, d) => s + (d.study_minutes ?? 0), 0);
    const avgDailyMinutes  = activeDays > 0 ? Math.round(totalRecentMinutes / activeDays) : 0;

    const scoredSubs       = submissions.filter(s => s.score != null && s.status === 'completed');
    const assignmentScores = scoredSubs.map(s => Number(s.score));
    let assignmentTrend    = null;
    if (assignmentScores.length >= 4) {
      const half  = Math.floor(assignmentScores.length / 2);
      const older = assignmentScores.slice(half).reduce((a, b) => a + b, 0) / half;
      const newer = assignmentScores.slice(0, half).reduce((a, b) => a + b, 0) / half;
      assignmentTrend = newer > older + 5 ? 'improving' : newer < older - 5 ? 'declining' : 'stable';
    }

    const scoredChallenges = challenges.filter(c => c.score != null);
    const challengeScores  = scoredChallenges.map(c => Number(c.score));

    // ── Build subject map from analytics events ────────────────────────────
    const subjectMap = {};
    for (const e of analyticsEvents) {
      if (!e.topic || !e.subject) continue;
      if (!subjectMap[e.subject]) subjectMap[e.subject] = { scores: [], topics: {} };
      const subj = subjectMap[e.subject];
      if (!subj.topics[e.topic]) subj.topics[e.topic] = { scores: [], sessions: 0 };
      const t = subj.topics[e.topic];
      if ((e.eventType === 'ibpyp_quiz_result' || e.eventType === 'ncert_quiz_result') && typeof e.score === 'number') {
        subj.scores.push(e.score); t.scores.push(e.score);
      }
      if (e.eventType === 'lesson_started' || e.eventType === 'ai_lesson_script') t.sessions++;
    }

    const subjectSummaries = Object.entries(subjectMap).map(([subject, data]) => {
      const topicDetails = Object.entries(data.topics).map(([topic, td]) => {
        const tAvg = td.scores.length ? Math.round(td.scores.reduce((a, b) => a + b, 0) / td.scores.length) : null;
        return { topic, avgScore: tAvg, quizAttempts: td.scores.length, sessions: td.sessions };
      });
      const avgScore     = data.scores.length ? Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length) : null;
      const strongTopics = topicDetails.filter(t => t.avgScore != null && t.avgScore >= 75);
      const weakTopics   = topicDetails.filter(t => t.avgScore != null && t.avgScore < 60);
      const exploredTopics = topicDetails.filter(t => t.sessions > 0);
      return { subject, avgScore, topicDetails, strongTopics, weakTopics, exploredTopics, quizCount: data.scores.length };
    });

    // ── No activity check ─────────────────────────────────────────────────
    const hasActivity = xp > 0 || studyMinutes > 0 || completedTopics.length > 0
      || assignmentsDone > 0 || challengesCompleted > 0 || analyticsEvents.length > 0;
    if (!hasActivity) {
      return res.json({
        student: { name: student.name, grade: student.grade, curriculum: student.curriculum, school: student.school },
        noData: true, generatedAt: new Date().toISOString(),
      });
    }

    // ── STAGE 2: Compute deterministic signals (no AI, pure logic) ─────────
    const profile = computeLearningProfile({
      completedTopics, assignmentsDone, challengesCompleted,
      streak, activeDays, studyMinutes, subjectSummaries,
      assignmentScores, challengeScores,
    });

    const avgAssignmentScore = profile.avgAssignmentScore;
    const avgChallengeScore  = profile.avgChallengeScore;

    // Clean raw topic keys → human-readable names
    function humanizeTopic(raw) {
      // e.g. "ch1_numbers" → "Chapter 1: Numbers", "ch12_fractions" → "Chapter 12: Fractions"
      const chMatch = String(raw).match(/^ch(\d+)[_\s](.+)$/i);
      if (chMatch) {
        const title = chMatch[2].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return `Chapter ${chMatch[1]}: ${title}`;
      }
      // Replace underscores, title-case
      return String(raw).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
    const readableTopics = completedTopics.map(humanizeTopic);

    // Build signal card — this is what the AI gets, not raw numbers
    const signalCard = {
      student:    `${student.name}, ${student.grade}, ${student.curriculum}`,
      pattern:    profile.learningPattern,
      consistency: profile.consistencySignal,
      topicsCompleted: completedTopics.length,
      topicNames: readableTopics.slice(0, 8).join(', ') + (completedTopics.length > 8 ? ` and ${completedTopics.length - 8} more` : ''),
      streakDays:  streak,
      activeDaysOf14: activeDays,
      studyTimeTotal: `${Math.floor(studyMinutes / 60)}h ${studyMinutes % 60}m`,
      hasQuizData: profile.hasQuizScores,
      strongTopics: profile.strongTopics.map(t => `${humanizeTopic(t.topic)} (${t.subject}, ${t.avgScore}%)`),
      weakTopics:   profile.weakTopics.map(t => `${humanizeTopic(t.topic)} (${t.subject}, ${t.avgScore}%)`),
      assignmentsDone,
      avgAssignmentScore,
      assignmentTrend,
      challengesCompleted,
      avgChallengeScore,
      riskFlags:      profile.riskFlags,
      positiveSignals: profile.positiveSignals,
    };

    // ── STAGE 3: AI reasons over signals only — mentor voice ───────────────
    const patternDescriptions = {
      just_started:         'just beginning their learning journey',
      broad_explorer:       'exploring a wide range of topics but not yet assessed on them',
      active_learner:       'actively learning and being assessed — a great combination',
      assignment_focused:   'completing assignments regularly, showing structured effort',
      developing:           'in the early stages of building a learning routine',
    };

    const consistencyDescriptions = {
      highly_consistent: 'studying very consistently — daily habit is strong',
      building_habit:    'building a study habit — some good days but not yet daily',
      occasional:        'studying occasionally — needs more regular sessions',
      irregular:         'studying irregularly — needs help building a routine',
    };

    const prompt = `You are Aivorah, an AI learning mentor. A parent is reading this report about their child. Write like a caring, insightful mentor who has studied this child's learning data closely.

STUDENT PROFILE (computed from real data):
- Student: ${signalCard.student}
- Learning pattern: ${patternDescriptions[signalCard.pattern]}
- Consistency: ${consistencyDescriptions[signalCard.consistency]}
- Topics completed: ${signalCard.topicsCompleted} — exact names: ${signalCard.topicNames} (use these exact topic names when mentioning them, do not rewrite or abbreviate them)
- Study time overall: ${signalCard.studyTimeTotal}
- Current streak: ${signalCard.streakDays} day(s), active ${signalCard.activeDaysOf14} of last 14 days
- Quiz data available: ${signalCard.hasQuizData ? 'Yes' : 'No — student has not taken quizzes yet'}
${signalCard.strongTopics.length > 0 ? `- Performing well in: ${signalCard.strongTopics.join(', ')}` : ''}
${signalCard.weakTopics.length > 0   ? `- Struggling with: ${signalCard.weakTopics.join(', ')}`    : ''}
- Assignments completed: ${signalCard.assignmentsDone}${avgAssignmentScore != null ? ` (avg ${avgAssignmentScore}%, trend: ${assignmentTrend})` : ''}
- Challenges completed: ${signalCard.challengesCompleted}${avgChallengeScore != null ? ` (avg ${avgChallengeScore}%)` : ''}
- Risk flags: ${signalCard.riskFlags.join(', ') || 'none'}
- Positive signals: ${signalCard.positiveSignals.join(', ') || 'none yet'}

YOUR TASK:
Write a mentor report for the parent. Each section must interpret the SIGNALS above — not just repeat numbers. Think about what this pattern MEANS for the child's learning journey.

RULES:
1. DO NOT invent skills, traits, or abilities. You only know what the signals show.
2. If quiz data is not available, say so honestly — "we haven't assessed this yet".
3. learning_pattern="${signalCard.pattern}" should drive your interpretation of why things are the way they are.
4. Recommendations must be specific actions the parent can take THIS WEEK.
5. Tone: warm mentor, not a robot reading a spreadsheet. Speak directly to the parent.

Return ONLY valid JSON, no markdown:
{
  "learning_pattern_insight": "2-3 sentences: what does this student's pattern tell us about how they learn right now?",
  "whats_going_well": "2-3 sentences on positive signals only — name specific topics or streaks",
  "where_to_focus": "2-3 sentences on what needs attention — be specific, not alarming",
  "subject_insights": [{ "subject": "name", "insight": "what the data shows about this subject" }],
  "consistency_insight": "1-2 sentences on study habit — use the streak and active days signal",
  "assignment_insight": ${assignmentsDone > 0 ? '"1-2 sentences on assignment performance from the signals"' : 'null'},
  "this_week_actions": ["specific action 1 for parent to take this week", "specific action 2", "specific action 3"],
  "message_to_child": "1 warm sentence the parent can read to the child — reference a real topic or streak"
}`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `You are Aivorah, a warm and insightful AI learning mentor writing reports for parents.
ABSOLUTE RULES — breaking even one makes the report invalid:
- FORBIDDEN PHRASES (never use, no exceptions): "enthusiasm for learning", "love of learning", "passion for learning", "natural curiosity", "problem-solving skills", "communication skills", "creative approach", "positive attitude", "hardworking", "talented", "keen interest", "social skills", "strong grasp", "excellent understanding", "dedicated learner", "bright student", "exceptional", "remarkable talent".
- The phrase "strong grasp" is FORBIDDEN. Do not write it under any circumstances.
- Every claim must be directly traceable to a signal in the student profile. Zero invented traits.
- If quiz data is absent, never imply competence. Say what you don't know rather than guessing.
- If a student just started, do not praise skills you cannot measure. Describe what you observed: topics explored, time studied, consistency.
- Always reference specific topics, numbers, and subjects from the profile.`,
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1200,
    });

    let aiReport;
    try {
      aiReport = JSON.parse(completion.choices[0].message.content.trim());
    } catch {
      const match = completion.choices[0].message.content.match(/\{[\s\S]*\}/);
      aiReport = match ? JSON.parse(match[0]) : {};
    }

    // ── Post-processing: strip banned phrases from all AI text fields ───────
    const BANNED_PHRASES = [
      'problem-solving skills', 'problem solving skills',
      'communication skills', 'creative approach',
      'positive attitude', 'keen interest', 'social skills',
      'enthusiasm for learning', 'love of learning', 'passion for learning',
      'natural curiosity', 'strong grasp', 'excellent understanding',
      'talented', 'hardworking', 'dedicated learner', 'bright student',
      'exceptional', 'remarkable talent', 'outstanding ability',
    ];
    function sanitizeText(text) {
      if (typeof text !== 'string') return text;
      let out = text;
      // Replace raw topic keys like "ch1_numbers" → "Chapter 1: Numbers"
      out = out.replace(/\bch(\d+)[_\s]([a-z][a-z0-9_]*)/gi, (_, num, rest) => {
        const title = rest.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return `Chapter ${num}: ${title}`;
      });
      for (const phrase of BANNED_PHRASES) {
        const re = new RegExp(phrase.replace(/[-()]/g, '\\$&'), 'gi');
        out = out.replace(re, 'consistent effort');
      }
      return out;
    }
    function sanitizeReport(obj) {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(sanitizeReport);
      const result = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = typeof v === 'string' ? sanitizeText(v) : sanitizeReport(v);
      }
      return result;
    }
    aiReport = sanitizeReport(aiReport);

    // ── Merge: deterministic facts + AI mentor reasoning ───────────────────
    const report = {
      learning_pattern_insight: aiReport.learning_pattern_insight || null,
      whats_going_well:  aiReport.whats_going_well  || null,
      where_to_focus:    aiReport.where_to_focus    || null,
      subject_insights:  aiReport.subject_insights  || [],
      consistency_insight: aiReport.consistency_insight || null,
      assignment_insight:  aiReport.assignment_insight  || null,
      this_week_actions: aiReport.this_week_actions  || [],
      message_to_child:  aiReport.message_to_child   || null,
      // Deterministic — AI cannot touch these
      strong_topics: profile.strongTopics.map(t => ({ topic: humanizeTopic(t.topic), subject: t.subject, score: t.avgScore })),
      weak_topics:   profile.weakTopics.map(t =>   ({ topic: humanizeTopic(t.topic), subject: t.subject, score: t.avgScore })),
      learning_pattern: signalCard.pattern,
      consistency_level: signalCard.consistency,
    };

    res.json({
      student: { name: student.name, grade: student.grade, curriculum: student.curriculum, school: student.school },
      metrics: {
        xp, level, studyTimeMinutes: studyMinutes,
        recentStudyMinutes: totalRecentMinutes,
        activeDays, activeDaysThisWeek: Math.min(activeDays, 7), avgDailyMinutes, currentStreak: streak,
        topicsCompleted: completedTopics.length, completedTopics,
        assignmentsDone, avgAssignmentScore, assignmentTrend,
        challengesCompleted, avgChallengeScore,
      },
      subjectPerformance: subjectSummaries,
      report,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[ai-report]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
