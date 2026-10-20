import { readdirSync, rmSync, statSync } from 'node:fs'
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

/** The build of the page (its <meta name="prose-build">). */
const pageBuildOf = (page: Page) => page.evaluate(() => document.querySelector('meta[name="prose-build"]')?.getAttribute('content'))

/** The keys (paths with query, relative to /prose-web/) of the store `name`. */
function storeKeys(page: Page, name: string): Promise<string[]> {
  return page.evaluate(
    async (name) => (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname.replace('/prose-web/', '') + new URL(r.url).search),
    name,
  )
}

/**
 * Fetches the 64-bit module's files (version `v`) from the page, through the service worker, as a
 * search's worker does: their statuses.
 */
function fetchModule64(page: Page, v: string): Promise<number[]> {
  return page.evaluate(
    (v) => Promise.all(['openms.mjs', 'openms.wasm'].map((f) => fetch(`openms64/${f}?v=${v}`).then((r) => r.arrayBuffer().then(() => r.status)))),
    v,
  )
}

/** The ids of a build; a fake later deployment B of `dist` (see pages-server.ts), removed after the test. */
const A = () => stampedIds('dist')
const B_IDS = { module: 'bbbbbbbbbbbb', module64: 'bbbbbbbbbb64', build: 'bbbbbbbbbb02' }

/**
 * In `page`, a new engine worker from the page's own worker script (as the app starts one for the
 * viewer, or after a cancel or a crash), loading OpenMS: "ready" or what went wrong.
 */
function startEngineWorker(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const src = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/assets/worker-'))!
    const worker = new Worker(src, { type: 'module' })
    try {
      return await new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve('timeout'), 90_000)
        worker.onerror = (e) => (clearTimeout(timer), resolve(`script failed: ${e.message ?? ''}`))
        worker.onmessage = (e) => {
          if (e.data?.id !== 1 || (e.data.type !== 'result' && e.data.type !== 'error')) return
          clearTimeout(timer)
          resolve(e.data.type === 'result' ? 'ready' : `error: ${JSON.stringify(e.data).slice(0, 300)}`)
        }
        worker.postMessage({ id: 1, type: 'init', threads: 1, baseUrl: new URL('/prose-web/', location.href).href })
      })
    } finally {
      worker.terminate()
    }
  })
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

test('on a page its server isolates (as the desktop app), the first start also ends up working offline', async ({ page }) => {
  // vite preview with the isolation headers: the app starts at once, OpenMS loads before the worker serves the page
  await page.goto('http://127.0.0.1:4173/prose-web/')
  await engineReady(page)
  await expect(page.getByTestId('engine-status')).toContainText('works offline', { timeout: 60_000 })
  const { module } = storeNames()
  const v = stampedIds('dist').module
  expect(await stored(page, module, `openms/openms.wasm?v=${v}`)).toBe(true)
  expect(await stored(page, module, `openms/openms.mjs?v=${v}`)).toBe(true)
})

test('a module update pairs the new module with its own wasm, and the new worker waits for Reload', async ({ page }) => {
  test.setTimeout(240_000)
  const a = A()
  const b = B_IDS
  const distB = fakeUpdate('dist', b)
  const server = await pagesServer({ A: 'dist', B: distB })
  try {
    await firstVisit(page, server.url)
    expect(await loadedModule(page)).toEqual({ mjs: a.module, wasm: a.module })
    // A's 64-bit module, as a search above 4 GB uses it (stored on first use)
    expect(await fetchModule64(page, a.module64)).toEqual([200, 200])
    await expect.poll(() => storeKeys(page, `openms64-module-${a.module64}`)).toHaveLength(2)

    // B is deployed; the first load of B runs under A's worker: B's module with B's wasm, which A's
    // worker passes on and does not store (nor B's page or chunks)
    server.phase('B')
    await page.reload()
    await engineReady(page)
    expect(await pageBuildOf(page)).toBe(b.build)
    expect(await loadedModule(page)).toEqual({ mjs: b.module, wasm: b.module })
    expect(server.log).toContain(`B /prose-web/openms/openms.wasm?v=${b.module}`)
    expect((await storeKeys(page, `openms-module-${a.module}`)).filter((k) => k.includes(b.module))).toEqual([])
    expect((await storeKeys(page, `prose-app-${a.build}`)).filter((k) => k.includes(b.build.slice(0, 8)))).toEqual([])

    // B's worker installs completely (its shell and module) and waits; the app offers the new version
    const notice = page.getByTestId('update-notice')
    await expect(notice).toContainText('Update ready', { timeout: 60_000 })
    expect(await storeKeys(page, `openms-module-${b.module}`)).toEqual(
      expect.arrayContaining([`openms/openms.mjs?v=${b.module}`, `openms/openms.wasm?v=${b.module}`]),
    )
    // not its 64-bit module: that is stored when a search first uses it
    expect(await page.evaluate((name) => caches.has(name), `openms64-module-${b.module64}`)).toBe(false)
    expect(server.log.filter((l) => l.includes(`/openms64/`) && l.includes(b.module64))).toEqual([])

    // Reload: B's worker takes over; A's stores go (no page of A is open)
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
    // (A's 64-bit module with them)
    await expect
      .poll(async () => (await page.evaluate(() => caches.keys())).filter((n) => n.includes(a.module) || n.includes(a.module64) || n.includes(a.build)))
      .toEqual([])
    await expect(page.getByTestId('update-notice')).toHaveCount(0)
    await expect(page.getByTestId('engine-status')).toContainText('works offline')

    // and so on later visits
    await page.reload()
    await engineReady(page)
    expect(await loadedModule(page)).toEqual({ mjs: b.module, wasm: b.module })
  } finally {
    await server.close()
    rmSync(distB, { recursive: true, force: true })
  }
})

