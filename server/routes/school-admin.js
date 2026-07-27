/**
 * School Admin Console API (V1): school-scoped dashboard counts + read-only
 * people roster. All scoping happens in the DATABASE QUERY, derived from the
 * authenticated admin's users.school_id via services/adminScope.js — never
 * from client-supplied school ids. A TSRA admin can never receive School B
 * rows because school_id is injected server-side into every query.
 *
 * Global admins (super_admin/allowlist) may pass ?schoolId= to inspect a
 * specific school; school_admins cannot override their own scope.
 */
const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const supabase = require('../services/supabase');
const { requireAdminScope } = require('../services/adminScope');
const {
  generateSecurePassword, generateStudentEmail, generateStaffEmail, generateParentLoginId, createFirebaseAccount,
  toTitleCase, generateAdmissionNumber,
} = require('../services/studentAccounts');
const { sendCredentialsEmail, sendOwnAccountCredentialsEmail, sendB2BConversionWelcomeEmail } = require('../services/mailer');
const { sortGradeNames, sortCurriculumNames } = require('../services/academicStructure');

router.use(requireAdminScope);

// Resolves which school this request is allowed to operate on.
function effectiveSchoolId(req) {
  if (req.adminScope.scopeType === 'school') return req.adminScope.schoolId;
  return req.query.schoolId || null; // global admin may choose; null = needs explicit pick
}

// A school's stored `curriculum` is a BASE type (IB / CBSE / ICSE /
// Cambridge / ...), not a flat value — IB in particular spans PYP (Grade
// 1-5), MYP (Grade 6-10) and DP (Grade 11-12) within the SAME school, so the
// exact curriculum must be derived per-student from their own grade. These
// ranges must stay in sync with `getGradesForCurriculum` in
// AIMentorApp/src/screens/onboarding/OnboardingScreen.tsx — that's the
// canonical source of the IB PYP/MYP/DP grade split.
function resolveCurriculum(baseCurriculum, grade) {
  if (!baseCurriculum) return null;
  if (baseCurriculum !== 'IB') return baseCurriculum;
  const num = parseInt(String(grade || '').replace(/\D/g, ''), 10);
  if (!num) return 'IB PYP';
  if (num <= 5) return 'IB PYP';
  if (num <= 10) return 'IB MYP';
  return 'IB DP';
}

// GET /school-admin/overview?adminEmail=[&schoolId= for global admins]
router.get('/overview', async (req, res) => {
  const schoolId = effectiveSchoolId(req);
  if (!schoolId) return res.status(400).json({ error: 'schoolId required for platform admins' });
  try {
    const { data: school, error: schoolErr } = await supabase
      .from('schools').select('id, name, curriculum, academic_year, contact_email').eq('id', schoolId).maybeSingle();
    if (schoolErr) throw schoolErr;
    if (!school) return res.status(404).json({ error: 'School not found' });

    // School logo (uploaded via Workspace Settings → POST /branding/logo).
    // branding_logos is keyed by the free-text school name, which is kept in
    // sync with schools.name on rename, so a name lookup here stays correct.
    let logoUrl = null;
    if (school.name) {
      const { data: brandRow } = await supabase
        .from('branding_logos').select('logo_url')
        .eq('kind', 'school').eq('name', school.name).maybeSingle();
      logoUrl = brandRow?.logo_url || null;
    }

    const { data: users, error: usersErr } = await supabase
      .from('users').select('role').eq('school_id', schoolId);
    if (usersErr) throw usersErr;
    const counts = { student: 0, parent: 0, teacher: 0, school_admin: 0 };
    for (const u of users || []) if (counts[u.role] !== undefined) counts[u.role]++;

    // Announcement counts + recent list: fully-scoped-to-this-school announcements
    // only (same "owned" boundary as the management endpoints — a school_admin's
    // Overview never surfaces platform/multi-school announcements as "theirs").
    const { data: targets, error: tErr } = await supabase
      .from('announcement_targets').select('announcement_id, school_id').eq('school_id', schoolId);
    if (tErr) throw tErr;
    const ids = [...new Set((targets || []).map((t) => t.announcement_id))];
    let published = 0, scheduled = 0, drafts = 0;
    let recent = [];
    if (ids.length) {
      const { data: anns, error: aErr } = await supabase
        .from('announcements')
        .select('id, title, severity, status, created_at, starts_at')
        .in('id', ids)
        .order('created_at', { ascending: false });
      if (aErr) throw aErr;
      for (const a of anns || []) {
        if (a.status === 'published') published++;
        else if (a.status === 'scheduled') scheduled++;
        else if (a.status === 'draft') drafts++;
      }
      recent = (anns || []).filter((a) => a.status !== 'draft').slice(0, 5).map((a) => ({
        id: a.id, title: a.title, severity: a.severity, status: a.status,
        createdAt: a.created_at, startsAt: a.starts_at,
      }));
    }

    res.json({
      school: {
        id: school.id, name: school.name, curriculum: school.curriculum || null,
        academicYear: school.academic_year || null, contactEmail: school.contact_email || null,
        logoUrl,
      },
      counts: {
        students: counts.student,
        teachers: counts.teacher,
        parents: counts.parent,
        publishedAnnouncements: published,
        scheduledAnnouncements: scheduled,
        draftAnnouncements: drafts,
      },
      recentAnnouncements: recent,
    });
  } catch (err) {
    console.error('[GET /school-admin/overview] error:', err.message);
    res.status(500).json({ error: 'Failed to load school overview' });
  }
});

const ACADEMIC_YEAR_RE = /^\d{4}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// PATCH /school-admin/workspace-settings — updates the editable Workspace
// Settings fields (school name, academic year, contact email). Renaming the
// school also keeps the free-text users.school column in sync for every user
// in this school, so name-keyed lookups (branding logo, monogram) stay
// consistent — scoping itself always uses the stable school_id FK, never the
// name, so a rename never affects who can see what.
router.patch('/workspace-settings', async (req, res) => {
  if (req.adminScope.scopeType !== 'school') return res.status(400).json({ error: 'Only a school administrator can edit workspace settings' });
  const schoolId = req.adminScope.schoolId;
  const { name, academicYear, contactEmail } = req.body || {};

  const patch = {};
  let newName = null;
  if (name !== undefined) {
    newName = String(name || '').trim();
    if (!newName) return res.status(400).json({ error: 'School name cannot be empty' });
    if (newName.length > 120) return res.status(400).json({ error: 'School name is too long' });
    patch.name = newName;
  }
  if (academicYear !== undefined) {
    if (!ACADEMIC_YEAR_RE.test(String(academicYear || ''))) return res.status(400).json({ error: 'Academic year must look like "2026-27"' });
    patch.academic_year = academicYear;
  }
  if (contactEmail !== undefined) {
    const trimmed = String(contactEmail || '').trim();
    if (trimmed && !EMAIL_RE.test(trimmed)) return res.status(400).json({ error: 'Contact email is not valid' });
    patch.contact_email = trimmed || null;
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update' });

  try {
    const { data: school, error } = await supabase
      .from('schools').update(patch).eq('id', schoolId)
      .select('id, name, curriculum, academic_year, contact_email').maybeSingle();
    if (error) {
      // A school name is unique (case-insensitive) across the platform. Surface
      // that as a clear, actionable message instead of a generic 500 so the
      // admin knows the name is taken rather than thinking the save is broken.
      if (error.code === '23505' || /schools_name_lower_idx|duplicate key/i.test(error.message || '')) {
        return res.status(409).json({ error: 'A school with this name already exists. Please choose a different name.' });
      }
      throw error;
    }

    // Keep the denormalized users.school text column aligned with the new name
    // so anything still matching by name (branding, monogram) resolves right.
    if (newName) {
      await supabase.from('users').update({ school: newName }).eq('school_id', schoolId);
    }

    res.json({
      school: {
        id: school.id, name: school.name, curriculum: school.curriculum || null,
        academicYear: school.academic_year || null, contactEmail: school.contact_email || null,
      },
    });
  } catch (err) {
    console.error('[PATCH /school-admin/workspace-settings] error:', err.message);
    res.status(500).json({ error: 'Failed to save workspace settings' });
  }
});

// GET /school-admin/people?adminEmail=&role=student|teacher|parent[&schoolId= for global admins]
router.get('/people', async (req, res) => {
  const schoolId = effectiveSchoolId(req);
  if (!schoolId) return res.status(400).json({ error: 'schoolId required for platform admins' });
  const roleFilter = ['student', 'teacher', 'parent'].includes(req.query.role) ? req.query.role : null;
  try {
    let query = supabase
      .from('users')
      .select('id, name, email, role, grade, created_at')
      .eq('school_id', schoolId)
      .order('name');
    if (roleFilter) query = query.eq('role', roleFilter);
    const { data, error } = await query;
    if (error) throw error;
    res.json((data || []).map((u) => ({
      id: u.id, name: u.name, email: u.email, role: u.role, grade: u.grade, joinedAt: u.created_at,
    })));
  } catch (err) {
    console.error('[GET /school-admin/people] error:', err.message);
    res.status(500).json({ error: 'Failed to load people' });
  }
});

// ---------------------------------------------------------------------------
// Student Administration (real V1 write access — school_admin is the
// operational manager for their own school, confirmed 2026-07-12: this is
// not a read-only oversight role).
// ---------------------------------------------------------------------------

// "Invited" is never stored — it's derived from the existing mustChangePassword
// signal in user_preferences (the same flag the real login flow already uses
// to gate the first-login password-set screen), so it can never drift from
// what actually happens when that student logs in.
async function deriveStatusMap(emails) {
  const map = new Map();
  if (!emails.length) return map;
  const { data, error } = await supabase
    .from('user_preferences').select('user_email, data').in('user_email', emails);
  if (error) throw error;
  for (const row of data || []) map.set(row.user_email, row.data?.mustChangePassword !== false);
  return map;
}

function displayStatus(dbStatus, mustChangePassword) {
  if (dbStatus === 'inactive') return 'inactive';
  if (dbStatus === 'archived') return 'archived';
  return mustChangePassword ? 'invited' : 'active';
}

// GET /school-admin/students?adminEmail=&search=&grade=&section=&curriculum=&status=&sort=name|grade&dir=asc|desc&page=&limit=
router.get('/students', async (req, res) => {
  const schoolId = effectiveSchoolId(req);
  if (!schoolId) return res.status(400).json({ error: 'schoolId required for platform admins' });
  try {
    let query = supabase
      .from('users')
      .select('id, name, email, grade, section, curriculum, status, admission_number, created_at, last_active_at')
      .eq('school_id', schoolId)
      .eq('role', 'student');

    const search = String(req.query.search || '').trim();
    if (search) query = query.or(`name.ilike.%${search}%,admission_number.ilike.%${search}%`);
    if (req.query.grade && req.query.grade !== 'all') query = query.eq('grade', req.query.grade);
    if (req.query.section && req.query.section !== 'all') query = query.eq('section', req.query.section);
    if (req.query.curriculum && req.query.curriculum !== 'all') query = query.eq('curriculum', req.query.curriculum);

    const { data, error } = await query;
    if (error) throw error;
    let rows = data || [];

    const mustChangeMap = await deriveStatusMap(rows.map((r) => r.email));
    let items = rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      admissionNumber: r.admission_number,
      grade: r.grade,
      section: r.section,
      curriculum: r.curriculum,
      status: displayStatus(r.status, mustChangeMap.get(r.email) ?? true),
      joinedAt: r.created_at,
      lastActiveAt: r.last_active_at,
    }));

    const statusFilter = req.query.status;
    if (statusFilter && statusFilter !== 'all') items = items.filter((i) => i.status === statusFilter);
    else items = items.filter((i) => i.status !== 'archived'); // "All" excludes archived, same as the approved design

    const sortKey = ['grade', 'admissionNumber'].includes(req.query.sort) ? req.query.sort : 'name';
    const dir = req.query.dir === 'desc' ? -1 : 1;
    items.sort((a, b) => {
      if (sortKey === 'grade') {
        // Natural/curriculum-aware compare (Grade 2 before Grade 10; IB's
        // PYP/MYP/DP stay in program order) — see sortGradeNames.
        const g = sortGradeNames(a.grade || '', b.grade || '') || (a.section || '').localeCompare(b.section || '');
        return (g || a.name.localeCompare(b.name)) * dir;
      }
      if (sortKey === 'admissionNumber') {
        // Rows with no admission number sort last regardless of direction, so
        // a missing ID reads as a flagged gap in the list, not a stray "top" row.
        if (!a.admissionNumber && !b.admissionNumber) return a.name.localeCompare(b.name);
        if (!a.admissionNumber) return 1;
        if (!b.admissionNumber) return -1;
        return a.admissionNumber.localeCompare(b.admissionNumber, undefined, { numeric: true }) * dir;
      }
      return a.name.localeCompare(b.name) * dir;
    });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const total = items.length;
    const start = (page - 1) * limit;

    res.json({ items: items.slice(start, start + limit), total, page, limit });
  } catch (err) {
    console.error('[GET /school-admin/students] error:', err.message);
    res.status(500).json({ error: 'Failed to load students' });
  }
});

