const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const fs         = require('fs');
const path       = require('path');
const cloudinary = require('cloudinary').v2;
const supabase   = require('../services/supabase');
const { encrypt, decrypt, hashEmail } = require('../utils/encryption');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const PREFS_FILE = path.join(__dirname, '../data/student_preferences.json');

// ── Sensitive fields encrypted at rest in the JSON file ──────────────
const ENCRYPTED_FIELDS = ['dob', 'phone'];

function encryptRecord(record) {
  const out = { ...record };
  for (const field of ENCRYPTED_FIELDS) {
    if (out[field]) out[field] = encrypt(out[field]);
  }
  return out;
}

function decryptRecord(record) {
  if (!record) return record;
  const out = { ...record };
  for (const field of ENCRYPTED_FIELDS) {
    if (out[field]) out[field] = decrypt(out[field]);
  }
  return out;
}

async function readPreferences() {
  try {
    const raw = await fs.promises.readFile(PREFS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writePreferences(data) {
  await fs.promises.mkdir(path.dirname(PREFS_FILE), { recursive: true });
  await fs.promises.writeFile(PREFS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/** Get a single user's preferences, decrypted. Looks up by email hash with fallback to plain email key (migration). */
async function getPreferences(email) {
  const all  = await readPreferences();
  const key  = hashEmail(email);
  const plain = email.toLowerCase().trim();
  const rec  = all[key] ?? all[plain] ?? null;
  return decryptRecord(rec);
}

/** Write a single user's preferences, using hashed key + encrypted sensitive fields. */
async function setPreferences(email, updates) {
  const all   = await readPreferences();
  const key   = hashEmail(email);
  const plain = email.toLowerCase().trim();

  // Migrate from plain-email key if it exists
  const existing = all[key] ?? all[plain] ?? { emailHash: key };
  if (all[plain] && !all[key]) delete all[plain]; // remove old plaintext key

  const merged = { ...decryptRecord(existing), ...updates, emailHash: key };
  all[key] = encryptRecord(merged);
  await writePreferences(all);
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
    if (school)     patch.school     = school.trim();
    if (curriculum) patch.curriculum = curriculum;
    if (location)   patch.location   = location;

    const { data, error } = await supabase
      .from('users')
      .upsert(patch, { onConflict: 'email' })
      .select('id, name, email, role, grade, school, curriculum, location, onboarding_complete, photo_url')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Auto-create student_stats if role is student
    if ((role === 'student' || data?.role === 'student') && data?.id) {
      await supabase.from('student_stats')
        .upsert({ student_id: data.id }, { onConflict: 'student_id', ignoreDuplicates: true });
    }

    res.json({
      id:                 data.id,
      name:               data.name,
      email:              data.email,
      role:               data.role,
      grade:              data.grade,
      school:             data.school,
      curriculum:         data.curriculum,
      location:           data.location,
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
    const { email, name, curriculum, grade, school, location,
            dob, gender, teaches, children, phone,
            onboardingStep, complete } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });

    const patch = {};
    if (complete === true) patch.onboarding_complete = true;
    if (name)       patch.name       = name.trim();
    if (curriculum) patch.curriculum = curriculum;
    if (grade)      patch.grade      = grade;
    if (school)     patch.school     = school.trim();
    if (location)   patch.location   = location;
    // Store onboarding step for resume capability
    if (onboardingStep != null) patch.onboarding_step = onboardingStep;

    const { data, error } = await supabase
      .from('users')
      .update(patch)
      .eq('email', email.toLowerCase().trim())
      .select('id, name, email, role, grade, school, curriculum, location, onboarding_complete')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Store teacher teaches[] in preferences file (no extra table needed)
    if (teaches && Array.isArray(teaches)) {
      await setPreferences(email, { teaches, updatedAt: new Date().toISOString() });
    }

    // Store parent children[] in preferences file
    if (children && Array.isArray(children)) {
      await setPreferences(email, { children, ...(phone ? { phone } : {}), updatedAt: new Date().toISOString() });

      // Also upsert parent_children rows in Supabase
      const emailLower = email.toLowerCase().trim();
      for (const child of children) {
        if (!child.email) continue;
        await supabase.from('parent_children').upsert({
          parent_email: emailLower,
          child_email:  child.email.toLowerCase().trim(),
          child_name:   child.name || '',
          child_grade:  child.grade || '',
          child_curriculum: child.curriculum || '',
        }, { onConflict: 'parent_email,child_email', ignoreDuplicates: false }).catch(() => {});
      }
    }

    // Store extra fields (dob, gender, phone) in preferences — dob + phone are encrypted
    if (dob || gender || phone) {
      const updates = { updatedAt: new Date().toISOString() };
      if (dob)    updates.dob    = dob;
      if (gender) updates.gender = gender;
      if (phone)  updates.phone  = phone;
      await setPreferences(email, updates);
    }

    // ── Auto-link teacher ↔ students by curriculum ─────────────
    // When onboarding completes (or curriculum/grade set), keep teacher_student in sync.
    try {
      const userRole = data.role;
      const userCurriculum = data.curriculum;
      const userId = data.id;

      if (userId && userCurriculum) {
        if (userRole === 'student') {
          // Find all teachers with matching curriculum and link this student to them
          const { data: teachers } = await supabase
            .from('users')
            .select('id')
            .eq('role', 'teacher')
            .eq('curriculum', userCurriculum);

          if (teachers && teachers.length > 0) {
            // Remove any existing wrong-curriculum links for this student
            const teacherIds = teachers.map(t => t.id);
            await supabase.from('teacher_student')
              .delete()
              .eq('student_id', userId)
              .not('teacher_id', 'in', `(${teacherIds.join(',')})`);

            // Upsert correct links
            const rows = teachers.map(t => ({ teacher_id: t.id, student_id: userId, subject: userCurriculum }));
            await supabase.from('teacher_student').upsert(rows, { onConflict: 'teacher_id,student_id', ignoreDuplicates: true });
          }

        } else if (userRole === 'teacher') {
          // Find all students with matching curriculum and link them to this teacher
          const { data: students } = await supabase
            .from('users')
            .select('id')
            .eq('role', 'student')
            .eq('curriculum', userCurriculum);

          if (students && students.length > 0) {
            // Remove any existing wrong-curriculum students linked to this teacher
            const studentIds = students.map(s => s.id);
            await supabase.from('teacher_student')
              .delete()
              .eq('teacher_id', userId)
              .not('student_id', 'in', `(${studentIds.join(',')})`);

            // Upsert correct links
            const rows = students.map(s => ({ teacher_id: userId, student_id: s.id, subject: userCurriculum }));
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
      .map((raw) => { const item = decryptRecord(raw); return ({
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
    const prefsPath = path.join(__dirname, '../data/student_preferences.json');
    let prefs = {};
    try { prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8')); } catch (_) {}

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

module.exports = router;
