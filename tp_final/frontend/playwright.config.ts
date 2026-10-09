import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://app.localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'dev', testIgnore: /smoke\.spec\.ts/ },
    { name: 'prod-smoke', testMatch: /smoke\.spec\.ts/ },
  ],
})