// GET /school-admin/students/facets — the FULL set of Grade/Section/
// Curriculum filter options for the school, independent of the current page,
// filters, or search on the Students list, AND independent of which programs
// happen to already have enrolled students. The list-filter dropdowns must
// call THIS, not derive options from whatever rows happen to be loaded —
// GET /students is paginated (100 rows) and often already filtered, so
// deriving from it silently hides values that exist beyond the current page
// or outside the current filter (e.g. "All grades" showing only Grade 6
// because that's all that was loaded).
//
// Grade/Section stay genuinely data-driven (free text, no fixed range for
// either — a school defines whatever grades/sections it actually uses).
// CURRICULUM is different: it's a STRUCTURAL fact of the school, not a
// derived tally of who's enrolled. An IB school always has three programs —
// PYP, MYP, DP — even on day one before a single DP-age student exists; if
// the dropdown were built from `users.curriculum` values like Grade/Section
// are, IB DP would silently vanish until someone happened to be admitted at
// that level. So Curriculum options come from the SCHOOL's own base type
// (schools.curriculum), expanded to the fixed IB PYP/MYP/DP triad when the
// base is 'IB' (mirrors resolveCurriculum's existing PYP/MYP/DP split above —
// same domain fact, not new hardcoding), or the single base value for a
// single-track curriculum (CBSE, ICSE, Cambridge, ...). Registered BEFORE
// /students/:id for the same reason as template.csv/xlsx below (Express
// matches by registration order, not specificity).
router.get('/students/facets', async (req, res) => {
  const schoolId = effectiveSchoolId(req);
  if (!schoolId) return res.status(400).json({ error: 'schoolId required for platform admins' });
  try {
    const [{ data: school }, { data, error }] = await Promise.all([
      supabase.from('schools').select('curriculum').eq('id', schoolId).maybeSingle(),
      supabase.from('users').select('grade, section, curriculum').eq('school_id', schoolId).eq('role', 'student'),
    ]);
    if (error) throw error;
    const gradeSet = new Set();
    const sectionSet = new Set();
    const curriculumSet = new Set(); // used only as a fallback below
    for (const r of data || []) {
      const g = String(r.grade || '').trim();
      if (g) gradeSet.add(g);
      const s = String(r.section || '').trim();
      if (s) sectionSet.add(s);
      const c = String(r.curriculum || '').trim();
      if (c) curriculumSet.add(c);
    }

    const baseCurriculum = school?.curriculum || null;
    let curriculums;
    if (baseCurriculum === 'IB') {
      curriculums = ['IB PYP', 'IB MYP', 'IB DP'];
    } else if (baseCurriculum) {
      curriculums = [baseCurriculum];
    } else {
      // School has no base curriculum configured yet — fall back to whatever
      // curriculum values actually appear on students, so the filter still
      // works instead of coming back empty.
      curriculums = [...curriculumSet].sort(sortCurriculumNames);
    }

    res.json({
      grades: [...gradeSet].sort(sortGradeNames),
      sections: [...sectionSet].sort((a, b) => a.localeCompare(b)),
      curriculums,
    });
  } catch (err) {
    console.error('[GET /school-admin/students/facets] error:', err.message);
    res.status(500).json({ error: 'Failed to load grade/section/curriculum options' });
  }
});

// GET /school-admin/students/template.csv|.xlsx — download a pre-filled
// roster the admin can edit and re-upload via POST /students/bulk (upsert
// semantics). Registered BEFORE /students/:id so Express doesn't match
// "template.csv" as an :id param (route matching is registration-order, not
// specificity).
const TEMPLATE_HEADER = ['Student Name', 'Student Email', 'Admission No', 'Curriculum', 'Grade', 'Section', 'Parent Name', 'Parent Email', 'Parent Phone'];

// Two obviously-fake rows at the top of every template, always present (even
// for a school with zero real students yet) so admins see the expected
// format at a glance — the bulk endpoint requires Student Name, so if one
// slips through on re-upload it just creates a clearly-named "(sample)"
// student rather than failing silently. The Curriculum cell is derived from
// THIS school's board (an IB school's samples show "IB PYP", never "CBSE"),
// so the example never suggests a curriculum the school doesn't follow.
const SAMPLE_ROW_COUNT = 4;
function buildSampleRows(baseCurriculum) {
  const c2 = resolveCurriculum(baseCurriculum, 'Grade 2') || '';
  const c3 = resolveCurriculum(baseCurriculum, 'Grade 3') || '';
  const c4 = resolveCurriculum(baseCurriculum, 'Grade 4') || '';
  const c5 = resolveCurriculum(baseCurriculum, 'Grade 5') || '';
  // Four fully-filled example rows so admins see every column populated the
  // way we expect (name, email, admission no, curriculum, grade, section,
  // parent name/email/phone). They're clearly marked "(delete before
  // uploading)" and are the first SAMPLE_ROW_COUNT rows so the .xlsx styling
  // tints them as placeholders.
  return [
    ['Aarav Sample (delete before uploading)', 'aarav.sample@example.com', 'ADM-0001', c3, 'Grade 3', 'A', 'Ravi Sample', 'ravi.sample@example.com', '+91 90000 00001'],
    ['Diya Sample (delete before uploading)', 'diya.sample@example.com', 'ADM-0002', c5, 'Grade 5', 'B', 'Meera Sample', 'meera.sample@example.com', '+91 90000 00002'],
    ['Kabir Sample (delete before uploading)', 'kabir.sample@example.com', 'ADM-0003', c2, 'Grade 2', 'A', 'Arjun Sample', 'arjun.sample@example.com', '+91 90000 00003'],
    ['Saanvi Sample (delete before uploading)', 'saanvi.sample@example.com', 'ADM-0004', c4, 'Grade 4', 'C', 'Nisha Sample', 'nisha.sample@example.com', '+91 90000 00004'],
  ];
}

function csvCell(value) {
  if (value === null || value === undefined || value === '') return '';
  return `"${String(value).replace(/"/g, '""')}"`;
}

function toCsv(header, rows) {
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return lines.join('\r\n');
}

// The template is a blank, sample-only roster for ADDING new students. It no
// longer lists the school's existing students: bulk import skips anyone already
// in the roster (editing an existing student is done from their details
// screen), so pre-filling them would only produce a wall of rows that all get
// skipped on re-upload. Just the 4 clearly-marked sample rows, curriculum
// derived from the school's board.
async function buildTemplateRows(schoolId) {
  const { data: school } = await supabase.from('schools').select('curriculum').eq('id', schoolId).maybeSingle();
  return buildSampleRows(school?.curriculum || null);
}

router.get('/students/template.csv', async (req, res) => {
  const schoolId = effectiveSchoolId(req);
  if (!schoolId) return res.status(400).json({ error: 'schoolId required for platform admins' });
  try {
    const rows = await buildTemplateRows(schoolId);
    const csv = toCsv(TEMPLATE_HEADER, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="students_template.csv"');
    res.send(csv);
  } catch (err) {
    console.error('[GET /school-admin/students/template.csv] error:', err.message);
    res.status(500).json({ error: 'Failed to build template' });
  }
});

router.get('/students/template.xlsx', async (req, res) => {
  const schoolId = effectiveSchoolId(req);
  if (!schoolId) return res.status(400).json({ error: 'schoolId required for platform admins' });
  try {
    const rows = await buildTemplateRows(schoolId);
    // ExcelJS (not the `xlsx` package) — the free tier of `xlsx` (SheetJS)
    // does not reliably write cell styles, and this template needs to look
    // like a real, professional spreadsheet: bold branded header, sane
    // column widths, borders, a frozen header row, and the sample rows
    // visually marked as placeholders (not just text in the cell).
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Aivorah';
    wb.created = new Date();
    const ws = wb.addWorksheet('Students', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    const COL_WIDTHS = [30, 30, 16, 12, 12, 12, 24, 28, 18];
    ws.columns = TEMPLATE_HEADER.map((header, i) => ({ header, key: `c${i}`, width: COL_WIDTHS[i] || 18 }));

    const HEADER_FILL = 'FF5C4A1E'; // deep olive-gold — Aivorah brand accent
    const SAMPLE_FILL = 'FFFBF0DA'; // soft warm tint to mark placeholder rows
    const THIN_BORDER = { style: 'thin', color: { argb: 'FFD9D3C7' } };

    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
      cell.alignment = { vertical: 'middle' };
      cell.border = { top: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER, bottom: THIN_BORDER };
    });
    headerRow.height = 22;

    // Parent Phone values start with "+91 …". Excel treats a leading "+" as a
    // formula and shows the "typo in your formula" prompt. Force that column to
    // Text so the values (and future edits) are treated literally.
    const PHONE_COL = TEMPLATE_HEADER.indexOf('Parent Phone') + 1;
    if (PHONE_COL > 0) ws.getColumn(PHONE_COL).numFmt = '@';

    rows.forEach((rowValues, i) => {
      const row = ws.addRow(rowValues);
      const isSample = i < SAMPLE_ROW_COUNT;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = { top: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER, bottom: THIN_BORDER };
        if (isSample) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SAMPLE_FILL } };
          cell.font = { italic: true, color: { argb: 'FF8A7550' } };
        }
      });
      if (PHONE_COL > 0) {
        const phoneCell = row.getCell(PHONE_COL);
        phoneCell.numFmt = '@';
        if (phoneCell.value != null) phoneCell.value = String(phoneCell.value);
      }
    });

    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: TEMPLATE_HEADER.length } };

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="students_template.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[GET /school-admin/students/template.xlsx] error:', err.message);
    res.status(500).json({ error: 'Failed to build template' });
  }
});

// GET /school-admin/students/:id  — quick-inspect drawer data
router.get('/students/:id', async (req, res) => {
  const schoolId = effectiveSchoolId(req);
  if (!schoolId) return res.status(400).json({ error: 'schoolId required for platform admins' });
  try {
    const { data: u, error } = await supabase
      .from('users').select('*').eq('id', req.params.id).eq('school_id', schoolId).eq('role', 'student').maybeSingle();
    if (error) throw error;
    if (!u) return res.status(404).json({ error: 'Student not found' });

    const mustChangeMap = await deriveStatusMap([u.email]);
    // Real parent linkage via parent_children — surfaced read-only; there is
    // no edit path for this yet (that's a separate parent-linking feature).
    const { data: links } = await supabase
      .from('parent_children').select('parent_email').eq('child_id', u.id);
    let parent = null;
    if (links?.length) {
      const { data: p } = await supabase.from('users').select('name, email, phone').eq('email', links[0].parent_email).maybeSingle();
      if (p) parent = { name: p.name, email: p.email, phone: p.phone || '' };
    }

    res.json({
      id: u.id, name: u.name, email: u.email, admissionNumber: u.admission_number,
      grade: u.grade, section: u.section, curriculum: u.curriculum,
      status: displayStatus(u.status, mustChangeMap.get(u.email) ?? true),
      joinedAt: u.created_at,
      lastActiveAt: u.last_active_at,
      parent,
    });
  } catch (err) {
    console.error('[GET /school-admin/students/:id] error:', err.message);
    res.status(500).json({ error: 'Failed to load student' });
  }
});

