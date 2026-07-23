/**
 * One-off repair — undo a corrupted Google-SSO "change email".
 *
 * The old /change-email rewrote a Google account's Firebase top-level email but
 * could not re-point its google.com provider, leaving a split-brain user. This
 * moves the identity BACK to the original Google address on BOTH sides so the
 * account logs in normally again; the user can then re-migrate via the new
 * in-app "Switch Google Account" flow.
 *
 * Usage (from server/):
 *   node scripts/revert-email-swap.js <fromEmail(current/wrong)> <toEmail(original google)> [--commit]
 *
 * Example:
 *   node scripts/revert-email-swap.js parentaivorah@gmail.com kannansaimohan2003@gmail.com --commit
 *
 * Without --commit it runs a DRY RUN (prints what it would change, mutates nothing).
 */
require('dotenv').config();
const admin = require('firebase-admin');
const supabase = require('../services/supabase');

const [, , fromRaw, toRaw, ...flags] = process.argv;
const COMMIT = flags.includes('--commit');
const fromEmail = String(fromRaw || '').trim().toLowerCase();
const toEmail   = String(toRaw || '').trim().toLowerCase();

if (!fromEmail || !toEmail) {
  console.error('Usage: node scripts/revert-email-swap.js <fromEmail> <toEmail> [--commit]');
  process.exit(1);
}

function initFirebase() {
  if (!admin.apps.length) {
    const svcPath = require('path').join(__dirname, '../firebase-service-account.json');
    admin.initializeApp({ credential: admin.credential.cert(require(svcPath)) });
  }
  return admin;
}

async function main() {
  console.log(`\n=== Revert email  ${fromEmail}  →  ${toEmail}  (${COMMIT ? 'COMMIT' : 'DRY RUN'}) ===\n`);
  initFirebase();

  // 1. Firebase: inspect the current (wrong) user and its provider linkage.
  let fbUser = null;
  try {
    fbUser = await admin.auth().getUserByEmail(fromEmail);
    const providers = (fbUser.providerData || []).map(p => `${p.providerId}(${p.email || '—'})`).join(', ');
    console.log(`[firebase] found uid=${fbUser.uid}`);
    console.log(`[firebase] top-level email = ${fbUser.email}`);
    console.log(`[firebase] providers        = ${providers}`);
  } catch (e) {
    console.log(`[firebase] no user for ${fromEmail} (${e.code || e.message}) — will only fix Supabase.`);
  }

  // Safety: make sure nothing already owns the destination address in Firebase.
  try {
    const clash = await admin.auth().getUserByEmail(toEmail);
    if (!fbUser || clash.uid !== fbUser.uid) {
      console.error(`[firebase] ABORT: ${toEmail} is already a DIFFERENT Firebase user (uid=${clash.uid}).`);
      process.exit(2);
    }
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
  }

  // 2. Apply Firebase top-level email revert.
  if (fbUser) {
    if (COMMIT) {
      await admin.auth().updateUser(fbUser.uid, { email: toEmail, emailVerified: true });
      console.log(`[firebase] ✓ top-level email set to ${toEmail}`);
    } else {
      console.log(`[firebase] would set top-level email → ${toEmail}`);
    }
  }

  // 3. Supabase: rename the identity row + every email-keyed table back.
  const emailKeyedTables = [
    ['users',                'email'],
    ['user_preferences',     'user_email'],
    ['student_preferences',  'user_email'],
    ['analytics_events',     'user_email'],
    ['habits_checkins',      'user_email'],
    ['llm_logs',             'student_email'],
    ['parent_children',      'parent_email'],
  ];
  for (const [table, col] of emailKeyedTables) {
    if (!COMMIT) { console.log(`[supabase] would update ${table}.${col}  ${fromEmail} → ${toEmail}`); continue; }
    const { error } = await supabase.from(table).update({ [col]: toEmail }).eq(col, fromEmail);
    console.log(error ? `[supabase] ✗ ${table}.${col}: ${error.message}` : `[supabase] ✓ ${table}.${col}`);
  }

  // 4. Supabase Auth (if a password-based auth user exists under fromEmail).
  try {
    const { data: list } = await supabase.auth.admin.listUsers();
    const authUser = list?.users?.find(u => u.email === fromEmail);
    if (authUser) {
      if (COMMIT) {
        await supabase.auth.admin.updateUserById(authUser.id, { email: toEmail, email_confirm: true });
        console.log(`[supabase-auth] ✓ ${authUser.id} email → ${toEmail}`);
      } else {
        console.log(`[supabase-auth] would update ${authUser.id} email → ${toEmail}`);
      }
    } else {
      console.log('[supabase-auth] no password-based auth user for fromEmail (nothing to do).');
    }
  } catch (e) {
    console.log(`[supabase-auth] skipped: ${e.message}`);
  }

  console.log(`\n=== ${COMMIT ? 'DONE' : 'DRY RUN complete — re-run with --commit to apply'} ===\n`);
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
