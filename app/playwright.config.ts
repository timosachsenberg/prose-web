import { defineConfig, devices } from '@playwright/test'

// The end-to-end tests run against the production build (`npm run build`), served by
// `vite preview` with the cross-origin isolation headers of the real deployment.
const port = 4173
const origin = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './e2e',
  reporter: 'list',
  use: {
    baseURL: `${origin}/prose-web/`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${origin}/prose-web/`,
    reuseExistingServer: !process.env.CI,
  },
})