// POST /school-admin/students — Add Student (single). School/school_id are
// always forced to the authenticated admin's own scope, never client-supplied.
router.post('/students', async (req, res) => {
  if (req.adminScope.scopeType !== 'school') return res.status(400).json({ error: 'Only a school administrator can add a student' });
  const schoolId = req.adminScope.schoolId;
  const {
    firstName, lastName, grade, section, email: emailOverride, initialStatus,
    parentName: parentNameIn, parentEmail: parentEmailInRaw, notes,
    curriculum: curriculumIn, admissionNumber: admissionNumberIn,
  } = req.body || {};
  if (!String(firstName || '').trim() || !String(lastName || '').trim()) return res.status(400).json({ error: 'First and last name are required' });
  if (!grade) return res.status(400).json({ error: 'Grade is required' });

  try {
    const { data: school, error: schoolErr } = await supabase.from('schools').select('name, curriculum').eq('id', schoolId).maybeSingle();
    if (schoolErr) throw schoolErr;
    const schoolName = school?.name || 'School';
    // Curriculum is now an EXPLICIT choice the admin makes on the form (e.g.
    // "IB PYP", "CBSE"), so prefer that. resolveCurriculum() remains only as a
    // fallback for older/other callers that don't send it, deriving the level
    // from the school's base type + grade. A student's Learning Paths screen
    // needs a curriculum before it shows anything, so we always set one.
    const schoolCurriculum = String(curriculumIn || '').trim() || resolveCurriculum(school?.curriculum, grade);
    const name = toTitleCase(`${firstName.trim()} ${lastName.trim()}`);
    const studentEmailProvided = String(emailOverride || '').trim().toLowerCase();
    const email = studentEmailProvided || generateStudentEmail(name, schoolName);
    const password = generateSecurePassword();

    const { data: dup } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
    if (dup) return res.status(409).json({ error: 'A user with this email already exists' });

    const parentName = String(parentNameIn || '').trim();
    const parentEmailIn = String(parentEmailInRaw || '').trim().toLowerCase();
    // Validate up front (before creating the student) so we don't leave a
    // student account behind when the parent email turns out to be unusable.
    if (parentName && parentEmailIn) {
      const { data: existing } = await supabase.from('users').select('id, role').eq('email', parentEmailIn).maybeSingle();
      if (existing && existing.role !== 'parent') {
        return res.status(400).json({ error: `Parent email ${parentEmailIn} already belongs to a non-parent account` });
      }
    }

    // Admin-provided admission number wins when given; otherwise auto-generate the
    // next one, same as before. Must still be unique within the school.
    const admissionNumberTrimmed = String(admissionNumberIn || '').trim();
    if (admissionNumberTrimmed) {
      const { data: admDup } = await supabase.from('users').select('id')
        .eq('school_id', schoolId).eq('role', 'student').eq('admission_number', admissionNumberTrimmed).maybeSingle();
      if (admDup) return res.status(409).json({ error: `Admission number "${admissionNumberTrimmed}" is already in use` });
    }
    const { count } = await supabase.from('users').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('role', 'student');
    const admissionNumber = admissionNumberTrimmed || generateAdmissionNumber(schoolName, count || 0);

    const firebaseUid = await createFirebaseAccount(email, password);
    const userId = randomUUID();
    const { error: userErr } = await supabase.from('users').insert({
      id: userId, name, email, role: 'student',
      grade, section: section || null, school: schoolName, school_id: schoolId, curriculum: schoolCurriculum,
      admission_number: admissionNumber, status: 'active', onboarding_complete: true,
      admin_notes: notes?.trim() || null,
    });
    if (userErr) throw userErr;

    await supabase.from('student_stats').insert({ student_id: userId });
    const mustChangePassword = initialStatus !== 'active';
    await supabase.from('user_preferences').upsert({
      user_email: email,
      // accountStatus: 'active' skips the email-verification gate — a school
      // admin created this account on the student's behalf with a real
      // email/ID+password, same as the existing parent/teacher-created-student
      // flows; there's no signup email for the student to verify in the first
      // place. mustChangePassword still forces them through Set Password.
      data: { loginId: email, initialPassword: password, studentName: name, grade, section: section || null, school: schoolName, firebaseUid, mustChangePassword, accountStatus: 'active' },
    });

    // --- PARENT (only when a parent name is supplied) — mirrors /students/bulk ---
    let resolvedParentEmail = ''; // set whenever a REAL (admin-provided) parent email is in play
    let newParentCreds = null;    // { name, email, password } — set only on create
    let parentEmailForLink = ''; // the parent account's actual email, real or generated
    if (parentName) {
      let parentEmail = parentEmailIn;
      let parentUser = null;
      if (parentEmail) {
        const { data: existing } = await supabase.from('users').select('id, email, role').eq('email', parentEmail).maybeSingle();
        if (existing && existing.role === 'parent') {
          parentUser = existing;
        } else if (existing) {
          // Email belongs to a non-parent account — cannot reuse it (already
          // validated up front, but re-checked in case of a race).
          return res.status(400).json({ error: `Parent email ${parentEmail} already belongs to a non-parent account` });
        }
      }
      if (!parentUser) {
        if (!parentEmail) parentEmail = await generateParentLoginId(supabase);
        const pName = toTitleCase(parentName);
        const pPassword = generateSecurePassword();
        const pFirebaseUid = await createFirebaseAccount(parentEmail, pPassword);
        const parentUserId = randomUUID();
        const { error: pErr } = await supabase.from('users').insert({
          id: parentUserId, name: pName, email: parentEmail, role: 'parent',
          school: schoolName, school_id: schoolId, status: 'active', onboarding_complete: true,
        });
        if (pErr) throw pErr;
        await supabase.from('user_preferences').upsert({
          user_email: parentEmail,
          data: { loginId: parentEmail, initialPassword: pPassword, parentName: pName, school: schoolName, firebaseUid: pFirebaseUid, mustChangePassword: true, accountStatus: 'active' },
        });
        // Only a real, admin-provided parent email is deliverable — an
        // auto-generated placeholder (generateStaffEmail fallback above)
        // isn't a real inbox anyone checks.
        if (parentEmailIn) newParentCreds = { name: pName, email: parentEmail, password: pPassword };
      }
      parentEmailForLink = parentEmail;
      if (parentEmailIn) resolvedParentEmail = parentEmail;
    }

    // --- LINK (select-then-insert to avoid duplicate links) ---
    if (parentEmailForLink) {
      const { data: link } = await supabase.from('parent_children')
        .select('child_id').eq('parent_email', parentEmailForLink).eq('child_id', userId).maybeSingle();
      if (!link) {
        await supabase.from('parent_children').insert({ parent_email: parentEmailForLink, child_id: userId });
      }
    }

    // --- Portal-access emails ---
    // Student: real email on file -> send login straight to the student;
    // otherwise fall back to the parent's real email with the student's
    // credentials (a child usually can't check a system-generated inbox).
    if (studentEmailProvided) {
      await sendCredentialsEmail({ to: email, childName: name, loginId: email, password, childEmail: email });
    } else if (resolvedParentEmail) {
      await sendCredentialsEmail({ to: resolvedParentEmail, childName: name, loginId: email, password, childEmail: email });
    }
    // Parent: their own new account gets its own credentials email,
    // independent of whatever happened with the student's above.
    if (newParentCreds) {
      await sendOwnAccountCredentialsEmail({ to: newParentCreds.email, name: newParentCreds.name, loginId: newParentCreds.email, password: newParentCreds.password, role: 'parent' });
    }

    res.status(201).json({
      id: userId, name, email, password, admissionNumber, grade, section: section || null,
      status: mustChangePassword ? 'invited' : 'active',
      parent: newParentCreds ? { name: newParentCreds.name, email: newParentCreds.email, password: newParentCreds.password } : undefined,
    });
  } catch (err) {
    console.error('[POST /school-admin/students] error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to create student' });
  }
});

async function assertOwnedStudents(ids, schoolId) {
  const { data, error } = await supabase.from('users').select('id').in('id', ids).eq('school_id', schoolId).eq('role', 'student');
  if (error) throw error;
  const owned = new Set((data || []).map((r) => r.id));
  return { owned: ids.filter((id) => owned.has(id)), skipped: ids.filter((id) => !owned.has(id)) };
}

