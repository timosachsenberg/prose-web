import { rmSync, statSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { preview } from 'vite'
import { searchSynthetic } from './helpers.js'
import { fakeUpdate, pagesServer, stampedIds } from './pages-server.js'

// The deployment. GitHub Pages sends no COOP/COEP headers, so these tests use a second `vite preview`
// of the same build without them (port 4174, see playwright.config.ts), or a Pages-like server of
// their own (pages-server.ts): the service worker has to make the page cross-origin isolated, store
// the module and keep the app working offline; without it the app runs on one thread and says so.

test.use({ baseURL: 'http://127.0.0.1:4174/prose-web/', serviceWorkers: 'allow' })

/** The names of the service worker's stores in this build (`dist/sw.js`, stamped by the build). */
function storeNames(dist = 'dist'): { module: string; app: string } {
  const ids = stampedIds(dist)
  return { module: `openms-module-${ids.module}`, app: `prose-app-${ids.build}` }
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

/** Whether the store `name` has `path` (relative to the page). */
function stored(page: Page, name: string, path: string): Promise<boolean> {
  return page.evaluate(
    async ({ name, path }) =>
      (await caches.has(name)) && (await (await caches.open(name)).match(new URL(path, location.href).href)) !== undefined,
    { name, path },
  )
}

/** The module versions (?v=) the engine worker loaded: its openms.mjs and its openms.wasm. */
async function loadedModule(page: Page): Promise<{ mjs: string | null; wasm: string | null }> {
  const worker = page.workers().find((w) => w.url().includes('/assets/worker-'))
  expect(worker, 'the engine worker').toBeTruthy()
  const names = await worker!.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name))
  const version = (file: string) => {
    const name = names.filter((n) => new URL(n).pathname.endsWith(`/openms/${file}`)).at(-1)
    return name === undefined ? null : (new URL(name).searchParams.get('v') ?? 'none')
  }
  return { mjs: version('openms.mjs'), wasm: version('openms.wasm') }
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

  // the module (with its version), the shell at installation, the example once OpenMS has loaded
  const { module, app } = storeNames()
  const v = stampedIds('dist').module
  expect(await loadedModule(page)).toEqual({ mjs: v, wasm: v })
  expect(await stored(page, module, `openms/openms.wasm?v=${v}`)).toBe(true)
  expect(await stored(page, app, 'index.html')).toBe(true)
  await expect.poll(() => stored(page, app, 'example/DatabaseSuitability_in_spec.mzML'), { timeout: 30_000 }).toBe(true)

  // a later visit is served by the service worker at once, without a reload
  await page.reload()
  await engineReady(page)
  expect(loads()).toBe(3)
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true)
})

test('a module update pairs the new module with its own wasm, and the new worker waits for Reload', async ({ page }) => {
  test.setTimeout(240_000)
  const a = stampedIds('dist')
  const b = { module: 'bbbbbbbbbbbb', build: 'bbbbbbbbbb02' }
  const distB = fakeUpdate('dist', b)
  const server = await pagesServer({ A: 'dist', B: distB })
  try {
    await firstVisit(page, server.url)
    expect(await loadedModule(page)).toEqual({ mjs: a.module, wasm: a.module })

    // B is deployed; the first load of B runs under A's worker: B's module with B's wasm, which A's
    // worker passes on from the network and does not store
    server.phase('B')
    await page.reload()
    await engineReady(page)
    expect(await loadedModule(page)).toEqual({ mjs: b.module, wasm: b.module })
    expect(server.log).toContain(`B /prose-web/openms/openms.wasm?v=${b.module}`)
    const keys = await page.evaluate(async (name) => (await (await caches.open(name)).keys()).map((r) => r.url), `openms-module-${a.module}`)
    expect(keys.filter((k) => k.includes(b.module))).toEqual([])

    // B's worker waits; the app offers the new version
    const notice = page.getByTestId('update-notice')
    await expect(notice).toContainText('A new version is ready', { timeout: 30_000 })
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(/\/sw\.js$/)

    // Reload: B's worker takes over and stores B's module; A's stores are gone
    const reloaded = page.waitForEvent('load')
    await notice.getByRole('button', { name: 'Reload' }).click()
    await reloaded
    await engineReady(page)
    expect(await loadedModule(page)).toEqual({ mjs: b.module, wasm: b.module })
    const wasmBytes = statSync(`${distB}/openms/openms.wasm`).size
    const stores = await page.evaluate(
      async ({ name, path }) => ({
        names: await caches.keys(),
        wasm: (await (await (await caches.open(name)).match(new URL(path, location.href).href))?.arrayBuffer())?.byteLength,
      }),
      { name: `openms-module-${b.module}`, path: `openms/openms.wasm?v=${b.module}` },
    )
    expect(stores.wasm).toBe(wasmBytes)
    expect(stores.names).toContain(`prose-app-${b.build}`)
    expect(stores.names.filter((n) => n.includes(a.module) || n.includes(a.build))).toEqual([])
    await expect(page.getByTestId('update-notice')).toHaveCount(0)

    // and so on later visits
    await page.reload()
    await engineReady(page)
    expect(await loadedModule(page)).toEqual({ mjs: b.module, wasm: b.module })
  } finally {
    await server.close()
    rmSync(distB, { recursive: true, force: true })
  }
})

