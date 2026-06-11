import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 600000,       // 10 min — 21 worksheets × ~20s each
  retries: 0,
  reporter: [
    ['html', { outputFolder: 'tests/report/html', open: 'always' }],
    ['list'],
  ],
  use: {
    baseURL: 'https://aivorah.ai',
    headless: false,     // watch it run
    slowMo: 300,
    screenshot: 'on',
    video: 'on',
    trace: 'on',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