// PATCH /school-admin/students/:id/status  { adminEmail, status: 'active'|'inactive'|'archived' }
router.patch('/students/:id/status', async (req, res) => {
  if (req.adminScope.scopeType !== 'school') return res.status(400).json({ error: 'Only a school administrator can update students' });
  const { status } = req.body || {};
  if (!['active', 'inactive', 'archived'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const { owned } = await assertOwnedStudents([req.params.id], req.adminScope.schoolId);
    if (!owned.length) return res.status(403).json({ error: 'Not authorized to manage this student' });
    const { error } = await supabase.from('users').update({ status }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[PATCH /school-admin/students/:id/status] error:', err.message);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// PATCH /school-admin/students/:id  — edit an existing student's details.
// Only the fields present in the body are changed (partial update). Student
// identity fields live on `users`; parent Name/Phone are applied to the LINKED
// parent account when one exists. Changing the student's or parent's login
// email is intentionally NOT supported here — that's an account-migration
// concern, not a routine roster edit.
router.patch('/students/:id', async (req, res) => {
  if (req.adminScope.scopeType !== 'school') return res.status(400).json({ error: 'Only a school administrator can update students' });
  const schoolId = req.adminScope.schoolId;
  const { name, grade, section, admissionNumber, curriculum, parentName, parentPhone } = req.body || {};
  try {
    const { owned } = await assertOwnedStudents([req.params.id], schoolId);
    if (!owned.length) return res.status(403).json({ error: 'Not authorized to manage this student' });

    // Build the student patch from only the provided fields. Empty strings for
    // grade/section/admission are treated as "clear it"; an omitted key leaves
    // the column untouched.
    const patch = {};
    if (name !== undefined) {
      const trimmed = toTitleCase(String(name).trim());
      if (!trimmed) return res.status(400).json({ error: 'Student name cannot be empty' });
      patch.name = trimmed;
    }
    if (grade !== undefined) patch.grade = String(grade).trim() || null;
    if (section !== undefined) patch.section = String(section).trim() || null;
    if (curriculum !== undefined) patch.curriculum = String(curriculum).trim() || null;
    if (admissionNumber !== undefined) {
      const adm = String(admissionNumber).trim();
      if (adm) {
        // Admission number must stay unique within the school.
        const { data: clash } = await supabase.from('users')
          .select('id').eq('school_id', schoolId).eq('role', 'student').eq('admission_number', adm)
          .neq('id', req.params.id).maybeSingle();
        if (clash) return res.status(409).json({ error: `Admission No "${adm}" is already used by another student` });
      }
      patch.admission_number = adm || null;
    }

    if (Object.keys(patch).length) {
      const { error: upErr } = await supabase.from('users').update(patch).eq('id', req.params.id);
      if (upErr) throw upErr;
    }

    // --- Parent name / phone edits, applied to the linked parent account ---
    if (parentName !== undefined || parentPhone !== undefined) {
      const { data: links } = await supabase.from('parent_children').select('parent_email').eq('child_id', req.params.id);
      const parentEmail = links?.[0]?.parent_email;
      if (parentEmail) {
        const pPatch = {};
        if (parentName !== undefined && String(parentName).trim()) pPatch.name = toTitleCase(String(parentName).trim());
        if (parentPhone !== undefined) pPatch.phone = String(parentPhone).trim() || null;
        if (Object.keys(pPatch).length) {
          await supabase.from('users').update(pPatch).eq('email', parentEmail).eq('role', 'parent');
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[PATCH /school-admin/students/:id] error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to update student' });
  }
});

// DELETE /school-admin/students/:id — permanently delete a student account and
// its data. This is a hard delete (distinct from Archive, which is a
// recoverable status). The linked PARENT account is NOT deleted — a parent can
// have other children and is a separate account; we only remove the link.
async function deleteStudentRows(userId, email) {
  const delById = async (table, column) => {
    try { await supabase.from(table).delete().eq(column, userId); }
    catch (e) { console.warn(`[delete student] ${table}.${column}: ${e.message}`); }
  };
  const delByEmail = async (table, column, val) => {
    try { await supabase.from(table).delete().eq(column, val); }
    catch (e) { console.warn(`[delete student] ${table}.${column}: ${e.message}`); }
  };
  // FK-referencing rows keyed by the student id.
  await delById('assignment_submissions', 'student_id');
  await delById('assignments', 'student_id');
  await delById('challenge_assignments', 'student_id');
  await delById('topic_attempts', 'student_id');
  await delById('messages', 'student_id');
  await delById('student_daily_log', 'student_id');
  await delById('student_stats', 'student_id');
  await delById('student_subject_time', 'student_id');
  await delById('parent_daily_tasks', 'child_id');
  await delById('parent_children', 'child_id');
  await delById('teacher_student', 'student_id');
  await delById('teacher_students', 'student_id');
  // Email-keyed rows.
  if (email) {
    await delByEmail('user_preferences', 'user_email', email);
    await delByEmail('student_preferences', 'user_email', email);
    await delByEmail('parent_children', 'child_email', email);
  }
}

async function deleteFirebaseAccountByEmail(email) {
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) return; // no credential configured — skip silently
    const fbUser = await admin.auth().getUserByEmail(email);
    await admin.auth().deleteUser(fbUser.uid);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') console.warn(`[delete student] firebase auth: ${err.message}`);
  }
}

router.delete('/students/:id', async (req, res) => {
  if (req.adminScope.scopeType !== 'school') return res.status(400).json({ error: 'Only a school administrator can delete students' });
  const schoolId = req.adminScope.schoolId;
  try {
    // Look up (and ownership-check) the student before deleting anything.
    const { data: student } = await supabase.from('users')
      .select('id, email').eq('id', req.params.id).eq('school_id', schoolId).eq('role', 'student').maybeSingle();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    await deleteStudentRows(student.id, student.email);
    const { error: delErr } = await supabase.from('users').delete().eq('id', student.id);
    if (delErr) throw delErr;
    await deleteFirebaseAccountByEmail(student.email);

    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /school-admin/students/:id] error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to delete student' });
  }
});

// POST /school-admin/students/bulk-status  { adminEmail, studentIds: [], status }
router.post('/students/bulk-status', async (req, res) => {
  if (req.adminScope.scopeType !== 'school') return res.status(400).json({ error: 'Only a school administrator can update students' });
  const { studentIds, status } = req.body || {};
  if (!Array.isArray(studentIds) || !studentIds.length) return res.status(400).json({ error: 'studentIds required' });
  if (!['active', 'inactive', 'archived'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const { owned, skipped } = await assertOwnedStudents(studentIds, req.adminScope.schoolId);
    if (owned.length) {
      const { error } = await supabase.from('users').update({ status }).in('id', owned);
      if (error) throw error;
    }
    res.json({ updated: owned.length, skipped });
  } catch (err) {
    console.error('[POST /school-admin/students/bulk-status] error:', err.message);
    res.status(500).json({ error: 'Failed to update students' });
  }
});

// POST /school-admin/students/bulk-grade  { adminEmail, studentIds: [], grade, section? }
// "Promote Students" — year-end grade/section move for a batch of students in
// one write. Mirrors bulk-status's ownership-checked pattern exactly. Only
// `grade` (and `section`, when provided) are changed on `users` — id, email,
// admission number, curriculum, and every other table (assignments,
// submissions, attendance, stats, parent links, reports) are untouched, so
// all learning history/IDs survive the move unmodified. `section` is
// optional: omit it to keep each student's current section while only the
// grade changes.
router.post('/students/bulk-grade', async (req, res) => {
  if (req.adminScope.scopeType !== 'school') return res.status(400).json({ error: 'Only a school administrator can promote students' });
  const { studentIds, grade, section } = req.body || {};
  if (!Array.isArray(studentIds) || !studentIds.length) return res.status(400).json({ error: 'studentIds required' });
  const targetGrade = String(grade || '').trim();
  if (!targetGrade) return res.status(400).json({ error: 'Target grade required' });
  try {
    const { owned, skipped } = await assertOwnedStudents(studentIds, req.adminScope.schoolId);
    if (owned.length) {
      const patch = { grade: targetGrade };
      if (section !== undefined) patch.section = String(section || '').trim() || null;
      const { error } = await supabase.from('users').update(patch).in('id', owned);
      if (error) throw error;
    }
    res.json({ promoted: owned.length, skipped, grade: targetGrade, section: section !== undefined ? (String(section || '').trim() || null) : undefined });
  } catch (err) {
    console.error('[POST /school-admin/students/bulk-grade] error:', err.message);
    res.status(500).json({ error: 'Failed to promote students' });
  }
});

// ---------------------------------------------------------------------------
// Bulk student/parent CSV import (self-contained CSV helpers — deliberately
// NOT imported from admin.js to keep this route file standalone).
// ---------------------------------------------------------------------------

// POST /school-admin/students/bulk — upsert students (+ optional linked parents)
// from an edited CSV. Each row is isolated: a failing row is reported in
// `errors` and never aborts the batch. Newly created accounts return their
// one-time credentials so the UI can show/download them once.
router.post('/students/bulk', async (req, res) => {
  if (req.adminScope.scopeType !== 'school') return res.status(400).json({ error: 'Only a school administrator can bulk import students' });
  const schoolId = req.adminScope.schoolId;
  const { rows, fileName } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'rows must be a non-empty array' });

  try {
    const { data: school, error: schoolErr } = await supabase.from('schools').select('name, curriculum').eq('id', schoolId).maybeSingle();
    if (schoolErr) throw schoolErr;
    const schoolName = school?.name || 'School';
    // Same reasoning as the single Add Student path: fall back to the
    // school's own default curriculum so a bulk-imported student's Learning
    // Paths aren't blocked on a "complete your profile" wall for information
    // the admin already gave us via the school itself. resolveCurriculum is
    // applied PER ROW below (not here) since IB spans PYP/MYP/DP by grade.
    const schoolBaseCurriculum = school?.curriculum || null;

    const { count: initialCount } = await supabase.from('users')
      .select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('role', 'student');
    let studentCount = initialCount || 0;

    const created = [];
    const updated = [];
    const skipped = [];
    const errors = [];
    const credentials = [];

    // Pre-load grade+section -> class-teacher id, so newly created students
    // land in `teacher_student` immediately instead of being invisible to
    // their teacher until a later manual re-link (same root cause as the
    // class-teacher auto-link above: teacher_student is the only thing the
    // teacher roster query reads, it is never derived from grade/section).
    const classTeacherIdByGradeSection = new Map();
    try {
      const grades = await buildGradesSectionsView(schoolId);
      const teacherEmails = new Set();
      for (const g of grades) {
        for (const s of g.sections || []) {
          if (s.classTeacherEmail) teacherEmails.add(s.classTeacherEmail);
        }
      }
      if (teacherEmails.size) {
        const { data: teachers } = await supabase.from('users')
          .select('id, email').in('email', [...teacherEmails]).eq('role', 'teacher').eq('school_id', schoolId);
        const teacherIdByEmail = new Map((teachers || []).map((t) => [t.email, t.id]));
        for (const g of grades) {
          for (const s of g.sections || []) {
            const teacherId = s.classTeacherEmail ? teacherIdByEmail.get(s.classTeacherEmail) : null;
            if (teacherId) classTeacherIdByGradeSection.set(`${g.name}||${s.name}`, teacherId);
          }
        }
      }
    } catch (linkPreloadErr) {
      console.error('[POST /school-admin/students/bulk] class-teacher preload failed:', linkPreloadErr.message);
    }

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i] || {};
      const studentName = String(raw.studentName || '').trim();
      const studentEmail = String(raw.studentEmail || '').trim().toLowerCase();
      const admissionNo = String(raw.admissionNo || '').trim();
      const rowCurriculum = String(raw.curriculum || '').trim();
      const grade = String(raw.grade || '').trim();
      const section = String(raw.section || '').trim();
      const parentName = String(raw.parentName || '').trim();
      const parentEmailIn = String(raw.parentEmail || '').trim().toLowerCase();
      const parentPhone = String(raw.parentPhone || '').trim();

      try {
        if (!studentName) {
          errors.push({ row: i + 1, error: 'Student Name is required' });
          continue;
        }

        // --- Match existing student (email first, then admission number) ---
        let student = null;
        if (studentEmail) {
          const { data: match } = await supabase.from('users')
            .select('id, name, email, grade, section')
            .eq('email', studentEmail).eq('school_id', schoolId).eq('role', 'student').maybeSingle();
          if (match) student = match;
        }
        if (!student && admissionNo) {
          const { data: match } = await supabase.from('users')
            .select('id, name, email, grade, section')
            .eq('admission_number', admissionNo).eq('school_id', schoolId).eq('role', 'student').maybeSingle();
          if (match) student = match;
        }

        let studentUserId;
        const name = toTitleCase(studentName);
        // Portal-access emails only make sense for a BRAND NEW account (we
        // never know an existing/updated account's real password to resend
        // it) — tracked separately from `student`/`created` so the email
        // decision below stays simple regardless of code path.
        let newStudentCreds = null; // { email, password } — set only on create

        if (student) {
          // --- SKIP: this student is already in the roster ---
          // Bulk import only ever ADDS new students. An already-imported
          // student (matched by email, then admission number) is left
          // untouched and reported as skipped — re-uploading a roster that
          // overlaps the existing one won't silently rewrite records. To edit
          // an existing student, the admin opens their details and edits them
          // there. (Parent linking below is also skipped via `continue`.)
          skipped.push({ row: i + 1, name, email: student.email, reason: 'Student already exists' });
          continue;
        } else {
          // --- CREATE new student (mirrors POST /students) ---
          const email = studentEmail || generateStudentEmail(name, schoolName);
          const { data: dup } = await supabase.from('users').select('id, school_id').eq('email', email).maybeSingle();
          if (dup) {
            errors.push({ row: i + 1, error: 'Email already exists' });
            continue;
          }
          const password = generateSecurePassword();
          const admissionNumber = admissionNo || generateAdmissionNumber(schoolName, studentCount++);
          const firebaseUid = await createFirebaseAccount(email, password);
          studentUserId = randomUUID();
          const { error: userErr } = await supabase.from('users').insert({
            id: studentUserId, name, email, role: 'student',
            grade: grade || null, section: section || null, school: schoolName, school_id: schoolId, curriculum: rowCurriculum || resolveCurriculum(schoolBaseCurriculum, grade),
            admission_number: admissionNumber, status: 'active', onboarding_complete: true,
          });
          if (userErr) throw userErr;
          await supabase.from('student_stats').insert({ student_id: studentUserId });
          // accountStatus: 'active' skips the email-verification gate — same
          // reasoning as the single Add Student path above.
          await supabase.from('user_preferences').upsert({
            user_email: email,
            data: { loginId: email, initialPassword: password, studentName: name, grade: grade || null, section: section || null, school: schoolName, firebaseUid, mustChangePassword: true, accountStatus: 'active' },
          });
          created.push({ id: studentUserId, name, email });
          credentials.push({ name, email, password, role: 'student' });
          newStudentCreds = { email, password };

          // --- Auto-link to the class teacher of this grade+section (if any) ---
          if (grade && section) {
            const classTeacherId = classTeacherIdByGradeSection.get(`${grade}||${section}`);
            if (classTeacherId) {
              await supabase.from('teacher_student')
                .upsert({ teacher_id: classTeacherId, student_id: studentUserId, subject: 'Homeroom' },
                  { onConflict: 'teacher_id,student_id,subject', ignoreDuplicates: true });
            }
          }
        }

        // --- PARENT (only when a parent name is supplied) ---
        let resolvedParentEmail = ''; // set whenever a REAL (admin-provided) parent email is in play
        let newParentCreds = null;    // { name, email, password } — set only on create
        if (parentName) {
          let parentEmail = parentEmailIn;
          let parentUser = null;
          if (parentEmail) {
            const { data: existing } = await supabase.from('users').select('id, email, role, phone').eq('email', parentEmail).maybeSingle();
            if (existing && existing.role === 'parent') {
              parentUser = existing;
              if (parentPhone && parentPhone !== existing.phone) {
                await supabase.from('users').update({ phone: parentPhone }).eq('id', existing.id);
              }
            } else if (existing) {
              // Email belongs to a non-parent account — cannot reuse it.
              throw new Error(`Parent email ${parentEmail} already belongs to a non-parent account`);
            }
          }
          if (!parentUser) {
            if (!parentEmail) parentEmail = await generateParentLoginId(supabase);
            const pName = toTitleCase(parentName);
            const pPassword = generateSecurePassword();
            const pFirebaseUid = await createFirebaseAccount(parentEmail, pPassword);
            const parentUserId = randomUUID();
            const { error: pErr } = await supabase.from('users').insert({
              id: parentUserId, name: pName, email: parentEmail, role: 'parent',
              phone: parentPhone || null, school: schoolName, school_id: schoolId,
              status: 'active', onboarding_complete: true,
            });
            if (pErr) throw pErr;
            await supabase.from('user_preferences').upsert({
              user_email: parentEmail,
              data: { loginId: parentEmail, initialPassword: pPassword, parentName: pName, school: schoolName, firebaseUid: pFirebaseUid, mustChangePassword: true, accountStatus: 'active' },
            });
            credentials.push({ name: pName, email: parentEmail, password: pPassword, role: 'parent' });
            // Only a real, admin-provided parent email is deliverable — an
            // auto-generated placeholder (generateStaffEmail fallback above)
            // isn't a real inbox anyone checks.
            if (parentEmailIn) newParentCreds = { name: pName, email: parentEmail, password: pPassword };
          }

          // --- LINK (select-then-insert to avoid duplicate links) ---
          const { data: link } = await supabase.from('parent_children')
            .select('child_id').eq('parent_email', parentEmail).eq('child_id', studentUserId).maybeSingle();
          if (!link) {
            await supabase.from('parent_children').insert({ parent_email: parentEmail, child_id: studentUserId });
          }
          if (parentEmailIn) resolvedParentEmail = parentEmail;
        }

        // --- Portal-access emails for the newly created accounts in this row ---
        // Student: real email on file -> send login straight to the student;
        // otherwise fall back to the parent's real email with the student's
        // credentials (a child usually can't check a system-generated inbox).
        if (newStudentCreds) {
          if (studentEmail) {
            await sendCredentialsEmail({ to: newStudentCreds.email, childName: name, loginId: newStudentCreds.email, password: newStudentCreds.password, childEmail: newStudentCreds.email });
          } else if (resolvedParentEmail) {
            await sendCredentialsEmail({ to: resolvedParentEmail, childName: name, loginId: newStudentCreds.email, password: newStudentCreds.password, childEmail: newStudentCreds.email });
          }
        }
        // Parent: their own new account gets its own credentials email,
        // independent of whatever happened with the student's above.
        if (newParentCreds) {
          await sendOwnAccountCredentialsEmail({ to: newParentCreds.email, name: newParentCreds.name, loginId: newParentCreds.email, password: newParentCreds.password, role: 'parent' });
        }
      } catch (rowErr) {
        console.error(`[POST /school-admin/students/bulk] row ${i + 1} error:`, rowErr.message);
        errors.push({ row: i + 1, error: rowErr.message });
      }
    }

    await logImportRun({
      schoolId, type: 'students', fileName, runByEmail: req.adminScope.email,
      importedCount: created.length + updated.length, skippedCount: skipped.length + errors.length,
    });

    res.json({ created: created.length, updated: updated.length, skipped, errors, credentials });
  } catch (err) {
    console.error('[POST /school-admin/students/bulk] error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to bulk import students' });
  }
});

// ---------------------------------------------------------------------------
// Grades & Sections — a managed VIEW over the school's academic structure.
// Merge/persist logic lives in services/academicStructure.js (shared with
// routes/classes.js, which must be callable by student/parent/teacher too —
// this router's requireAdminScope middleware above would 403 those roles).
// ---------------------------------------------------------------------------
const { buildGradesSectionsView, saveStructure } = require('../services/academicStructure');

// GET /school-admin/grades-sections
router.get('/grades-sections', async (req, res) => {
  const schoolId = effectiveSchoolId(req);
  if (!schoolId) return res.status(400).json({ error: 'schoolId required for platform admins' });
  try {
    const grades = await buildGradesSectionsView(schoolId);
    res.json({ grades });
  } catch (err) {
    console.error('[GET /school-admin/grades-sections] error:', err.message);
    res.status(500).json({ error: 'Failed to load grades & sections' });
  }
});

// POST /school-admin/grades  { name }
router.post('/grades', async (req, res) => {
  if (req.adminScope.scopeType !== 'school') return res.status(400).json({ error: 'Only a school administrator can add a grade' });
  const schoolId = req.adminScope.schoolId;
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Grade name is required' });
  try {
    const grades = await buildGradesSectionsView(schoolId);
    if (grades.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: 'That grade already exists' });
    }
    grades.push({ name, archived: false, sections: [] });
    await saveStructure(schoolId, grades);
    res.status(201).json({ ok: true, grades: await buildGradesSectionsView(schoolId) });
  } catch (err) {
    console.error('[POST /school-admin/grades] error:', err.message);
    res.status(500).json({ error: 'Failed to add grade' });
  }
});

