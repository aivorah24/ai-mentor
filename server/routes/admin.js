const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const supabase = require('../services/supabase');

const PREFS_FILE = path.join(__dirname, '../data/student_preferences.json');

function getAllowedAdminEmails() {
  const list = [
    'kannansaimohan2003@gmail.com',
    'preddy6678@gmail.com',
    process.env.ADMIN_EMAIL || '',
    ...(process.env.ADMIN_EMAILS || '').split(','),
  ];
  return new Set(
    list
      .map((email) => String(email).toLowerCase().trim())
      .filter(Boolean),
  );
}

function requireAdminAccess(req, res, next) {
  const requiredKey = process.env.ADMIN_PANEL_KEY;
  const providedKey = req.query.key || req.headers['x-admin-key'];
  if (requiredKey && providedKey !== requiredKey) {
    return res.status(401).json({ error: 'Unauthorized admin key' });
  }

  const providedEmail = String(req.query.email || req.headers['x-admin-email'] || '').toLowerCase().trim();
  const allowed = getAllowedAdminEmails();
  if (!providedEmail || !allowed.has(providedEmail)) {
    return res.status(403).json({ error: 'Unauthorized admin email' });
  }
  req.adminEmail = providedEmail;
  next();
}

router.use(requireAdminAccess);

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

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows, headers) {
  const head = headers.map(csvCell).join(',');
  const body = rows.map((row) => headers.map((h) => csvCell(row[h])).join(',')).join('\n');
  return `${head}\n${body}`;
}

router.get('/panel', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-panel.html'));
});

