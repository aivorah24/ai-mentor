// One-off: delete specific users from Firebase Auth by email.
// Usage:  node delete_firebase_users.js
require('dotenv').config();
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

if (!admin.apps.length) {
  let credential = null;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
    credential = admin.credential.cert(JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8')));
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  } else {
    const svcPath = path.join(__dirname, 'firebase-service-account.json');
    if (fs.existsSync(svcPath)) credential = admin.credential.cert(require(svcPath));
  }
  if (!credential) { console.error('No Firebase service account found.'); process.exit(1); }
  admin.initializeApp({ credential });
}

// Pass emails as CLI args:  node delete_firebase_users.js a@x.com b@y.com
// Falls back to this list if no args are given.
const EMAILS = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [
  // (default list — edit or pass args instead)
];

(async () => {
  for (const email of EMAILS) {
    try {
      const user = await admin.auth().getUserByEmail(email);
      await admin.auth().deleteUser(user.uid);
      console.log(`✅ deleted ${email} (uid ${user.uid})`);
    } catch (err) {
      if (err.code === 'auth/user-not-found') console.log(`— ${email}: not in Firebase Auth`);
      else console.error(`❌ ${email}: ${err.message}`);
    }
  }
  process.exit(0);
})();
