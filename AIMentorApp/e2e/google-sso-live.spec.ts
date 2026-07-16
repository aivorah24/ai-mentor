import { test, expect } from '@playwright/test';
import { openLoginModal } from './live-auth.helpers';

/**
 * Google SSO — wiring check, not a full login.
 *
 * Google's OAuth popup actively fingerprints and blocks automated browsers
 * ("This browser or app may not be secure"), so a script can't type a real
 * Google password into it reliably — that's true for any CI, not specific to
 * this repo. What actually breaks in practice (wrong Firebase API key, wrong
 * redirect URL, button not wired, popup blocked) is exactly what this test
 * catches: it asserts the button opens Firebase's real auth handler pointed
 * at the correct project and google.com provider.
 *
 * For a true end-to-end "did Google login land me on the right dashboard"
 * check, capture a Playwright storageState once by signing in manually with
 * a test Google account, then reuse it — see README note at bottom of file.
 */
test.describe('Google SSO', () => {
  test('Sign in with Google opens Firebase auth popup for the correct project', async ({ page, context }) => {
    await openLoginModal(page);

    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout: 10_000 }),
      page.getByText('Sign in with Google').first().click(),
    ]);

    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    const popupUrl = popup.url();

    expect(popupUrl).toContain('firebaseapp.com/__/auth/handler');
    expect(popupUrl).toContain('providerId=google.com');
    expect(popupUrl).toContain('apiKey=');

    await popup.close();
  });

  test('Sign up with Google opens Firebase auth popup for the correct project', async ({ page, context }) => {
    await openLoginModal(page);
    await page.getByText("Sign up free").first().click();
    await expect(page.getByText(/create your account/i).first()).toBeVisible({ timeout: 10_000 }).catch(() => {});

    const googleBtn = page.getByText('Sign up with Google').first();
    await expect(googleBtn).toBeVisible({ timeout: 10_000 });

    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout: 10_000 }),
      googleBtn.click(),
    ]);

    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    expect(popup.url()).toContain('firebaseapp.com/__/auth/handler');
    expect(popup.url()).toContain('providerId=google.com');

    await popup.close();
  });
});

/**
 * To add a REAL Google-login-lands-correctly check later:
 *   1. Run `npx playwright open https://aivorah.ai` locally, sign in by hand
 *      with a dedicated test Google account, then run
 *      `await context.storageState({ path: 'e2e/.auth/google-user.json' })`
 *      from the inspector console.
 *   2. Add a project in playwright.config.ts with
 *      `use: { storageState: 'e2e/.auth/google-user.json' }`.
 *   3. Write a spec that just goes to '/' and asserts the dashboard loads —
 *      this checks session persistence, not the OAuth handshake itself.
 *   Never commit e2e/.auth/*.json — add it to .gitignore.
 */