// POST /school-admin/grades/:grade/sections  { name }
router.post('/grades/:grade/sections', async (req, res) => {
  if (req.adminScope.scopeType !== 'school') return res.status(400).json({ error: 'Only a school administrator can add a section' });
  const schoolId = req.adminScope.schoolId;
  const gradeName = String(req.params.grade || '').trim();
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Section name is required' });
  try {
    const grades = await buildGradesSectionsView(schoolId);
    const grade = grades.find((g) => g.name === gradeName);
    if (!grade) return res.status(404).json({ error: 'Grade not found' });
    if (grade.sections.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: 'That section already exists in this grade' });
    }
    grade.sections.push({ name, archived: false, studentCount: 0 });
    await saveStructure(schoolId, grades);
    res.status(201).json({ ok: true, grades: await buildGradesSectionsView(schoolId) });
  } catch (err) {
    console.error('[POST /school-admin/grades/:grade/sections] error:', err.message);
    res.status(500).json({ error: 'Failed to add section' });
  }
});

// PATCH /school-admin/grades/:grade  { name, section?, sectionNewName? }
// Rename a grade (cascades to every student in it), OR rename a section within
// a grade (cascades to students in that grade+section) when `section` is given.
router.patch('/grades/:grade', async (req, res) => {
  if (req.adminScope.scopeType !== 'school') return res.status(400).json({ error: 'Only a school administrator can rename' });
  const schoolId = req.adminScope.schoolId;
  const gradeName = String(req.params.grade || '').trim();
  const section = req.body?.section != null ? String(req.body.section).trim() : null;
  const newName = String((section != null ? req.body?.sectionNewName : req.body?.name) || '').trim();
  if (!newName) return res.status(400).json({ error: 'New name is required' });
  try {
    const grades = await buildGradesSectionsView(schoolId);
    const grade = grades.find((g) => g.name === gradeName);
    if (!grade) return res.status(404).json({ error: 'Grade not found' });

    if (section != null) {
      const sec = grade.sections.find((s) => s.name === section);
      if (!sec) return res.status(404).json({ error: 'Section not found' });
      if (grade.sections.some((s) => s !== sec && s.name.toLowerCase() === newName.toLowerCase())) {
        return res.status(409).json({ error: 'Another section already has that name' });
      }
      sec.name = newName;
      await saveStructure(schoolId, grades);
      await supabase.from('users').update({ section: newName })
        .eq('school_id', schoolId).eq('role', 'student').eq('grade', gradeName).eq('section', section);
    } else {
      if (grades.some((g) => g !== grade && g.name.toLowerCase() === newName.toLowerCase())) {
        return res.status(409).json({ error: 'Another grade already has that name' });
      }
      grade.name = newName;
      await saveStructure(schoolId, grades);
      await supabase.from('users').update({ grade: newName })
        .eq('school_id', schoolId).eq('role', 'student').eq('grade', gradeName);
    }
    res.json({ ok: true, grades: await buildGradesSectionsView(schoolId) });
  } catch (err) {
    console.error('[PATCH /school-admin/grades/:grade] error:', err.message);
    res.status(500).json({ error: 'Failed to rename' });
  }
});

// PATCH /school-admin/grades/:grade/archive  { archived: bool, section? }
router.patch('/grades/:grade/archive', async (req, res) => {
  if (req.adminScope.scopeType !== 'school') return res.status(400).json({ error: 'Only a school administrator can archive' });
  const schoolId = req.adminScope.schoolId;
  const gradeName = String(req.params.grade || '').trim();
  const archived = req.body?.archived !== false; // default true
  const section = req.body?.section != null ? String(req.body.section).trim() : null;
  try {
    const grades = await buildGradesSectionsView(schoolId);
    const grade = grades.find((g) => g.name === gradeName);
    if (!grade) return res.status(404).json({ error: 'Grade not found' });
    if (section != null) {
      const sec = grade.sections.find((s) => s.name === section);
      if (!sec) return res.status(404).json({ error: 'Section not found' });
      sec.archived = archived;
    } else {
      grade.archived = archived;
    }
    await saveStructure(schoolId, grades);
    res.json({ ok: true, grades: await buildGradesSectionsView(schoolId) });
  } catch (err) {
    console.error('[PATCH /school-admin/grades/:grade/archive] error:', err.message);
    res.status(500).json({ error: 'Failed to archive' });
  }
});

// ---------------------------------------------------------------------------
// Classes — every non-archived grade+section pair from the same merged
// Grades & Sections view, each optionally assigned a class teacher. The
// class-teacher assignment is stored on the same academic_structure overlay
// (section.classTeacherEmail), so it survives grade/section renames.
// ---------------------------------------------------------------------------

// GET /school-admin/classes — flattened list for the Classes screen.
router.get('/classes', async (req, res) => {
  const schoolId = effectiveSchoolId(req);
  if (!schoolId) return res.status(400).json({ error: 'schoolId required for platform admins' });
  try {
    const grades = await buildGradesSectionsView(schoolId);
    const classes = [];
    const teacherEmails = new Set();
    for (const g of grades) {
      if (g.archived) continue;
      for (const s of g.sections) {
        if (s.archived) continue;
        if (s.classTeacherEmail) teacherEmails.add(s.classTeacherEmail);
        classes.push({ grade: g.name, section: s.name, studentCount: s.studentCount, classTeacherEmail: s.classTeacherEmail || null, classTeacherName: null });
      }
    }
    if (teacherEmails.size > 0) {
      const { data: teachers } = await supabase.from('users').select('email, name').in('email', [...teacherEmails]);
      const nameByEmail = new Map((teachers || []).map((t) => [t.email, t.name]));
      for (const c of classes) {
        if (c.classTeacherEmail) c.classTeacherName = nameByEmail.get(c.classTeacherEmail) || c.classTeacherEmail;
      }
    }
    res.json({ classes });
  } catch (err) {
    console.error('[GET /school-admin/classes] error:', err.message);
    res.status(500).json({ error: 'Failed to load classes' });
  }
});