test('an update the user never applies still works offline', async ({ page, context }) => {
  test.setTimeout(240_000)
  const distB = fakeUpdate('dist', B_IDS)
  const server = await pagesServer({ A: 'dist', B: distB })
  try {
    await firstVisit(page, server.url)
    server.phase('B')
    await page.reload()
    await engineReady(page)
    await expect(page.getByTestId('update-notice')).toBeVisible({ timeout: 60_000 })
    // the user closes the tab without choosing Reload; the next visit is offline
    await server.close()
    await page.close()
    await context.setOffline(true)
    const next = await context.newPage()
    await next.goto(server.url)
    await engineReady(next)
    expect(await pageBuildOf(next)).toBe(B_IDS.build)
    expect(await loadedModule(next)).toEqual({ mjs: B_IDS.module, wasm: B_IDS.module })
    await expect(next.getByTestId('engine-status')).toContainText('works offline')
    // the example A stored is B's too (same bytes): carried over by B's installation
    await next.getByRole('button', { name: 'Try the example' }).click()
    await expect(next.getByText('DatabaseSuitability_database.fasta').first()).toBeVisible({ timeout: 30_000 })
  } finally {
    await server.close()
    rmSync(distB, { recursive: true, force: true })
  }
})

test('an aborted update leaves the previous version working offline', async ({ page, context }) => {
  test.setTimeout(240_000)
  const a = A()
  // B's shell lacks a file on the server: its worker cannot install
  const font = readdirSync('dist/assets').find((f) => f.endsWith('.woff2'))!
  const distB = fakeUpdate('dist', B_IDS, { missing: [`assets/${font}`] })
  const server = await pagesServer({ A: 'dist', B: distB })
  try {
    await firstVisit(page, server.url)
    server.phase('B')
    await page.reload()
    await engineReady(page)
    expect(await pageBuildOf(page)).toBe(B_IDS.build)
    await expect
      .poll(() => page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return Boolean(r?.installing || r?.waiting) }), { timeout: 30_000 })
      .toBe(false)
    await expect(page.getByTestId('update-notice')).toHaveCount(0)
    // A's store still has A's page (not the B page the network gave)
    const storedPage = await page.evaluate(async (name) => (await (await caches.open(name)).match(new URL('index.html', location.href).href))?.text(), `prose-app-${a.build}`)
    expect(storedPage).toContain(`content="${a.build}"`)

    await server.close()
    await context.setOffline(true)
    await page.reload()
    await engineReady(page)
    expect(await pageBuildOf(page)).toBe(a.build)
    expect(await loadedModule(page)).toEqual({ mjs: a.module, wasm: a.module })
  } finally {
    await server.close()
    rmSync(distB, { recursive: true, force: true })
  }
})

