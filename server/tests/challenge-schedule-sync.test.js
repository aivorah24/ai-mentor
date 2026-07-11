/**
 * Challenge → Schedule sync regression coverage.
 *
 * POST /challenges/assign auto-adds a schedule_events row when a dueDate is
 * given, so the deadline shows up in the student's Schedule and bell
 * notifications. Two bugs previously broke that insert silently (wrapped in
 * a try/catch that never surfaced the failure):
 *   1. challenge_assignments.id was generated with a hand-rolled non-UUID
 *      string ("ca_" + random) instead of a real UUID.
 *   2. The schedule_events insert never set its own "id" field, and that
 *      column has a NOT NULL constraint with no DB default — so the insert
 *      always failed with "null value in column \"id\"...".
 * This mirrors the insert payload built in server/routes/challenges.js
 * POST /assign (~line 191 and ~line 227).
 */

function buildChallengeAssignmentRow({ uuidv4, challengeId, studentId, assignedById, assignedByRole, dueDate }) {
  return {
    id:               uuidv4(),
    challenge_id:     challengeId,
    student_id:       studentId,
    assigned_by_id:   assignedById || '',
    assigned_by_role: assignedByRole,
    due_date:         dueDate || null,
    status:           'assigned',
  };
}

function buildScheduleEventRow({ uuidv4, challenge, studentId, assignedByRole, assignmentId, dueDate }) {
  return {
    id:            uuidv4(),
    title:         `${challenge.title} — Due`,
    event_date:    dueDate,
    start_time:    '23:59',
    end_time:      '23:59',
    type:          'challenge',
    note:          `${challenge.category} · ${challenge.subject}${challenge.grade ? ' · ' + challenge.grade : ''}`,
    student_id:    studentId,
    created_by:    assignedByRole,
    tag:           challenge.subject || null,
    assignment_id: assignmentId,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('challenge → schedule_events sync', () => {
  const uuidv4 = () => require('crypto').randomUUID();

  test('challenge_assignments row gets a real UUID id, not a "ca_" prefixed string', () => {
    const row = buildChallengeAssignmentRow({
      uuidv4, challengeId: 'ch_1', studentId: 'stu_1',
      assignedById: 't@test.com', assignedByRole: 'teacher', dueDate: '2026-07-25',
    });
    expect(row.id).toMatch(UUID_RE);
  });

  test('schedule_events row always has an explicit id set (NOT NULL, no DB default)', () => {
    const challenge = { title: 'Term 1 Brain Blitz', category: 'School Challenge', subject: 'Mathematics', grade: 'Grade 5' };
    const row = buildScheduleEventRow({
      uuidv4, challenge, studentId: 'stu_1', assignedByRole: 'teacher',
      assignmentId: 'assignment_1', dueDate: '2026-07-25',
    });
    expect(row.id).toBeTruthy();
    expect(row.id).toMatch(UUID_RE);
  });

  test('schedule_events row links back to the challenge assignment via assignment_id', () => {
    const challenge = { title: 'Term 1 Brain Blitz', category: 'School Challenge', subject: 'Mathematics', grade: 'Grade 5' };
    const row = buildScheduleEventRow({
      uuidv4, challenge, studentId: 'stu_1', assignedByRole: 'teacher',
      assignmentId: 'assignment_1', dueDate: '2026-07-25',
    });
    expect(row.assignment_id).toBe('assignment_1');
    expect(row.type).toBe('challenge');
    expect(row.event_date).toBe('2026-07-25');
  });
});
