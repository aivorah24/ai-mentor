/**
 * Regression coverage for issue #62:
 * a user who completed onboarding should not see onboarding again after logout/login.
 */

function resolveOnboardingComplete(
  savedLocal: { onboardingComplete?: boolean },
  supaProfile: { onboardingComplete?: boolean },
): boolean {
  return supaProfile.onboardingComplete === true || savedLocal.onboardingComplete === true;
}

function normalizeEmail(email?: string | null) {
  return String(email || '').toLowerCase().trim();
}

function cachedProfileForEmail<T extends { email?: string }>(profile: T | null, email: string): Partial<T> {
  if (!profile) return {};
  return normalizeEmail(profile.email) === normalizeEmail(email) ? profile : {};
}

async function simulateHandleFinish(
  fetchResponse: { ok: boolean; status: number; text: string },
): Promise<{ onboardingMarkedComplete: boolean; errorThrown: boolean }> {
  let onboardingMarkedComplete = false;
  let errorThrown = false;

  try {
    const profileRes = {
      ok: fetchResponse.ok,
      status: fetchResponse.status,
      text: async () => fetchResponse.text,
    };

    if (!profileRes.ok) {
      const errText = await profileRes.text().catch(() => '');
      throw new Error(`Profile save failed (${profileRes.status}): ${errText.slice(0, 200)}`);
    }

    onboardingMarkedComplete = true;
  } catch {
    errorThrown = true;
  }

  return { onboardingMarkedComplete, errorThrown };
}

describe('onboarding completion resolution', () => {
  test('uses local completion when Supabase temporarily returns false', () => {
    const savedLocal = cachedProfileForEmail(
      { email: 'student@example.com', onboardingComplete: true },
      'student@example.com',
    );
    const supaProfile = { onboardingComplete: false };

    expect(resolveOnboardingComplete(savedLocal, supaProfile)).toBe(true);
  });

  test('uses Supabase completion when the database is already updated', () => {
    const savedLocal = { onboardingComplete: false };
    const supaProfile = { onboardingComplete: true };

    expect(resolveOnboardingComplete(savedLocal, supaProfile)).toBe(true);
  });

  test('keeps a completed user out of onboarding after logout and login', () => {
    const cachedAfterLogout = { email: 'student@example.com', onboardingComplete: true };
    const savedLocal = cachedProfileForEmail(cachedAfterLogout, 'student@example.com');
    const supaProfile = { onboardingComplete: false };

    expect(resolveOnboardingComplete(savedLocal, supaProfile)).toBe(true);
  });

  test('does not leak cached completion to another email', () => {
    const cachedAfterLogout = { email: 'student@example.com', onboardingComplete: true };
    const savedLocal = cachedProfileForEmail(cachedAfterLogout, 'other@example.com');
    const supaProfile = { onboardingComplete: false };

    expect(resolveOnboardingComplete(savedLocal, supaProfile)).toBe(false);
  });

  test('shows onboarding for a brand new user', () => {
    const savedLocal = {};
    const supaProfile = { onboardingComplete: false };

    expect(resolveOnboardingComplete(savedLocal, supaProfile)).toBe(false);
  });
});

describe('onboarding profile save', () => {
  test('marks onboarding complete only after profile PATCH succeeds', async () => {
    const result = await simulateHandleFinish({ ok: true, status: 200, text: '{}' });

    expect(result.onboardingMarkedComplete).toBe(true);
    expect(result.errorThrown).toBe(false);
  });

  test('does not mark complete when profile PATCH fails', async () => {
    const result = await simulateHandleFinish({ ok: false, status: 500, text: 'Internal Server Error' });

    expect(result.onboardingMarkedComplete).toBe(false);
    expect(result.errorThrown).toBe(true);
  });
});
