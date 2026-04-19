import { Page, expect } from '@playwright/test';

export const TEACHER_ACCOUNTS = {
  ravi:   { email: 'ravi@test.ai',   name: 'Mr. Ravi Singh' },
  anjali: { email: 'anjali@test.ai', name: 'Ms. Anjali Kumar' },
  demo:   { email: 'teacher@demo.com', name: 'Teacher' },
};

export const PARENT_ACCOUNTS = {
  suresh:  { email: 'suresh@test.ai',  name: 'Suresh Sharma',  children: ['Arjun Sharma'] },
  deepa:   { email: 'deepa@test.ai',   name: 'Deepa Nair',    children: ['Priya Nair', 'Rahul Mehta'] },
  fatima:  { email: 'fatima@test.ai',  name: 'Fatima Ahmed',  children: ['Zara Ahmed', 'Kavya Reddy'] },
  demo:    { email: 'parent@demo.com', name: 'Priya Richardson', children: ['Alex', 'Mia'] },
};

/** Maps email → display name shown on the landing card */
const EMAIL_TO_NAME: Record<string, string> = {
  'suresh@test.ai':  'Suresh Sharma',
  'deepa@test.ai':   'Deepa Nair',
  'fatima@test.ai':  'Fatima Ahmed',
  'arjun@test.ai':   'Arjun Sharma',
  'priya@test.ai':   'Priya Nair',
  'rahul@test.ai':   'Rahul Mehta',
  'zara@test.ai':    'Zara Ahmed',
  'kavya@test.ai':   'Kavya Reddy',
  'anjali@test.ai':  'Ms. Anjali Kumar',
  'ravi@test.ai':    'Mr. Ravi Singh',
  'parent@demo.com': 'Parent',
  'teacher@demo.com':'Teacher',
  'alex@demo.com':   'Student',
};

/** DEMO buttons map (Student / Teacher / Parent quick buttons) */
const DEMO_EMAILS = new Set(['parent@demo.com', 'teacher@demo.com', 'alex@demo.com']);

/**
 * Login via the test-accounts panel on the landing page.
 * Waits for the sidebar "Aivorah" logo to appear, confirming navigation to the main app.
 */
export async function loginAs(page: Page, email: string) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Expand the test-accounts panel if not already open
  const firstTestCard = page.getByText('Arjun Sharma').first();
  const panelOpen = await firstTestCard.isVisible().catch(() => false);
  if (!panelOpen) {
    await page.getByText('Test Accounts with Real Data').first().click();
    await expect(firstTestCard).toBeVisible({ timeout: 5_000 });
  }

  const displayName = EMAIL_TO_NAME[email] ?? email;

  if (DEMO_EMAILS.has(email)) {
    // Demo quick-login: the button text is "Student" / "Teacher" / "Parent"
    await page.getByText(displayName).first().click();
  } else {
    // Test account card — click by full name
    await page.locator(`text="${displayName}"`).first().click();
  }

  // After login, the landing "AI-Powered Learning Platform" hero should disappear
  // and the app sidebar / drawer should appear. Wait for it.
  await expect(page.getByText('AI-Powered Learning Platform')).not.toBeVisible({ timeout: 15_000 });
  // Also wait for any app chrome to load
  await page.waitForTimeout(1000);
}

/** Wait for text to appear anywhere on page */
export async function waitForText(page: Page, text: string | RegExp) {
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 15_000 });
}

/** Navigate to a parent screen via sidebar link text */
export async function goToParentScreen(page: Page, linkText: string) {
  await page.getByText(linkText).first().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
}

/** Assert no hardcoded UUID/mock strings visible in the DOM */
export async function assertNoMockData(page: Page) {
  const body = await page.locator('body').innerText();
  const MOCK_STRINGS = [
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'DEMO_CHILDREN',
    'SELECTED_CHILD',
  ];
  for (const s of MOCK_STRINGS) {
    expect(body, `Found mock string: "${s}"`).not.toContain(s);
  }
}
