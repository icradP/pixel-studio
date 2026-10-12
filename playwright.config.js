import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  outputDir: process.env.PIXEL_TEST_OUTPUT || './test-results',
  use: {
    baseURL: 'http://127.0.0.1:13839',
    viewport: { width: 1024, height: 768 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PIXEL_BROWSER_PATH
      ? { executablePath: process.env.PIXEL_BROWSER_PATH }
      : {},
  },
  webServer: {
    command: 'node server.cjs',
    env: { PIXEL_PORT: '13839' },
    url: 'http://127.0.0.1:13839',
    reuseExistingServer: false,
  },
});