// PATCH /school-admin/grades/:grade/sections/:section/class-teacher  { teacherEmail: string | null }
router.patch('/grades/:grade/sections/:section/class-teacher', async (req, res) => {
  if (req.adminScope.scopeType !== 'school') return res.status(400).json({ error: 'Only a school administrator can assign a class teacher' });
  const schoolId = req.adminScope.schoolId;
  const gradeName = String(req.params.grade || '').trim();
  const sectionName = String(req.params.section || '').trim();
  const teacherEmail = req.body?.teacherEmail ? String(req.body.teacherEmail).trim().toLowerCase() : null;
  try {
    if (teacherEmail) {
      const { data: teacher } = await supabase.from('users').select('id').eq('email', teacherEmail).eq('role', 'teacher').eq('school_id', schoolId).maybeSingle();
      if (!teacher) return res.status(404).json({ error: 'That teacher was not found in this school' });
    }
    const grades = await buildGradesSectionsView(schoolId);
    const grade = grades.find((g) => g.name === gradeName);
    if (!grade) return res.status(404).json({ error: 'Grade not found' });
    const section = grade.sections.find((s) => s.name === sectionName);
    if (!section) return res.status(404).json({ error: 'Section not found' });
    section.classTeacherEmail = teacherEmail;
    await saveStructure(schoolId, grades);

    // Auto-link the class teacher to every student in this grade+section, so
    // Messages/Contacts can resolve their parents without a manual DB fix.
    // (Root cause of a real bug: class-teacher assignment alone never used
    // to populate teacher_student — see chat-channel membership incident.)
    if (teacherEmail) {
      try {
        const { data: teacher } = await supabase.from('users').select('id').eq('email', teacherEmail).eq('role', 'teacher').eq('school_id', schoolId).maybeSingle();
        const { data: students } = await supabase.from('users').select('id')
          .eq('role', 'student').eq('school_id', schoolId).eq('grade', gradeName).eq('section', sectionName);
        if (teacher && students?.length) {
          const rows = students.map((s) => ({ teacher_id: teacher.id, student_id: s.id, subject: 'Homeroom' }));
          await supabase.from('teacher_student').upsert(rows, { onConflict: 'teacher_id,student_id,subject', ignoreDuplicates: true });
        }
      } catch (linkErr) {
        console.error('[class-teacher] teacher_student auto-link failed:', linkErr.message);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[PATCH /school-admin/grades/:grade/sections/:section/class-teacher] error:', err.message);
    res.status(500).json({ error: 'Failed to assign class teacher' });
  }
});

// ---------------------------------------------------------------------------
// Teachers & Parents (dedicated screens per the approved design — distinct
// from the generic /people roster: Teachers carries subject assignments,
// Parents carries linked-student counts, both real relational data.
// "Class teacher of" has no backend concept (no Classes entity exists yet,
// same reason Grades & Sections/Classes are deferred), so it's intentionally
// left out rather than faked.
// ---------------------------------------------------------------------------

router.get('/teachers', async (req, res) => {
  const schoolId = effectiveSchoolId(req);
  if (!schoolId) return res.status(400).json({ error: 'schoolId required for platform admins' });
  try {
    const { data: teachers, error } = await supabase
      .from('users').select('id, name, email, status, created_at, grade, curriculum')
      .eq('school_id', schoolId).eq('role', 'teacher').order('name');
    if (error) throw error;
    const emails = (teachers || []).map((t) => t.email);
    const mustChangeMap = await deriveStatusMap(emails);
    const { data: prefs } = emails.length
      ? await supabase.from('user_preferences').select('user_email, data').in('user_email', emails)
      : { data: [] };
    const teachesMap = new Map((prefs || []).map((p) => [p.user_email, p.data?.teaches || []]));

    res.json((teachers || []).map((t) => {
      const teaches = teachesMap.get(t.email) || [];
      // teaches[] is the source of truth ({grade,curriculum,subjects[]} per
      // entry); users.grade/curriculum are legacy single-value columns kept
      // in sync from the first entry for any code that still reads them.
      return {
        id: t.id, name: t.name, email: t.email,
        teaches,
        subjects: Array.from(new Set(teaches.flatMap((e) => Array.isArray(e?.subjects) ? e.subjects : []))),
        grade: t.grade || null, curriculum: t.curriculum || null,
        status: displayStatus(t.status, mustChangeMap.get(t.email) ?? true),
        joinedAt: t.created_at,
      };
    }));
  } catch (err) {
    console.error('[GET /school-admin/teachers] error:', err.message);
    res.status(500).json({ error: 'Failed to load teachers' });
  }
});

// Body accepts either the multi-entry `teaches: [{curriculum, grade, subjects[]}]`
// shape (a teacher can teach different subjects in different grades — e.g.
// Social Studies in Grade 3, Science in Grade 4), or the legacy single
// curriculum/grade/subjects fields for backward compatibility. When both are
// present, `teaches` wins.
function normalizeTeaches(body) {
  const { teaches, subjects, curriculum, grade } = body || {};
  if (Array.isArray(teaches) && teaches.length > 0) {
    return teaches
      .map((e) => ({
        curriculum: String(e?.curriculum || '').trim(),
        grade: String(e?.grade || '').trim(),
        subjects: Array.isArray(e?.subjects) ? e.subjects.map((s) => String(s).trim()).filter(Boolean) : [],
      }))
      .filter((e) => e.curriculum && e.grade);
  }
  const legacyCurriculum = String(curriculum || '').trim();
  const legacyGrade = String(grade || '').trim();
  if (!legacyCurriculum && !legacyGrade) return [];
  return [{
    curriculum: legacyCurriculum, grade: legacyGrade,
    subjects: Array.isArray(subjects) ? subjects.map((s) => String(s).trim()).filter(Boolean) : [],
  }];
}

router.post('/teachers', async (req, res) => {
  if (req.adminScope.scopeType !== 'school') return res.status(400).json({ error: 'Only a school administrator can add a teacher' });
  const schoolId = req.adminScope.schoolId;
  const { firstName, lastName, email: emailOverride } = req.body || {};
  if (!String(firstName || '').trim() || !String(lastName || '').trim()) return res.status(400).json({ error: 'First and last name are required' });
  try {
    const { data: school, error: schoolErr } = await supabase.from('schools').select('name').eq('id', schoolId).maybeSingle();
    if (schoolErr) throw schoolErr;
    const schoolName = school?.name || 'School';
    const name = toTitleCase(`${firstName.trim()} ${lastName.trim()}`);
    const email = String(emailOverride || '').trim().toLowerCase() || generateStaffEmail(name, schoolName, 'teacher');
    const password = generateSecurePassword();
    const teaches = normalizeTeaches(req.body);
    // Legacy single-value columns kept in sync from the first teaching entry
    // for any code that still reads users.curriculum/users.grade directly.
    const teachCurriculum = teaches[0]?.curriculum || null;
    const teachGrade = teaches[0]?.grade || null;

    const { data: dup } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
    if (dup) return res.status(409).json({ error: 'A user with this email already exists' });

    const firebaseUid = await createFirebaseAccount(email, password);
    const userId = randomUUID();
    const { error: userErr } = await supabase.from('users').insert({
      id: userId, name, email, role: 'teacher',
      school: schoolName, school_id: schoolId, status: 'active', onboarding_complete: true,
      curriculum: teachCurriculum, grade: teachGrade,
    });
    if (userErr) throw userErr;

    await supabase.from('user_preferences').upsert({
      user_email: email,
      data: { loginId: email, initialPassword: password, teacherName: name, school: schoolName, firebaseUid, teaches, teachCurriculum, teachGrade, mustChangePassword: true, accountStatus: 'active' },
    });

    // Email the login to the teacher when a real inbox was provided (an
    // auto-generated @school.teacher placeholder isn't deliverable).
    if (String(emailOverride || '').trim()) {
      await sendOwnAccountCredentialsEmail({ to: email, name, loginId: email, password, role: 'teacher' });
    }

    const allSubjects = Array.from(new Set(teaches.flatMap((e) => e.subjects)));
    res.status(201).json({ id: userId, name, email, password, teaches, subjects: allSubjects, status: 'invited' });
  } catch (err) {
    console.error('[POST /school-admin/teachers] error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to add teacher' });
  }
});

// ── Teacher bulk import: template + upsert-by-create ────────────────────────
const TEACHER_TEMPLATE_HEADER = ['Teacher Name', 'Email', 'Curriculum', 'Grade', 'Subjects', 'Phone'];
const TEACHER_SAMPLE_ROW_COUNT = 4;
function buildTeacherSampleRows(baseCurriculum) {
  const c1 = resolveCurriculum(baseCurriculum, 'Grade 1') || '';
  const c3 = resolveCurriculum(baseCurriculum, 'Grade 3') || '';
  const c4 = resolveCurriculum(baseCurriculum, 'Grade 4') || '';
  const c5 = resolveCurriculum(baseCurriculum, 'Grade 5') || '';
  return [
    // A teacher who handles more than one grade — recommended pattern: ONE
    // row, "|" separating each grade's Curriculum/Grade/Subjects, matched by
    // position. Works even when Email is left blank (the normal case).
    ['Mayur Sample (delete before uploading)', '', `${c1} | ${c3}`, 'Grade 1 | Grade 3', 'Social Studies | Maths', ''],
    // Alternative: same Email repeated on more than one row also merges into
    // ONE account — but only use this if you're supplying a real, exact-match
    // Email on every row for that teacher (a blank Email can't be repeated,
    // since it's auto-generated per row and won't match across rows).
    ['Priya Sample (delete before uploading)', 'priya.sample@example.com', c3, 'Grade 3', 'Maths; Science', '+91 90000 00001'],
    ['Priya Sample (delete before uploading)', 'priya.sample@example.com', c4, 'Grade 4', 'Social Studies', '+91 90000 00001'],
    ['Rahul Sample (delete before uploading)', '', c5, 'Grade 5', 'English', ''],
  ];
}

async function buildTeacherTemplateRows(schoolId) {
  const { data: school } = await supabase.from('schools').select('curriculum').eq('id', schoolId).maybeSingle();
  const sampleRows = buildTeacherSampleRows(school?.curriculum || null);

  const { data: teachers, error } = await supabase
    .from('users').select('name, email, phone, grade, curriculum').eq('school_id', schoolId).eq('role', 'teacher').order('name');
  if (error) throw error;
  const emails = (teachers || []).map((t) => t.email);
  const { data: prefs } = emails.length
    ? await supabase.from('user_preferences').select('user_email, data').in('user_email', emails)
    : { data: [] };
  const teachesMap = new Map((prefs || []).map((p) => [p.user_email, (p.data?.teaches || [])]));
  const realRows = (teachers || []).map((t) => {
    const teaches = teachesMap.get(t.email) || [];
    const subjectsCsv = Array.from(new Set(teaches.flatMap((e) => Array.isArray(e?.subjects) ? e.subjects : []))).join('; ');
    return [t.name || '', t.email || '', t.curriculum || '', t.grade || '', subjectsCsv, t.phone || ''];
  });
  return [...sampleRows, ...realRows];
}

// GET /school-admin/teachers/template.csv — registered here (there is no
// /teachers/:id route to shadow it, but keep it above any future one).
router.get('/teachers/template.csv', async (req, res) => {
  const schoolId = effectiveSchoolId(req);
  if (!schoolId) return res.status(400).json({ error: 'schoolId required for platform admins' });
  try {
    const rows = await buildTeacherTemplateRows(schoolId);
    const csv = toCsv(TEACHER_TEMPLATE_HEADER, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="teachers_template.csv"');
    res.send(csv);
  } catch (err) {
    console.error('[GET /school-admin/teachers/template.csv] error:', err.message);
    res.status(500).json({ error: 'Failed to build template' });
  }
});

router.get('/teachers/template.xlsx', async (req, res) => {
  const schoolId = effectiveSchoolId(req);
  if (!schoolId) return res.status(400).json({ error: 'schoolId required for platform admins' });
  try {
    const rows = await buildTeacherTemplateRows(schoolId);
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Aivorah';
    const ws = wb.addWorksheet('Teachers', { views: [{ state: 'frozen', ySplit: 1 }] });
    const widths = [30, 30, 12, 12, 26, 18];
    ws.columns = TEACHER_TEMPLATE_HEADER.map((header, i) => ({ header, key: `c${i}`, width: widths[i] || 18 }));
    const THIN = { style: 'thin', color: { argb: 'FFD9D3C7' } };
    ws.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5C4A1E' } };
      cell.border = { top: THIN, left: THIN, right: THIN, bottom: THIN };
    });
    ws.getRow(1).height = 22;
    // Phone column → Text, so a leading "+" isn't parsed as an Excel formula.
    const TCH_PHONE_COL = TEACHER_TEMPLATE_HEADER.indexOf('Phone') + 1;
    if (TCH_PHONE_COL > 0) ws.getColumn(TCH_PHONE_COL).numFmt = '@';
    rows.forEach((rowValues, i) => {
      const row = ws.addRow(rowValues);
      const isSample = i < TEACHER_SAMPLE_ROW_COUNT;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = { top: THIN, left: THIN, right: THIN, bottom: THIN };
        if (isSample) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBF0DA' } }; cell.font = { italic: true, color: { argb: 'FF8A7550' } }; }
      });
      if (TCH_PHONE_COL > 0) {
        const pc = row.getCell(TCH_PHONE_COL);
        pc.numFmt = '@';
        if (pc.value != null) pc.value = String(pc.value);
      }
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: TEACHER_TEMPLATE_HEADER.length } };
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="teachers_template.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[GET /school-admin/teachers/template.xlsx] error:', err.message);
    res.status(500).json({ error: 'Failed to build template' });
  }
});

