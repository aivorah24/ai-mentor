/**
 * One-off, cleanup-able test student for verifying the Math Learning Engine
 * prototype (Grade 6 NCERT Mathematics). Mirrors seed-e2e-accounts.js's
 * namespacing convention (@aivorah.test) so it can never collide with real
 * users and is trivially removable.
 *
 *   node scripts/seed-e2e-math-student.js            # create/repair
 *   node scripts/seed-e2e-math-student.js --cleanup  # delete
 */
require('dotenv').config();
const supabase = require('../services/supabase');

const PASSWORD = process.env.E2E_PASSWORD || 'E2eTest!2026';
const ACCOUNT = { email: 'e2e.mathstudent@aivorah.test', name: 'E2E Math Student', role: 'student' };

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

async function seed() {
  const existing = await findAuthUserByEmail(ACCOUNT.email);
  let id;
  if (existing) {
    await supabase.auth.admin.updateUserById(existing.id, { password: PASSWORD, email_confirm: true });
    id = existing.id;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({ email: ACCOUNT.email, password: PASSWORD, email_confirm: true });
    if (error || !data?.user) throw new Error(`createUser failed: ${error?.message}`);
    id = data.user.id;
  }
  const { error } = await supabase.from('users').upsert({
    id, name: ACCOUNT.name, email: ACCOUNT.email, role: 'student',
    school: '', onboarding_complete: true, status: 'active',
    curriculum: 'NCERT', grade: 'Grade 6', section: 'A',
    created_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw new Error(`users upsert failed: ${error.message}`);
  console.log(`✅ ${ACCOUNT.email} / ${PASSWORD}  (id ${id})`);
}

async function cleanup() {
  const existing = await findAuthUserByEmail(ACCOUNT.email);
  if (!existing) { console.log('nothing to clean up'); return; }
  await supabase.from('users').delete().eq('id', existing.id);
  await supabase.auth.admin.deleteUser(existing.id);
  console.log(`deleted ${ACCOUNT.email}`);
}

(async () => {
  try {
    if (process.argv.includes('--cleanup')) await cleanup();
    else await seed();
    process.exit(0);
  } catch (e) {
    console.error('❌', e.message);
    process.exit(1);
  }
})();
