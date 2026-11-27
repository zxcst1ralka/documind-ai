
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 100_000,
  expect: { timeout: 18_000 },
  use: { baseURL: process.env.DOCUMIND_E2E_URL ?? 'http://localhost:8081', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  reporter: process.env.CI ? 'github' : 'list',
})
