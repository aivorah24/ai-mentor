const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  timeout: 120_000,
  outputDir: './test-results',
  use: {
    headless: false,
    viewport: { width: 1280, height: 800 },
  },
});