router.get('/overview', async (_req, res) => {
  try {
    const [usersRes, statsRes, parentLinksRes, teacherLinksRes, prefs] = await Promise.all([
      supabase.from('users').select('id, name, email, role, grade, curriculum, school, location, onboarding_complete, photo_url'),
      supabase.from('student_stats').select('student_id, xp_points, level, current_streak, study_time_minutes, completed_topics, last_lesson, updated_at'),
      supabase.from('parent_children').select('parent_email, child_id, added_at'),
      supabase.from('teacher_student').select('teacher_id, student_id, subject'),
      readPreferences(),
    ]);

    if (usersRes.error) return res.status(500).json({ error: usersRes.error.message });
    if (statsRes.error) return res.status(500).json({ error: statsRes.error.message });
    if (parentLinksRes.error) return res.status(500).json({ error: parentLinksRes.error.message });
    if (teacherLinksRes.error) return res.status(500).json({ error: teacherLinksRes.error.message });

    const users = usersRes.data ?? [];
    const studentStats = statsRes.data ?? [];
    const parentLinks = parentLinksRes.data ?? [];
    const teacherLinks = teacherLinksRes.data ?? [];

    const statsByStudentId = {};
    for (const s of studentStats) statsByStudentId[s.student_id] = s;

    const usersById = {};
    const usersByEmail = {};
    for (const u of users) {
      usersById[u.id] = u;
      if (u.email) usersByEmail[String(u.email).toLowerCase()] = u;
    }

    const parentChildrenByEmail = {};
    for (const link of parentLinks) {
      const email = String(link.parent_email || '').toLowerCase();
      if (!email) continue;
      if (!parentChildrenByEmail[email]) parentChildrenByEmail[email] = [];
      const child = usersById[link.child_id];
      parentChildrenByEmail[email].push({
        childId: link.child_id,
        childName: child?.name ?? '',
        childEmail: child?.email ?? '',
        childGrade: child?.grade ?? '',
        addedAt: link.added_at ?? '',
      });
    }

    const teacherStudentsById = {};
    for (const link of teacherLinks) {
      if (!teacherStudentsById[link.teacher_id]) teacherStudentsById[link.teacher_id] = [];
      const student = usersById[link.student_id];
      teacherStudentsById[link.teacher_id].push({
        studentId: link.student_id,
        studentName: student?.name ?? '',
        studentEmail: student?.email ?? '',
        studentGrade: student?.grade ?? '',
        subject: link.subject ?? '',
      });
    }

    const students = users
      .filter((u) => u.role === 'student')
      .map((u) => {
        const stats = statsByStudentId[u.id] ?? {};
        const pref = prefs[String(u.email || '').toLowerCase()] ?? {};
        const parentEmails = parentLinks
          .filter((p) => p.child_id === u.id)
          .map((p) => p.parent_email);
        const teacherIds = teacherLinks
          .filter((t) => t.student_id === u.id)
          .map((t) => t.teacher_id);

        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          grade: u.grade,
          curriculum: u.curriculum,
          school: u.school,
          location: u.location,
          onboardingComplete: u.onboarding_complete,
          photoUrl: u.photo_url,
          xpPoints: stats.xp_points ?? 0,
          level: stats.level ?? 1,
          currentStreak: stats.current_streak ?? 0,
          studyTimeMinutes: stats.study_time_minutes ?? 0,
          completedTopicsCount: Array.isArray(stats.completed_topics) ? stats.completed_topics.length : 0,
          lastLesson: stats.last_lesson ?? '',
          avatarStyle: pref.avatarStyle ?? '',
          learningStyle: pref.learningStyle ?? '',
          interests: Array.isArray(pref.interests) ? pref.interests : [],
          bio: pref.bio ?? '',
          parentEmails,
          teacherIds,
          updatedAt: stats.updated_at ?? pref.updatedAt ?? '',
        };
      });

    const teachers = users
      .filter((u) => u.role === 'teacher')
      .map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        school: u.school,
        location: u.location,
        assignedStudents: teacherStudentsById[u.id] ?? [],
        totalAssignedStudents: (teacherStudentsById[u.id] ?? []).length,
      }));

    const parents = users
      .filter((u) => u.role === 'parent')
      .map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        school: u.school,
        location: u.location,
        children: parentChildrenByEmail[String(u.email || '').toLowerCase()] ?? [],
        totalChildren: (parentChildrenByEmail[String(u.email || '').toLowerCase()] ?? []).length,
      }));

    res.json({
      counts: {
        users: users.length,
        students: students.length,
        teachers: teachers.length,
        parents: parents.length,
        preferencesCaptured: Object.keys(prefs).length,
      },
      students,
      teachers,
      parents,
      rawPreferences: prefs,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/export/students.csv', async (_req, res) => {
  try {
    const usersRes = await supabase.from('users').select('id, name, email, role, grade, curriculum, school, location').eq('role', 'student');
    const statsRes = await supabase.from('student_stats').select('student_id, xp_points, level, current_streak, study_time_minutes, completed_topics, last_lesson, updated_at');
    const prefs = await readPreferences();

    if (usersRes.error) return res.status(500).json({ error: usersRes.error.message });
    if (statsRes.error) return res.status(500).json({ error: statsRes.error.message });

    const statsById = {};
    for (const s of statsRes.data ?? []) statsById[s.student_id] = s;

    const rows = (usersRes.data ?? []).map((u) => {
      const s = statsById[u.id] ?? {};
      const pref = prefs[String(u.email || '').toLowerCase()] ?? {};
      return {
        name: u.name ?? '',
        email: u.email ?? '',
        grade: u.grade ?? '',
        curriculum: u.curriculum ?? '',
        school: u.school ?? '',
        location: u.location ?? '',
        xpPoints: s.xp_points ?? 0,
        level: s.level ?? 1,
        streak: s.current_streak ?? 0,
        studyTimeMinutes: s.study_time_minutes ?? 0,
        completedTopicsCount: Array.isArray(s.completed_topics) ? s.completed_topics.length : 0,
        lastLesson: s.last_lesson ?? '',
        avatarStyle: pref.avatarStyle ?? '',
        learningStyle: pref.learningStyle ?? '',
        interests: Array.isArray(pref.interests) ? pref.interests.join('|') : '',
        bio: pref.bio ?? '',
        updatedAt: s.updated_at ?? pref.updatedAt ?? '',
      };
    });

    const headers = [
      'name',
      'email',
      'grade',
      'curriculum',
      'school',
      'location',
      'xpPoints',
      'level',
      'streak',
      'studyTimeMinutes',
      'completedTopicsCount',
      'lastLesson',
      'avatarStyle',
      'learningStyle',
      'interests',
      'bio',
      'updatedAt',
    ];

    const csv = toCsv(rows, headers);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="admin_students_${date}.csv"`);
    res.status(200).send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
