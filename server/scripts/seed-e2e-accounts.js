/**
 * Seed (or clean up) the linked test accounts used by the end-to-end UI suite
 * (AIMentorApp/e2e/full-lifecycle.spec.ts).
 *
 * Creates THREE real Supabase-auth accounts, connected the way the app expects:
 *   • e2e.teacher@aivorah.test   (teacher · TSRA · IB PYP)
 *   • e2e.student@aivorah.test   (student · TSRA · IB PYP · PYP 4)
 *   • e2e.parent@aivorah.test    (parent, linked to the student)
 * Links: teacher_student + teacher_students (teacher↔student),
 *        parent_children + parent_student (parent↔student).
 *
 * Idempotent — safe to re-run (find-or-create by email, upsert rows/links).
 * Namespaced under @aivorah.test so it can never collide with real users.
 *
 *   node scripts/seed-e2e-accounts.js            # create/repair the accounts
 *   node scripts/seed-e2e-accounts.js --cleanup  # delete them
 *
 * Credentials are printed at the end (and mirrored in the Playwright spec's env).
 */
require('dotenv').config();
const supabase = require('../services/supabase');

const PASSWORD = process.env.E2E_PASSWORD || 'E2eTest!2026';
const SCHOOL = 'TSRA';
const CURRICULUM = 'IB PYP';
const GRADE = 'PYP 4';
const SECTION = 'A';

const ACCOUNTS = {
  teacher: { email: 'e2e.teacher@aivorah.test', name: 'E2E Teacher', role: 'teacher' },
  student: { email: 'e2e.student@aivorah.test', name: 'E2E Student', role: 'student' },
  parent:  { email: 'e2e.parent@aivorah.test',  name: 'E2E Parent',  role: 'parent'  },
};

// ── Find an auth user by email (listUsers is paginated) ──────────────────────
async function findAuthUserByEmail(email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = (data?.users || []).find(u => (u.email || '').toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (!data || data.users.length < 200) break; // last page
  }
  return null;
}

async function findOrCreateAuthUser(email) {
  const existing = await findAuthUserByEmail(email);
  if (existing) {
    // Ensure the password is the known test password (in case it drifted)
    await supabase.auth.admin.updateUserById(existing.id, { password: PASSWORD, email_confirm: true });
    return { id: existing.id, created: false };
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
  });
  if (error || !data?.user) throw new Error(`createUser(${email}) failed: ${error?.message || 'no user'}`);
  return { id: data.user.id, created: true };
}

async function upsertUserRow(id, acc) {
  const row = {
    id, name: acc.name, email: acc.email, role: acc.role,
    school: SCHOOL, onboarding_complete: true, status: 'active',
    created_at: new Date().toISOString(),
  };
  if (acc.role === 'student' || acc.role === 'teacher') { row.curriculum = CURRICULUM; }
  if (acc.role === 'student') { row.grade = GRADE; row.section = SECTION; }
  const { error } = await supabase.from('users').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(`users upsert (${acc.email}) failed: ${error.message}`);
}

async function ensureLink(table, match, insert) {
  const q = supabase.from(table).select('*', { head: false });
  Object.entries(match).forEach(([k, v]) => q.eq(k, v));
  const { data } = await q;
  if (data && data.length) return;
  const { error } = await supabase.from(table).insert(insert);
  if (error && error.code !== '23505') throw new Error(`${table} link failed: ${error.message}`);
}

async function seed() {
  const ids = {};
  for (const [key, acc] of Object.entries(ACCOUNTS)) {
    const { id, created } = await findOrCreateAuthUser(acc.email);
    ids[key] = id;
    await upsertUserRow(id, acc);
    console.log(`  ${created ? 'created' : 'exists '} ${acc.role.padEnd(7)} ${acc.email}  (${id})`);
  }

  // Teacher ↔ Student (both link tables the app reads from)
  await ensureLink('teacher_student', { teacher_id: ids.teacher, student_id: ids.student },
    { teacher_id: ids.teacher, student_id: ids.student, subject: 'Mathematics' });
  await ensureLink('teacher_students', { teacher_id: ids.teacher, student_id: ids.student },
    { teacher_id: ids.teacher, student_id: ids.student, section: SECTION, added_at: new Date().toISOString() });

  // Parent ↔ Student (email-based + id-based tables)
  await ensureLink('parent_children', { parent_email: ACCOUNTS.parent.email, child_id: ids.student },
    { parent_email: ACCOUNTS.parent.email, child_id: ids.student, added_at: new Date().toISOString() });
  await ensureLink('parent_student', { parent_id: ids.parent, student_id: ids.student },
    { parent_id: ids.parent, student_id: ids.student });

  console.log('  linked: teacher↔student, parent↔student');
  console.log('\n✅ E2E accounts ready. Credentials:');
  for (const acc of Object.values(ACCOUNTS)) console.log(`   ${acc.role.padEnd(7)} ${acc.email} / ${PASSWORD}`);
}

async function cleanup() {
  for (const acc of Object.values(ACCOUNTS)) {
    const authUser = await findAuthUserByEmail(acc.email);
    if (authUser) {
      await supabase.from('teacher_student').delete().eq('student_id', authUser.id);
      await supabase.from('teacher_students').delete().eq('student_id', authUser.id);
      await supabase.from('teacher_student').delete().eq('teacher_id', authUser.id);
      await supabase.from('teacher_students').delete().eq('teacher_id', authUser.id);
      await supabase.from('parent_student').delete().eq('student_id', authUser.id);
      await supabase.from('parent_student').delete().eq('parent_id', authUser.id);
      await supabase.from('parent_children').delete().eq('child_id', authUser.id);
      await supabase.from('parent_children').delete().eq('parent_email', acc.email);
      await supabase.from('users').delete().eq('id', authUser.id);
      await supabase.auth.admin.deleteUser(authUser.id);
      console.log(`  deleted ${acc.email}`);
    }
  }
  console.log('✅ E2E accounts removed.');
}

(async () => {
  try {
    if (process.argv.includes('--cleanup')) { console.log('Cleaning up E2E accounts...'); await cleanup(); }
    else { console.log('Seeding linked E2E accounts...'); await seed(); }
    process.exit(0);
  } catch (e) {
    console.error('❌ seed-e2e-accounts failed:', e.message);
    process.exit(1);
  }
})();
