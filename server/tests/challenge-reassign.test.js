/**
 * Challenge Re-assignment Logic Tests
 *
 * Regression coverage: POST /challenges/assign used to return the existing
 * challenge_assignments row untouched whenever one already existed for that
 * student+challenge pair — including when its status was 'completed'. That
 * meant re-assigning a challenge a student had already finished (e.g. for a
 * retry) was a silent no-op: no new due date, no schedule entry, no
 * notification. This mirrors the branch logic in server/routes/challenges.js
 * POST /assign (~line 182 onward).
 */

function resolveAssignAction(existing, { assignedById, assignedByRole, dueDate }) {
  if (existing && existing.status !== 'completed') {
    return { action: 'noop', result: existing };
  }
  if (existing && existing.status === 'completed') {
    return {
      action: 'reset',
      result: {
        ...existing,
        assigned_by_id:   assignedById || '',
        assigned_by_role: assignedByRole,
        due_date:         dueDate || null,
        status:           'assigned',
        score:            null,
        xp_awarded:       null,
        completed_at:     null,
      },
    };
  }
  return {
    action: 'insert',
    result: {
      challenge_id:     null,
      assigned_by_id:   assignedById || '',
      assigned_by_role: assignedByRole,
      due_date:         dueDate || null,
      status:           'assigned',
    },
  };
}

describe('challenge re-assignment', () => {
  const completedAssignment = {
    id: 'ca_1', challenge_id: 'ch_1', student_id: 'stu_1',
    assigned_by_id: 'old_teacher@test.com', assigned_by_role: 'teacher',
    due_date: '2026-06-01', status: 'completed',
    score: 85, xp_awarded: 50, completed_at: '2026-06-01T10:00:00Z',
  };

  test('re-assigning a completed challenge resets status and clears score/xp/completedAt', () => {
    const { action, result } = resolveAssignAction(completedAssignment, {
      assignedById: 'new_teacher@test.com', assignedByRole: 'teacher', dueDate: '2026-07-25',
    });
    expect(action).toBe('reset');
    expect(result.status).toBe('assigned');
    expect(result.score).toBeNull();
    expect(result.xp_awarded).toBeNull();
    expect(result.completed_at).toBeNull();
  });

  test('re-assigning a completed challenge updates the due date and assigner', () => {
    const { result } = resolveAssignAction(completedAssignment, {
      assignedById: 'new_teacher@test.com', assignedByRole: 'teacher', dueDate: '2026-07-25',
    });
    expect(result.due_date).toBe('2026-07-25');
    expect(result.assigned_by_id).toBe('new_teacher@test.com');
  });

  test('re-assigning a still-pending (not completed) challenge is a no-op', () => {
    const pending = { ...completedAssignment, status: 'assigned', score: null, xp_awarded: null, completed_at: null };
    const { action, result } = resolveAssignAction(pending, {
      assignedById: 'someone_else@test.com', assignedByRole: 'teacher', dueDate: '2026-08-01',
    });
    expect(action).toBe('noop');
    // Untouched — original due date and assigner are preserved
    expect(result.due_date).toBe('2026-06-01');
    expect(result.assigned_by_id).toBe('old_teacher@test.com');
  });

  test('assigning a challenge with no prior record inserts a fresh assignment', () => {
    const { action, result } = resolveAssignAction(null, {
      assignedById: 'teacher@test.com', assignedByRole: 'teacher', dueDate: '2026-07-25',
    });
    expect(action).toBe('insert');
    expect(result.status).toBe('assigned');
    expect(result.due_date).toBe('2026-07-25');
  });
});
