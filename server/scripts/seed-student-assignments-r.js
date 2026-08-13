/**
 * Seeds student-r for tests/student/assignments/*.spec.js - a dedicated
 * mutable account so that spec's real assignment creation/submission
 * (via /assignments POST + student UI) can't collide with any other
 * spec's account. CBSE/Grade 3, same default profile as student-a/j/k.
 *
 * Creates both the Supabase users row and the matching Firebase Auth user -
 * both are required for browser login to work (same two-part pattern as
 * seed-e2e-accounts.js + seed-student-learning-path-g6.js).
 *
 * Idempotent - safe to re-run.
 *
 *   node scripts/seed-student-assignments-r.js
 */
require('dotenv').config();
const admin = require('firebase-admin');
const path = require('path');
const supabase = require('../services/supabase');
const serviceAccount = require(path.resolve(__dirname, '../firebase-service-account.json'));

const PASSWORD = process.env.E2E_PASSWORD || 'E2eTest!2026';
const SCHOOL = 'TSRA';
const CURRICULUM = 'CBSE';
const GRADE = 'Grade 3';

const ACCOUNT = { key: 'r', email: process.env.E2E_STUDENT_R || 'e2e.student.r@aivorah.test', name: 'E2E Student R' };

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
    id, name: acc.name, email: acc.email, role: 'student',
    school: SCHOOL, curriculum: CURRICULUM, grade: GRADE,
    onboarding_complete: true, status: 'active',
    // Backdated on purpose: routes/assignments.js sets `joinedAfterDue` when
    // studentJoinedAt > dueDate, which suppresses the "Ready"/overdue status
    // for any assignment due before the student joined. A freshly-created
    // account (created_at = now) could never show a real overdue assignment,
    // so this account is backdated to let the Assignments spec create one
    // with a genuinely past due date.
    created_at: '2020-01-01T00:00:00.000Z',
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

(async () => {
  try {
    const id = await findOrCreateSupabaseUser(ACCOUNT.email);
    await upsertUserRow(id, ACCOUNT);
    await ensureFirebaseUser(ACCOUNT);
    console.log(`  ready student-${ACCOUNT.key}  ${ACCOUNT.email}  (${id})  CBSE Grade 3`);
    console.log(`\n✅ student-r ready. Password: ${PASSWORD}`);
    process.exit(0);
  } catch (e) {
    console.error('❌ seed-student-assignments-r failed:', e.message);
    process.exit(1);
  }
})();