test('works offline after the first visit', async ({ page, context }) => {
  test.setTimeout(240_000)
  // Offline emulation does not reach the service worker's own requests, so this test has a server of
  // its own (the same `vite preview` without isolation headers) and stops it.
  const before = process.env.PROSE_PREVIEW_ISOLATION
  process.env.PROSE_PREVIEW_ISOLATION = 'off'
  const server = await preview({ logLevel: 'silent', preview: { host: '127.0.0.1', port: 0, strictPort: false } })
  if (before === undefined) delete process.env.PROSE_PREVIEW_ISOLATION
  else process.env.PROSE_PREVIEW_ISOLATION = before
  const address = server.httpServer.address()
  if (address === null || typeof address === 'string') throw new Error('the preview server has no port')
  try {
    await firstVisit(page, `http://127.0.0.1:${address.port}/prose-web/`)
    await expect(page.getByTestId('engine-status')).toContainText('works offline')
    // the example and cRAP are stored once OpenMS has loaded
    const { app } = storeNames()
    await expect.poll(() => stored(page, app, '__data-stored__'), { timeout: 30_000 }).toBe(true)
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

test('offline before the example was stored, "Try the example" says why', async ({ page, context }) => {
  // the data request never reaches the worker: only the shell and the module are stored
  await page.addInitScript(() => {
    const post = ServiceWorker.prototype.postMessage
    ServiceWorker.prototype.postMessage = function (this: ServiceWorker, message: unknown, ...rest: unknown[]) {
      if ((message as { type?: string })?.type === 'STORE_DATA') return
      return (post as (...a: unknown[]) => void).call(this, message, ...rest)
    } as typeof post
  })
  const server = await pagesServer({ A: 'dist' })
  try {
    await firstVisit(page, server.url)
  } finally {
    await server.close()
  }
  await context.setOffline(true)
  await page.reload()
  await engineReady(page)
  await page.getByRole('button', { name: 'Try the example' }).click()
  await expect(page.getByText('The example is not stored on this computer, and there is no connection.')).toBeVisible()
})

test('a PSM with its PeptDeep prediction, under the service worker', async ({ page }) => {
  test.setTimeout(300_000)
  await firstVisit(page)
  await page.getByRole('button', { name: 'Try the example' }).click()
  const peptdeep = page.getByRole('switch', { name: 'PeptDeep predictions' })
  if ((await peptdeep.getAttribute('aria-checked')) !== 'true') await peptdeep.click()
  await page.getByRole('button', { name: /^Start search/ }).click()
  await expect(page).toHaveURL(/#\/results\/[^/]+$/, { timeout: 180_000 })
  await page.getByRole('tab', { name: /^PSMs/ }).click()
  await page.getByTestId('results-table').locator('tr[data-index]').first().click()
  const spectrum = page.getByTestId('psm-view').getByTestId('spectrum')
  await expect(spectrum.getByTestId('bottom-label')).toContainText(/^PeptDeep · NCE \d+/, { timeout: 60_000 })
  await expect(spectrum.getByTestId('bottom-peaks').first()).toBeAttached()
  // the models came through the worker, with the module's version
  const { module } = storeNames()
  const v = stampedIds('dist').module
  expect(await stored(page, module, `openms/models/peptdeep_ms2_dynamic.onnx?v=${v}`)).toBe(true)
  expect(await stored(page, module, `openms/models/peptdeep_rt_dynamic.onnx?v=${v}`)).toBe(true)
})

test("the app unregisters the earlier demos' service worker", async ({ page }) => {
  // the earlier site's demos registered theirs with scope examples/prose/ (or examples/browser/): resolved
  // against the page, not the script; the desktop app 0.2.0 at /examples/prose/
  await page.goto('./')
  await engineReady(page)
  const earlier = await page.evaluate(async () => (await navigator.serviceWorker.register('sw.js', { scope: 'examples/prose/' })).scope)
  expect(earlier).toMatch(/\/prose-web\/examples\/prose\/$/)
  await page.reload()
  await engineReady(page)
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname)))
    .toEqual(['/prose-web/'])
})

test('the app starts where the browser blocks the session storage', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new DOMException('Access is denied for this document.', 'SecurityError')
      },
    })
  })
  const t0 = Date.now()
  await page.goto('./')
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 10_000 })
  expect(Date.now() - t0).toBeLessThan(10_000)
  await engineReady(page)
  expect(errors).toEqual([])
})

test.describe('without a service worker', () => {
  test('runs single-threaded when the registration is refused', async ({ page }) => {
    test.setTimeout(240_000)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.addInitScript(() => {
      ServiceWorkerContainer.prototype.register = () => Promise.reject(new DOMException('The operation is insecure.', 'SecurityError'))
    })
    const t0 = Date.now()
    await searchSynthetic(page)
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(false)
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull()

    const status = page.getByTestId('engine-status')
    await expect(status).toContainText('1 thread')
    await expect(status).toContainText('not cross-origin isolated')
    await expect(status).toHaveAttribute('title', /one thread/)

    // the search finished: PSMs in the table
    await expect(page.getByRole('tab', { name: /^PSMs/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('results-table').locator('tr[data-index]').first()).toBeVisible()
    expect(Date.now() - t0, 'no wait for a service worker').toBeLessThan(60_000)

    // New search says it too, until dismissed
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'New search' }).click()
    const notice = page.getByTestId('isolation-notice')
    await expect(notice).toContainText('OpenMS runs on one thread')
    await notice.getByRole('button', { name: 'Dismiss' }).click()
    await expect(notice).toBeHidden()
    expect(errors).toEqual([])
  })

  test('starts at once in a browser without service workers', async ({ page }) => {
    await page.addInitScript(() => {
      delete (Navigator.prototype as unknown as { serviceWorker?: unknown }).serviceWorker
    })
    const t0 = Date.now()
    await page.goto('./')
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 5_000 })
    expect(Date.now() - t0).toBeLessThan(5_000)
    await expect(page.getByTestId('engine-status')).toContainText('1 thread · not cross-origin isolated', { timeout: 120_000 })
  })
})
