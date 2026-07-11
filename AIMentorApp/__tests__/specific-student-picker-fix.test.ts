/**
 * Regression coverage: assigning a worksheet-based interactive quiz to a
 * "Specific student" silently hid the target student when the AI-extracted
 * grade string (e.g. "3rd Grade") didn't exactly match the student's stored
 * grade format (e.g. "Grade 3"). Mirrors the fallback logic in
 * TeacherAssignmentsScreen.tsx's specific-student picker (~line 4636).
 */

type StudentItem = { id: string; name: string; grade?: string; curriculum?: string };

function normG(g?: string) {
  return (g ?? '').toLowerCase().replace(/grade/g, '').replace(/\s+/g, '').trim();
}

function pickStudents(
  students: StudentItem[],
  studentSearch: string,
  teacherCurriculum: string,
  grade: string,
): StudentItem[] {
  const base = students.filter((s) => {
    const matchSearch = s.name?.toLowerCase().includes(studentSearch.toLowerCase());
    const matchCurriculum = !teacherCurriculum || !s.curriculum || s.curriculum === teacherCurriculum;
    return matchSearch && matchCurriculum;
  });
  const gradeMatched = base.filter((s) => !grade || normG(s.grade) === normG(grade));
  return gradeMatched.length > 0 ? gradeMatched : base;
}

describe('specific-student picker grade fallback', () => {
  const students: StudentItem[] = [
    { id: '1', name: 'Ela', grade: 'Grade 3', curriculum: 'IB PYP' },
    { id: '2', name: 'Mia', grade: 'Grade 5', curriculum: 'IB PYP' },
  ];

  test('shows the student when grade format matches exactly', () => {
    const result = pickStudents(students, '', 'IB PYP', 'Grade 3');
    expect(result.map((s) => s.id)).toEqual(['1']);
  });

  test('falls back to the full roster when AI-extracted grade format does not match any student', () => {
    // Worksheet AI extraction returned "3rd Grade" instead of "Grade 3" —
    // without the fallback, Ela would be filtered out entirely.
    const result = pickStudents(students, '', 'IB PYP', '3rd Grade');
    expect(result.map((s) => s.id)).toEqual(['1', '2']);
  });

  test('still narrows by grade when the format normalizes to a real match', () => {
    const result = pickStudents(students, '', 'IB PYP', 'grade5');
    expect(result.map((s) => s.id)).toEqual(['2']);
  });

  test('search and curriculum filters still apply on top of the grade fallback', () => {
    const result = pickStudents(students, 'mia', 'IB PYP', '3rd Grade');
    expect(result.map((s) => s.id)).toEqual(['2']);
  });

  test('no grade selected yet shows the full curriculum-matched roster', () => {
    const result = pickStudents(students, '', 'IB PYP', '');
    expect(result.map((s) => s.id)).toEqual(['1', '2']);
  });
});
