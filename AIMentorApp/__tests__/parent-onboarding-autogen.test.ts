/**
 * Parent onboarding auto-generation flow tests.
 *
 * These are pure unit tests (no RN/Expo runtime) that mirror the logic used
 * in OnboardingScreen handleFinish + credentials modal confirmation.
 */

type CreateStudentResponse = {
  ok: boolean;
  status: number;
  body?: {
    child?: {
      email?: string;
      verificationRequired?: boolean;
      studentId?: string;
    };
    error?: string;
  };
};

type AutoCreateInput = {
  childName: string;
  childEmail: string;
  serverPassword: string;
  generatedStudentId: string;
  onboardingPatch: Record<string, unknown>;
};

type AutoCreateOutput = {
  showCredsModal: boolean;
  createdLoginId: string;
  createdPassword: string;
  createdStudentId: string;
  pendingUserPatch: Record<string, unknown> | null;
  shouldFinalizeImmediately: boolean;
  shouldTryLinkExisting: boolean;
  error: string | null;
};

function simulateParentAutoCreate(
  input: AutoCreateInput,
  createRes: CreateStudentResponse,
): AutoCreateOutput {
  const candidateEmail = input.childEmail.trim().toLowerCase();

  if (createRes.ok) {
    const child = createRes.body?.child;
    if (child?.email) {
      return {
        showCredsModal: true,
        createdLoginId: child.email,
        createdPassword: child.verificationRequired ? '' : input.serverPassword,
        createdStudentId: child.studentId || input.generatedStudentId,
        pendingUserPatch: input.onboardingPatch,
        shouldFinalizeImmediately: false,
        shouldTryLinkExisting: false,
        error: null,
      };
    }
  }

  if (createRes.status === 409 && candidateEmail.length > 0) {
    return {
      showCredsModal: false,
      createdLoginId: '',
      createdPassword: '',
      createdStudentId: '',
      pendingUserPatch: null,
      shouldFinalizeImmediately: true,
      shouldTryLinkExisting: true,
      error: null,
    };
  }

  return {
    showCredsModal: false,
    createdLoginId: '',
    createdPassword: '',
    createdStudentId: '',
    pendingUserPatch: null,
    shouldFinalizeImmediately: false,
    shouldTryLinkExisting: false,
    error: createRes.body?.error || 'Could not create child account during onboarding.',
  };
}

describe('Parent onboarding auto-generated credentials', () => {
  const patch = { onboardingComplete: true, role: 'parent' };

  test('blank email uses server-generated login/password and shows modal', () => {
    const out = simulateParentAutoCreate(
      {
        childName: 'Aaliya',
        childEmail: '',
        serverPassword: 'V8#aLq2$mPz9',
        generatedStudentId: 'STU-A-123456',
        onboardingPatch: patch,
      },
      {
        ok: true,
        status: 200,
        body: {
          child: {
            email: 'aaliya.1777387313645@aivorah.student',
            studentId: 'STU-A-123456',
          },
        },
      },
    );

    expect(out.showCredsModal).toBe(true);
    expect(out.createdLoginId).toBe('aaliya.1777387313645@aivorah.student');
    expect(out.createdPassword).toBe('V8#aLq2$mPz9');
    expect(out.createdStudentId).toBe('STU-A-123456');
    expect(out.pendingUserPatch).toEqual(patch);
    expect(out.shouldFinalizeImmediately).toBe(false);
  });

  test('real child email stays pending and does not show password before verification', () => {
    const out = simulateParentAutoCreate(
      {
        childName: 'Somu',
        childEmail: 'somu@example.com',
        serverPassword: 'Q7@bNm4#Lp2',
        generatedStudentId: 'STU-S-777777',
        onboardingPatch: patch,
      },
      {
        ok: true,
        status: 200,
        body: {
          child: {
            email: 'somu.1777387313000@aivorah.student',
            studentId: 'STU-S-777777',
            verificationRequired: true,
          },
        },
      },
    );

    expect(out.showCredsModal).toBe(true);
    expect(out.createdPassword).toBe('');
  });

  test('409 with provided email should trigger link-existing fallback (no modal)', () => {
    const out = simulateParentAutoCreate(
      {
        childName: 'Aliya',
        childEmail: 'aliya@example.com',
        serverPassword: '',
        generatedStudentId: 'STU-AL-999999',
        onboardingPatch: patch,
      },
      {
        ok: false,
        status: 409,
        body: { error: 'An account with this email already exists.' },
      },
    );

    expect(out.shouldTryLinkExisting).toBe(true);
    expect(out.showCredsModal).toBe(false);
    expect(out.shouldFinalizeImmediately).toBe(true);
  });

  test('non-409 create failure should block completion with explicit error', () => {
    const out = simulateParentAutoCreate(
      {
        childName: 'Aliya',
        childEmail: '',
        serverPassword: '',
        generatedStudentId: 'STU-AL-999999',
        onboardingPatch: patch,
      },
      {
        ok: false,
        status: 500,
        body: { error: 'Could not create auth account' },
      },
    );

    expect(out.shouldTryLinkExisting).toBe(false);
    expect(out.shouldFinalizeImmediately).toBe(false);
    expect(out.error).toContain('Could not create auth account');
  });
});
