import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { preview } from 'vite'
import { searchSynthetic } from './helpers.js'

// The deployment. GitHub Pages sends no COOP/COEP headers, so these tests use a second `vite preview`
// of the same build without them (port 4174, see playwright.config.ts): the service worker has to
// make the page cross-origin isolated, store the module and keep the app working offline; without
// it the app runs on one thread and says so.

test.use({ baseURL: 'http://127.0.0.1:4174/prose-web/', serviceWorkers: 'allow' })

/** The names of the service worker's stores in this build (`dist/sw.js`, stamped by the build). */
function storeNames(): { module: string; app: string } {
  const sw = readFileSync('dist/sw.js', 'utf8')
  const id = (name: string) => new RegExp(`const ${name} = '([0-9a-f]{12})'`).exec(sw)?.[1]
  expect(id('MODULE_ID'), 'dist/sw.js is stamped by the build').toBeTruthy()
  expect(id('BUILD_ID'), 'dist/sw.js is stamped by the build').toBeTruthy()
  return { module: `openms-module-${id('MODULE_ID')}`, app: `prose-app-${id('BUILD_ID')}` }
}

/** Waits for OpenMS ("OpenMS 3.7 · 16 threads …"). */
async function engineReady(page: Page) {
  await expect(page.getByTestId('engine-status')).toContainText(/\d+ threads?/, { timeout: 120_000 })
}

/**
 * The first visit (of `url`): the page reloads once to come under the service worker. Returns the page
 * loads so far (document requests of the page, not the hash changes).
 */
async function firstVisit(page: Page, url = './'): Promise<() => number> {
  let loads = 0
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) loads++
  })
  await page.goto(url, { waitUntil: 'commit' })
  await expect.poll(() => page.evaluate(() => crossOriginIsolated).catch(() => false), { timeout: 30_000 }).toBe(true)
  await engineReady(page)
  return () => loads
}

test('the service worker isolates the page and caches the module', async ({ page }) => {
  const loads = await firstVisit(page)
  expect(loads()).toBe(2)
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)

  // the engine worker (and the module's threads, started from it) are isolated too
  const status = page.getByTestId('engine-status')
  await expect(status).not.toContainText('not cross-origin isolated')
  await expect(status).toContainText('works offline')
  await expect(page.getByTestId('isolation-notice')).toHaveCount(0)

  const { module, app } = storeNames()
  const stored = await page.evaluate(
    async ({ module, app }) => {
      const has = async (store: string, path: string) =>
        (await caches.has(store)) && (await (await caches.open(store)).match(new URL(path, location.href).href)) !== undefined
      return {
        wasm: await has(module, 'openms/openms.wasm'),
        shell: await has(app, 'index.html'),
        example: await has(app, 'example/DatabaseSuitability_in_spec.mzML'),
      }
    },
    { module, app },
  )
  expect(stored).toEqual({ wasm: true, shell: true, example: true })

  // a later visit is served by the service worker at once, without a reload
  await page.reload()
  await engineReady(page)
  expect(loads()).toBe(3)
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true)
})

test('works offline after the first visit', async ({ page, context }) => {
  test.setTimeout(240_000)
  // Offline emulation does not reach the service worker's own requests, so this test has a server of
  // its own (the same `vite preview` without isolation headers) and stops it.
  process.env.PROSE_PREVIEW_ISOLATION = 'off'
  const server = await preview({ logLevel: 'silent', preview: { host: '127.0.0.1', port: 0, strictPort: false } })
  const address = server.httpServer.address()
  if (address === null || typeof address === 'string') throw new Error('the preview server has no port')
  try {
    await firstVisit(page, `http://127.0.0.1:${address.port}/prose-web/`)
    await expect(page.getByTestId('engine-status')).toContainText('works offline')
  } finally {
    await server.close()
  }
  await context.setOffline(true)
  // the server is gone: what the service worker has not stored fails
  expect(await page.evaluate(() => fetch('example/not-stored.txt').then((r) => r.status, () => 'failed'))).toBe('failed')

  await page.reload()
  await engineReady(page)
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true)
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'History' })).toBeVisible()

  // the example: its files, the database with cRAP and a search (PeptDeep's models were never stored)
  await page.getByRole('button', { name: 'Try the example' }).click()
  await expect(page.getByText('DatabaseSuitability_database.fasta').first()).toBeVisible({ timeout: 30_000 })
  const peptdeep = page.getByRole('switch', { name: 'PeptDeep predictions' })
  if ((await peptdeep.getAttribute('aria-checked')) === 'true') await peptdeep.click()
  await page.getByRole('button', { name: /^Start search/ }).click()
  await expect(page).toHaveURL(/#\/results\/[^/]+$/, { timeout: 180_000 })
  await expect(page.getByTestId('results-table')).toBeVisible()
})

test.describe('without a service worker', () => {
  test.use({ serviceWorkers: 'block' })

  test('runs single-threaded without isolation', async ({ page }) => {
    test.setTimeout(240_000)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await searchSynthetic(page)
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(false)

    const status = page.getByTestId('engine-status')
    await expect(status).toContainText('1 thread')
    await expect(status).toContainText('not cross-origin isolated')
    await expect(status).toHaveAttribute('title', /one thread/)

    // the search finished: PSMs in the table
    await expect(page.getByRole('tab', { name: /^PSMs/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('results-table').locator('tr[data-index]').first()).toBeVisible()

    // New search says it too, until dismissed
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'New search' }).click()
    const notice = page.getByTestId('isolation-notice')
    await expect(notice).toContainText('OpenMS runs on one thread')
    await notice.getByRole('button', { name: 'Dismiss' }).click()
    await expect(notice).toBeHidden()
    expect(errors).toEqual([])
  })
})
