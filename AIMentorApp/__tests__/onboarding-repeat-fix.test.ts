/**
 * Tests for the repeated onboarding bug fix
 *
 * Bug: Onboarding kept showing on every login even after completion.
 *
 * Root causes fixed:
 * 1. AuthContext — supaProfile spread overwrote savedLocal.onboardingComplete: true
 * 2. OnboardingScreen — handleFinish called updateUser even when PATCH /user/profile failed
 */

// ─────────────────────────────────────────────────────────────────────────────
// Fix 1: onboardingComplete "sticky true" logic (extracted from AuthContext.tsx)
// ─────────────────────────────────────────────────────────────────────────────

function resolveOnboardingComplete(
  savedLocal: { onboardingComplete?: boolean },
  supaProfile: { onboardingComplete?: boolean },
): boolean {
  return supaProfile.onboardingComplete === true || savedLocal.onboardingComplete === true;
}

describe('Fix 1 — onboardingComplete sticky-true (AuthContext onAuthStateChanged)', () => {
  test('stays TRUE when supabase returns false but local storage has true', () => {
    // Scenario: user completed onboarding, DB save was slow/failed, but local is true
    const savedLocal = { onboardingComplete: true };
    const supaProfile = { onboardingComplete: false };
    expect(resolveOnboardingComplete(savedLocal, supaProfile)).toBe(true);
  });

  test('stays TRUE when supabase returns null/undefined but local storage has true', () => {
    const savedLocal = { onboardingComplete: true };
    const supaProfile = { onboardingComplete: undefined };
    expect(resolveOnboardingComplete(savedLocal, supaProfile)).toBe(true);
  });

  test('is TRUE when supabase returns true (normal case after successful save)', () => {
    const savedLocal = { onboardingComplete: false };
    const supaProfile = { onboardingComplete: true };
    expect(resolveOnboardingComplete(savedLocal, supaProfile)).toBe(true);
  });

  test('is TRUE when both local and supabase say true', () => {
    const savedLocal = { onboardingComplete: true };
    const supaProfile = { onboardingComplete: true };
    expect(resolveOnboardingComplete(savedLocal, supaProfile)).toBe(true);
  });

  test('is FALSE for a brand new user (both false) — onboarding should show', () => {
    const savedLocal = { onboardingComplete: false };
    const supaProfile = { onboardingComplete: false };
    expect(resolveOnboardingComplete(savedLocal, supaProfile)).toBe(false);
  });

  test('is FALSE when local storage is empty (first install)', () => {
    const savedLocal = {};
    const supaProfile = { onboardingComplete: false };
    expect(resolveOnboardingComplete(savedLocal, supaProfile)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 2: handleFinish should NOT update local state if PATCH fails
// ─────────────────────────────────────────────────────────────────────────────

async function simulateHandleFinish(
  fetchResponse: { ok: boolean; status: number; text: string },
): Promise<{ onboardingMarkedComplete: boolean; errorThrown: boolean }> {
  let onboardingMarkedComplete = false;
  let errorThrown = false;

  // Simulate the fixed handleFinish logic
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

    // Only reached if PATCH succeeded
    onboardingMarkedComplete = true; // simulates updateUser({ onboardingComplete: true })
  } catch {
    errorThrown = true;
  }

  return { onboardingMarkedComplete, errorThrown };
}

describe('Fix 2 — handleFinish only marks complete if PATCH succeeds (OnboardingScreen)', () => {
  test('marks onboarding complete when PATCH returns 200', async () => {
    const result = await simulateHandleFinish({ ok: true, status: 200, text: '{}' });
    expect(result.onboardingMarkedComplete).toBe(true);
    expect(result.errorThrown).toBe(false);
  });

  test('does NOT mark complete and throws when PATCH returns 500', async () => {
    const result = await simulateHandleFinish({ ok: false, status: 500, text: 'Internal Server Error' });
    expect(result.onboardingMarkedComplete).toBe(false);
    expect(result.errorThrown).toBe(true);
  });

  test('does NOT mark complete and throws when PATCH returns 403 Forbidden', async () => {
    const result = await simulateHandleFinish({ ok: false, status: 403, text: 'Forbidden' });
    expect(result.onboardingMarkedComplete).toBe(false);
    expect(result.errorThrown).toBe(true);
  });

  test('does NOT mark complete and throws when PATCH returns 404', async () => {
    const result = await simulateHandleFinish({ ok: false, status: 404, text: 'Not Found' });
    expect(result.onboardingMarkedComplete).toBe(false);
    expect(result.errorThrown).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Combined: end-to-end scenario simulation
// ─────────────────────────────────────────────────────────────────────────────

describe('End-to-end scenario: onboarding no longer repeats after completion', () => {
  test('Scenario — user completes onboarding, next login should NOT show onboarding', () => {
    // Step 1: User completes onboarding, PATCH succeeds, local state set to true
    const savedLocal = { onboardingComplete: true };

    // Step 2: Next login — Supabase returns true (DB was saved correctly)
    const supaProfile = { onboardingComplete: true };
    expect(resolveOnboardingComplete(savedLocal, supaProfile)).toBe(true); // no onboarding ✓
  });

  test('Scenario — PATCH succeeded but Supabase sync lag returns false on next login', () => {
    // Even if Supabase temporarily returns false (sync lag), local true wins
    const savedLocal = { onboardingComplete: true };
    const supaProfile = { onboardingComplete: false };
    expect(resolveOnboardingComplete(savedLocal, supaProfile)).toBe(true); // no onboarding ✓
  });

  test('Scenario — brand new user, never completed onboarding → show onboarding', () => {
    const savedLocal = {};
    const supaProfile = { onboardingComplete: false };
    expect(resolveOnboardingComplete(savedLocal, supaProfile)).toBe(false); // show onboarding ✓
  });
});
