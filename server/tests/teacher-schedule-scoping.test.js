/**
 * Teacher calendar scoping regression coverage.
 *
 * GET /schedule/teacher?date=&email= is supposed to show only events THIS
 * teacher created. It used to filter on a mapped "createdBy" field that only
 * ever holds the role string ('teacher'/'parent'/'student'), never a user id
 * — so `e.createdBy === teacherId` was always false, and the filter silently
 * degraded to `e.createdBy === 'teacher'`, which matches EVERY teacher's
 * events. Every teacher saw every other teacher's schedule. This mirrors the
 * raw-row filter now applied in server/routes/schedule.js GET /teacher
 * (before mapRow, using the real created_by_id column).
 */

function filterTeacherEvents(rawEvents, teacherId) {
  return rawEvents.filter(e => e.created_by === 'teacher' && e.created_by_id === teacherId);
}

describe('teacher calendar scoping', () => {
  const rows = [
    { id: 'e1', created_by: 'teacher', created_by_id: 'teacher_A', title: 'Own event' },
    { id: 'e2', created_by: 'teacher', created_by_id: 'teacher_B', title: "Other teacher's event" },
    { id: 'e3', created_by: 'parent', created_by_id: 'parent_X', title: "A parent's event" },
    { id: 'e4', created_by: 'student', created_by_id: 'student_Y', title: "A student's self-scheduled event" },
  ];

  test('only returns events created by this specific teacher', () => {
    const result = filterTeacherEvents(rows, 'teacher_A');
    expect(result.map(r => r.id)).toEqual(['e1']);
  });

  test('never returns another teacher\'s events, even though both have created_by="teacher"', () => {
    const result = filterTeacherEvents(rows, 'teacher_A');
    expect(result.some(r => r.id === 'e2')).toBe(false);
  });

  test('never returns parent- or student-created events', () => {
    const result = filterTeacherEvents(rows, 'teacher_A');
    expect(result.some(r => r.id === 'e3' || r.id === 'e4')).toBe(false);
  });

  test('a teacher with no events of their own gets an empty list, not everyone else\'s', () => {
    const result = filterTeacherEvents(rows, 'teacher_with_nothing');
    expect(result).toEqual([]);
  });
});
