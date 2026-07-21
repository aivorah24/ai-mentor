/**
 * Regression guard — Google SSO verification email + onboarding race.
 *
 * Broke live 2026-07-17 in commit e2a7f90 ("Schedule/notification fixes...
 * plus Gemini worksheet/read-aloud work"), stacking on top of the 2026-07-09
 * "sticky emailVerified" cache added in 6905e9c.
 *
 * Reported symptom (2026-07-20): Google SSO sometimes sends the "verify your
 * email" email but still lets the user into onboarding without waiting for
 * verification. Separately, the verification email was resending on every
 * SSO login, not just pre-verification ones.
 *
 * Root cause in signInWithGoogle() (this file's AuthContext.tsx):
 *   - `newUser.emailVerified` was set from `cred.user.emailVerified`, which
 *     is GOOGLE's own flag and is always true — not Aivorah's own
 *     `accountStatus === 'active'` check.
 *   - `setUser(newUser)` + `AsyncStorage.setItem(PROFILE_KEY, ...)` ran
 *     BEFORE the accountStatus check, poisoning the "sticky emailVerified"
 *     local cache (added Jul 9 to avoid a verify-page flash) with an
 *     unconfirmed `true` on every single Google login.
 *
 * This test doesn't spin up the full AuthProvider (Firebase/Expo dependency
 * surface is too heavy for a unit test) — instead it locks the exact
 * source-level invariants that must hold for the bug to stay fixed. If this
 * test starts failing, someone edited signInWithGoogle() in a way that can
 * silently reintroduce the regression — read the invariants below before
 * "fixing" the test.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

const SOURCE: string = fs.readFileSync(
  path.join(__dirname, '../context/AuthContext.tsx'),
  'utf8'
);

// Isolate just the signInWithGoogle function body so matches can't
// accidentally hit similarly-named code elsewhere in this large file.
function extractFunctionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start === -1) throw new Error(`Could not find "${signature}" in AuthContext.tsx — has it been renamed?`);
  // Grab a generous window; signInWithGoogle is a large async function.
  return source.slice(start, start + 8000);
}

describe('Google SSO signInWithGoogle — verification race regression guard', () => {
  const body = extractFunctionBody(SOURCE, 'async function signInWithGoogle');

  test('emailVerified is derived from isAlreadyVerified (Aivorah accountStatus), not Google\'s own flag', () => {
    // The only correct source for a RETURNING user's emailVerified is
    // Aivorah's own verification state. Using cred.user.emailVerified
    // directly is always true for Google accounts and reintroduces the bug.
    expect(body).toMatch(/emailVerified:\s*existingRole\s*\?\s*isAlreadyVerified\s*:\s*false/);
    expect(body).not.toMatch(/emailVerified:\s*existingRole\s*\?\s*cred\.user\.emailVerified/);
  });

  test('isAlreadyVerified is computed before newUser/setUser/AsyncStorage write it into the sticky cache', () => {
    const isAlreadyVerifiedIdx = body.indexOf('const isAlreadyVerified');
    const setUserIdx = body.indexOf('setUser(newUser)');
    const asyncStorageIdx = body.indexOf('AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(newUser))');

    expect(isAlreadyVerifiedIdx).toBeGreaterThan(-1);
    expect(setUserIdx).toBeGreaterThan(-1);
    expect(asyncStorageIdx).toBeGreaterThan(-1);

    // The ordering that broke prod: setUser/AsyncStorage ran BEFORE
    // isAlreadyVerified existed at all. Guard against that ordering forever.
    expect(isAlreadyVerifiedIdx).toBeLessThan(setUserIdx);
    expect(isAlreadyVerifiedIdx).toBeLessThan(asyncStorageIdx);
  });
});
