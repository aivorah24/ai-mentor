import { defineConfig, devices } from '@playwright/test';

/**
 * Aivorah — Playwright config
 * Tests run against the Expo web dev server (http://localhost:8081)
 *
 * Start the app first:  npm run web
 * Then run tests:       npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],

  use: {
    baseURL: process.env.PW_BASE_URL || 'http://localhost:8081', // override with PW_BASE_URL=https://aivorah.ai
    headless: true,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Uncomment to auto-start expo web before running tests:
  // webServer: {
  //   command: 'npm run web -- --non-interactive',
  //   port: 8081,
  //   reuseExistingServer: true,
  //   timeout: 60_000,
  // },
});