test('a PeptDeep model fetched after a deployment is never stored under the old version', async ({ page }) => {
  test.setTimeout(240_000)
  const a = A()
  const distB = fakeUpdate('dist', B_IDS)
  const server = await pagesServer({ A: 'dist', B: distB })
  try {
    await firstVisit(page, server.url)
    server.phase('B')
    // the open A page searches with PeptDeep: its models (v=A) are on the server no more (B's bytes there)
    await page.getByRole('button', { name: 'Try the example' }).click()
    await expect(page.getByText('DatabaseSuitability_database.fasta').first()).toBeVisible({ timeout: 30_000 })
    const peptdeep = page.getByRole('switch', { name: 'PeptDeep predictions' })
    if ((await peptdeep.getAttribute('aria-checked')) !== 'true') await peptdeep.click()
    await page.getByRole('button', { name: /^Start search/ }).click()
    await expect(page.getByText(/A newer version of ProSE was deployed: reload the page\./).first()).toBeVisible({ timeout: 120_000 })
    await expect(page.getByRole('button', { name: 'Reload the page' })).toBeVisible()
    expect(page.url()).not.toMatch(/#\/results\//)
    expect((await storeKeys(page, `openms-module-${a.module}`)).filter((k) => k.includes('/models/'))).toEqual([])
  } finally {
    await server.close()
    rmSync(distB, { recursive: true, force: true })
  }
})

test("an old tab still starts engine workers after a deployment, before and after another tab's Reload", async ({ context }) => {
  test.setTimeout(300_000)
  const a = A()
  const distB = fakeUpdate('dist', B_IDS)
  const server = await pagesServer({ A: 'dist', B: distB })
  try {
    const old = await context.newPage()
    await firstVisit(old, `${server.url}?debug=engine`)
    /** A PeptDeep prediction in the old tab (its MS2 model, never stored, is B's on the server now). */
    const predict = () =>
      old.evaluate(() =>
        (window as unknown as { __engine: { predict: (...a: unknown[]) => Promise<unknown[]> } }).__engine
          .predict('PEPTIDEK', 2, 30, 'QE')
          .then((ions) => `ok ${ions.length}`, (e: Error) => `error: ${e.message}`),
      )
    const other = await context.newPage()
    await other.goto(server.url)
    await engineReady(other)

    server.phase('B')
    await other.reload()
    await engineReady(other)
    await expect(other.getByTestId('update-notice')).toBeVisible({ timeout: 60_000 })
    // A's worker still in charge: A's worker script is gone from the server, but stored
    expect(await startEngineWorker(old)).toBe('ready')
    expect(await predict()).toMatch(/^error: .*A newer version of ProSE was deployed/)

    // the other tab takes the update: B's worker serves the old tab too, and keeps A's generation for it
    const reloaded = other.waitForEvent('load')
    await other.getByTestId('update-notice').getByRole('button', { name: 'Reload' }).click()
    await reloaded
    await engineReady(other)
    await expect.poll(() => old.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)).not.toBeNull()
    expect(await startEngineWorker(old)).toBe('ready')
    expect(await old.evaluate(() => caches.keys())).toEqual(expect.arrayContaining([`prose-app-${a.build}`, `openms-module-${a.module}`]))
    // B's worker knows A's manifest (A's generation): B's bytes under A's URL are refused, not passed on
    expect(await predict()).toMatch(/^error: .*A newer version of ProSE was deployed/)
    // the old tab is told
    await expect(old.getByTestId('update-notice')).toBeVisible({ timeout: 30_000 })

    // once no page of A is open, A's generation goes
    await old.close()
    await other.reload()
    await engineReady(other)
    await expect
      .poll(async () => (await other.evaluate(() => caches.keys())).filter((n) => n.includes(a.module) || n.includes(a.build)), { timeout: 30_000 })
      .toEqual([])
  } finally {
    await server.close()
    rmSync(distB, { recursive: true, force: true })
  }
})

test('the update notice appears also when the page comes while the update is still installing', async ({ page }) => {
  test.setTimeout(240_000)
  const distB = fakeUpdate('dist', B_IDS)
  // B's wasm comes slowly: B's installation (which stores it) is still running when the next page starts
  const server = await pagesServer({ A: 'dist', B: distB }, 'A', {}, { 'B openms/openms.wasm': 8_000 })
  try {
    await firstVisit(page, server.url)
    server.phase('B')
    await page.reload()
    await expect
      .poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.installing)), { timeout: 30_000 })
      .toBe(true)
    // a page that starts during the installation (its updatefound has fired before)
    await page.reload()
    expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.installing))).toBe(true)
    await expect(page.getByTestId('update-notice')).toBeVisible({ timeout: 60_000 })
  } finally {
    await server.close()
    rmSync(distB, { recursive: true, force: true })
  }
})

