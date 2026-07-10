// One-off: fully delete a user's data from Supabase (DB + Auth) and Firebase Auth.
// Usage: node delete_user_full.js <email>
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const EMAIL = process.argv[2];
if (!EMAIL) {
  console.error('Usage: node delete_user_full.js <email>');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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
  if (credential) admin.initializeApp({ credential });
}

async function delBy(table, column, value, label) {
  const { error, count } = await supabase.from(table).delete({ count: 'exact' }).eq(column, value);
  if (error) console.error(`  x ${label}: ${error.message}`);
  else console.log(`  - ${label}: ${count ?? 0} row(s) deleted`);
}

(async () => {
  console.log(`Looking up user ${EMAIL} ...`);
  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('id, email')
    .eq('email', EMAIL)
    .maybeSingle();

  if (userErr) {
    console.error('Error looking up user:', userErr.message);
    process.exit(1);
  }

  const userId = userRow?.id || null;
  console.log(userId ? `Found users.id = ${userId}` : 'No row in users table (will still clean email-keyed rows and auth accounts).');

  if (userId) {
    console.log('Deleting FK-referencing rows by id...');
    await delBy('assignment_submissions', 'student_id', userId, 'assignment_submissions.student_id');
    await delBy('assignments', 'student_id', userId, 'assignments.student_id');
    await delBy('assignments', 'created_by_id', userId, 'assignments.created_by_id');
    await delBy('challenge_assignments', 'student_id', userId, 'challenge_assignments.student_id');
    await delBy('topic_attempts', 'student_id', userId, 'topic_attempts.student_id');
    await delBy('messages', 'student_id', userId, 'messages.student_id');
    await delBy('student_daily_log', 'student_id', userId, 'student_daily_log.student_id');
    await delBy('student_stats', 'student_id', userId, 'student_stats.student_id');
    await delBy('parent_daily_tasks', 'child_id', userId, 'parent_daily_tasks.child_id');
    await delBy('parent_student', 'parent_id', userId, 'parent_student.parent_id');
    await delBy('parent_student', 'student_id', userId, 'parent_student.student_id');
    await delBy('teacher_student', 'teacher_id', userId, 'teacher_student.teacher_id');
    await delBy('teacher_student', 'student_id', userId, 'teacher_student.student_id');
    await delBy('teacher_students', 'teacher_id', userId, 'teacher_students.teacher_id');
    await delBy('teacher_students', 'student_id', userId, 'teacher_students.student_id');
    await delBy('student_subject_time', 'student_id', userId, 'student_subject_time.student_id');
  }

  console.log('Deleting email-keyed rows...');
  await delBy('parent_children', 'parent_email', EMAIL, 'parent_children.parent_email');
  await delBy('parent_children', 'child_email', EMAIL, 'parent_children.child_email');
  await delBy('user_preferences', 'user_email', EMAIL, 'user_preferences.user_email');
  await delBy('student_preferences', 'user_email', EMAIL, 'student_preferences.user_email');
  await delBy('analytics_events', 'user_email', EMAIL, 'analytics_events.user_email');
  await delBy('habits_checkins', 'user_email', EMAIL, 'habits_checkins.user_email');
  await delBy('llm_logs', 'student_email', EMAIL, 'llm_logs.student_email');

  if (userId) {
    console.log('Deleting users row...');
    await delBy('users', 'id', userId, 'users.id');
  }

  console.log('Deleting Supabase Auth account (if any)...');
  try {
    const { data: authList, error: listErr } = await supabase.auth.admin.listUsers();
    if (listErr) throw listErr;
    const authUser = authList.users.find(u => u.email === EMAIL);
    if (authUser) {
      const { error: delErr } = await supabase.auth.admin.deleteUser(authUser.id);
      if (delErr) console.error(`  x supabase auth: ${delErr.message}`);
      else console.log(`  - supabase auth: deleted (uid ${authUser.id})`);
    } else {
      console.log('  - supabase auth: no account found');
    }
  } catch (e) {
    console.error(`  x supabase auth lookup failed: ${e.message}`);
  }

  console.log('Deleting Firebase Auth account (if any)...');
  if (admin.apps.length) {
    try {
      const fbUser = await admin.auth().getUserByEmail(EMAIL);
      await admin.auth().deleteUser(fbUser.uid);
      console.log(`  - firebase auth: deleted (uid ${fbUser.uid})`);
    } catch (err) {
      if (err.code === 'auth/user-not-found') console.log('  - firebase auth: no account found');
      else console.error(`  x firebase auth: ${err.message}`);
    }
  } else {
    console.log('  - firebase auth: skipped (no credential configured)');
  }

  console.log('Done.');
  process.exit(0);
})();
