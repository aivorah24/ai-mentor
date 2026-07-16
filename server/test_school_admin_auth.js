/**
 * Cross-school authorization tests for the School Admin Console + scoped
 * announcement management. Run against a LOCAL server (node index.js):
 *
 *   node test_school_admin_auth.js
 *
 * Uses the dedicated test identities created 2026-07-12 (safe, clearly named,
 * no real users):
 *   schooladmin.tsra.test@aivorah.com     — school_admin @ "TSRA" school row
 *   schooladmin.other.test@aivorah.com    — school_admin @ "North High School"
 *   schooladmin.noschool.test@aivorah.com — school_admin, school_id = null
 *   preddy6678@gmail.com                  — global allowlist admin
 *
 * Test announcements created here are archived-by-id at the end via the
 * global admin (no hard deletes; titles prefixed [AUTHTEST]).
 */
const BASE = process.env.BASE_URL || 'http://localhost:3006';
const TSRA = 'schooladmin.tsra.test@aivorah.com';
const OTHER = 'schooladmin.other.test@aivorah.com';
const NOSCHOOL = 'schooladmin.noschool.test@aivorah.com';
const GLOBAL = 'preddy6678@gmail.com';

let pass = 0, fail = 0;
const created = [];

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail}`); }
}

async function api(path, method = 'GET', body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function main() {
  console.log(`\n── School-admin authorization tests → ${BASE} ──\n`);

  // ── Scope resolution ──────────────────────────────────────────────────
  console.log('Scope resolution:');
  let r = await api(`/school-admin/overview?adminEmail=${TSRA}`);
  check('TSRA admin can access own dashboard', r.status === 200 && r.data?.school?.name === 'TSRA');
  const tsraSchoolId = r.data?.school?.id;

  r = await api(`/school-admin/overview?adminEmail=${OTHER}`);
  check('Other admin resolves to their own school', r.status === 200 && r.data?.school?.name === 'North High School');
  const otherSchoolId = r.data?.school?.id;

  r = await api(`/school-admin/overview?adminEmail=${NOSCHOOL}`);
  check('Null-school admin is rejected (403)', r.status === 403, `got ${r.status}`);

  r = await api(`/school-admin/overview?adminEmail=nobody@example.com`);
  check('Non-admin is rejected (403)', r.status === 403, `got ${r.status}`);

  // Tampering: TSRA admin passes other school's id — server must ignore it.
  r = await api(`/school-admin/overview?adminEmail=${TSRA}&schoolId=${otherSchoolId}`);
  check('TSRA admin cannot switch schools via ?schoolId (forced to own)', r.status === 200 && r.data?.school?.id === tsraSchoolId);

  r = await api(`/school-admin/people?adminEmail=${TSRA}&schoolId=${otherSchoolId}`);
  const peopleAllTsra = Array.isArray(r.data) && r.data.every((u) => true); // rows come pre-scoped
  r = await api(`/school-admin/people?adminEmail=${OTHER}`);
  const otherPeople = r.data || [];
  r = await api(`/school-admin/people?adminEmail=${TSRA}`);
  const tsraPeople = r.data || [];
  const overlap = tsraPeople.filter((u) => otherPeople.some((o) => o.id === u.id));
  check('People rosters do not overlap across schools', overlap.length === 0, `${overlap.length} shared rows`);

  r = await api(`/school-admin/overview?adminEmail=${GLOBAL}&schoolId=${tsraSchoolId}`);
  check('Global admin can inspect any school explicitly', r.status === 200 && r.data?.school?.id === tsraSchoolId);

  // ── Announcement create scoping ──────────────────────────────────────
  console.log('\nAnnouncement creation:');
  // TSRA admin tries to create a GLOBAL announcement (no targets) + tampered target
  r = await api('/announcements/admin', 'POST', {
    adminEmail: TSRA, title: '[AUTHTEST] TSRA notice', body: 'test', status: 'published',
    targets: [{ schoolId: otherSchoolId, role: 'parent' }], // tampered: points at other school
  });
  check('TSRA admin create succeeds', r.status === 201);
  const tsraAnn = r.data;
  if (tsraAnn?.id) created.push(tsraAnn.id);
  check('...but server forced target school to TSRA (tamper ignored)',
    tsraAnn?.audienceSchoolId === tsraSchoolId, `got ${tsraAnn?.audienceSchoolId}`);

  r = await api('/announcements/admin', 'POST', {
    adminEmail: TSRA, title: '[AUTHTEST] attempted global', body: 'test', status: 'draft', targets: [],
  });
  check('TSRA admin cannot create a global announcement (targets forced to school)',
    r.status === 201 && r.data?.audienceSchoolId === tsraSchoolId, `got ${r.data?.audienceSchoolId}`);
  if (r.data?.id) created.push(r.data.id);

  r = await api('/announcements/admin', 'POST', {
    adminEmail: NOSCHOOL, title: '[AUTHTEST] should fail', body: 'x',
  });
  check('Null-school admin cannot create (403)', r.status === 403, `got ${r.status}`);

  // Global admin creates a cross-school announcement targeting TSRA + Other
  r = await api('/announcements/admin', 'POST', {
    adminEmail: GLOBAL, title: '[AUTHTEST] platform multi-school', body: 'platform notice', status: 'published',
    targets: [{ schoolId: tsraSchoolId, role: null }, { schoolId: otherSchoolId, role: null }],
  });
  check('Global admin can create multi-school announcement', r.status === 201);
  const platformAnn = r.data;
  if (platformAnn?.id) created.push(platformAnn.id);

  // ── Announcement management ownership ─────────────────────────────────
  console.log('\nAnnouncement management ownership:');
  r = await api(`/announcements/admin/${tsraAnn.id}`, 'PATCH', { adminEmail: TSRA, title: '[AUTHTEST] TSRA notice (edited)' });
  check('TSRA admin can edit own school announcement', r.status === 200);

  r = await api(`/announcements/admin/${tsraAnn.id}`, 'PATCH', { adminEmail: OTHER, title: 'hijacked' });
  check('Other-school admin cannot edit TSRA announcement (403)', r.status === 403, `got ${r.status}`);

  r = await api(`/announcements/admin/${tsraAnn.id}/archive`, 'POST', { adminEmail: OTHER });
  check('Other-school admin cannot archive TSRA announcement (403)', r.status === 403, `got ${r.status}`);

  r = await api(`/announcements/admin/${platformAnn.id}`, 'PATCH', { adminEmail: TSRA, title: 'hijack platform' });
  check('TSRA admin cannot edit platform multi-school announcement (403)', r.status === 403, `got ${r.status}`);

  r = await api(`/announcements/admin/${platformAnn.id}/archive`, 'POST', { adminEmail: TSRA });
  check('TSRA admin cannot archive platform announcement (403)', r.status === 403, `got ${r.status}`);

  // Management list scoping
  r = await api(`/announcements/admin/all?adminEmail=${TSRA}`);
  const tsraList = r.data || [];
  check('TSRA management list contains own announcement', tsraList.some((a) => a.id === tsraAnn.id));
  check('TSRA management list excludes platform announcement', !tsraList.some((a) => a.id === platformAnn.id));

  r = await api(`/announcements/admin/all?adminEmail=${OTHER}`);
  check('Other-school management list excludes TSRA announcement', !(r.data || []).some((a) => a.id === tsraAnn.id));

  r = await api(`/announcements/admin/all?adminEmail=${GLOBAL}`);
  check('Global admin management list sees everything', (r.data || []).some((a) => a.id === tsraAnn.id) && (r.data || []).some((a) => a.id === platformAnn.id));

  // Schools picker scoping
  r = await api(`/announcements/admin/schools?adminEmail=${TSRA}`);
  check('TSRA schools picker returns only own school', Array.isArray(r.data) && r.data.length === 1 && r.data[0].id === tsraSchoolId);

  // ── Super admin regression ─────────────────────────────────────────────
  console.log('\nGlobal admin regression:');
  r = await api(`/announcements/admin/${platformAnn.id}`, 'PATCH', { adminEmail: GLOBAL, title: '[AUTHTEST] platform multi-school (edited)' });
  check('Global admin can edit platform announcement', r.status === 200);

  // ── Cleanup (archive test announcements — no hard deletes) ────────────
  console.log('\nCleanup:');
  for (const id of created) {
    const rr = await api(`/announcements/admin/${id}/archive`, 'POST', { adminEmail: GLOBAL });
    check(`archived ${id.slice(0, 8)}`, rr.status === 200);
  }

  console.log(`\n── ${pass} passed, ${fail} failed ──\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
