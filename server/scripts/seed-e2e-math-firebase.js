/**
 * Firebase counterpart to seed-e2e-math-student.js (mirrors seed-e2e-firebase.js).
 * Browser login is Firebase Auth — without a matching Firebase user, login
 * returns "Invalid email or password" even though the Supabase side is fine.
 *
 *   node server/scripts/seed-e2e-math-firebase.js
 */
const admin = require('firebase-admin');
const path = require('path');
const serviceAccount = require(path.resolve(__dirname, '../firebase-service-account.json'));

const PASSWORD = process.env.E2E_PASSWORD || 'E2eTest!2026';
const EMAIL = 'e2e.mathstudent@aivorah.test';

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const auth = admin.auth();

(async () => {
  const existing = await auth.getUserByEmail(EMAIL).catch(() => null);
  if (existing) {
    await auth.updateUser(existing.uid, { password: PASSWORD, emailVerified: true, disabled: false });
    console.log(`updated ${EMAIL} (${existing.uid})`);
  } else {
    const created = await auth.createUser({ email: EMAIL, password: PASSWORD, emailVerified: true, displayName: 'E2E Math Student|student' });
    console.log(`created ${EMAIL} (${created.uid})`);
  }
})();
