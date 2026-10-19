import { defineConfig, devices } from '@playwright/test'

// The end-to-end tests run against the production build (`npm run build`), served by `vite preview`:
// - on port 4173 with the cross-origin isolation headers (as the desktop app serves it);
// - on port 4174 without them, as GitHub Pages serves it (deploy.spec.ts: the service worker).
// The service worker is blocked unless a test allows it: request interception (page.route) does not
// see what a service worker fetches, and the isolated server needs none.
const isolated = 4173
const plain = 4174
const preview = (port: number) => `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`

export default defineConfig({
  testDir: './e2e',
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${isolated}/prose-web/`,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: preview(isolated),
      url: `http://127.0.0.1:${isolated}/prose-web/`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `PROSE_PREVIEW_ISOLATION=off ${preview(plain)}`,
      url: `http://127.0.0.1:${plain}/prose-web/`,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
