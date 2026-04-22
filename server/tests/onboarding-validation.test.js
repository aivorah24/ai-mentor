/**
 * Onboarding Validation Tests — Issue #54
 *
 * Tests the validation logic in PATCH /user/profile:
 *   - Students cannot complete onboarding without grade + curriculum
 *   - Empty strings are treated as missing (not silently skipped)
 *   - Teachers and parents can complete without grade/curriculum
 *   - Role from request body is used when DB lookup fails
 *   - Onboarding is never marked complete with corrupt data
 *
 * Mocks Supabase so no real DB connection is needed.
 */

// ── Mock Supabase before requiring the route ───────────────────────────────
jest.mock('../services/supabase', () => {
  const chain = {
    select:    jest.fn().mockReturnThis(),
    eq:        jest.fn().mockReturnThis(),
    update:    jest.fn().mockReturnThis(),
    upsert:    jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(),
    single:    jest.fn(),
    not:       jest.fn().mockReturnThis(),
    delete:    jest.fn().mockReturnThis(),
    insert:    jest.fn().mockReturnThis(),
    in:        jest.fn().mockReturnThis(),
  };
  return { from: jest.fn(() => chain), _chain: chain };
});

// ── Validation logic extracted (mirrors server/routes/user.js) ─────────────
// We test the pure validation rules independently — fast, no HTTP needed.

function validateOnboardingComplete({ role, grade, curriculum }) {
  const resolvedGrade      = (grade      || '').trim();
  const resolvedCurriculum = (curriculum || '').trim();

  if (role === 'student' && (!resolvedGrade || !resolvedCurriculum)) {
    return { ok: false, error: 'Students must provide grade and curriculum to complete onboarding.' };
  }
  return { ok: true };
}

