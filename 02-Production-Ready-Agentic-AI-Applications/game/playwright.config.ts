import { defineConfig, devices } from '@playwright/test'

// Browser tests on the demo pack (engineering spec, section 12.6). Mac only.
const PORT = 3200
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  // The Chrome installed on the Mac, so no browser download is needed.
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'off', screenshot: 'off', channel: 'chrome', actionTimeout: 10_000 },
  projects: [
    { name: 'laptop', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1280, height: 720 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], channel: 'chrome', viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `rm -rf .e2e-data && CLIENT_DIR=packages/client/dist DATA_DIR=.e2e-data PORT=${PORT} HOST=127.0.0.1 PUBLIC_URL=http://127.0.0.1:${PORT} HOST_PASSCODE=e2e-passcode-0123 LOG_LEVEL=warn npx tsx packages/server/src/main.ts`,
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
