/**
 * No Mock Data For Real Users
 * Verifies that real users (non-demo accounts) always get real data
 * and demo accounts retain their demo fallback.
 */

// ── Mirror of frontend demo-account sets ──────────────────────────────────

const DEMO_TEACHER_EMAILS = new Set([
  'anjali@test.ai', 'priya@test.ai', 'vikram@test.ai', 'teacher@demo.com',
]);

const DEMO_PARENT_EMAILS = new Set([
  'suresh@test.ai', 'deepa@test.ai', 'fatima@test.ai', 'prakash@test.ai', 'parent@demo.com',
]);

const DEMO_STUDENT_EMAILS = new Set([
  'aanya@test.ai', 'ishaan@test.ai', 'rohan@test.ai', 'diya@test.ai',
  'arjun@test.ai', 'priya@test.ai', 'rahul@test.ai', 'zara@test.ai',
  'kavya@test.ai', 'alex@demo.com', 'mia@demo.com', 'student@demo.com',
]);

// Server-side demo maps
const DEMO_MAP_SERVER = new Set([
  'student_alex001', 'student_mia001', 'sarah@demo.com', 'teacher@demo.com',
]);
const TEACHER_ID_MAP_SERVER = new Set(['teacher@demo.com']);

function isTeacherDemo(email) { return DEMO_TEACHER_EMAILS.has(email.toLowerCase()); }
function isParentDemo(email)  { return DEMO_PARENT_EMAILS.has(email.toLowerCase()); }
function isStudentDemo(email) { return DEMO_STUDENT_EMAILS.has(email.toLowerCase()); }

// ── Simulated load logic (mirrors TeacherStudentsScreen) ──────────────────

function loadTeacherStudents(email, serverData, teaches) {
  const demo = isTeacherDemo(email);
  if (serverData.length > 0) return serverData;
  if (demo) return teaches; // demo fallback
  return [];               // real teacher → empty, never demo data
}

function loadParentChildren(email, serverData, localChildren) {
  const demo = isParentDemo(email);
  if (serverData.length > 0) return serverData;
  if (demo) return localChildren; // demo fallback
  return [];                      // real parent → empty, never demo data
}

// ── TeacherStudentsScreen — real vs demo ───────────────────────────────────

describe('TeacherStudentsScreen — real users never get demo students', () => {
  const demoRoster = [{ name: 'Aanya Kapoor' }, { name: 'Ishaan Mehta' }];

  test('real teacher: server returns data → shows server data', () => {
    const result = loadTeacherStudents('sheila@school.com', [{ name: 'Real Student' }], demoRoster);
    expect(result).toEqual([{ name: 'Real Student' }]);
  });

  test('real teacher: server returns empty → shows empty list (NOT demo students)', () => {
    const result = loadTeacherStudents('sheila@school.com', [], demoRoster);
    expect(result).toHaveLength(0);
  });

  test('demo teacher: server returns empty → shows demo roster', () => {
    const result = loadTeacherStudents('anjali@test.ai', [], demoRoster);
    expect(result).toBe(demoRoster);
  });

  test('demo teacher: server returns data → shows server data (real data takes priority)', () => {
    const real = [{ name: 'Real Student From DB' }];
    const result = loadTeacherStudents('anjali@test.ai', real, demoRoster);
    expect(result).toBe(real);
  });
});

// ── ParentMyKidsScreen — real vs demo ─────────────────────────────────────

describe('ParentMyKidsScreen — real parents never get demo child stats', () => {
  const demoChildren = [{ name: 'Aanya', xpPoints: 850, currentStreak: 5 }];

  test('real parent: server returns children → shows server data', () => {
    const result = loadParentChildren('realmom@gmail.com', [{ name: 'Real Child' }], demoChildren);
    expect(result).toEqual([{ name: 'Real Child' }]);
  });

  test('real parent: server returns empty → shows empty (NOT demo children)', () => {
    const result = loadParentChildren('realmom@gmail.com', [], demoChildren);
    expect(result).toHaveLength(0);
  });

  test('demo parent: server returns empty → shows demo children', () => {
    const result = loadParentChildren('suresh@test.ai', [], demoChildren);
    expect(result).toBe(demoChildren);
  });

  test('demo parent: server returns real data → real data takes priority', () => {
    const real = [{ name: 'Real Child From DB' }];
    const result = loadParentChildren('suresh@test.ai', real, demoChildren);
    expect(result).toBe(real);
  });
});

// ── Demo account classification ────────────────────────────────────────────

describe('Demo account classification — correct identification', () => {
  const REAL_EMAILS = [
    'sheila@hyderabadschool.com',
    'teacher.new@school.edu',
    'parent123@gmail.com',
    'student.real@outlook.com',
    'drbodanapu@gmail.com',
  ];

  test('real teacher emails are NOT classified as demo', () => {
    REAL_EMAILS.forEach(email => {
      expect(isTeacherDemo(email)).toBe(false);
    });
  });

  test('real parent emails are NOT classified as demo', () => {
    REAL_EMAILS.forEach(email => {
      expect(isParentDemo(email)).toBe(false);
    });
  });

  test('real student emails are NOT classified as demo', () => {
    REAL_EMAILS.forEach(email => {
      expect(isStudentDemo(email)).toBe(false);
    });
  });

  test('known demo teacher emails are correctly identified', () => {
    ['anjali@test.ai', 'teacher@demo.com'].forEach(email => {
      expect(isTeacherDemo(email)).toBe(true);
    });
  });

  test('known demo parent emails are correctly identified', () => {
    ['suresh@test.ai', 'parent@demo.com'].forEach(email => {
      expect(isParentDemo(email)).toBe(true);
    });
  });

  test('known demo student emails are correctly identified', () => {
    ['aanya@test.ai', 'student@demo.com'].forEach(email => {
      expect(isStudentDemo(email)).toBe(true);
    });
  });
});

// ── Server-side DEMO_MAP — only for demo accounts ─────────────────────────

describe('Server DEMO_MAP — never matches real user emails', () => {
  const REAL_EMAILS = [
    'sheila@hyderabadschool.com', 'newteacher@school.edu',
    'realpparent@gmail.com', 'student.new@school.com',
  ];

  test('real emails are not in server DEMO_MAP', () => {
    REAL_EMAILS.forEach(email => {
      expect(DEMO_MAP_SERVER.has(email)).toBe(false);
    });
  });

  test('real emails are not in TEACHER_ID_MAP', () => {
    REAL_EMAILS.forEach(email => {
      expect(TEACHER_ID_MAP_SERVER.has(email)).toBe(false);
    });
  });
});

// ── Data priority: real data always wins over demo ─────────────────────────

describe('Data priority — real data always wins', () => {
  test('when server returns data, it is always used regardless of account type', () => {
    const serverData = [{ id: 'real-1', name: 'Real Student', xpPoints: 500 }];
    // Even for demo accounts, real server data takes priority
    const resultDemo = loadTeacherStudents('anjali@test.ai', serverData, []);
    const resultReal = loadTeacherStudents('sheila@school.com', serverData, []);
    expect(resultDemo).toBe(serverData);
    expect(resultReal).toBe(serverData);
  });

  test('empty array from server is treated as no data (not an error)', () => {
    // Real user gets empty list — correct behaviour
    const result = loadTeacherStudents('sheila@school.com', [], []);
    expect(result).toEqual([]);
    expect(Array.isArray(result)).toBe(true);
  });
});
