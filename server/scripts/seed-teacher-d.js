/**
 * Seeds teacher-d for tests/student/assignments/*.spec.js's cross-persona
 * test - a teacher who assigns a real quiz to student-r through the real
 * Teacher Assignments UI (Quiz Library -> Assign -> Publish), so the
 * Assignments spec can verify the FULL teacher-assigns -> student-receives
 * -> student-submits loop, not just the student half via API-seeded data.
 *
 * Dedicated account, not teacher-a - keeps this roster link off teacher-a's
 * own roster (used by tests/teacher/*-analytics.spec.js).
 *
 * Links teacher-d -> student-r via teacher_student (same table/shape as
 * seed-mock-teacher-progress.cjs).
 *
 * Creates both the Supabase users row and the matching Firebase Auth user -
 * both are required for browser login to work (same two-part pattern as
 * seed-student-assignments-r.js).
 *
 * Idempotent - safe to re-run.
 *
 *   node scripts/seed-teacher-d.js
 */
require('dotenv').config();
const admin = require('firebase-admin');
const path = require('path');
const supabase = require('../services/supabase');
const serviceAccount = require(path.resolve(__dirname, '../firebase-service-account.json'));

const PASSWORD = process.env.E2E_PASSWORD || 'E2eTest!2026';
const SCHOOL = 'TSRA';
const CURRICULUM = 'CBSE';

const TEACHER = { key: 'd', email: process.env.E2E_TEACHER_D || 'e2e.teacher.d@aivorah.test', name: 'E2E Teacher D' };
const STUDENT_R_EMAIL = process.env.E2E_STUDENT_R || 'e2e.student.r@aivorah.test';

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const fbAuth = admin.auth();

async function findAuthUserByEmail(email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = (data?.users || []).find(u => (u.email || '').toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (!data || data.users.length < 200) break;
  }
  return null;
}

async function findOrCreateSupabaseUser(email) {
  const existing = await findAuthUserByEmail(email);
  if (existing) {
    await supabase.auth.admin.updateUserById(existing.id, { password: PASSWORD, email_confirm: true });
    return existing.id;
  }
  const { data, error } = await supabase.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data?.user) throw new Error(`createUser(${email}) failed: ${error?.message || 'no user'}`);
  return data.user.id;
}

async function upsertUserRow(id, acc) {
  const row = {
    id, name: acc.name, email: acc.email, role: 'teacher',
    school: SCHOOL, curriculum: CURRICULUM,
    onboarding_complete: true, status: 'active', created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('users').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(`users upsert (${acc.email}) failed: ${error.message}`);
}

async function ensureFirebaseUser(acc) {
  const existing = await fbAuth.getUserByEmail(acc.email).catch(() => null);
  if (existing) {
    await fbAuth.updateUser(existing.uid, { password: PASSWORD, emailVerified: true, displayName: acc.name, disabled: false });
    return;
  }
  await fbAuth.createUser({ email: acc.email, password: PASSWORD, emailVerified: true, displayName: acc.name });
}

async function linkToStudentR(teacherId) {
  const { data: student, error: findErr } = await supabase
    .from('users').select('id').eq('email', STUDENT_R_EMAIL).maybeSingle();
  if (findErr || !student) throw new Error(`student-r (${STUDENT_R_EMAIL}) not found - seed it first via seed-student-assignments-r.js`);
  const { error } = await supabase
    .from('teacher_student')
    .upsert({ teacher_id: teacherId, student_id: student.id, subject: 'Mathematics' }, { onConflict: 'teacher_id,student_id,subject' });
  if (error) throw new Error(`teacher_student link failed: ${error.message}`);
  return student.id;
}

(async () => {
  try {
    const id = await findOrCreateSupabaseUser(TEACHER.email);
    await upsertUserRow(id, TEACHER);
    await ensureFirebaseUser(TEACHER);
    const studentId = await linkToStudentR(id);
    console.log(`  ready teacher-${TEACHER.key}  ${TEACHER.email}  (${id})`);
    console.log(`  linked to student-r (${studentId})`);
    console.log(`\n✅ teacher-d ready. Password: ${PASSWORD}`);
    process.exit(0);
  } catch (e) {
    console.error('❌ seed-teacher-d failed:', e.message);
    process.exit(1);
  }
})();