test('with a full storage OpenMS still loads, online, and says why it does not work offline', async ({ page, context }) => {
  test.setTimeout(240_000)
  const server = await pagesServer({ A: 'dist' })
  try {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(server.url).origin, quotaSize: 30e6 })
    await firstVisit(page, server.url)
    const status = page.getByTestId('engine-status')
    await expect(status).toContainText(/\d+ threads/)
    await expect(status).not.toContainText('works offline')
    await expect(status).toHaveAttribute('title', /storage for this site is full/, { timeout: 30_000 })
    // and again on the next visit (the module from the network)
    await page.reload()
    await engineReady(page)
    await expect(status).not.toContainText('could not be loaded')
  } finally {
    await server.close()
  }
})

test('an update that has no room for its module still arrives, and makes room once it takes over', async ({ page, context }) => {
  test.setTimeout(300_000)
  const a = A()
  const distB = fakeUpdate('dist', B_IDS)
  const server = await pagesServer({ A: 'dist', B: distB })
  try {
    // room for one module (≈ 45 MB) and A's example, not for a second module
    const cdp = await context.newCDPSession(page)
    await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(server.url).origin, quotaSize: 80e6 })
    await firstVisit(page, server.url)
    await expect(page.getByTestId('engine-status')).toContainText('works offline')
    await expect.poll(() => stored(page, `prose-app-${a.build}`, '__data-stored__'), { timeout: 30_000 }).toBe(true)

    server.phase('B')
    await page.reload()
    await engineReady(page)
    // B installs without its module (no room while A is in use) and waits: the notice, and B's wasm
    // downloaded once (by the page), not again and again by failing installations
    await expect(page.getByTestId('update-notice')).toBeVisible({ timeout: 60_000 })
    await page.waitForTimeout(3000)
    expect(server.log.filter((l) => l === `B /prose-web/openms/openms.wasm?v=${B_IDS.module}`).length).toBe(1)

    // Reload: B takes over; no page of A is open, so A goes and B stores its module
    const reloaded = page.waitForEvent('load')
    await page.getByTestId('update-notice').getByRole('button', { name: 'Reload' }).click()
    await reloaded
    await engineReady(page)
    expect(await loadedModule(page)).toEqual({ mjs: B_IDS.module, wasm: B_IDS.module })
    await expect(page.getByTestId('engine-status')).toContainText('works offline', { timeout: 60_000 })
    expect((await page.evaluate(() => caches.keys())).filter((n) => n.includes(a.module) || n.includes(a.build))).toEqual([])
  } finally {
    await server.close()
    rmSync(distB, { recursive: true, force: true })
  }
})

test("other pages of the site do not keep a previous version's files", async ({ page, context }) => {
  test.setTimeout(240_000)
  const a = A()
  const distB = fakeUpdate('dist', B_IDS)
  const server = await pagesServer({ A: 'dist', B: distB })
  try {
    await firstVisit(page, server.url)
    // a page of the site that is not the app (under the worker's scope; it never answers BUILD?)
    const other = await context.newPage()
    await other.goto(`${server.url}data/`)
    server.phase('B')
    await page.reload()
    await engineReady(page)
    const reloaded = page.waitForEvent('load')
    await page.getByTestId('update-notice').getByRole('button', { name: 'Reload' }).click({ timeout: 60_000 })
    await reloaded
    await engineReady(page)
    await expect
      .poll(async () => (await page.evaluate(() => caches.keys())).filter((n) => n.includes(a.module) || n.includes(a.build)), { timeout: 30_000 })
      .toEqual([])
  } finally {
    await server.close()
    rmSync(distB, { recursive: true, force: true })
  }
})

test('a module of this version that is no longer on the server: a clear message', async ({ page }) => {
  const distB = fakeUpdate('dist', B_IDS)
  const server = await pagesServer({ A: 'dist', B: distB })
  try {
    await firstVisit(page, server.url)
    // the open A page's module not stored (e.g. dropped), B deployed: a new engine worker of A
    await page.evaluate(async () => {
      for (const name of await caches.keys()) if (name.startsWith('openms-module-')) await caches.delete(name)
    })
    server.phase('B')
    expect(await startEngineWorker(page)).toMatch(/^error: .*A newer version of ProSE was deployed: reload the page/)
  } finally {
    await server.close()
    rmSync(distB, { recursive: true, force: true })
  }
})

