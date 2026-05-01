const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const cloudinary = require('cloudinary').v2;
const supabase   = require('../services/supabase');
const { encrypt, decrypt } = require('../utils/encryption');
const { sendWelcomeEmail, sendVerificationEmail, sendPasswordResetEmail } = require('../services/mailer');

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
      'kannansaimohan2003@gmail.com',
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
    const patch = { email: email.toLowerCase().trim() };
    if (name)       patch.name       = name;
    if (role)       patch.role       = role;
    if (grade)      patch.grade      = grade;
    if (school)     patch.school     = school?.trim();
    if (curriculum) patch.curriculum = curriculum;
    if (location)   patch.location   = location;

    // If name is not provided, do a SELECT only — don't upsert
    // Upserting without name would fail the NOT NULL constraint on the name column
    const isReadOnly = !patch.name;

    let data, error;
    if (isReadOnly) {
      ({ data, error } = await supabase
        .from('users')
        .select('id, name, email, role, grade, school, curriculum, location, phone, onboarding_complete, photo_url')
        .eq('email', patch.email)
        .maybeSingle());
    } else {
      ({ data, error } = await supabase
        .from('users')
        .upsert(patch, { onConflict: 'email' })
        .select('id, name, email, role, grade, school, curriculum, location, phone, onboarding_complete, photo_url')
        .single());
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

    // Pull roles from user_preferences (stored there since users table has no roles column)
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
      curriculum:         data.curriculum,
      location:           data.location,
      phone:              data.phone ?? null,
      onboardingComplete: data.onboarding_complete,
      photoUrl:           data.photo_url ?? null,
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
    if (phone)      patch.phone      = phone.trim();
    // Store onboarding step for resume capability
    if (onboardingStep != null) patch.onboarding_step = onboardingStep;

    const emailLc = email.toLowerCase().trim();

    // First try update; if no row matched (new signup flow), upsert instead
    let { data, error } = await supabase
      .from('users')
      .update(patch)
      .eq('email', emailLc)
      .select('id, name, email, role, grade, school, curriculum, location, phone, onboarding_complete')
      .single();

    if (error && error.code === 'PGRST116') {
      // PGRST116 = no rows returned — user row doesn't exist yet, upsert it
      ({ data, error } = await supabase
        .from('users')
        .upsert({ email: emailLc, ...patch }, { onConflict: 'email' })
        .select('id, name, email, role, grade, school, curriculum, location, phone, onboarding_complete')
        .single());
    }

    if (error) return res.status(500).json({ error: error.message });

    // Store teacher teaches[] in preferences file (no extra table needed)
    if (teaches && Array.isArray(teaches)) {
      await setPreferences(email, { teaches, updatedAt: new Date().toISOString() });
    }

    // Store parent children[] in preferences file
    if (children && Array.isArray(children)) {
      await setPreferences(email, { children, ...(phone ? { phone } : {}), updatedAt: new Date().toISOString() });
      // parent_children linking (by child_id) is handled separately via POST /parent/:email/children/create-student
    }

    // Store extra fields (dob, gender, phone) in preferences — dob + phone are encrypted
    if (dob || gender || phone) {
      const updates = { updatedAt: new Date().toISOString() };
      if (dob)    updates.dob    = dob;
      if (gender) updates.gender = gender;
      if (phone)  updates.phone  = phone;
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
      phone:              data.phone ?? null,
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

    patch.updatedAt = new Date().toISOString();
    await setPreferences(email, patch);
    const saved = await getPreferences(email);

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

    // 3. Send branded email from aivorah24@gmail.com
    await sendPasswordResetEmail({ to: emailLc, resetLink });
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

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    // Store token in user_preferences.data
    const { data: existing } = await supabase
      .from('user_preferences')
      .select('data')
      .eq('user_email', email.toLowerCase())
      .maybeSingle();

    const currentData = existing?.data || {};
    await supabase.from('user_preferences').upsert({
      user_email: email.toLowerCase(),
      data: { ...currentData, verifyToken: token, verifyTokenExpiry: expiry, accountStatus: 'pending_verification' },
    }, { onConflict: 'user_email' });

    const serverBase = `${req.protocol}://${req.get('host')}`;
    const appBase = frontendOrigin || 'https://aivorah.ai';
    const redirect = encodeURIComponent(appBase + '/verify-success');
    const encodedEmail = encodeURIComponent(email.toLowerCase());
    // Include email in URL so verify endpoint can look up by PK (reliable, no JSONB scan needed)
    const verifyUrl = `${serverBase}/user/verify/${token}?email=${encodedEmail}&redirect=${redirect}`;

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

    if (fetchErr || !pref || pref.data?.verifyToken !== token) {
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

module.exports = router;
