/**
 * "All students" broadcast scoping regression coverage.
 *
 * A teacher's "All students" assignment/schedule broadcast (student_id/target
 * null or 'all') must only reach students actually linked to that teacher.
 * Both server/routes/schedule.js (scopeAllEvents) and server/routes/assignments.js
 * (GET / filter) previously had a "fail-open" bug: if a broadcast's created_by_id
 * was null (creator deleted, or never resolved at creation time), the code
 * skipped the teacher-link check entirely instead of excluding the row — so an
 * orphaned broadcast became visible to literally every student in the database.
 * This mirrors the filter logic in both files.
 */

function scheduleAllowsBroadcast(event, userId, linkedTeacherIds) {
  if (event.student_id !== 'all' || event.created_by !== 'teacher') return true;
  if (!event.created_by_id || !userId) return false;
  return linkedTeacherIds.has(event.created_by_id);
}

function assignmentAllowsBroadcast(assignment, studentTeacherIds) {
  if (assignment.student_id !== null) return true;
  if (assignment.created_by_role === 'teacher') {
    return !!assignment.created_by_id && studentTeacherIds.has(assignment.created_by_id);
  }
  return true;
}

describe('schedule "All students" broadcast scoping', () => {
  const linkedTeacherIds = new Set(['teacher_A']);

  test('a broadcast with no creator id is hidden, never shown to everyone', () => {
    const orphaned = { student_id: 'all', created_by: 'teacher', created_by_id: null };
    expect(scheduleAllowsBroadcast(orphaned, 'student_1', linkedTeacherIds)).toBe(false);
  });

  test('a broadcast from the student\'s own linked teacher is shown', () => {
    const own = { student_id: 'all', created_by: 'teacher', created_by_id: 'teacher_A' };
    expect(scheduleAllowsBroadcast(own, 'student_1', linkedTeacherIds)).toBe(true);
  });

  test('a broadcast from a teacher the student is NOT linked to is hidden', () => {
    const other = { student_id: 'all', created_by: 'teacher', created_by_id: 'teacher_B' };
    expect(scheduleAllowsBroadcast(other, 'student_1', linkedTeacherIds)).toBe(false);
  });

  test('a broadcast is hidden when the student profile itself cannot be resolved', () => {
    const own = { student_id: 'all', created_by: 'teacher', created_by_id: 'teacher_A' };
    expect(scheduleAllowsBroadcast(own, null, linkedTeacherIds)).toBe(false);
  });

  test('a non-teacher (school/admin) broadcast is never scoped by teacher links', () => {
    const admin = { student_id: 'all', created_by: 'admin', created_by_id: null };
    expect(scheduleAllowsBroadcast(admin, 'student_1', linkedTeacherIds)).toBe(true);
  });

  test('a personal (non-"all") event always passes through', () => {
    const personal = { student_id: 'student_1', created_by: 'teacher', created_by_id: null };
    expect(scheduleAllowsBroadcast(personal, 'student_1', linkedTeacherIds)).toBe(true);
  });
});

describe('assignments "All students" broadcast scoping', () => {
  const studentTeacherIds = new Set(['teacher_A']);

  test('a class-wide teacher assignment with no creator id is excluded', () => {
    const orphaned = { student_id: null, created_by_role: 'teacher', created_by_id: null };
    expect(assignmentAllowsBroadcast(orphaned, studentTeacherIds)).toBe(false);
  });

  test('a class-wide assignment from the student\'s own teacher is included', () => {
    const own = { student_id: null, created_by_role: 'teacher', created_by_id: 'teacher_A' };
    expect(assignmentAllowsBroadcast(own, studentTeacherIds)).toBe(true);
  });

  test('a class-wide assignment from an unrelated teacher is excluded', () => {
    const other = { student_id: null, created_by_role: 'teacher', created_by_id: 'teacher_B' };
    expect(assignmentAllowsBroadcast(other, studentTeacherIds)).toBe(false);
  });

  test('a personal assignment always passes through regardless of creator', () => {
    const personal = { student_id: 'student_1', created_by_role: 'teacher', created_by_id: null };
    expect(assignmentAllowsBroadcast(personal, studentTeacherIds)).toBe(true);
  });
});