test('the 64-bit engine is stored only when a search first uses it, by its own ?v=, and then works offline', async ({ page, context }) => {
  test.setTimeout(420_000)
  const a = A()
  const server = await pagesServer({ A: 'dist' })
  /** The example, searched (PeptDeep off) on the page as it is; ends on the results. */
  const searchExample = async () => {
    await page.getByRole('button', { name: 'Try the example' }).click()
    await expect(page.getByText('DatabaseSuitability_database.fasta').first()).toBeVisible({ timeout: 30_000 })
    const peptdeep = page.getByRole('switch', { name: 'PeptDeep predictions' })
    if ((await peptdeep.getAttribute('aria-checked')) === 'true') await peptdeep.click()
    await expect(page.getByTestId('search-plan')).toContainText('64-bit engine (up to 16 GB)')
    await page.getByRole('button', { name: /^Start search/ }).click()
    await expect(page.getByTestId('search-engine')).toHaveText('64-bit', { timeout: 60_000 })
    await expect(page).toHaveURL(/#\/results\/[^/]+$/, { timeout: 180_000 })
  }
  /** The ?v= of the 64-bit module files the page's workers loaded. */
  const loaded64 = async () => {
    const out = new Set<string>()
    // (the engine workers only: the module's threads, Blob workers, may be blocked in a wait)
    for (const worker of page.workers().filter((w) => w.url().includes('/assets/worker-'))) {
      const names = await worker.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name)).catch(() => [])
      for (const n of names) if (new URL(n).pathname.includes('/openms64/')) out.add(new URL(n).pathname.replace('/prose-web/', '') + new URL(n).search)
    }
    return [...out].sort()
  }
  const status = page.getByTestId('engine-status')
  try {
    await firstVisit(page, server.url)
    await expect(status).toContainText('works offline')
    await expect.poll(() => stored(page, `prose-app-${a.build}`, '__data-stored__'), { timeout: 30_000 }).toBe(true)
    // the first visit neither downloads nor stores it
    expect(await page.evaluate((name) => caches.has(name), `openms64-module-${a.module64}`)).toBe(false)
    expect(server.log.filter((l) => l.includes('/openms64/'))).toEqual([])
    await expect(status).toHaveAttribute('title', /The 64-bit engine for large searches not stored yet \(stored when first used\)\./)

    // a search in it (?debug=wasm64): its files with its own id, stored in a store of their own
    await page.goto(`${server.url}?debug=wasm64`)
    await engineReady(page)
    await searchExample()
    const v = a.module64
    expect(await loaded64()).toEqual([`openms64/openms.mjs?v=${v}`, `openms64/openms.wasm?v=${v}`])
    const requested = server.log.filter((l) => l.includes('/openms64/'))
    expect(requested).toContain(`A /prose-web/openms64/openms.wasm?v=${v}`)
    expect(requested.filter((l) => !l.endsWith(`?v=${v}`))).toEqual([])
    expect((await storeKeys(page, `openms64-module-${v}`)).sort()).toEqual([`openms64/openms.mjs?v=${v}`, `openms64/openms.wasm?v=${v}`])
    expect((await storeKeys(page, `openms-module-${a.module}`)).filter((k) => k.includes('openms64'))).toEqual([])
    await expect(status).toHaveAttribute('title', /The 64-bit engine for large searches too\./, { timeout: 30_000 })
  } finally {
    await server.close()
  }
  // offline (the server is gone): the 64-bit engine starts from the store
  await context.setOffline(true)
  await page.goto(`${server.url}?debug=wasm64`)
  await engineReady(page)
  await searchExample()
  expect(await loaded64()).toEqual([`openms64/openms.mjs?v=${a.module64}`, `openms64/openms.wasm?v=${a.module64}`])
})

