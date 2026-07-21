/**
 * Firebase counterpart to seed-e2e-accounts.js.
 *
 * The web app logs in via Firebase Auth (signInWithEmailAndPassword), while
 * seed-e2e-accounts.js only provisions the Supabase side. Without a matching
 * Firebase user, browser login returns "Invalid email or password" even though
 * the backend API resolves the account fine. This ensures the same @aivorah.test
 * trio exists in Firebase with the known test password and verified email.
 *
 * Idempotent — safe to re-run.
 *
 * RUN:  node server/scripts/seed-e2e-firebase.js
 */
const admin = require('firebase-admin');
const path = require('path');
const serviceAccount = require(path.resolve(__dirname, '../firebase-service-account.json'));

const PASSWORD = process.env.E2E_PASSWORD || 'E2eTest!2026';
const ACCOUNTS = [
  { email: 'e2e.teacher@aivorah.test', name: 'E2E Teacher|teacher' },
  { email: 'e2e.student@aivorah.test', name: 'E2E Student|student' },
  { email: 'e2e.parent@aivorah.test',  name: 'E2E Parent|parent'  },
];

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const auth = admin.auth();

(async () => {
  console.log('Seeding Firebase E2E accounts...');
  for (const acc of ACCOUNTS) {
    try {
      const existing = await auth.getUserByEmail(acc.email).catch(() => null);
      if (existing) {
        await auth.updateUser(existing.uid, {
          password: PASSWORD, emailVerified: true, displayName: acc.name, disabled: false,
        });
        console.log(`  updated ${acc.email}  (${existing.uid})`);
      } else {
        const created = await auth.createUser({
          email: acc.email, password: PASSWORD, emailVerified: true, displayName: acc.name,
        });
        console.log(`  created ${acc.email}  (${created.uid})`);
      }
    } catch (e) {
      console.error(`  FAILED ${acc.email}: ${e.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n✅ Firebase E2E accounts ready. Password: ${PASSWORD}`);
})();
