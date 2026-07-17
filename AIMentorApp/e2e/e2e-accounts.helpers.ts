import { Page, expect } from '@playwright/test';

/**
 * The three LINKED accounts seeded by server/scripts/seed-e2e-accounts.js
 * (teacher↔student, parent↔student). Password is shared for the test trio.
 * Override the password via E2E_PASSWORD if you changed it in the seed.
 */
export const E2E = {
  password: process.env.E2E_PASSWORD || 'E2eTest!2026',
  teacher: { email: 'e2e.teacher@aivorah.test', name: 'E2E Teacher' },
  student: { email: 'e2e.student@aivorah.test', name: 'E2E Student' },
  parent:  { email: 'e2e.parent@aivorah.test',  name: 'E2E Parent'  },
};

/**
 * Log in with email + password via the LoginModal (works for accounts that are
 * NOT in the "Test Accounts with Real Data" quick-panel). Mirrors the flow in
 * email-password-live.spec.ts. Handles both the marketing-iframe landing (prod)
 * and the plain Expo dev landing (local).
 */
export async function loginWithPassword(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1200);

  // Open the login modal — the "Login" trigger may live inside the landing.html iframe (prod) or on the page (local).
  const marketingFrame = page.frames().find(f => f.url().includes('landing.html'));
  if (marketingFrame) {
    await marketingFrame.getByText('Login', { exact: true }).first().click();
  } else {
    await page.getByText('Login', { exact: true }).first().click();
  }
  await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 10_000 });

  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByText('Sign In', { exact: true }).click();

  // Modal closes on success
  await expect(page.getByText('Welcome back')).not.toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1000);
}