// A teacher can teach different subjects in different grades (e.g. Social
// Studies in Grade 3, Science in Grade 4). Recommended pattern: a SINGLE row
// with "|"-separated groups in Grade and Subjects, matched by position —
// e.g. Grade "Grade 1 | Grade 3", Subjects "Social | Maths". A group's own
// subjects can still use ";"/"," for more than one subject in that grade,
// e.g. "Social | Maths; Science". Curriculum can be one value shared by every
// group, or its own "|"-separated value per group.
//
// This is preferred over repeating the same Email across multiple rows,
// because that alternative only works when the admin supplies an explicit,
// exactly-matching Email on every row for that teacher — a blank Email
// (the normal case) is auto-generated per row and can't be repeated, and a
// typo'd repeat silently creates a second teacher account instead of merging.
//
// Group counts across Grade/Subjects must match exactly (a single Curriculum
// group is allowed to apply to every grade) — a mismatch is rejected as a
// row error rather than silently mis-pairing or dropping data.
function parseRowTeachingEntries(rowCurriculum, rowGrade, rowSubjectsRaw, schoolBaseCurriculumForTeachers) {
  const grades = String(rowGrade || '').split('|').map((s) => s.trim()).filter(Boolean);
  if (grades.length === 0) return { entries: [], error: null };
  const curricula = String(rowCurriculum || '').split('|').map((s) => s.trim()).filter(Boolean);
  const subjectGroups = String(rowSubjectsRaw || '').split('|').map((s) => s.trim());
  if (grades.length > 1) {
    if (subjectGroups.length !== grades.length) {
      return { entries: [], error: `Grade has ${grades.length} "|"-separated groups but Subjects has ${subjectGroups.length} — they must match one-to-one` };
    }
    if (curricula.length > 1 && curricula.length !== grades.length) {
      return { entries: [], error: `Grade has ${grades.length} "|"-separated groups but Curriculum has ${curricula.length} — use one Curriculum for all grades, or one per grade` };
    }
  }
  const entries = grades.map((grade, i) => {
    const curriculum = curricula[i] || curricula[0] || resolveCurriculum(schoolBaseCurriculumForTeachers, grade) || '';
    const subjects = (subjectGroups[i] || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    return { curriculum, grade, subjects };
  }).filter((e) => e.curriculum && e.grade);
  return { entries, error: null };
}

// POST /school-admin/teachers/bulk — create teacher accounts from parsed rows.
// Body: { rows: [{ teacherName, email, curriculum, grade, subjects, phone }] }.
// subjects may be a string ("Maths; Science" / "Maths, Science") or an array.
router.post('/teachers/bulk', async (req, res) => {
  if (req.adminScope.scopeType !== 'school') return res.status(400).json({ error: 'Only a school administrator can bulk import teachers' });
  const schoolId = req.adminScope.schoolId;
  const { rows, fileName } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'rows must be a non-empty array' });
  try {
    const { data: school } = await supabase.from('schools').select('name, curriculum').eq('id', schoolId).maybeSingle();
    const schoolName = school?.name || 'School';
    const schoolBaseCurriculumForTeachers = school?.curriculum || null;
    const errors = [];
    const teacherByEmail = new Map(); // email -> record, for merging same-email rows within this batch
    const createdRecords = [];

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i] || {};
      const teacherName = String(raw.teacherName || '').trim();
      const emailIn = String(raw.email || '').trim().toLowerCase();
      const phone = String(raw.phone || '').trim();
      const rowCurriculum = String(raw.curriculum || '').trim();
      const rowSubjectsRaw = Array.isArray(raw.subjects) ? raw.subjects.join(', ') : String(raw.subjects || '');
      const { entries: rowEntries, error: groupError } = parseRowTeachingEntries(rowCurriculum, raw.grade, rowSubjectsRaw, schoolBaseCurriculumForTeachers);
      try {
        if (!teacherName) { errors.push({ row: i + 1, error: 'Teacher Name is required' }); continue; }
        if (groupError) { errors.push({ row: i + 1, error: groupError }); continue; }
        const name = toTitleCase(teacherName);
        // Legacy single-value columns kept in sync from the row's first
        // grade entry, for any code that still reads users.curriculum/grade.
        const teachCurriculum = rowEntries[0]?.curriculum || null;
        const teachGrade = rowEntries[0]?.grade || null;

        if (emailIn && teacherByEmail.has(emailIn)) {
          teacherByEmail.get(emailIn).teaches.push(...rowEntries);
          continue;
        }

        const email = emailIn || generateStaffEmail(name, schoolName, 'teacher');
        const { data: dup } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
        if (dup) { errors.push({ row: i + 1, error: 'Email already exists' }); continue; }
        const password = generateSecurePassword();
        const firebaseUid = await createFirebaseAccount(email, password);
        const userId = randomUUID();
        const { error: userErr } = await supabase.from('users').insert({
          id: userId, name, email, role: 'teacher', phone: phone || null,
          school: schoolName, school_id: schoolId, status: 'active', onboarding_complete: true,
          curriculum: teachCurriculum, grade: teachGrade,
        });
        if (userErr) throw userErr;
        const record = { userId, name, email, password, firebaseUid, teachCurriculum, teachGrade, teaches: [...rowEntries], sendEmail: !!emailIn };
        createdRecords.push(record);
        if (emailIn) teacherByEmail.set(emailIn, record);
      } catch (rowErr) {
        console.error(`[POST /school-admin/teachers/bulk] row ${i + 1} error:`, rowErr.message);
        errors.push({ row: i + 1, error: rowErr.message });
      }
    }

    // Persist prefs + send credentials once per created teacher, after every
    // row has been folded in (so multi-grade merges are complete first).
    const credentials = [];
    for (const rec of createdRecords) {
      await supabase.from('user_preferences').upsert({
        user_email: rec.email,
        data: { loginId: rec.email, initialPassword: rec.password, teacherName: rec.name, school: schoolName, firebaseUid: rec.firebaseUid, teaches: rec.teaches, teachCurriculum: rec.teachCurriculum, teachGrade: rec.teachGrade, mustChangePassword: true, accountStatus: 'active' },
      });
      credentials.push({ name: rec.name, email: rec.email, password: rec.password, role: 'teacher' });
      if (rec.sendEmail) await sendOwnAccountCredentialsEmail({ to: rec.email, name: rec.name, loginId: rec.email, password: rec.password, role: 'teacher' });
    }
    await logImportRun({
      schoolId, type: 'teachers', fileName, runByEmail: req.adminScope.email,
      importedCount: createdRecords.length, skippedCount: errors.length,
    });

    res.json({ created: createdRecords.length, updated: 0, errors, credentials });
  } catch (err) {
    console.error('[POST /school-admin/teachers/bulk] error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to bulk import teachers' });
  }
});

// Records the outcome of a bulk-import run for the Import History screen.
// Best-effort: a logging failure must never fail the import itself.
async function logImportRun({ schoolId, type, fileName, runByEmail, importedCount, skippedCount }) {
  const status = skippedCount === 0 ? 'Completed' : (importedCount > 0 ? 'Completed with errors' : 'Failed');
  try {
    await supabase.from('import_runs').insert({
      school_id: schoolId, type, file_name: fileName || 'import.csv', run_by_email: runByEmail,
      imported_count: importedCount, skipped_count: skippedCount, status,
    });
  } catch (err) {
    console.error('[logImportRun] failed to record import run:', err.message);
  }
}

// GET /school-admin/import-history — every past bulk-import run for this school.
router.get('/import-history', async (req, res) => {
  const schoolId = effectiveSchoolId(req);
  if (!schoolId) return res.status(400).json({ error: 'schoolId required for platform admins' });
  try {
    const { data, error } = await supabase
      .from('import_runs')
      .select('id, type, file_name, run_by_email, imported_count, skipped_count, status, created_at')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json((data || []).map((r) => ({
      id: r.id, type: r.type, fileName: r.file_name, runByEmail: r.run_by_email,
      importedCount: r.imported_count, skippedCount: r.skipped_count, status: r.status, createdAt: r.created_at,
    })));
  } catch (err) {
    console.error('[GET /school-admin/import-history] error:', err.message);
    res.status(500).json({ error: 'Failed to load import history' });
  }
});

router.get('/parents', async (req, res) => {
  const schoolId = effectiveSchoolId(req);
  if (!schoolId) return res.status(400).json({ error: 'schoolId required for platform admins' });
  try {
    const { data: parents, error } = await supabase
      .from('users').select('id, name, email, status, created_at')
      .eq('school_id', schoolId).eq('role', 'parent').order('name');
    if (error) throw error;
    const emails = (parents || []).map((p) => p.email);
    const mustChangeMap = await deriveStatusMap(emails);
    const { data: links } = emails.length
      ? await supabase.from('parent_children').select('parent_email, child_id').in('parent_email', emails)
      : { data: [] };
    const childIds = [...new Set((links || []).map((l) => l.child_id))];
    const { data: children } = childIds.length
      ? await supabase.from('users').select('id, name').in('id', childIds)
      : { data: [] };
    const childNameMap = new Map((children || []).map((c) => [c.id, c.name]));
    const linkedMap = new Map();
    for (const l of links || []) {
      const arr = linkedMap.get(l.parent_email) || [];
      const cname = childNameMap.get(l.child_id);
      if (cname) arr.push(cname);
      linkedMap.set(l.parent_email, arr);
    }

    res.json((parents || []).map((p) => ({
      id: p.id, name: p.name, email: p.email,
      linkedStudents: linkedMap.get(p.email) || [],
      status: displayStatus(p.status, mustChangeMap.get(p.email) ?? true),
      joinedAt: p.created_at,
    })));
  } catch (err) {
    console.error('[GET /school-admin/parents] error:', err.message);
    res.status(500).json({ error: 'Failed to load parents' });
  }
});

router.post('/parents', async (req, res) => {
  if (req.adminScope.scopeType !== 'school') return res.status(400).json({ error: 'Only a school administrator can invite a parent' });
  const schoolId = req.adminScope.schoolId;
  // children: how the admin identifies each kid to link — typed, not picked
  // from a list — { admissionNumber?, name?, grade?, section? }. Admission
  // number is exact and preferred; name (+ optional grade/section to
  // disambiguate same-name students) is the fallback. Every entry must
  // resolve to EXACTLY one student in this school or nothing is created —
  // a typo should never silently link the wrong child or create an orphaned
  // parent account.
  // studentIds/studentId: still accepted for any older caller (e.g. a
  // pick-list flow), folded in as already-resolved ids alongside `children`.
  const { firstName, lastName, email: emailOverride, phone, studentId, studentIds, children } = req.body || {};
  if (!String(firstName || '').trim() || !String(lastName || '').trim()) return res.status(400).json({ error: 'First and last name are required' });

  const presetIds = Array.from(new Set([
    ...(Array.isArray(studentIds) ? studentIds : []),
    ...(studentId ? [studentId] : []),
  ].filter(Boolean)));
  const childEntries = Array.isArray(children) ? children : [];

  try {
    // Resolve each typed child entry to exactly one student in this school.
    const resolvedIds = [];
    const unresolved = [];
    for (let i = 0; i < childEntries.length; i++) {
      const entry = childEntries[i] || {};
      const admissionNumber = String(entry.admissionNumber || '').trim();
      const name = String(entry.name || '').trim();
      const grade = String(entry.grade || '').trim();
      const section = String(entry.section || '').trim();

      if (!admissionNumber && !name) {
        unresolved.push({ index: i, reason: 'Enter an admission number or a student name.' });
        continue;
      }

      let query = supabase.from('users').select('id, name, grade, section')
        .eq('school_id', schoolId).eq('role', 'student');
      if (admissionNumber) {
        query = query.ilike('admission_number', admissionNumber);
      } else {
        query = query.ilike('name', name);
        if (grade) query = query.eq('grade', grade);
        if (section) query = query.eq('section', section);
      }
      const { data: matches, error: matchErr } = await query;
      if (matchErr) throw matchErr;

      if (!matches || matches.length === 0) {
        unresolved.push({
          index: i,
          reason: admissionNumber
            ? `No student found with admission number "${admissionNumber}".`
            : `No student found named "${name}"${grade ? ` in ${grade}` : ''}${section ? ` · ${section}` : ''}.`,
        });
      } else if (matches.length > 1) {
        unresolved.push({
          index: i,
          reason: `${matches.length} students match "${name || admissionNumber}" — add grade and section to narrow it down.`,
        });
      } else {
        resolvedIds.push(matches[0].id);
      }
    }

    if (unresolved.length > 0) {
      return res.status(400).json({ error: 'Could not match one or more children to a student record.', unresolved });
    }

    const linkIds = Array.from(new Set([...presetIds, ...resolvedIds]));

    const { data: school, error: schoolErr } = await supabase.from('schools').select('name').eq('id', schoolId).maybeSingle();
    if (schoolErr) throw schoolErr;
    const schoolName = school?.name || 'School';
    const name = toTitleCase(`${firstName.trim()} ${lastName.trim()}`);
    const email = String(emailOverride || '').trim().toLowerCase() || await generateParentLoginId(supabase);
    const cleanPhone = String(phone || '').trim() || null;
    const password = generateSecurePassword();

    const { data: dup } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
    if (dup) return res.status(409).json({ error: 'A user with this email already exists' });

    if (presetIds.length) {
      // Verify any already-resolved (pick-list) ids actually belong to this
      // school — resolvedIds above are already scoped by the query itself.
      const { data: matched } = await supabase.from('users').select('id').in('id', presetIds).eq('school_id', schoolId).eq('role', 'student');
      const matchedIds = new Set((matched || []).map((s) => s.id));
      const missing = presetIds.filter((id) => !matchedIds.has(id));
      if (missing.length) return res.status(400).json({ error: 'One or more selected students were not found in your school' });
    }

    const firebaseUid = await createFirebaseAccount(email, password);
    const userId = randomUUID();
    const { error: userErr } = await supabase.from('users').insert({
      id: userId, name, email, role: 'parent', phone: cleanPhone,
      school: schoolName, school_id: schoolId, status: 'active', onboarding_complete: true,
    });
    if (userErr) throw userErr;

    if (linkIds.length) {
      await supabase.from('parent_children').insert(linkIds.map((childId) => ({ parent_email: email, child_id: childId })));
    }

    await supabase.from('user_preferences').upsert({
      user_email: email,
      data: { loginId: email, initialPassword: password, parentName: name, school: schoolName, firebaseUid, mustChangePassword: true, accountStatus: 'active' },
    });

    res.status(201).json({ id: userId, name, email, password, status: 'invited' });
  } catch (err) {
    console.error('[POST /school-admin/parents] error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to invite parent' });
  }
});

