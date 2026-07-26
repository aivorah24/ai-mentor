/**
 * seed-grade-audit-accounts.cjs — one CBSE test student per grade (1-12), in
 * both Firebase Auth (web login) and Supabase (users row), for the visual
 * G1-G12 chapter/title audit.
 *
 * Idempotent — safe to re-run.
 *   node scripts/seed-grade-audit-accounts.cjs
 */
require('dotenv').config();
const path = require('path');
const admin = require('firebase-admin');
const supabase = require('../services/supabase');

const PASSWORD = 'CbseAudit!2026';
const GRADES = Array.from({ length: 12 }, (_, i) => i + 1);

const serviceAccount = require(path.resolve(__dirname, '..', 'firebase-service-account.json'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const fbAuth = admin.auth();

async function findSupabaseUserId(email) {
  for (let page = 1; page <= 10; page++) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users || []).find(u => (u.email || '').toLowerCase() === email);
    if (hit) return hit.id;
    if (!data || data.users.length < 200) break;
  }
  return null;
}

(async () => {
  const creds = [];
  for (const g of GRADES) {
    const email = `cbse.g${g}.student@aivorah.test`;

    // Firebase side
    const existingFb = await fbAuth.getUserByEmail(email).catch(() => null);
    if (existingFb) {
      await fbAuth.updateUser(existingFb.uid, { password: PASSWORD, emailVerified: true, displayName: `CBSE G${g} Test Student|student`, disabled: false });
    } else {
      await fbAuth.createUser({ email, password: PASSWORD, emailVerified: true, displayName: `CBSE G${g} Test Student|student` });
    }

    // Supabase side
    let userId = await findSupabaseUserId(email);
    if (userId) {
      await supabase.auth.admin.updateUserById(userId, { password: PASSWORD, email_confirm: true });
    } else {
      const { data, error } = await supabase.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (error) throw new Error(`supabase createUser(${email}): ${error.message}`);
      userId = data.user.id;
    }
    const row = {
      id: userId, name: `CBSE G${g} Test Student`, email, role: 'student',
      school: 'TSRA', onboarding_complete: true, status: 'active',
      curriculum: 'CBSE', grade: `Grade ${g}`, section: 'A',
      created_at: new Date().toISOString(),
    };
    const { error: upErr } = await supabase.from('users').upsert(row, { onConflict: 'id' });
    if (upErr) throw new Error(`users upsert(${email}): ${upErr.message}`);

    creds.push({ grade: g, email, password: PASSWORD });
    console.log(`G${g}  ready  ${email}`);
  }

  console.log('\n| Grade | Email | Password |');
  console.log('|---|---|---|');
  for (const c of creds) console.log(`| Grade ${c.grade} | ${c.email} | ${c.password} |`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
