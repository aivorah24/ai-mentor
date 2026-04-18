/**
 * One-time migration: convert student_preferences.json and habits_checkins.json
 * from plaintext email keys to SHA-256 hashed keys, and encrypt dob/phone fields.
 *
 * Run once: node scripts/migrate_encrypt_prefs.js
 * Safe to run multiple times — already-hashed keys are detected and skipped.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const { encrypt, hashEmail } = require('../utils/encryption');

const PREFS_FILE    = path.join(__dirname, '../data/student_preferences.json');
const CHECKIN_FILE  = path.join(__dirname, '../data/habits_checkins.json');
const ENCRYPTED_FIELDS = ['dob', 'phone'];

function isEmailKey(key) {
  return key.includes('@');
}

function migratePreferences() {
  if (!fs.existsSync(PREFS_FILE)) { console.log('No preferences file found, skipping.'); return; }
  const data = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8'));
  let changed = 0;

  for (const key of Object.keys(data)) {
    if (!isEmailKey(key)) continue; // already hashed, skip

    const record = data[key];
    const hashedKey = hashEmail(key);

    // Encrypt sensitive fields
    for (const field of ENCRYPTED_FIELDS) {
      if (record[field] && !record[field].includes(':')) {
        record[field] = encrypt(record[field]);
      }
    }

    // Move to hashed key, remove old key
    record.emailHash = hashedKey;
    delete record.email; // don't store plaintext email
    data[hashedKey] = record;
    delete data[key];
    changed++;
    console.log(`  preferences: migrated ${key} → ${hashedKey.slice(0, 12)}...`);
  }

  fs.writeFileSync(PREFS_FILE, JSON.stringify(data, null, 2));
  console.log(`preferences: ${changed} records migrated.`);
}

function migrateCheckins() {
  if (!fs.existsSync(CHECKIN_FILE)) { console.log('No checkins file found, skipping.'); return; }
  const data = JSON.parse(fs.readFileSync(CHECKIN_FILE, 'utf8'));
  let changed = 0;

  for (const key of Object.keys(data)) {
    if (!isEmailKey(key)) continue; // already hashed, skip

    const hashedKey = hashEmail(key);
    data[hashedKey] = data[key];
    delete data[key];
    changed++;
    console.log(`  checkins: migrated ${key} → ${hashedKey.slice(0, 12)}...`);
  }

  fs.writeFileSync(CHECKIN_FILE, JSON.stringify(data, null, 2));
  console.log(`checkins: ${changed} records migrated.`);
}

console.log('Starting PII migration...');
migratePreferences();
migrateCheckins();
console.log('Done.');
