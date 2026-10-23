import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 8091);
export const BASE_URL = `http://localhost:${PORT}`;

/**
 * End-to-end tests run against the production build (`npm run build`) with dev sign-in and a
 * throwaway database. Set E2E_DATABASE_URL to point at an empty Postgres database.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Allow a pre-installed Chromium (e.g. in sandboxes) instead of `playwright install`.
        launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
      },
    },
  ],
  webServer: {
    command: 'node server/dist/index.js',
    url: `${BASE_URL}/readyz`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'test',
      PORT: String(PORT),
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://postgres@localhost:5432/qrdirector_e2e',
      PUBLIC_BASE_URL: BASE_URL,
      SESSION_SECRET: 'e2e-secret-e2e-secret-e2e-secret-xyz',
      AUTH_MODE: 'dev',
      TRUST_PROXY_HOPS: '0',
      LOG_LEVEL: 'warn',
    },
  },
});
