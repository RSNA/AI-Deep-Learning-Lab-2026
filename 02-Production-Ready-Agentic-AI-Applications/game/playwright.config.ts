import { defineConfig, devices } from '@playwright/test'

// Browser tests on the demo pack (engineering spec, section 12.6). Mac only.
// Another port by `E2E_PORT`, so that two checkouts can run their browser tests at the same time.
// The server gets a made-up facilitator guide, so that the page around the guide can be tested.
const PORT = Number(process.env.E2E_PORT ?? 3200)
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
    command: `rm -rf .e2e-data && CLIENT_DIR=packages/client/dist DATA_DIR=.e2e-data PORT=${PORT} HOST=127.0.0.1 PUBLIC_URL=http://127.0.0.1:${PORT} HOST_PASSCODE=e2e-passcode-0123 FACILITATOR_GUIDE_FILE=e2e/fixtures/demo-guide.html LOG_LEVEL=warn npx tsx packages/server/src/main.ts`,
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
