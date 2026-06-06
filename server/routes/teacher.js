const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { randomUUID, randomInt } = require('crypto');
const { sendCredentialsEmail } = require('../services/mailer');
const multer   = require('multer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function toTitleCase(str) {
  return String(str || '').replace(/\b\w/g, c => c.toUpperCase());
}

function generateSecurePassword() {
  const groups = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
    '#@$%&*?',
  ];
  const all = groups.join('');
  const chars = groups.map(g => g[randomInt(g.length)]);
  while (chars.length < 12) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function generateStudentLoginId(name) {
  const slug = String(name || 'student')
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '') || 'student';
  return `${slug}.${Date.now()}${randomInt(1000, 9999)}@aivorah.student`;
}

// ── POST /teacher/students/init-auth ──────────────────────────────────────────
// Generate login credentials for a new student — call BEFORE creating Firebase account.
// Body: { name, email?, password? }
router.post('/students/init-auth', async (req, res) => {
  try {
    const { name, email, password: customPassword } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    const emailProvided = Boolean(email && String(email).trim());
    const cleanEmail = emailProvided
      ? String(email).toLowerCase().trim()
      : generateStudentLoginId(name);

    // Check for duplicate
    const { data: existing } = await supabase.from('users').select('id').eq('email', cleanEmail).maybeSingle();
    if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

    const trimmed = customPassword && String(customPassword).trim();
    const password = (trimmed && trimmed.length >= 6) ? trimmed : generateSecurePassword();

    res.json({ success: true, email: cleanEmail, password, emailProvided });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /teacher/:teacherEmail/students/link-created ─────────────────────────
// After the frontend creates the Firebase account, call this to:
//   - save the student to the users table
//   - link them to this teacher in teacher_student
//   - store credentials in user_preferences
// Body: { firebaseUid, name, email, grade, curriculum, school?, studentId?, initialPassword? }
router.post('/:teacherEmail/students/link-created', async (req, res) => {
  try {
    const { teacherEmail } = req.params;
    const { firebaseUid, name, email, grade, curriculum, school = '', studentId, initialPassword } = req.body || {};

    if (!firebaseUid || !name || !email || !grade || !curriculum) {
      return res.status(400).json({ error: 'firebaseUid, name, email, grade, curriculum are required' });
    }

    const cleanEmail        = String(email).toLowerCase().trim();
    const cleanTeacherEmail = String(teacherEmail).toLowerCase().trim();
    const resolvedStudentId = String(studentId || '').trim() || `STU-${Date.now()}`;
    const newId             = randomUUID();

    // 1. Upsert student in users table
    const { data: existingUser } = await supabase.from('users').select('id').eq('email', cleanEmail).maybeSingle();
    const userId = existingUser?.id || newId;

    const { error: userErr } = await supabase.from('users').upsert({
      id: userId,
      name: toTitleCase(String(name).trim()),
      email: cleanEmail,
      role: 'student',
      grade,
      curriculum,
      school: String(school || '').trim(),
      onboarding_complete: true,
    }, { onConflict: 'id' });
    if (userErr) return res.status(500).json({ error: userErr.message });

    // 2. Init student stats row
    await supabase.from('student_stats')
      .upsert({ student_id: userId }, { onConflict: 'student_id', ignoreDuplicates: true });

    // 3. Find teacher and link
    const { data: teacher } = await supabase.from('users').select('id').eq('email', cleanTeacherEmail).maybeSingle();
    if (!teacher) return res.status(404).json({ error: 'Teacher account not found.' });

    await supabase.from('teacher_student').upsert({
      teacher_id: teacher.id,
      student_id: userId,
      subject: curriculum,
    }, { onConflict: 'teacher_id,student_id,subject', ignoreDuplicates: true });

    // 4. Save preferences (credentials + meta)
    const { data: existingPrefs } = await supabase.from('user_preferences').select('data').eq('user_email', cleanEmail).maybeSingle();
    const merged = {
      ...(existingPrefs?.data ?? {}),
      studentId: resolvedStudentId,
      createdByTeacher: cleanTeacherEmail,
      accountStatus: 'active',
      firebaseUid,
      activatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(initialPassword ? { initialPassword, passwordSavedAt: new Date().toISOString() } : {}),
    };
    await supabase.from('user_preferences').upsert(
      { user_email: cleanEmail, data: merged, updated_at: new Date().toISOString() },
      { onConflict: 'user_email' }
    );

    // Email credentials to teacher
    await sendCredentialsEmail({
      to: cleanTeacherEmail,
      childName: toTitleCase(String(name).trim()),
      loginId: cleanEmail,
      password: initialPassword || undefined,
      studentId: resolvedStudentId,
    });

    res.json({
      success: true,
      student: {
        id: userId,
        studentId: resolvedStudentId,
        name: toTitleCase(String(name).trim()),
        email: cleanEmail,
        grade,
        curriculum,
        school: String(school || '').trim(),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /teacher/:teacherEmail/students/:studentId ────────────────────────
// Unlink a student from this teacher's class.
router.delete('/:teacherEmail/students/:studentId', async (req, res) => {
  try {
    const cleanTeacherEmail = String(req.params.teacherEmail).toLowerCase().trim();
    const studentId = req.params.studentId;

    const { data: teacher } = await supabase.from('users').select('id').eq('email', cleanTeacherEmail).maybeSingle();
    if (!teacher) return res.status(404).json({ error: 'Teacher not found.' });

    const { error } = await supabase
      .from('teacher_student')
      .delete()
      .eq('teacher_id', teacher.id)
      .eq('student_id', studentId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /teacher/:teacherEmail/students/link-existing ────────────────────────
// Link an existing Aivorah student (by their email) to this teacher's class.
// Body: { studentEmail }
router.post('/:teacherEmail/students/link-existing', async (req, res) => {
  try {
    const { teacherEmail } = req.params;
    const { studentEmail } = req.body || {};

    if (!studentEmail) return res.status(400).json({ error: 'studentEmail is required' });

    const cleanTeacherEmail = String(teacherEmail).toLowerCase().trim();
    const cleanStudentEmail = String(studentEmail).toLowerCase().trim();

    // Find teacher
    const { data: teacher } = await supabase.from('users').select('id').eq('email', cleanTeacherEmail).maybeSingle();
    if (!teacher) return res.status(404).json({ error: 'Teacher not found.' });

    // Find student
    const { data: student } = await supabase
      .from('users')
      .select('id, name, email, grade, curriculum')
      .eq('email', cleanStudentEmail)
      .eq('role', 'student')
      .maybeSingle();
    if (!student) return res.status(404).json({ error: 'No student found with that email. Make sure they have an Aivorah account.' });

    // Link
    const { error } = await supabase.from('teacher_student').upsert({
      teacher_id: teacher.id,
      student_id: student.id,
      subject: student.curriculum || 'General',
    }, { onConflict: 'teacher_id,student_id,subject', ignoreDuplicates: true });
    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true, student });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helpers for bulk import ───────────────────────────────────────────────────

function parseCSV(text) {
  // Strip BOM if present (Excel UTF-8 files)
  const clean = text.replace(/^﻿/, '');
  const lines = clean.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = [];
    let inQuote = false, cur = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        cols.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    rows.push(cols);
  }
  return rows;
}

async function createFirebaseAccount(email, password) {
  const apiKey = process.env.FIREBASE_API_KEY;
  if (!apiKey) throw new Error('FIREBASE_API_KEY not set on server');
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: false }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || 'Firebase signup failed';
    throw new Error(msg);
  }
  return data.localId; // Firebase UID
}

// ── POST /teacher/:teacherEmail/students/bulk-import ─────────────────────────
// Accepts multipart/form-data with a 'csv' file field.
// CSV columns (case-insensitive, order-independent):
//   Name (required), Email (optional), Grade, Curriculum, School
// Optional body fields: defaultGrade, defaultCurriculum
router.post('/:teacherEmail/students/bulk-import', upload.single('csv'), async (req, res) => {
  try {
    const { teacherEmail } = req.params;
    const defaultGrade      = (req.body?.defaultGrade      || 'Grade 3').trim();
    const defaultCurriculum = (req.body?.defaultCurriculum || 'IB PYP').trim();

    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded.' });

    const cleanTeacherEmail = String(teacherEmail).toLowerCase().trim();
    const { data: teacher } = await supabase.from('users').select('id').eq('email', cleanTeacherEmail).maybeSingle();
    if (!teacher) return res.status(404).json({ error: 'Teacher account not found.' });

    const csvText = req.file.buffer.toString('utf-8');
    const rows = parseCSV(csvText);
    if (rows.length < 2) return res.status(400).json({ error: 'CSV must have a header row and at least one student row.' });

    // Map header columns
    const header = rows[0].map(h => h.toLowerCase().replace(/[^a-z]/g, ''));
    const col = (name) => header.indexOf(name);
    const nameIdx       = col('name');
    const emailIdx      = col('email');
    const gradeIdx      = col('grade');
    const curriculumIdx = col('curriculum');
    const schoolIdx     = col('school');

    if (nameIdx === -1) return res.status(400).json({ error: 'CSV must have a "Name" column.' });

    const results = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rawName = row[nameIdx]?.trim() || '';
      if (!rawName) continue;

      const cleanName   = toTitleCase(rawName);
      const emailRaw    = emailIdx >= 0 ? (row[emailIdx]?.trim() || '') : '';
      const grade       = gradeIdx >= 0 && row[gradeIdx]?.trim() ? row[gradeIdx].trim() : defaultGrade;
      const curriculum  = curriculumIdx >= 0 && row[curriculumIdx]?.trim() ? row[curriculumIdx].trim() : defaultCurriculum;
      const school      = schoolIdx >= 0 ? (row[schoolIdx]?.trim() || '') : '';
      const studentEmail = emailRaw ? emailRaw.toLowerCase() : generateStudentLoginId(cleanName);

      try {
        // Skip duplicates
        const { data: dup } = await supabase.from('users').select('id').eq('email', studentEmail).maybeSingle();
        if (dup) {
          results.push({ name: cleanName, email: studentEmail, grade, curriculum, status: 'skipped', error: 'Email already exists' });
          continue;
        }

        const password = generateSecurePassword();

        // Create Firebase account server-side via REST API
        const firebaseUid = await createFirebaseAccount(studentEmail, password);

        // Save to Supabase
        const userId = randomUUID();
        const resolvedStudentId = `STU-${Date.now()}-${randomInt(1000, 9999)}`;

        const { error: userErr } = await supabase.from('users').upsert({
          id: userId, name: cleanName, email: studentEmail, role: 'student',
          grade, curriculum, school, onboarding_complete: true,
        }, { onConflict: 'id' });
        if (userErr) throw new Error(userErr.message);

        await supabase.from('student_stats').upsert({ student_id: userId }, { onConflict: 'student_id', ignoreDuplicates: true });

        await supabase.from('teacher_student').upsert({
          teacher_id: teacher.id, student_id: userId, subject: curriculum,
        }, { onConflict: 'teacher_id,student_id,subject', ignoreDuplicates: true });

        await supabase.from('user_preferences').upsert({
          user_email: studentEmail,
          data: {
            studentId: resolvedStudentId, createdByTeacher: cleanTeacherEmail,
            accountStatus: 'active', firebaseUid,
            activatedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            initialPassword: password, passwordSavedAt: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_email' });

        // Email credentials to teacher
        sendCredentialsEmail({ to: cleanTeacherEmail, childName: cleanName, loginId: studentEmail, password, studentId: resolvedStudentId });

        results.push({ name: cleanName, email: studentEmail, password, studentId: resolvedStudentId, grade, curriculum, status: 'created' });
      } catch (rowErr) {
        results.push({ name: cleanName, email: studentEmail, grade, curriculum, status: 'error', error: rowErr.message });
      }
    }

    const created = results.filter(r => r.status === 'created').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const errors  = results.filter(r => r.status === 'error').length;

    res.json({ success: true, summary: { created, skipped, errors, total: results.length }, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
