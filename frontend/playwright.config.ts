import { defineConfig, devices } from '@playwright/test';

/**
 * Browser E2E. By default it starts the real backend (needs a migrated PostgreSQL in
 * `DATABASE_URL`, e.g. `npx prisma migrate deploy` first) and the built frontend, with the
 * server pacing delays shortened so a whole game takes a few seconds.
 *
 * To run against an already running stack (e.g. `docker compose up`) set `E2E_BASE_URL`
 * (and `E2E_BACKEND_URL` if the backend is not on http://localhost:3001); nothing is started then.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const backendURL = process.env.E2E_BACKEND_URL ?? 'http://localhost:3001';
const externalStack = Boolean(process.env.E2E_BASE_URL);

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    // Chromium-based phone profile (touch + portrait viewport).
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: externalStack
    ? undefined
    : [
        {
          command: 'npm run start:prod',
          cwd: '../backend',
          url: `${backendURL}/stats/e2e-health`,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          env: {
            PORT: new URL(backendURL).port || '3001',
            CORS_ORIGIN: baseURL,
            AI_TURN_DELAY_MIN_MS: '50',
            AI_TURN_DELAY_MAX_MS: '120',
            TRICK_RESOLVED_DELAY_MS: '150',
          },
        },
        {
          command: 'npm run start -- -p ' + (new URL(baseURL).port || '3000'),
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      ],
});