test('with no room for the 64-bit engine it still runs, online, and the chip says why it is not stored', async ({ page, context }) => {
  test.setTimeout(240_000)
  const a = A()
  const server = await pagesServer({ A: 'dist' })
  try {
    // room for the app, its module (≈ 45 MB) and the example, not for the 64-bit module (≈ 46 MB)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(server.url).origin, quotaSize: 80e6 })
    await firstVisit(page, server.url)
    const status = page.getByTestId('engine-status')
    await expect(status).toContainText('works offline')
    // a search's worker loads it: answered from the network, whole, and not stored
    expect(await fetchModule64(page, a.module64)).toEqual([200, 200])
    const size = await page.evaluate(async (v) => (await (await fetch(`openms64/openms.wasm?v=${v}`)).arrayBuffer()).byteLength, a.module64)
    expect(size).toBe(statSync('dist/openms64/openms.wasm').size)
    expect(await storeKeys(page, `openms64-module-${a.module64}`)).not.toContain(`openms64/openms.wasm?v=${a.module64}`)
    // the app still works offline (its module is stored); the chip says why the 64-bit engine is not
    await expect(status).toContainText('works offline')
    const full = /The 64-bit engine for large searches not stored: the browser's storage for this site is full\./
    await expect(status).toHaveAttribute('title', full, { timeout: 30_000 })
    // and still after the service worker was stopped (as the browser stops an idle one) and started again
    await cdp.send('ServiceWorker.enable')
    await cdp.send('ServiceWorker.stopAllWorkers')
    await page.reload()
    await engineReady(page)
    await expect(status).toContainText('works offline')
    await expect(status).toHaveAttribute('title', full, { timeout: 30_000 })
  } finally {
    await server.close()
  }
})

test("an update without room for its module drops a stored 64-bit engine rather than staying online-only", async ({ page, context }) => {
  test.setTimeout(300_000)
  const a = A()
  const distB = fakeUpdate('dist', B_IDS)
  const server = await pagesServer({ A: 'dist', B: distB })
  try {
    // room for A (≈ 52 MB) with its 64-bit engine (≈ 46 MB), not for B's module beside them
    const cdp = await context.newCDPSession(page)
    await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(server.url).origin, quotaSize: 130e6 })
    await firstVisit(page, server.url)
    await expect(page.getByTestId('engine-status')).toContainText('works offline')
    await expect.poll(() => stored(page, `prose-app-${a.build}`, '__data-stored__'), { timeout: 30_000 }).toBe(true)
    expect(await fetchModule64(page, a.module64)).toEqual([200, 200])
    await expect.poll(() => storeKeys(page, `openms64-module-${a.module64}`)).toHaveLength(2)
    // a later session: the browser stopped the worker that served it (Chrome frees a dropped store's
    // bytes only once no worker or page holds its responses)
    await cdp.send('ServiceWorker.enable')
    await cdp.send('ServiceWorker.stopAllWorkers')
    await page.reload()
    await engineReady(page)

    // B installs: no room for its module while A's 64-bit engine is stored, so that goes (it is stored
    // again when a search needs it), and B stores its module before it waits: complete
    server.phase('B')
    await page.reload()
    await engineReady(page)
    await expect(page.getByTestId('update-notice')).toBeVisible({ timeout: 60_000 })
    expect(await storeKeys(page, `openms-module-${B_IDS.module}`)).toEqual(
      expect.arrayContaining([`openms/openms.mjs?v=${B_IDS.module}`, `openms/openms.wasm?v=${B_IDS.module}`]),
    )
    expect(await page.evaluate((n) => caches.has(n), `openms64-module-${a.module64}`)).toBe(false)
    const marker = await page.evaluate(
      async (name) => (await (await caches.open(name)).match(new URL('__generation__', location.href).href))?.json(),
      `prose-app-${B_IDS.build}`,
    )
    expect(marker.moduleSkipped).toBeUndefined()
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
  // the earlier site's demos registered theirs (examples/sw.js) with scope examples/prose/ (resolved
  // against the page, not the script); the desktop app 0.2.0 at /examples/prose/
  const server = await pagesServer({ A: 'dist' }, 'A', {
    'examples/sw.js': {
      type: 'text/javascript',
      body: "self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim())); self.addEventListener('fetch', () => {})",
    },
  })
  try {
    await firstVisit(page, server.url)
    const scope = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register('examples/sw.js', { scope: 'examples/prose/' })
      const worker = registration.installing ?? registration.waiting ?? registration.active
      if (worker && worker.state !== 'activated') await new Promise((resolve) => worker.addEventListener('statechange', () => worker.state === 'activated' && resolve(null)))
      return registration.scope
    })
    expect(scope).toMatch(/\/prose-web\/examples\/prose\/$/)
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(2)
    await page.reload()
    await engineReady(page)
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname)))
      .toEqual(['/prose-web/'])
  } finally {
    await server.close()
  }
})

test('the app starts where the browser blocks the session storage: no reload, one thread', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  let loads = 0
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) loads++
  })
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
  await expect(page.getByTestId('engine-status')).toContainText('1 thread · not cross-origin isolated', { timeout: 120_000 })
  await page.waitForTimeout(2000)
  expect(loads).toBe(1)
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
