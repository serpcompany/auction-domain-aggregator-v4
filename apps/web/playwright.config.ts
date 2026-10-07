import { defineConfig, devices } from '@playwright/test'

// Not Wrangler's default 8787, which other local projects commonly occupy.
const PORT = 8797
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  outputDir: './tmp/playwright/test-results',
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['line'], ['html', { open: 'never', outputFolder: './tmp/playwright/report' }]],
  // Builds OpenNext, seeds an isolated D1, and serves the Worker (scripts/e2e-server.ts).
  // Playwright refuses to start if the port is already taken, and stops the server afterwards.
  webServer: {
    command: `node --import tsx scripts/e2e-server.ts ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'pipe'
  },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
})
