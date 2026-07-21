const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const cloudinary = require('cloudinary').v2;
const supabase   = require('../services/supabase');
const otpStore   = require('../services/otpStore');
const { encrypt, decrypt } = require('../utils/encryption');
const { sendWelcomeEmail, sendVerificationEmail, sendPasswordResetEmail, sendRecoveryEmailConfirmation } = require('../services/mailer');

// Firebase Admin — used to generate password reset links server-side
// Supports two init methods:
//   1. FIREBASE_SERVICE_ACCOUNT env var (JSON string) — used on Cloud Run
//   2. firebase-service-account.json file — used locally
let firebaseAdmin = null;
try {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    let credential = null;

    // Priority 1: base64-encoded env var (Cloud Run / production — avoids CLI special-char issues)
    if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
      const svcJson = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8'));
      credential = admin.credential.cert(svcJson);
      console.log('[firebase-admin] initialised from FIREBASE_SERVICE_ACCOUNT_B64 env var');
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const svcJson = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      credential = admin.credential.cert(svcJson);
      console.log('[firebase-admin] initialised from FIREBASE_SERVICE_ACCOUNT env var');
    } else {
      // Priority 2: local file
      const svcPath = require('path').join(__dirname, '../firebase-service-account.json');
      if (require('fs').existsSync(svcPath)) {
        credential = admin.credential.cert(require(svcPath));
        console.log('[firebase-admin] initialised from service account file');
      }
    }

    if (credential) {
      admin.initializeApp({ credential });
      firebaseAdmin = admin;
    } else {
      console.warn('[firebase-admin] no service account found — password reset will use Firebase default sender');
    }
  } else {
    firebaseAdmin = admin;
  }
} catch (e) {
  console.warn('[firebase-admin] not available:', e.message);
}
const crypto = require('crypto');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── Preferences stored in Supabase user_preferences table ────────────
async function getPreferences(email) {
  try {
    const key = email.toLowerCase().trim();
    const { data } = await supabase.from('user_preferences').select('data').eq('user_email', key).maybeSingle();
    return data?.data ?? null;
  } catch { return null; }
}

async function setPreferences(email, updates) {
  try {
    const key = email.toLowerCase().trim();
    const { data: existing } = await supabase.from('user_preferences').select('data').eq('user_email', key).maybeSingle();
    const merged = { ...(existing?.data ?? {}), ...updates };
    await supabase.from('user_preferences').upsert({ user_email: key, data: merged, updated_at: new Date().toISOString() }, { onConflict: 'user_email' });
  } catch (err) { console.error('[setPreferences]', err?.message); }
}

async function readPreferences() {
  // Returns all rows as a flat object keyed by email (for CSV export)
  try {
    const { data } = await supabase.from('user_preferences').select('user_email, data');
    const out = {};
    for (const row of (data ?? [])) out[row.user_email] = row.data ?? {};
    return out;
  } catch { return {}; }
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows, headers) {
  const head = headers.map(csvCell).join(',');
  const body = rows.map((row) => headers.map((h) => csvCell(row[h])).join(',')).join('\n');
  return `${head}\n${body}`;
}

function hasAdminExportAccess(req) {
  const requiredKey = process.env.ADMIN_PANEL_KEY;
  const providedKey = req.query.key || req.headers['x-admin-key'];
  if (requiredKey && providedKey !== requiredKey) return false;

  const allowedEmails = new Set(
    [
      'admin@aivorah.ai',
      'preddy6678@gmail.com',
      process.env.ADMIN_EMAIL || '',
      ...(process.env.ADMIN_EMAILS || '').split(','),
    ]
      .map((email) => String(email).toLowerCase().trim())
      .filter(Boolean),
  );

  const providedEmail = String(req.query.email || req.headers['x-admin-email'] || '').toLowerCase().trim();
  return Boolean(providedEmail && allowedEmails.has(providedEmail));
}

// ── POST /user/sync ──────────────────────────────────────
// Called on every login — upserts Firebase user into Supabase users table
// Body: { name, email, role, grade?, school?, curriculum?, location? }

