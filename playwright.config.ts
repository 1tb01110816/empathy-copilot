import { defineConfig, devices } from '@playwright/test';

const PORT = 8790;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'npm start',
    url: `http://127.0.0.1:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(PORT),
      APP_ACCESS_CODE: 'e2e-access-code',
      APP_AUTH_USER: 'demo',
      APP_SESSION_SECRET: 'e2e-session-secret',
      LOGIN_RATE_MAX: '100',
      DB_HOST: '',
      DASHSCOPE_API_KEY: '',
    },
  },
});
