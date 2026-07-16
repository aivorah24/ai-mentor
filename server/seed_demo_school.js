require('dotenv').config();
const { randomUUID } = require('crypto');
const supabase = require('./services/supabase');
const { createFirebaseAccount } = require('./services/studentAccounts');

const SERVER_URL = 'http://localhost:3006';
const SCHOOL_NAME = 'Aivorah Demo School';
const ADMIN_EMAIL = 'schooladmin.demo@aivorah.com';
const ADMIN_PASSWORD = 'DemoAdmin123!';

const STUDENTS = [
  ['Aarav', 'Sharma', 'Grade 3', 'A'], ['Diya', 'Patel', 'Grade 3', 'A'], ['Vihaan', 'Reddy', 'Grade 3', 'B'],
  ['Ananya', 'Iyer', 'Grade 4', 'A'], ['Kabir', 'Nair', 'Grade 4', 'A'], ['Myra', 'Gupta', 'Grade 4', 'B'],
  ['Arjun', 'Rao', 'Grade 5', 'A'], ['Ishita', 'Menon', 'Grade 5', 'A'], ['Reyansh', 'Verma', 'Grade 5', 'B'],
  ['Saanvi', 'Pillai', 'Grade 6', 'A'], ['Vivaan', 'Joshi', 'Grade 6', 'A'], ['Aadhya', 'Kulkarni', 'Grade 6', 'B'],
  ['Advik', 'Bose', 'Grade 7', 'A'], ['Kiara', 'Chatterjee', 'Grade 7', 'A'], ['Shaurya', 'Desai', 'Grade 7', 'B'],
];

const TEACHERS = [
  ['Priya', 'Krishnan', ['Mathematics', 'Science']],
  ['Rahul', 'Agarwal', ['English']],
  ['Sneha', 'Bhatt', ['Social Studies', 'Hindi']],
  ['Vikram', 'Malhotra', ['Mathematics']],
  ['Neha', 'Chandran', ['Science', 'Environmental Studies']],
];

async function main() {
  console.log('1. Creating school...');
  const { data: existing } = await supabase.from('schools').select('id').eq('name', SCHOOL_NAME).maybeSingle();
  let schoolId;
  if (existing) {
    schoolId = existing.id;
    console.log('   already exists:', schoolId);
  } else {
    const { data: school, error } = await supabase.from('schools').insert({ name: SCHOOL_NAME }).select('id').single();
    if (error) throw error;
    schoolId = school.id;
    console.log('   created:', schoolId);
  }

  console.log('2. Creating school_admin account...');
  const { data: existingAdmin } = await supabase.from('users').select('id').eq('email', ADMIN_EMAIL).maybeSingle();
  if (!existingAdmin) {
    let firebaseUid;
    try {
      firebaseUid = await createFirebaseAccount(ADMIN_EMAIL, ADMIN_PASSWORD);
    } catch (e) {
      console.log('   firebase account may already exist, continuing:', e.message);
    }
    const adminId = randomUUID();
    const { error } = await supabase.from('users').insert({
      id: adminId, name: 'Demo School Admin', email: ADMIN_EMAIL, role: 'school_admin',
      school: SCHOOL_NAME, school_id: schoolId, status: 'active', onboarding_complete: true,
    });
    if (error) throw error;
    console.log('   created admin:', ADMIN_EMAIL);
  } else {
    console.log('   admin already exists');
  }

  // Ensure firebase password is set even if account already existed
  const admin = require('firebase-admin');
  const fs = require('fs');
  if (!admin.apps.length) {
    let credential;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
      credential = admin.credential.cert(JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8')));
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
    } else if (fs.existsSync('./firebase-service-account.json')) {
      credential = admin.credential.cert(require('./firebase-service-account.json'));
    }
    admin.initializeApp({ credential });
  }
  try {
    const fbUser = await admin.auth().getUserByEmail(ADMIN_EMAIL);
    await admin.auth().updateUser(fbUser.uid, { password: ADMIN_PASSWORD });
  } catch (e) {
    console.log('   (firebase password set skipped/failed):', e.message);
  }

  console.log('3. Seeding students via real API...');
  for (const [first, last, grade, section] of STUDENTS) {
    const res = await fetch(`${SERVER_URL}/school-admin/students?adminEmail=${encodeURIComponent(ADMIN_EMAIL)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: first, lastName: last, grade, section }),
    });
    const data = await res.json();
    console.log(`   ${res.ok ? 'OK' : 'FAIL'} ${first} ${last}`, res.ok ? '' : JSON.stringify(data));
  }

  console.log('4. Seeding teachers via real API...');
  for (const [first, last, subjects] of TEACHERS) {
    const res = await fetch(`${SERVER_URL}/school-admin/teachers?adminEmail=${encodeURIComponent(ADMIN_EMAIL)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: first, lastName: last, subjects }),
    });
    const data = await res.json();
    console.log(`   ${res.ok ? 'OK' : 'FAIL'} ${first} ${last}`, res.ok ? '' : JSON.stringify(data));
  }

  console.log('5. Fetching created students to link parents...');
  const listRes = await fetch(`${SERVER_URL}/school-admin/students?adminEmail=${encodeURIComponent(ADMIN_EMAIL)}&limit=100`);
  const listData = await listRes.json();
  const studentItems = listData.items || [];

  console.log('6. Seeding parents via real API (linked to first few students)...');
  const PARENTS = [
    ['Rajesh', 'Sharma', studentItems[0]?.id],
    ['Kavita', 'Patel', studentItems[1]?.id],
    ['Suresh', 'Reddy', studentItems[2]?.id],
    ['Meera', 'Iyer', studentItems[3]?.id],
  ];
  for (const [first, last, studentId] of PARENTS) {
    if (!studentId) continue;
    const res = await fetch(`${SERVER_URL}/school-admin/parents?adminEmail=${encodeURIComponent(ADMIN_EMAIL)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: first, lastName: last, studentId }),
    });
    const data = await res.json();
    console.log(`   ${res.ok ? 'OK' : 'FAIL'} ${first} ${last}`, res.ok ? '' : JSON.stringify(data));
  }

  console.log('\nDone. Log in as:');
  console.log('  Email:', ADMIN_EMAIL);
  console.log('  Password:', ADMIN_PASSWORD);
}

main().catch((e) => { console.error(e); process.exit(1); });