router.post('/sync', async (req, res) => {
  try {
    const { name, email, role, grade, school, curriculum, location } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });

    // Build upsert patch — only include fields that are provided
    // IMPORTANT: only set name if explicitly provided; never fall back to email prefix
    // (fetchSupabaseProfile calls this with only email, and we must not overwrite a real name)
    const patch = { email: email.toLowerCase().trim(), last_active_at: new Date().toISOString() };
    if (name)       patch.name       = name;
    if (grade)      patch.grade      = grade;
    if (school)     patch.school     = school?.trim();
    if (curriculum) patch.curriculum = curriculum;
    if (location)   patch.location   = location;

    // Resolve the free-text school to a schools row so new users don't pile up
    // with school_id = null (the V1 tenant boundary is users.school_id).
    // MATCH-ONLY: never auto-create a school from arbitrary signup text — the
    // schools table already has near-duplicate noise, and only a case-insensitive
    // exact match (guaranteed unique by schools_name_lower_idx) is unambiguous.
    // No match → school_id stays untouched (null for new users).
    //
    // ONE-TIME FILL ONLY — never overwrite an existing school_id. `/user/sync`
    // runs on every login, and the client's `school` fallback (AuthContext:
    // `profile.school || 'Hyderabad International School'`) fires whenever the
    // DB's free-text `school` column happens to be empty — including for
    // school_admin accounts whose real tenant boundary is school_id, not that
    // legacy text field. Re-resolving on every login would silently reassign a
    // school_admin's scope to whatever that fallback string matches. Only fill
    // school_id when the row doesn't have one yet.
    if (patch.school) {
      try {
        const { data: existing } = await supabase
          .from('users').select('school_id').eq('email', patch.email).maybeSingle();
        if (!existing?.school_id) {
          const { data: schoolRow } = await supabase
            .from('schools').select('id')
            .ilike('name', patch.school)
            .maybeSingle();
          if (schoolRow) patch.school_id = schoolRow.id;
        }
      } catch (e) {
        console.warn('[/user/sync] school_id resolution skipped:', e.message);
      }
    }

    // If name is not provided, do a SELECT only — don't upsert
    // Upserting without name would fail the NOT NULL constraint on the name column
    const isReadOnly = !patch.name;

    let data, error;
    if (isReadOnly) {
      ({ data, error } = await supabase
        .from('users')
        .select('id, name, email, role, grade, school, school_id, curriculum, location, phone, onboarding_complete, photo_url')
        .eq('email', patch.email)
        .maybeSingle());
    } else {
      // Detect whether this upsert CREATES the row (fresh signup for this email)
      const { data: existingRow } = await supabase
        .from('users').select('id, role').eq('email', patch.email).maybeSingle();

      // Only set role on first signup (no existing row / no role yet) or when it
      // matches the existing role. This endpoint runs on EVERY login — blindly
      // writing whatever role the client happened to send silently flipped real
      // teacher/parent accounts to the wrong role whenever any call passed a
      // different one (e.g. opening a differently-roled screen with the same
      // login). An intentional role change goes through /user/add-role instead.
      if (role) {
        if (!existingRow || !existingRow.role || existingRow.role === role) {
          patch.role = role;
        } else {
          console.warn(`[/user/sync] Ignored role change for ${patch.email}: existing="${existingRow.role}" incoming="${role}"`);
        }
      }

      ({ data, error } = await supabase
        .from('users')
        .upsert(patch, { onConflict: 'email' })
        .select('id, name, email, role, grade, school, school_id, curriculum, location, phone, onboarding_complete, photo_url')
        .single());

      // Fresh signup + leftover user_preferences from a previously DELETED account:
      // its accountStatus 'active' makes the app treat the new signup as already
      // verified and silently skip "Check your inbox" (founder-reported). Reset the
      // verification state so every re-registered email verifies like a new user.
      if (!existingRow && !error) {
        const { data: pref } = await supabase
          .from('user_preferences').select('data').eq('user_email', patch.email).maybeSingle();
        if (pref?.data?.accountStatus === 'active') {
          await supabase.from('user_preferences').update({
            data: { ...pref.data, accountStatus: 'pending_verification', verifyToken: null, verifyTokenExpiry: null },
          }).eq('user_email', patch.email);
          console.log('[/user/sync] reset stale verified state for re-registered email:', patch.email);
        }
      }
    }

    if (error) {
      console.error('[/user/sync] Supabase error:', JSON.stringify(error));
      console.error('[/user/sync] patch was:', JSON.stringify(patch));
      return res.status(500).json({ error: error.message });
    }

    // No row yet — user hasn't completed signup flow
    if (!data) return res.json({ email: patch.email, onboardingComplete: false });

    // Auto-create student_stats if role is student
    if ((role === 'student' || data?.role === 'student') && data?.id) {
      await supabase.from('student_stats')
        .upsert({ student_id: data.id }, { onConflict: 'student_id', ignoreDuplicates: true });
    }

    // Pull roles + isPro from user_preferences (stored there since users table has no roles/isPro column)
    const prefs = await getPreferences(data.email);
    const rolesFromPrefs = Array.isArray(prefs?.roles) ? prefs.roles : null;

    res.json({
      id:                 data.id,
      name:               data.name,
      email:              data.email,
      role:               data.role,
      roles:              rolesFromPrefs || [data.role].filter(Boolean),
      grade:              data.grade,
      school:             data.school,
      // Authoritative B2B tenant boundary: a real school-org FK. NULL = B2C /
      // independent self-signup (no official school link). The client uses this
      // to hide school-only features (My Classes, Attendance) for B2C users.
      schoolId:           data.school_id ?? null,
      curriculum:         data.curriculum,
      location:           data.location,
      phone:              data.phone ? decrypt(data.phone) : null,
      // Trust the DB column directly. NULL means not complete (new/migrated accounts).
      onboardingComplete: data.onboarding_complete === true,
      photoUrl:           data.photo_url ?? null,
      isPro:              prefs?.isPro === true,
      // For auto-generated @aivorah.student accounts: default to true (must change) unless
      // explicitly cleared (false) after the student has changed their password.
      // For all other accounts: only true if explicitly set.
      mustChangePassword: (data.email || '').endsWith('@aivorah.student')
        ? prefs?.mustChangePassword !== false
        : prefs?.mustChangePassword === true,
      // BUG FIX (2026-07-21): this was never included even though `prefs` was
      // already fetched above — the Google SSO client-side check
      // (`profile.accountStatus === 'active'`) could therefore never see a
      // true "already verified" state, so every single Google login resent
      // the verification email instead of only the first one.
      accountStatus:      prefs?.accountStatus ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /user/profile ──────────────────────────────────
// Updates profile fields for a logged-in user — supports all roles
// Body: { email, name?, curriculum?, grade?, school?, location?,
//         dob?, gender?, teaches?, children?, phone?, onboardingStep? }

router.patch('/profile', async (req, res) => {
  try {
    const { email, name, role: bodyRole, curriculum, grade, school, location,
            dob, gender, teaches, children, phone,
            onboardingStep, complete } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });

    // Resolve role: trust body first (sent by onboarding), fall back to DB lookup.
    // This makes the student-completeness check reliable even if the DB lookup fails.
    let currentRole = bodyRole || null;
    if (!currentRole) {
      try {
        const { data: existing } = await supabase
          .from('users').select('role').eq('email', email.toLowerCase().trim()).maybeSingle();
        currentRole = existing?.role ?? null;
      } catch (_) {}
    }

    // Also store role in Supabase if provided (ensures it's always set)
    const patch = {};
    if (name)       patch.name       = name.trim();
    if (bodyRole)   patch.role       = bodyRole;
    if (curriculum) patch.curriculum = curriculum.trim();
    if (grade)      patch.grade      = grade.trim();

    // Only mark onboarding complete for students if grade + curriculum are present
    if (complete === true) {
      const resolvedGrade      = (grade      || '').trim();
      const resolvedCurriculum = (curriculum || '').trim();
      if (currentRole === 'student' && (!resolvedGrade || !resolvedCurriculum)) {
        return res.status(400).json({ error: 'Students must provide grade and curriculum to complete onboarding.' });
      }
      patch.onboarding_complete = true;
    }
    if (school)     patch.school     = school.trim();
    if (location)   patch.location   = location;
    if (phone)      patch.phone      = encrypt(phone.trim());
    // Store onboarding step for resume capability
    if (onboardingStep != null) patch.onboarding_step = onboardingStep;

    const emailLc = email.toLowerCase().trim();

    // Only hit the users table if there is something to update there
    let data = null;
    let error = null;

    if (Object.keys(patch).length > 0) {
      // First try update; if no row matched (new signup flow), upsert instead
      ({ data, error } = await supabase
        .from('users')
        .update(patch)
        .eq('email', emailLc)
        .select('id, name, email, role, grade, school, curriculum, location, phone, onboarding_complete')
        .single());

      if (error && error.code === 'PGRST116') {
        // PGRST116 = no rows returned — user row doesn't exist yet, upsert it
        ({ data, error } = await supabase
          .from('users')
          .upsert({ email: emailLc, ...patch }, { onConflict: 'email' })
          .select('id, name, email, role, grade, school, curriculum, location, phone, onboarding_complete')
          .single());
      }

      if (error) return res.status(500).json({ error: error.message });
    } else {
      // No users-table fields to update — just fetch existing row for the response
      const { data: existing } = await supabase
        .from('users')
        .select('id, name, email, role, grade, school, curriculum, location, phone, onboarding_complete')
        .eq('email', emailLc)
        .maybeSingle();
      data = existing;
    }

    // Store teacher teaches[] in preferences file (no extra table needed)
    if (teaches && Array.isArray(teaches)) {
      await setPreferences(email, { teaches, updatedAt: new Date().toISOString() });
    }

    // Store parent children[] in preferences file
    if (children && Array.isArray(children)) {
      await setPreferences(email, { children, ...(phone ? { phone: encrypt(phone) } : {}), updatedAt: new Date().toISOString() });
      // parent_children linking (by child_id) is handled separately via POST /parent/:email/children/create-student
    }

    // Store extra fields (dob, gender, phone) in preferences — dob + phone are encrypted
    if (dob || gender || phone) {
      const updates = { updatedAt: new Date().toISOString() };
      if (dob)    updates.dob    = dob;
      if (gender) updates.gender = gender;
      if (phone)  updates.phone  = encrypt(phone);
      await setPreferences(email, updates);
    }

    // ── Auto-link teacher ↔ students by curriculum + grade ────────────────
    // Matches on both curriculum AND grade so a Grade-3 student is only linked
    // to teachers whose teaches[] includes Grade 3, not every teacher in the curriculum.
    try {
      const userRole = data.role;
      const userCurriculum = data.curriculum;
      const userGrade = data.grade;
      const userId = data.id;

      if (userId && userCurriculum && userGrade) {
        if (userRole === 'student') {
          // Get all teachers in this curriculum
          const { data: allTeachers } = await supabase
            .from('users')
            .select('id, email')
            .eq('role', 'teacher')
            .eq('curriculum', userCurriculum);

          // Filter to teachers whose teaches[] includes this student's grade
          const allPrefs = (allTeachers && allTeachers.length > 0) ? await readPreferences() : {};
          const matchingTeachers = (allTeachers ?? []).filter(t => {
            const tp = allPrefs[t.email] ?? {};
            if (Array.isArray(tp.teaches) && tp.teaches.length > 0) {
              return tp.teaches.some(tg => tg.curriculum === userCurriculum && tg.grade === userGrade);
            }
            return false;
          });

          if (matchingTeachers.length > 0) {
            const ids = matchingTeachers.map(t => t.id);
            await supabase.from('teacher_student')
              .delete()
              .eq('student_id', userId)
              .not('teacher_id', 'in', `(${ids.join(',')})`);
            const rows = ids.map(tid => ({ teacher_id: tid, student_id: userId, subject: userCurriculum }));
            await supabase.from('teacher_student').upsert(rows, { onConflict: 'teacher_id,student_id', ignoreDuplicates: true });
          }

        } else if (userRole === 'teacher') {
          // Use teaches[] from request body (set during onboarding), fall back to single grade
          const teacherGrades = Array.isArray(teaches) && teaches.length > 0
            ? teaches
            : [{ grade: userGrade, curriculum: userCurriculum }];

          // Find all students matching any of the teacher's grade+curriculum combos
          const { data: allStudents } = await supabase
            .from('users')
            .select('id, grade, curriculum')
            .eq('role', 'student');

          const matchingStudents = (allStudents ?? []).filter(s =>
            s.curriculum && s.grade &&
            teacherGrades.some(tg => tg.curriculum === s.curriculum && tg.grade === s.grade)
          );

          if (matchingStudents.length > 0) {
            const ids = matchingStudents.map(s => s.id);
            await supabase.from('teacher_student')
              .delete()
              .eq('teacher_id', userId)
              .not('student_id', 'in', `(${ids.join(',')})`);
            const rows = ids.map(sid => ({ teacher_id: userId, student_id: sid, subject: userCurriculum }));
            await supabase.from('teacher_student').upsert(rows, { onConflict: 'teacher_id,student_id', ignoreDuplicates: true });
          }
        }
      }
    } catch (_) { /* non-blocking — don't fail onboarding */ }

    res.json({
      id:                 data.id,
      name:               data.name,
      email:              data.email,
      role:               data.role,
      grade:              data.grade,
      school:             data.school,
      curriculum:         data.curriculum,
      location:           data.location,
      phone:              data.phone ? decrypt(data.phone) : null,
      onboardingComplete: data.onboarding_complete,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /user/upload-photo ──────────────────────────────
// Uploads a profile photo to Cloudinary and saves URL to users table
// Body: { userEmail, base64, mimeType }

router.post('/upload-photo', async (req, res) => {
  try {
    const { userEmail, base64, mimeType = 'image/jpeg' } = req.body;
    if (!userEmail) return res.status(400).json({ error: 'userEmail required' });
    if (!base64)    return res.status(400).json({ error: 'base64 image required' });

    const dataUri = `data:${mimeType};base64,${base64}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      folder:         'aivorah/profiles',
      public_id:      userEmail.replace(/[@.]/g, '_'),
      overwrite:      true,
      transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
    });

    const photoUrl = result.secure_url;
    await supabase.from('users').update({ photo_url: photoUrl }).eq('email', userEmail.toLowerCase().trim());

    res.json({ photoUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /user/preferences ────────────────────────────────────────────────
// Stores student preference responses for reporting/export.
// Body: { email, name?, role?, grade?, curriculum?, school?, location?,
//         avatarStyle?, learningStyle?, interests?, bio?, photoUrl? }
router.patch('/preferences', async (req, res) => {
  try {
    const {
      email,
      name,
      role,
      grade,
      curriculum,
      school,
      location,
      avatarStyle,
      learningStyle,
      interests,
      bio,
      photoUrl,
      pushNotifications,
      aiSuggestions,
      weeklyReport,
      assignmentAlerts,
      challengeUpdates,
      // Teacher enforced settings
      autoGrading,
      shareProgress,
      // Additional onboarding fields (previously dropped)
      gender,
      dob,
      mobile,
      phone,
      mobileVerified,
      state,
      country,
      // Teacher onboarding fields
      teacherRole,
      experience,
    } = req.body ?? {};

    if (!email) return res.status(400).json({ error: 'email required' });

    const patch = {};
    if (name != null) patch.name = String(name);
    if (role != null) patch.role = String(role);
    if (grade != null) patch.grade = String(grade);
    if (curriculum != null) patch.curriculum = String(curriculum);
    if (school != null) patch.school = String(school);
    if (location != null) patch.location = String(location);
    if (avatarStyle != null) patch.avatarStyle = String(avatarStyle);
    if (learningStyle != null) patch.learningStyle = String(learningStyle);
    if (bio != null) patch.bio = String(bio);
    if (photoUrl != null) patch.photoUrl = String(photoUrl);
    if (interests != null) {
      patch.interests = Array.isArray(interests)
        ? interests.map((x) => String(x))
        : String(interests)
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean);
    }

    if (pushNotifications != null) patch.pushNotifications = Boolean(pushNotifications);
    if (aiSuggestions != null) patch.aiSuggestions = Boolean(aiSuggestions);
    if (weeklyReport != null) patch.weeklyReport = Boolean(weeklyReport);
    if (assignmentAlerts != null) patch.assignmentAlerts = Boolean(assignmentAlerts);
    if (challengeUpdates != null) patch.challengeUpdates = Boolean(challengeUpdates);
    // Teacher enforced settings (read server-side to gate grading & parent score sharing)
    if (autoGrading != null)  patch.autoGrading  = Boolean(autoGrading);
    if (shareProgress != null) patch.shareProgress = Boolean(shareProgress);

    // Additional onboarding fields — store in the preferences jsonb so nothing is dropped.
    if (gender != null)  patch.gender  = String(gender);
    if (dob != null)     patch.dob     = String(dob);
    if (state != null)   patch.state   = String(state);
    if (country != null) patch.country = String(country);
    if (teacherRole != null) patch.teacherRole = String(teacherRole);
    if (experience != null)  patch.experience  = String(experience);
    const phoneVal = phone ?? mobile;
    if (phoneVal != null) patch.phone = encrypt(String(phoneVal));
    if (mobileVerified != null) patch.mobileVerified = Boolean(mobileVerified);
    const { roles, activeRole } = req.body ?? {};
    if (Array.isArray(roles) && roles.length > 0) patch.roles = roles;
    if (activeRole != null) patch.activeRole = String(activeRole);

    patch.updatedAt = new Date().toISOString();
    await setPreferences(email, patch);

    // Also persist grade / location / phone to the users table so they survive re-login
    const usersPatch = {};
    if (grade != null) usersPatch.grade = String(grade);
    if (curriculum != null) usersPatch.curriculum = String(curriculum);
    if (location != null) usersPatch.location = String(location);
    if (phoneVal != null) usersPatch.phone = encrypt(String(phoneVal));
    if (Object.keys(usersPatch).length > 0) {
      await supabase.from('users').update(usersPatch).eq('email', email.toLowerCase().trim());
    }

    const saved = await getPreferences(email);
    if (saved?.phone) saved.phone = decrypt(saved.phone);
    res.json({ ok: true, preference: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /user/preferences?email=... ────────────────────────────────────────
router.get('/preferences', async (req, res) => {
  try {
    const email = req.query.email ? String(req.query.email).toLowerCase().trim() : '';
    if (!email) return res.json({}); // don't expose all records
    const rec = await getPreferences(email);
    if (rec?.phone) rec.phone = decrypt(rec.phone);
    res.json(rec ?? null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /user/preferences/export.csv ───────────────────────────────────────
// Download all captured preference responses for Excel.
router.get('/preferences/export.csv', async (req, res) => {
  try {
    if (!hasAdminExportAccess(req)) {
      return res.status(403).json({ error: 'Unauthorized admin export access' });
    }
    const all = await readPreferences();
    const rows = Object.values(all)
      .map((raw) => { const item = raw; return ({
        email: item.email ?? item.emailHash ?? '',
        name: item.name ?? '',
        role: item.role ?? '',
        grade: item.grade ?? '',
        curriculum: item.curriculum ?? '',
        school: item.school ?? '',
        location: item.location ?? '',
        avatarStyle: item.avatarStyle ?? '',
        learningStyle: item.learningStyle ?? '',
        interests: Array.isArray(item.interests) ? item.interests.join('|') : item.interests ?? '',
        bio: item.bio ?? '',
        photoUrl: item.photoUrl ?? '',
        createdAt: item.createdAt ?? '',
        updatedAt: item.updatedAt ?? '',
      }); })
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

    const headers = [
      'email',
      'name',
      'role',
      'grade',
      'curriculum',
      'school',
      'location',
      'avatarStyle',
      'learningStyle',
      'interests',
      'bio',
      'photoUrl',
      'createdAt',
      'updatedAt',
    ];

    const csv = toCsv(rows, headers);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="student_preferences_${date}.csv"`);
    res.status(200).send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /user/repair-teacher-student ───────────────────────
// Rebuilds teacher_student by curriculum + grade.
// Teacher teaches[] grades come from preferences file; student grade from users table.

router.post('/repair-teacher-student', async (req, res) => {
  try {
    // Fetch all users with grade info
    const { data: allUsers, error } = await supabase
      .from('users')
      .select('id, email, role, curriculum, grade')
      .in('role', ['teacher', 'student']);

    if (error) return res.status(500).json({ error: error.message });

    const teachers = allUsers.filter(u => u.role === 'teacher');
    const students = allUsers.filter(u => u.role === 'student' && u.curriculum);

    // Read teacher preferences to get their teaches[] (grade+curriculum combos)
    const prefs = await readPreferences();

    // Build teacher → [{ grade, curriculum }] map
    // Fall back to teacher's own grade/curriculum if no teaches[] in prefs
    function getTeacherGrades(teacher) {
      const pref = prefs[teacher.email] || {};
      if (Array.isArray(pref.teaches) && pref.teaches.length > 0) return pref.teaches;
      if (teacher.curriculum && teacher.grade) return [{ grade: teacher.grade, curriculum: teacher.curriculum }];
      return [];
    }

    // Delete all existing links and rebuild
    await supabase.from('teacher_student').delete().neq('teacher_id', '00000000-0000-0000-0000-000000000000');

    const rows = [];
    for (const teacher of teachers) {
      const teacherGrades = getTeacherGrades(teacher);
      if (teacherGrades.length === 0) continue;

      for (const student of students) {
        const matches = teacherGrades.some(tg =>
          tg.curriculum === student.curriculum && tg.grade === student.grade
        );
        if (matches) {
          rows.push({ teacher_id: teacher.id, student_id: student.id, subject: student.curriculum });
        }
      }
    }

    if (rows.length > 0) {
      const { error: insertErr } = await supabase.from('teacher_student').insert(rows);
      if (insertErr) return res.status(500).json({ error: insertErr.message });
    }

    // Return summary for verification
    const summary = teachers.map(t => ({
      teacher: t.email,
      teaches: getTeacherGrades(t),
      linkedStudents: rows.filter(r => r.teacher_id === t.id).length,
    }));

    res.json({ fixed: rows.length, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /user/role?email= ─────────────────────────────────────
// Returns the registered role for an email (used on signup to show helpful error)
router.get('/role', async (req, res) => {
  const email = (req.query.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'email required' });
  const { data, error } = await supabase.from('users').select('role').eq('email', email).maybeSingle();
  if (error || !data) return res.status(404).json({ error: 'User not found' });
  res.json({ role: data.role });
});

// OTP codes (email verification + recovery) are stored in Supabase via
// services/otpStore so they work across multiple Cloud Run instances.

// ── Generic email-verification OTP (used to verify a child's email inline) ────
router.post('/email-otp/send', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = req.body?.name ? String(req.body.name) : 'there';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await otpStore.setOtp(email, 'email_verify', { otp });
    const { sendEmailOtpCode } = require('../services/mailer');
    await sendEmailOtpCode({ to: email, otp, name });
    res.json({ ok: true });
  } catch (err) {
    console.error('[email-otp/send]', err.message);
    res.status(500).json({ error: 'Could not send the verification code. Please try again.' });
  }
});

router.post('/email-otp/verify', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '').trim();
    const stored = await otpStore.getOtp(email, 'email_verify');
    if (!stored) return res.status(400).json({ error: 'No code requested. Please send a code first.' });
    if (Date.now() > stored.expiresAt) {
      await otpStore.deleteOtp(email, 'email_verify');
      return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    }
    if (stored.otp !== otp) return res.status(400).json({ error: 'Incorrect code. Please try again.' });
    await otpStore.deleteOtp(email, 'email_verify');
    res.json({ verified: true });
  } catch (err) {
    console.error('[email-otp/verify]', err.message);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

// ── Change email address ──────────────────────────────────────────────
// Reuses the same 'email_verify' OTP purpose as above: the client must first
// call POST /email-otp/send with the NEW email so the owner proves they can
// receive mail there, then submits that code here alongside the account they
// want to rename. Identity of the CURRENT account is confirmed client-side
// before this call (password reauth, or Google popup reauth for SSO users —
// there is no password to check for those, so the UI must not require one).
// This single call verifies the OTP and propagates the rename everywhere the
// email is used as a lookup key: the `users` table, every email-keyed table
// (no FK — `user_email`/`student_email`/`parent_email` columns), and both
// auth providers (Supabase Auth + Firebase Auth), so no side of the system is
// left pointing at the old address.
router.post('/change-email', async (req, res) => {
  try {
    const currentEmail = String(req.body?.currentEmail || '').trim().toLowerCase();
    const newEmail     = String(req.body?.newEmail || '').trim().toLowerCase();
    const otp          = String(req.body?.otp || '').trim();
    if (!currentEmail || !newEmail || !otp) {
      return res.status(400).json({ error: 'currentEmail, newEmail and otp are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (newEmail === currentEmail) {
      return res.status(400).json({ error: 'New email must be different from your current one.' });
    }

    const { data: taken } = await supabase.from('users').select('id').eq('email', newEmail).maybeSingle();
    if (taken) return res.status(409).json({ error: 'That email is already in use by another account.' });

    const stored = await otpStore.getOtp(newEmail, 'email_verify');
    if (!stored) return res.status(400).json({ error: 'No code requested for that email. Please send a code first.' });
    if (Date.now() > stored.expiresAt) {
      await otpStore.deleteOtp(newEmail, 'email_verify');
      return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    }
    if (stored.otp !== otp) return res.status(400).json({ error: 'Incorrect code. Please try again.' });
    await otpStore.deleteOtp(newEmail, 'email_verify');

    const { data: updated, error } = await supabase
      .from('users')
      .update({ email: newEmail })
      .eq('email', currentEmail)
      .select('id, name, email, role')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    // Best-effort: propagate to every other email-keyed table so nothing is
    // silently orphaned under the old address. None of these block the response —
    // the identity rename (above) is the part that must succeed.
    const emailKeyedTables = [
      ['user_preferences',    'user_email'],
      ['student_preferences', 'user_email'],
      ['analytics_events',    'user_email'],
      ['habits_checkins',     'user_email'],
      ['llm_logs',            'student_email'],
    ];
    for (const [table, col] of emailKeyedTables) {
      await supabase.from(table).update({ [col]: newEmail }).eq(col, currentEmail)
        .then(({ error: e }) => { if (e) console.error(`[change-email] ${table}.${col}:`, e.message); });
    }
    await supabase.from('parent_children').update({ parent_email: newEmail }).eq('parent_email', currentEmail)
      .then(({ error: e }) => { if (e) console.error('[change-email] parent_children.parent_email:', e.message); });

    // Supabase Auth (if this user also has a password-based Supabase Auth account)
    try {
      const { data: authList } = await supabase.auth.admin.listUsers();
      const authUser = authList?.users?.find(u => u.email === currentEmail);
      if (authUser) {
        await supabase.auth.admin.updateUserById(authUser.id, { email: newEmail, email_confirm: true });
      }
    } catch (e) {
      console.error('[change-email] supabase auth update failed:', e.message);
    }

    // Firebase Auth — updated via Admin SDK so this works uniformly for both
    // password and Google-SSO accounts (no client-side reauth token needed here;
    // ownership of newEmail was already proven by the OTP above).
    try {
      if (firebaseAdmin) {
        const fbUser = await firebaseAdmin.auth().getUserByEmail(currentEmail);
        await firebaseAdmin.auth().updateUser(fbUser.uid, { email: newEmail, emailVerified: true });
      }
    } catch (e) {
      console.error('[change-email] firebase auth update failed:', e.message);
    }

    res.json({ ok: true, user: updated });
  } catch (err) {
    console.error('[change-email]', err.message);
    res.status(500).json({ error: 'Could not update your email. Please try again.' });
  }
});

// ── Mobile-number OTP verification via Fast2SMS (India only — 10-digit
// numbers). Mirrors the email-otp pattern above, same otpStore backing so
// it works across multiple Cloud Run instances. ────────────────────────
router.post('/mobile-otp/send', async (req, res) => {
  try {
    const digits = String(req.body?.mobile || '').replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) {
      return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
    }
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await otpStore.setOtp(digits, 'mobile_verify', { otp });
    const { sendMobileOtpSms } = require('../services/sms');
    await sendMobileOtpSms({ to: digits, otp });
    res.json({ ok: true });
  } catch (err) {
    console.error('[mobile-otp/send]', err.message);
    res.status(500).json({ error: 'Could not send the verification code. Please try again.' });
  }
});

router.post('/mobile-otp/verify', async (req, res) => {
  try {
    const digits = String(req.body?.mobile || '').replace(/\D/g, '').slice(-10);
    const otp = String(req.body?.otp || '').trim();
    const stored = await otpStore.getOtp(digits, 'mobile_verify');
    if (!stored) return res.status(400).json({ error: 'No code requested. Please send a code first.' });
    if (Date.now() > stored.expiresAt) {
      await otpStore.deleteOtp(digits, 'mobile_verify');
      return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    }
    if (stored.otp !== otp) return res.status(400).json({ error: 'Incorrect code. Please try again.' });
    await otpStore.deleteOtp(digits, 'mobile_verify');
    res.json({ verified: true });
  } catch (err) {
    console.error('[mobile-otp/verify]', err.message);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

// ── POST /user/recovery-email/send-code ──────────────────────
// Generates a 6-digit OTP and emails it to the recovery address
router.post('/recovery-email/send-code', async (req, res) => {
  try {
    const { email, recoveryEmail } = req.body;
    if (!email || !recoveryEmail) return res.status(400).json({ error: 'email and recoveryEmail required' });

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await otpStore.setOtp(email.trim().toLowerCase(), 'recovery', {
      otp,
      recoveryEmail: recoveryEmail.trim().toLowerCase(),
    });

    // Send OTP to the recovery email
    const { sendRecoveryOtpEmail } = require('../services/mailer');
    await sendRecoveryOtpEmail({ to: recoveryEmail.trim().toLowerCase(), otp });

    res.json({ ok: true });
  } catch (err) {
    console.error('[recovery-email/send-code]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /user/recovery-email ───────────────────────────────
// Verifies OTP then saves recovery email + sends confirmation
router.patch('/recovery-email', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'email and otp required' });

    const emailLc = email.trim().toLowerCase();
    const stored = await otpStore.getOtp(emailLc, 'recovery');
    if (!stored) return res.status(400).json({ error: 'No pending verification. Please request a new code.' });
    if (Date.now() > stored.expiresAt) {
      await otpStore.deleteOtp(emailLc, 'recovery');
      return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    }
    if (stored.otp !== String(otp).trim()) {
      return res.status(400).json({ error: 'Incorrect code. Please try again.' });
    }

    // OTP valid — save recovery email
    await otpStore.deleteOtp(emailLc, 'recovery');
    const recoveryEmail = stored.recoveryEmail;
    await setPreferences(emailLc, { recoveryEmail });

    // Fetch name for confirmation email
    const { data } = await supabase.from('users').select('name').eq('email', emailLc).maybeSingle();

    // Send confirmation to the recovery email
    sendRecoveryEmailConfirmation({
      to: recoveryEmail,
      accountEmail: emailLc,
      accountName: data?.name || '',
    }).catch(() => {});

    res.json({ ok: true, recoveryEmail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /user/clear-must-change-password ───────────────────
// Called after a student changes their auto-generated password for the first time
router.patch('/clear-must-change-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    await setPreferences(email, { mustChangePassword: false });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /user/add-role ─────────────────────────────────────
// Adds a second role to an existing user (e.g. teacher → teacher+parent)
// Body: { email, role }  where role is the role to ADD
router.patch('/add-role', async (req, res) => {
  const { email, role } = req.body;
  if (!email || !role) return res.status(400).json({ error: 'email and role required' });

  const allowed = ['teacher', 'parent', 'student'];
  if (!allowed.includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const emailLc = email.toLowerCase().trim();

  // Fetch current user row to get primary role
  const { data: user, error: fetchErr } = await supabase
    .from('users').select('id, role').eq('email', emailLc).maybeSingle();
  if (fetchErr || !user) return res.status(404).json({ error: 'User not found' });

  // Build new roles array — always start from primary role in users table, merge with prefs
  const existingPrefs = await getPreferences(emailLc);
  const primaryRole = user.role; // ground truth from users table
  const prefsRoles = Array.isArray(existingPrefs?.roles) ? existingPrefs.roles : [];
  // Union: primary role + any prefs roles + the new role being added
  const merged = Array.from(new Set([primaryRole, ...prefsRoles, role]));

  await setPreferences(emailLc, { ...existingPrefs, roles: merged });

  res.json({ ok: true, roles: merged });
});

// ── POST /user/welcome-email ─────────────────────────────────────────────────
router.post('/welcome-email', async (req, res) => {
  try {
    const { email, name, role } = req.body;
    if (!email || !name || !role) return res.status(400).json({ error: 'email, name, role required' });
    await sendWelcomeEmail({ to: email, name, role });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /user/send-password-reset ───────────────────────────────────────────
// Generates Firebase password reset link and sends it from aivorah24@gmail.com
router.post('/send-password-reset', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const emailLc = email.trim().toLowerCase();

    const { frontendOrigin } = req.body;
    const appBase = frontendOrigin || 'https://aivorah.ai';
    let resetLink = null;

    // Synthetic student logins (@aivorah.student) have no real inbox — the
    // Firebase credential lives on that email, but the reset email must be
    // delivered to the parent's real address.
    let deliverTo = emailLc;
    let childName = null;
    if (emailLc.endsWith('@aivorah.student')) {
      const { data: childUser } = await supabase
        .from('users').select('id, name').eq('email', emailLc).maybeSingle();
      if (childUser?.id) {
        const { data: link } = await supabase
          .from('parent_children').select('parent_email').eq('child_id', childUser.id).maybeSingle();
        if (link?.parent_email) {
          deliverTo = link.parent_email.toLowerCase();
          childName = childUser.name || 'your child';
        }
      }
      if (deliverTo === emailLc) {
        // No parent on file — nothing deliverable; don't leak existence.
        console.warn('[send-password-reset] student account with no parent email:', emailLc);
        return res.json({ ok: true, note: 'no_recipient' });
      }
    }

    // 1. Try Firebase Admin SDK if service account is available
    if (firebaseAdmin) {
      try {
        const actionCodeSettings = {
          url: `${appBase}/reset-password`,
          handleCodeInApp: false, // link opens in browser, not app
        };
        resetLink = await firebaseAdmin.auth().generatePasswordResetLink(emailLc, actionCodeSettings);
      } catch (adminErr) {
        if (adminErr.code === 'auth/user-not-found') return res.json({ ok: true });
        console.warn('[send-password-reset] admin err:', adminErr.message);
      }
    }

    // 2. Try Firebase REST API with returnOobLink (requires admin; may not work without service account)
    if (!resetLink) {
      const fbRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${process.env.FIREBASE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: emailLc, returnOobLink: true }),
        }
      );
      const fbData = await fbRes.json();
      if (fbData.oobLink) {
        resetLink = fbData.oobLink;
      } else if (fbData.error?.message === 'EMAIL_NOT_FOUND') {
        return res.json({ ok: true }); // don't expose user enumeration
      } else {
        // returnOobLink not available without admin — fall back to Firebase sending its own email
        console.warn('[send-password-reset] returnOobLink not available, using Firebase default sender');
        await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${process.env.FIREBASE_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: emailLc }),
          }
        );
        return res.json({ ok: true, note: 'firebase_fallback' });
      }
    }

    // Point the link at OUR themed /reset-password page instead of Firebase's
    // generic firebaseapp.com action page. Firebase's link carries the oobCode
    // as a query param — extract it and rebuild against the Aivorah frontend.
    let themedLink = resetLink;
    try {
      const oob = new URL(resetLink).searchParams.get('oobCode');
      if (oob) themedLink = `${appBase}/reset-password?oobCode=${encodeURIComponent(oob)}`;
    } catch (_) { /* keep original link if parsing fails */ }

    // 3. Send branded email from aivorah24@gmail.com (to parent for student accounts)
    await sendPasswordResetEmail({ to: deliverTo, resetLink: themedLink, childName });
    res.json({ ok: true });
  } catch (err) {
    console.error('[send-password-reset]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /user/send-verification ─────────────────────────────────────────────
// Generates a branded verification email from aivorah24@gmail.com (not Firebase spam)
router.post('/send-verification', async (req, res) => {
  try {
    const { email, name, frontendOrigin } = req.body;
    if (!email || !name) return res.status(400).json({ error: 'email and name required' });

    // Store token in user_preferences.data
    const { data: existing } = await supabase
      .from('user_preferences')
      .select('data')
      .eq('user_email', email.toLowerCase())
      .maybeSingle();

    const currentData = existing?.data || {};

    // Idempotency guard (regression fix, 2026-07-20): an already-active account
    // must never be resent a verification email or downgraded back to
    // pending_verification. Without this, any caller that races ahead of a
    // fresh accountStatus read (e.g. the client re-checking on every SSO
    // login) silently re-parks a verified user in "pending" state.
    if (currentData.accountStatus === 'active') {
      return res.json({ ok: true, alreadyVerified: true });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    await supabase.from('user_preferences').upsert({
      user_email: email.toLowerCase(),
      data: { ...currentData, verifyToken: token, verifyTokenExpiry: expiry, accountStatus: 'pending_verification' },
    }, { onConflict: 'user_email' });

    const serverBase = `${req.protocol}://${req.get('host')}`;
    const appBase = frontendOrigin || 'https://aivorah.ai';
    const redirect = encodeURIComponent(appBase + '/verify-success');
    const encodedEmail = encodeURIComponent(email.toLowerCase());
    const fullVerifyUrl = `${serverBase}/user/verify/${token}?email=${encodedEmail}&redirect=${redirect}`;

    // Generate a short code and store the full URL so we can send a clean /v/:code link
    const shortCode = crypto.randomBytes(5).toString('hex'); // 10-char hex
    const expiresAt = new Date(expiry).toISOString();
    await supabase.from('short_links').insert({ code: shortCode, url: fullVerifyUrl, expires_at: expiresAt });
    const verifyUrl = `${serverBase}/v/${shortCode}`;

    await sendVerificationEmail({ to: email, name, verifyUrl });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /user/verify/:token ───────────────────────────────────────────────────
// Called when user clicks the verification link in the email
router.get('/verify/:token', async (req, res) => {
  const { token } = req.params;
  const email = (req.query.email || '').toLowerCase();
  const appRedirect = req.query.redirect || 'https://aivorah.ai/verify-success';

  // Always redirect back to the app — pass ?verified=1 or ?error=1 so app can react
  const successUrl = appRedirect.includes('?') ? `${appRedirect}&verified=1` : `${appRedirect}?verified=1`;
  const errorUrl   = appRedirect.includes('?') ? `${appRedirect}&error=1`    : `${appRedirect}?error=1`;

  try {
    if (!email) {
      console.warn('[verify] no email param');
      return res.redirect(errorUrl);
    }

    // Look up by email (primary key) — no JSONB scanning
    const { data: pref, error: fetchErr } = await supabase
      .from('user_preferences')
      .select('data')
      .eq('user_email', email)
      .maybeSingle();

    console.log('[verify]', email, '| token match:', pref?.data?.verifyToken === token, '| fetchErr:', fetchErr?.message);

    if (fetchErr || !pref) {
      return res.redirect(errorUrl);
    }

    // Token already consumed (cleared after first verification) — this happens
    // when an email client (e.g. Apple Mail Privacy Protection, Outlook Safe
    // Links) pre-fetches the link before the user taps it, which verifies the
    // account on the first hit. If the account is already active, treat any
    // later hit on the same link as a success too, not an error.
    if (pref.data?.verifyToken !== token) {
      if (pref.data?.accountStatus === 'active') {
        return res.redirect(successUrl);
      }
      return res.redirect(errorUrl);
    }

    const meta = pref.data || {};
    if (meta.verifyTokenExpiry && Date.now() > meta.verifyTokenExpiry) {
      return res.redirect(errorUrl);
    }

    // Mark verified — clear token, set active
    await supabase.from('user_preferences').upsert({
      user_email: email,
      data: { ...meta, accountStatus: 'active', verifyToken: null, verifyTokenExpiry: null },
    }, { onConflict: 'user_email' });

    console.log('[verify] ✅ verified:', email);
    res.redirect(successUrl);
  } catch (err) {
    console.error('[verify] unexpected error:', err);
    res.redirect(errorUrl);
  }
});

function errorPage(msg) {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f0f0f">
    <div style="text-align:center;padding:40px">
      <div style="font-size:48px;margin-bottom:16px">⚠️</div>
      <h2 style="color:#ef4444;font-size:20px;margin-bottom:8px">${msg}</h2>
      <p style="color:#888;font-size:14px">Go back to the app and click "Resend Email" to get a new link.</p>
    </div></body></html>`;
}

// ── GET /user/check-verified ──────────────────────────────────────────────────
// Returns accountStatus for a given email — used by VerifyEmailScreen
router.get('/check-verified', async (req, res) => {
  try {
    const email = (req.query.email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'email required' });

    const { data: pref } = await supabase
      .from('user_preferences')
      .select('data')
      .eq('user_email', email)
      .maybeSingle();

    const accountStatus = pref?.data?.accountStatus || null;
    res.json({ verified: accountStatus === 'active', accountStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /user/set-pro ──────────────────────────────────────────────────────
// Admin-only: toggle isPro flag for a user (controls premium feature access)
// Body: { email, isPro: true/false, adminEmail }
router.patch('/set-pro', async (req, res) => {
  try {
    const { email, isPro, adminEmail } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    if (typeof isPro !== 'boolean') return res.status(400).json({ error: 'isPro must be true or false' });

    // Verify admin access
    if (!hasAdminExportAccess({ query: { email: adminEmail }, headers: req.headers })) {
      return res.status(403).json({ error: 'Unauthorized — admin access required' });
    }

    const emailLc = email.toLowerCase().trim();
    await setPreferences(emailLc, { isPro });

    res.json({ ok: true, email: emailLc, isPro });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /user/delete-account ──────────────────────────────
// Permanently deletes all user data from Supabase (Firebase deletion is done client-side)
router.delete('/delete-account', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const emailLc = email.trim().toLowerCase();

    // Delete from all tables in order (child links first, then main records)
    await supabase.from('parent_children').delete().eq('parent_email', emailLc);
    await supabase.from('parent_children').delete().eq('child_email', emailLc);
    await supabase.from('student_stats').delete().eq('student_id',
      (await supabase.from('users').select('id').eq('email', emailLc).maybeSingle())?.data?.id || ''
    );
    await supabase.from('user_preferences').delete().eq('user_email', emailLc);
    await supabase.from('users').delete().eq('email', emailLc);

    // Also delete the Firebase Auth account via the Admin SDK so the account is
    // fully removed regardless of sign-in provider (password OR Google SSO) — the
    // client can't always reauthenticate (e.g. SSO users have no password).
    try {
      const admin = require('firebase-admin');
      if (admin.apps && admin.apps.length) {
        const fbUser = await admin.auth().getUserByEmail(emailLc).catch(() => null);
        if (fbUser) await admin.auth().deleteUser(fbUser.uid);
      }
    } catch (fbErr) {
      console.warn('[delete-account] firebase delete skipped:', fbErr.message);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[delete-account]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /user/push-token ──────────────────────────────────────────────────
// Mobile app registers its Expo push token here so the server can notify this
// user. Tokens are kept in user_preferences.data.expoPushTokens (deduped array).
router.post('/push-token', async (req, res) => {
  try {
    const { email, token } = req.body ?? {};
    if (!email || !token) return res.status(400).json({ error: 'email and token required' });
    if (!String(token).startsWith('ExponentPushToken')) {
      return res.status(400).json({ error: 'invalid expo push token' });
    }
    const existing = await getPreferences(email);
    const current = Array.isArray(existing?.expoPushTokens) ? existing.expoPushTokens : [];
    const merged = [...new Set([...current, String(token)])].slice(-10); // cap stored devices
    await setPreferences(email, { expoPushTokens: merged, updatedAt: new Date().toISOString() });
    res.json({ ok: true, devices: merged.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// B2C → B2B conversion bridge (Connect to My School)
// ---------------------------------------------------------------------------

// GET /user/schools — public, minimal school list for the "Connect to My School"
// picker (id + name only). No auth: it exposes nothing sensitive and any
// signed-in B2C user needs it to pick their school.
router.get('/schools', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('schools').select('id, name').order('name');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[GET /user/schools] error:', err.message);
    res.status(500).json({ error: 'Failed to load schools' });
  }
});

// GET /user/school-structure?schoolId= — public: the grades (and their sections)
// defined at a school, for the "Connect to My School" grade/section dropdowns.
// Archived grades/sections are excluded. Read-only, non-sensitive.
router.get('/school-structure', async (req, res) => {
  const schoolId = req.query.schoolId;
  if (!schoolId) return res.status(400).json({ error: 'schoolId is required' });
  try {
    const { buildGradesSectionsView } = require('../services/academicStructure');
    const grades = await buildGradesSectionsView(schoolId);
    const out = (grades || [])
      .filter((g) => !g.archived)
      .map((g) => ({
        name: g.name,
        sections: (g.sections || []).filter((s) => !s.archived).map((s) => s.name),
      }));
    // Include the school's base curriculum (IB / CBSE / ...) so the client can
    // group grades by programme (e.g. IB → PYP / MYP / DP) in pickers.
    const { data: school } = await supabase.from('schools').select('curriculum').eq('id', schoolId).maybeSingle();
    res.json({ grades: out, curriculum: school?.curriculum || null });
  } catch (err) {
    console.error('[GET /user/school-structure] error:', err.message);
    res.status(500).json({ error: 'Failed to load school grades' });
  }
});

// POST /user/request-school-access  { email, schoolId, grade?, section? }
// A B2C user asks to join an official school. Records a pending request for a
// School Admin to approve — does NOT link the account itself (approval does).
router.post('/request-school-access', async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  const schoolId = req.body?.schoolId;
  const grade = req.body?.grade ? String(req.body.grade).trim() : null;
  const section = req.body?.section ? String(req.body.section).trim() : null;
  const parentEmail = req.body?.parentEmail ? String(req.body.parentEmail).toLowerCase().trim() : null;
  if (!email || !schoolId) return res.status(400).json({ error: 'email and schoolId are required' });
  try {
    const { data: u } = await supabase
      .from('users').select('id, school_id').eq('email', email).maybeSingle();
    if (!u) return res.status(404).json({ error: 'Account not found' });

    if (parentEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) {
      await supabase.from('parent_children').upsert({
        parent_email: parentEmail,
        child_id: u.id,
      }, { onConflict: 'parent_email,child_id' }).catch((e) => console.warn('[request-school-access] parent link warning:', e.message));

      const { data: pref } = await supabase.from('user_preferences').select('data').eq('user_email', email).maybeSingle();
      await supabase.from('user_preferences').upsert({
        user_email: email,
        data: { ...(pref?.data || {}), parentConsentStatus: 'parent_action_required' },
      }).catch(() => {});
    }

    // Check if the user already has a formally approved B2B access request
    const { data: approvedReq } = await supabase
      .from('school_access_requests')
      .select('id, school_id, status')
      .eq('user_email', email)
      .eq('status', 'approved')
      .maybeSingle();
    if (approvedReq) {
      return res.status(409).json({ error: 'Your account is already verified and linked to an official school.' });
    }

    // Verify the school exists (avoids orphan requests / FK errors).
    const { data: school } = await supabase
      .from('schools').select('id, name').eq('id', schoolId).maybeSingle();
    if (!school) return res.status(404).json({ error: 'School not found' });

    // De-dupe / update: if a pending request already exists, update grade/section if provided, and return success.
    const { data: existing } = await supabase
      .from('school_access_requests')
      .select('id').eq('user_email', email).eq('school_id', schoolId).eq('status', 'pending').maybeSingle();
    if (existing) {
      if (grade || section) {
        await supabase.from('school_access_requests').update({ grade, section }).eq('id', existing.id);
      }
      return res.json({ ok: true, status: 'pending', schoolName: school.name });
    }

    const { error } = await supabase.from('school_access_requests').insert({
      user_email: email, school_id: schoolId, grade, section, status: 'pending',
    });
    if (error) throw error;
    res.status(201).json({ ok: true, status: 'pending', schoolName: school.name });
  } catch (err) {
    console.error('[POST /user/request-school-access] error:', err.message);
    res.status(500).json({ error: 'Failed to submit request. Please try again.' });
  }
});

module.exports = router;