// ---------------------------------------------------------------------------
// B2C → B2B access requests (Connect to My School approvals)
// Scoped to the admin's own school via effectiveSchoolId — an admin only ever
// sees / actions requests targeting their school.
// ---------------------------------------------------------------------------

// GET /school-admin/access-requests?adminEmail=[&status=pending]
router.get('/access-requests', async (req, res) => {
  const schoolId = effectiveSchoolId(req);
  if (!schoolId) return res.status(400).json({ error: 'schoolId required for platform admins' });
  const status = req.query.status || 'pending';
  try {
    const { data: reqs, error } = await supabase
      .from('school_access_requests')
      .select('id, user_email, grade, section, status, created_at')
      .eq('school_id', schoolId).eq('status', status)
      .order('created_at', { ascending: false });
    if (error) throw error;

    // Decorate each request with the full picture the admin needs to decide:
    // the requester's identity (name/role/grade/curriculum/phone/age), their
    // under-14 consent requirements, and — for a student — their linked parent(s).
    const emails = [...new Set((reqs || []).map((r) => r.user_email))];
    const userMap = new Map();       // email -> { id, name, role, grade, curriculum, phone, created_at }
    const prefMap = new Map();       // email -> { age, dateOfBirth, parentConsentStatus }
    if (emails.length) {
      const [{ data: users }, { data: prefs }] = await Promise.all([
        supabase.from('users').select('id, email, name, role, grade, curriculum, phone, created_at').in('email', emails),
        supabase.from('user_preferences').select('user_email, data').in('user_email', emails),
      ]);
      for (const u of users || []) userMap.set(u.email, u);
      for (const p of prefs || []) prefMap.set(p.user_email, p.data || {});
    }

    // Resolve linked parents for the student requesters. parent_children links a
    // parent_email to a child_id (the student's users.id); we then resolve each
    // parent_email to a display name + phone.
    const studentIds = [...new Set([...userMap.values()].filter((u) => u.role === 'student').map((u) => u.id))];
    const parentsByChildId = new Map(); // child_id -> [{ name, email, phone }]
    if (studentIds.length) {
      const { data: links } = await supabase
        .from('parent_children').select('child_id, parent_email').in('child_id', studentIds);
      const parentEmails = [...new Set((links || []).map((l) => l.parent_email))];
      const parentMap = new Map();
      if (parentEmails.length) {
        const { data: parents } = await supabase.from('users').select('email, name, phone').in('email', parentEmails);
        for (const p of parents || []) parentMap.set(p.email, p);
      }
      for (const l of links || []) {
        if (!parentsByChildId.has(l.child_id)) parentsByChildId.set(l.child_id, []);
        const pInfo = parentMap.get(l.parent_email) || {};
        parentsByChildId.get(l.child_id).push({ email: l.parent_email, name: pInfo.name || null, phone: pInfo.phone || null });
      }
    }

    res.json((reqs || []).map((r) => {
      const u = userMap.get(r.user_email);
      const pref = prefMap.get(r.user_email) || {};
      const parents = u ? (parentsByChildId.get(u.id) || []) : [];

      // Calculate or estimate age from profile preferences or grade level
      let age = pref.age || null;
      if (!age && pref.dateOfBirth) {
        const dob = new Date(pref.dateOfBirth);
        if (!isNaN(dob.getTime())) {
          age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
        }
      }
      // If age not explicitly provided, estimate from requested/current grade
      const gStr = String(r.grade || u?.grade || '').toLowerCase();
      let isUnder14 = age !== null ? age < 14 : true;
      if (age === null && (gStr.includes('myp 4') || gStr.includes('myp 5') || gStr.includes('dp') || gStr.includes('grade 9') || gStr.includes('grade 10') || gStr.includes('grade 11') || gStr.includes('grade 12'))) {
        isUnder14 = false;
      }

      // Determine parent consent status (< 14 vs >= 14)
      let parentConsentStatus = pref.parentConsentStatus || null;
      if (!parentConsentStatus) {
        if (isUnder14) {
          parentConsentStatus = parents.length > 0 ? 'approved_by_parent' : 'pending_parent_verification';
        } else {
          parentConsentStatus = parents.length > 0 ? 'student_initiated_with_parent' : 'student_initiated_independent';
        }
      }

      return {
        ...r,
        name: u?.name || null,
        role: u?.role || null,
        phone: u?.phone || null,
        age,
        isUnder14,
        parentConsentStatus,
        userCreatedAt: u?.created_at || null,
        studentGrade: u?.grade || null,
        curriculum: u?.curriculum || null,
        parents,
      };
    }));
  } catch (err) {
    console.error('[GET /school-admin/access-requests] error:', err.message);
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

// POST /school-admin/access-requests/:id/approve  { adminEmail }
// Links the requester and all linked parents to this school (B2C → B2B cascade)
// and sends professional welcome notifications via Resend.
router.post('/access-requests/:id/approve', async (req, res) => {
  const schoolId = effectiveSchoolId(req);
  if (!schoolId) return res.status(400).json({ error: 'schoolId required for platform admins' });
  try {
    const { data: reqRow, error: rErr } = await supabase
      .from('school_access_requests').select('*').eq('id', req.params.id).maybeSingle();
    if (rErr) throw rErr;
    if (!reqRow) return res.status(404).json({ error: 'Request not found' });
    // Ownership guard: an admin can only action requests for their own school.
    if (reqRow.school_id !== schoolId) return res.status(403).json({ error: 'Not authorized for this request' });
    if (reqRow.status !== 'pending') return res.status(409).json({ error: `Request already ${reqRow.status}` });

    // Look up school name and user record for cascade & notification
    const [{ data: schoolRow }, { data: userRow }] = await Promise.all([
      supabase.from('schools').select('name').eq('id', schoolId).maybeSingle(),
      supabase.from('users').select('id, name, role').eq('email', reqRow.user_email).maybeSingle(),
    ]);
    const schoolName = schoolRow?.name || 'Your School';

    // Link the user to the school AND place them in the requested grade+section
    const patch = { school_id: schoolId, school: schoolName };
    if (reqRow.grade) patch.grade = reqRow.grade;
    if (reqRow.section) patch.section = reqRow.section;
    const { error: uErr } = await supabase.from('users').update(patch).eq('email', reqRow.user_email);
    if (uErr) throw uErr;

    // Also update preferences data with school details
    const { data: prefRow } = await supabase.from('user_preferences').select('data').eq('user_email', reqRow.user_email).maybeSingle();
    const updatedPref = { ...(prefRow?.data || {}), school: schoolName, schoolId, accountStatus: 'active' };
    await supabase.from('user_preferences').upsert({ user_email: reqRow.user_email, data: updatedPref });

    // ── Cascade to linked parents (if requester is a student) ──────────────────
    let linkedParents = [];
    if (userRow && userRow.role === 'student' && userRow.id) {
      const { data: parentLinks } = await supabase.from('parent_children').select('parent_email').eq('child_id', userRow.id);
      if (parentLinks && parentLinks.length > 0) {
        const parentEmails = parentLinks.map(l => l.parent_email).filter(Boolean);
        if (parentEmails.length > 0) {
          // Link all parents to this school as B2B parent accounts
          await supabase.from('users').update({ school_id: schoolId, school: schoolName }).in('email', parentEmails);
          const { data: parentUsers } = await supabase.from('users').select('name, email').in('email', parentEmails);
          linkedParents = parentUsers || [];
          for (const p of linkedParents) {
            const { data: pPref } = await supabase.from('user_preferences').select('data').eq('user_email', p.email).maybeSingle();
            await supabase.from('user_preferences').upsert({
              user_email: p.email,
              data: { ...(pPref?.data || {}), school: schoolName, schoolId, accountStatus: 'active' },
            });
          }
        }
      }
    }

    const { error: sErr } = await supabase.from('school_access_requests')
      .update({ status: 'approved', reviewed_by: req.adminEmail, reviewed_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (sErr) throw sErr;

    // ── Send Professional Welcome Notifications via Resend ─────────────────────
    sendB2BConversionWelcomeEmail({
      to: reqRow.user_email,
      name: userRow?.name || null,
      role: userRow?.role || 'student',
      schoolName,
      grade: reqRow.grade,
      section: reqRow.section,
    }).catch(err => console.error('[approve request] failed to send student welcome email:', err.message));

    for (const p of linkedParents) {
      sendB2BConversionWelcomeEmail({
        to: p.email,
        name: p.name || 'Parent',
        role: 'parent',
        schoolName,
        studentName: userRow?.name || 'your child',
        grade: reqRow.grade,
        section: reqRow.section,
      }).catch(err => console.error('[approve request] failed to send parent welcome email:', err.message));
    }

    res.json({ ok: true, status: 'approved', cascadedParents: linkedParents.length });
  } catch (err) {
    console.error('[POST /school-admin/access-requests/:id/approve] error:', err.message);
    res.status(500).json({ error: 'Failed to approve request' });
  }
});

// POST /school-admin/access-requests/:id/reject  { adminEmail }
router.post('/access-requests/:id/reject', async (req, res) => {
  const schoolId = effectiveSchoolId(req);
  if (!schoolId) return res.status(400).json({ error: 'schoolId required for platform admins' });
  try {
    const { data: reqRow, error: rErr } = await supabase
      .from('school_access_requests').select('id, school_id, status').eq('id', req.params.id).maybeSingle();
    if (rErr) throw rErr;
    if (!reqRow) return res.status(404).json({ error: 'Request not found' });
    if (reqRow.school_id !== schoolId) return res.status(403).json({ error: 'Not authorized for this request' });
    if (reqRow.status !== 'pending') return res.status(409).json({ error: `Request already ${reqRow.status}` });

    const { error } = await supabase.from('school_access_requests')
      .update({ status: 'rejected', reviewed_by: req.adminEmail, reviewed_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true, status: 'rejected' });
  } catch (err) {
    console.error('[POST /school-admin/access-requests/:id/reject] error:', err.message);
    res.status(500).json({ error: 'Failed to reject request' });
  }
});

module.exports = router;