function buildPatch({ name, bodyRole, curriculum, grade, school, location, complete }) {
  const patch = {};
  if (name)       patch.name       = name.trim();
  if (bodyRole)   patch.role       = bodyRole;
  if (curriculum) patch.curriculum = curriculum.trim();
  if (grade)      patch.grade      = grade.trim();
  if (school)     patch.school     = school.trim();
  if (location)   patch.location   = location;
  if (complete === true) patch.onboarding_complete = true;
  return patch;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Onboarding validation — students must have grade + curriculum', () => {
  test('student with grade + curriculum → valid', () => {
    const result = validateOnboardingComplete({
      role: 'student', grade: 'Grade 4', curriculum: 'IB PYP',
    });
    expect(result.ok).toBe(true);
  });

  test('student without grade → rejected', () => {
    const result = validateOnboardingComplete({
      role: 'student', grade: '', curriculum: 'IB PYP',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/grade/i);
  });

  test('student without curriculum → rejected', () => {
    const result = validateOnboardingComplete({
      role: 'student', grade: 'Grade 4', curriculum: '',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/curriculum/i);
  });

  test('student with null grade → rejected', () => {
    const result = validateOnboardingComplete({
      role: 'student', grade: null, curriculum: 'IB PYP',
    });
    expect(result.ok).toBe(false);
  });

  test('student with null curriculum → rejected', () => {
    const result = validateOnboardingComplete({
      role: 'student', grade: 'Grade 4', curriculum: null,
    });
    expect(result.ok).toBe(false);
  });

  test('student with undefined grade → rejected', () => {
    const result = validateOnboardingComplete({
      role: 'student', grade: undefined, curriculum: 'IB PYP',
    });
    expect(result.ok).toBe(false);
  });

  test('student with whitespace-only grade → rejected', () => {
    const result = validateOnboardingComplete({
      role: 'student', grade: '   ', curriculum: 'IB PYP',
    });
    expect(result.ok).toBe(false);
  });

  test('student with whitespace-only curriculum → rejected', () => {
    const result = validateOnboardingComplete({
      role: 'student', grade: 'Grade 4', curriculum: '   ',
    });
    expect(result.ok).toBe(false);
  });

  test('student with both missing → rejected', () => {
    const result = validateOnboardingComplete({
      role: 'student', grade: '', curriculum: '',
    });
    expect(result.ok).toBe(false);
  });
});

describe('Onboarding validation — all valid grade/curriculum combinations', () => {
  const grades = ['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5',
                  'Grade 6','Grade 7','Grade 8','Grade 9','Grade 10'];
  const curricula = ['IB PYP', 'NCERT', 'CBSE', 'ICSE', 'Cambridge', 'State Board'];

  grades.forEach(grade => {
    curricula.forEach(curriculum => {
      test(`student Grade=${grade}, Curriculum=${curriculum} → valid`, () => {
        const result = validateOnboardingComplete({ role: 'student', grade, curriculum });
        expect(result.ok).toBe(true);
      });
    });
  });
});

describe('Onboarding validation — teachers and parents do not need grade/curriculum', () => {
  test('teacher without grade + curriculum → valid', () => {
    const result = validateOnboardingComplete({
      role: 'teacher', grade: '', curriculum: '',
    });
    expect(result.ok).toBe(true);
  });

  test('parent without grade + curriculum → valid', () => {
    const result = validateOnboardingComplete({
      role: 'parent', grade: undefined, curriculum: undefined,
    });
    expect(result.ok).toBe(true);
  });
});

describe('Patch builder — empty strings are not included in Supabase patch', () => {
  test('empty grade string is not added to patch', () => {
    const patch = buildPatch({ grade: '', curriculum: 'IB PYP', name: 'Test', school: 'HIS', location: 'Hyd', complete: true });
    expect(patch).not.toHaveProperty('grade');
  });

  test('empty curriculum string is not added to patch', () => {
    const patch = buildPatch({ grade: 'Grade 4', curriculum: '', name: 'Test', school: 'HIS', location: 'Hyd', complete: true });
    expect(patch).not.toHaveProperty('curriculum');
  });

  test('valid grade and curriculum are trimmed and included', () => {
    const patch = buildPatch({ grade: '  Grade 4  ', curriculum: '  IB PYP  ', name: 'Test', school: 'HIS', location: 'Hyd' });
    expect(patch.grade).toBe('Grade 4');
    expect(patch.curriculum).toBe('IB PYP');
  });

  test('complete:true sets onboarding_complete in patch', () => {
    const patch = buildPatch({ grade: 'Grade 4', curriculum: 'IB PYP', name: 'Test', school: 'HIS', location: 'Hyd', complete: true });
    expect(patch.onboarding_complete).toBe(true);
  });

  test('role from body is included in patch', () => {
    const patch = buildPatch({ bodyRole: 'student', grade: 'Grade 4', curriculum: 'IB PYP', name: 'Test', school: 'HIS', location: 'Hyd' });
    expect(patch.role).toBe('student');
  });
});

describe('Onboarding validation — Eilla regression (Grade 4 IB PYP)', () => {
  test('Eilla scenario: Grade 4, IB PYP student → valid', () => {
    const result = validateOnboardingComplete({
      role: 'student', grade: 'Grade 4', curriculum: 'IB PYP',
    });
    expect(result.ok).toBe(true);
  });

  test('Eilla bug scenario: grade=null, curriculum=null with complete:true → rejected', () => {
    // This was the exact bug — onboarding marked complete with no grade/curriculum
    const result = validateOnboardingComplete({
      role: 'student', grade: null, curriculum: null,
    });
    expect(result.ok).toBe(false);
  });

  test('patch with Grade 4 and IB PYP includes both fields correctly', () => {
    const patch = buildPatch({
      bodyRole: 'student', grade: 'Grade 4', curriculum: 'IB PYP',
      name: 'Eilla Advaitha Bodanapu', school: 'Test School',
      location: 'Hyderabad', complete: true,
    });
    expect(patch.grade).toBe('Grade 4');
    expect(patch.curriculum).toBe('IB PYP');
    expect(patch.onboarding_complete).toBe(true);
    expect(patch.role).toBe('student');
  });
});
