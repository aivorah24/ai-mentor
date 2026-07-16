/**
 * "My Classes" — read-only, role-aware view of a user's homeroom class(es),
 * surfacing data that already exists (users.grade/section + the
 * classTeacherEmail already assignable via SchoolAdminClassesScreen) to
 * student/parent/teacher, none of whom could see it before.
 *
 * Identity: same trust model as routes/announcements.js — no session/token
 * layer, a client-supplied email is looked up server-side for role/school_id
 * (never trusted directly). This is why the route lives here rather than
 * under /school-admin: that router's requireAdminScope middleware only
 * accepts global/school_admin/teacher scopes and would 403 students/parents.
 */
const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');
const { buildGradesSectionsView } = require('../services/academicStructure');

async function getUserContext(email) {
  if (!email) return null;
  const { data, error } = await supabase
    .from('users')
    .select('id, role, school_id, email, name, grade, section')
    .eq('email', String(email).toLowerCase().trim())
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function resolveTeacherName(email) {
  if (!email) return null;
  const { data } = await supabase.from('users').select('name').eq('email', email).maybeSingle();
  return data?.name || null;
}

// Finds the merged grade/section entry (with classTeacherEmail + live
// studentCount) for one grade+section pair, reusing the same merge the
// School Admin console already relies on.
function findSection(grades, grade, section) {
  const g = grades.find((x) => String(x.name).trim() === String(grade || '').trim());
  if (!g) return null;
  const s = g.sections.find((x) => String(x.name).trim() === String(section || '').trim());
  if (!s) return null;
  return { grade: g.name, section: s.name, classTeacherEmail: s.classTeacherEmail, studentCount: s.studentCount };
}

async function classCard(schoolId, grade, section) {
  if (!schoolId || !grade) return null;
  const grades = await buildGradesSectionsView(schoolId);
  const found = findSection(grades, grade, section);
  if (!found) return null;
  return {
    grade: found.grade,
    section: found.section,
    label: `${found.grade} Homeroom`,
    code: section ? `${found.grade}${found.section}` : found.grade,
    classTeacherEmail: found.classTeacherEmail,
    classTeacherName: await resolveTeacherName(found.classTeacherEmail),
    studentCount: found.studentCount,
  };
}

// GET /classes/mine?email=
router.get('/mine', async (req, res) => {
  const email = req.query.email;
  try {
    const userCtx = await getUserContext(email);
    if (!userCtx) return res.status(404).json({ error: 'User not found' });
    if (!userCtx.school_id) return res.json({ classes: [] });

    if (userCtx.role === 'student') {
      const card = await classCard(userCtx.school_id, userCtx.grade, userCtx.section);
      return res.json({ classes: card ? [card] : [] });
    }

    if (userCtx.role === 'parent') {
      const { data: kids, error } = await supabase
        .from('parent_children')
        .select('child_id, users!parent_children_child_id_fkey(id, name, grade, section)')
        .eq('parent_email', userCtx.email);
      if (error) throw error;
      const grades = await buildGradesSectionsView(userCtx.school_id);
      const classes = [];
      for (const row of kids || []) {
        const child = row.users;
        if (!child?.grade) continue;
        const found = findSection(grades, child.grade, child.section);
        if (!found) continue;
        classes.push({
          grade: found.grade,
          section: found.section,
          label: `${found.grade} Homeroom`,
          code: found.section ? `${found.grade}${found.section}` : found.grade,
          classTeacherEmail: found.classTeacherEmail,
          classTeacherName: await resolveTeacherName(found.classTeacherEmail),
          studentCount: found.studentCount,
          studentId: child.id,
          studentName: child.name,
        });
      }
      return res.json({ classes });
    }

    if (userCtx.role === 'teacher') {
      const grades = await buildGradesSectionsView(userCtx.school_id);
      const classes = [];
      for (const g of grades) {
        for (const s of g.sections) {
          if (s.classTeacherEmail && s.classTeacherEmail.toLowerCase() === userCtx.email.toLowerCase()) {
            classes.push({
              grade: g.name,
              section: s.name,
              label: `${g.name} Homeroom`,
              code: s.name ? `${g.name}${s.name}` : g.name,
              classTeacherEmail: s.classTeacherEmail,
              classTeacherName: userCtx.name || null,
              studentCount: s.studentCount,
            });
          }
        }
      }
      return res.json({ classes });
    }

    res.json({ classes: [] });
  } catch (err) {
    console.error('[GET /classes/mine] error:', err.message);
    res.status(500).json({ error: 'Failed to load classes' });
  }
});

module.exports = router;
