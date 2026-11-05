// Playwright config of the rehearse e2e tests (T13). Birdview plays this project; each test
// starts its own `rehearse serve` on a copy of the shop fixture, so no web server here.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { headless: true, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
