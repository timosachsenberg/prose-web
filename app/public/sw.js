// ProSE's service worker, registered by src/lib/sw-client.ts with the app's directory as its scope
// (/prose-web/ on GitHub Pages, / in the desktop app). Derived from examples/sw.js (OpenMS PR #10575,
// with the HTTP-cache fix of 80a3b501c4). It does three things a static web server cannot:
//
//  1. Threads. The threaded module needs a cross-origin isolated page: the response headers
//     Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy on the page and on every worker
//     script, which GitHub Pages does not send. The worker adds them to every response it gives,
//     except openms.wasm (see 2), and to every page and worker script within its scope (also the
//     other pages of the site, which it otherwise leaves alone). On the first visit the page reloads
//     once, so that the worker serves it (sw-client.ts). The engine worker's script comes through
//     here with the headers; the module's own threads are started from a Blob (Chromium does not send
//     the script requests of a worker started inside a worker through a service worker) and inherit
//     the engine worker's isolation.
//  2. The module (openms/: openms.mjs, openms.wasm, the PeptDeep models) comes from the Cache API,
//     cache-first. On the first request the worker stores the file and answers from the store at
//     once, so Chrome keeps the compiled code of openms.wasm and the module starts faster from the
//     second visit on. Chrome keeps it only for the stored response itself: a response the worker
//     wraps with new headers is never code-cached, so openms.wasm is passed on untouched.
//     The app asks for every module file with ?v=<the module's id> (engine/worker.ts). Only files of
//     this worker's module are stored; another version's (a page of a newer deployment under this
//     worker, or a tab of an older one) comes from a store that has exactly that URL, else from the
//     network, and is not stored: a module and its wasm must always be of the same version.
//  3. Offline. The app's files are fetched from the network (network-first) and stored; offline they
//     come from the store. The app's shell (index.html, assets/) is stored on installation, all of it
//     or the installation fails; the example and the cRAP database (DATA) are stored when the app
//     asks for them (STORE_DATA, once OpenMS has loaded), so the first visit does not wait for them.
//
// Updates: a new worker waits until the app tells it to take over (SKIP_WAITING: the user chose
// "Reload" in the app's update notice), so tabs of the previous version keep the worker of their
// version. The worker's own requests go past the browser's HTTP cache (cache: "no-cache", i.e.
// revalidated): GitHub Pages sends max-age=600, and the HTTP cache would otherwise fill a new
// version's stores with the files of the previous one. The build stamps the ids and lists below
// (sw-stamp.ts): the module's store is named after the module package, the app's store after the
// whole build; when a new worker takes over, it drops the stores of other ids and what the earlier
// site (examples/, the module in the site's root) left in its stores. Shift+Reload bypasses the worker.

const BUILD_ID = '__BUILD_ID__'
const MODULE_ID = '__MODULE_ID__'
/** The app's shell, relative to the scope, stored on installation (all or nothing). */
const SHELL = /* __SHELL__ */ []
/** The example and the cRAP database, relative to the scope, stored when the app asks (STORE_DATA). */
const DATA = /* __DATA__ */ []

const MODULE_STORE = `openms-module-${MODULE_ID}`
const APP_STORE = `prose-app-${BUILD_ID}`
/** This worker's stores (of any build); not those of the site's other pages (openms-demo/). */
const OWN_STORE = /^(openms-module|prose-app)-[0-9a-f]{12}$/
/** The stores of the earlier site's demos, named after the module version (openms-demo/ uses them too). */
const DEMO_STORE = /^openms-(module|app)-\d+\.\d+\.\d+/
/** Marks a complete DATA in the app's store. */
const DATA_MARK = '__data-stored__'

const SCOPE = new URL(self.registration.scope)

/**
 * What a path of this origin is to the worker: the module ("module"), one of the app's files
 * ("app"), or something else (null: the other pages of the site, data/, ...).
 */
function kindOf(pathname) {
  if (!pathname.startsWith(SCOPE.pathname)) return null
  const rest = pathname.slice(SCOPE.pathname.length)
  if (rest.startsWith('openms/')) return 'module'
  if (rest === '' || rest === 'index.html' || /^(assets|example|fasta)\//.test(rest)) return 'app'
  return null
}

/** What the earlier site stored under this scope: its module in the root, its models, examples/. */
function earlierSiteFile(url) {
  if (!url.pathname.startsWith(SCOPE.pathname)) return false
  const rest = url.pathname.slice(SCOPE.pathname.length)
  return /^(openms\.(wasm|mjs|data)|index\.mjs|package\.json|models\/[^/]+|examples\/.*)$/.test(rest)
}

/** The store's key of an app file: the page under one name, without a query. */
function appKey(url) {
  const path = url.pathname === SCOPE.pathname ? `${SCOPE.pathname}index.html` : url.pathname
  return new URL(path, url.origin).href
}

/** From the server, past the browser's HTTP cache (revalidated: a 304 where nothing changed). */
const fromServer = (request) => fetch(request, { cache: 'no-cache' })

/**
 * A module file: this worker's version from its store (the first time from the network, stored and
 * answered from the store); another version's from a store that has it, else from the network.
 */
async function moduleFile(request, url) {
  if (url.searchParams.get('v') !== MODULE_ID) return (await caches.match(request)) ?? fromServer(request)
  const cache = await caches.open(MODULE_STORE)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fromServer(request)
  if (!response.ok) return response
  await cache.put(request, response)
  return (await cache.match(request)) ?? fromServer(request)
}

/** From the network, stored; from the store when the network fails. */
async function networkFirst(request, key) {
  const cache = await caches.open(APP_STORE)
  try {
    const response = await fromServer(request)
    if (response.ok) await cache.put(key, response.clone())
    return response
  } catch (error) {
    const hit = await cache.match(key)
    if (hit) return hit
    throw error
  }
}

function withIsolationHeaders(response) {
  if (response.status === 0) return response // opaque, or a redirect of a navigation
  const headers = new Headers(response.headers)
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
  headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

/**
 * Stores the shell, all of it or nothing (a failure fails the installation; the browser tries again
 * on a later visit). The page must be of this worker's build: a deployment landing during the
 * installation would otherwise pair this worker with another build's page.
 */
async function storeShell() {
  const responses = await Promise.all(
    SHELL.map(async (path) => {
      const key = new URL(path, SCOPE).href
      const response = await fromServer(key)
      if (!response.ok) throw new Error(`${path}: ${response.status}`)
      return [key, response]
    }),
  )
  const page = responses.find(([key]) => key.endsWith('/index.html'))
  if (page) {
    const build = /<meta name="prose-build" content="([0-9a-f]+)"/.exec(await page[1].clone().text())?.[1]
    if (build !== BUILD_ID) throw new Error(`index.html is of build ${build}, this worker of ${BUILD_ID}`)
  }
  const cache = await caches.open(APP_STORE)
  await Promise.all(responses.map(([key, response]) => cache.put(key, response)))
}

/** Stores DATA (what is not stored yet); true when all of it is. */
async function storeData() {
  const cache = await caches.open(APP_STORE)
  if (await cache.match(new URL(DATA_MARK, SCOPE).href)) return true
  const stored = await Promise.all(
    DATA.map(async (path) => {
      const key = new URL(path, SCOPE).href
      try {
        if (await cache.match(key)) return true
        const response = await fromServer(key)
        if (!response.ok) return false
        await cache.put(key, response)
        return true
      } catch {
        return false // offline: the next STORE_DATA tries again
      }
    }),
  )
  const complete = stored.every(Boolean)
  if (complete) await cache.put(new URL(DATA_MARK, SCOPE).href, new Response(new Date().toISOString()))
  return complete
}

/** Drops this worker's stores of other ids and what the earlier site left in the demos' stores. */
async function dropOldStores() {
  for (const name of await caches.keys()) {
    if (OWN_STORE.test(name)) {
      if (name !== MODULE_STORE && name !== APP_STORE) await caches.delete(name)
    } else if (DEMO_STORE.test(name)) {
      // the earlier site's files only: the entries of openms-demo/ stay
      const cache = await caches.open(name)
      const keys = await cache.keys()
      const old = keys.filter((request) => earlierSiteFile(new URL(request.url)))
      for (const request of old) await cache.delete(request)
      if (old.length > 0 && old.length === keys.length) await caches.delete(name)
    }
  }
  // openms-meta records the version of the demos' stores; without any of them it is the earlier site's
  const names = await caches.keys()
  if (names.includes('openms-meta') && !names.some((name) => DEMO_STORE.test(name))) await caches.delete('openms-meta')
}

self.addEventListener('install', (event) => {
  event.waitUntil(storeShell())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await dropOldStores()
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  const type = event.data?.type
  if (type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting())
  } else if (type === 'STORE_DATA') {
    event.waitUntil(
      storeData().then((complete) => event.source?.postMessage({ type: 'DATA_STORED', complete, build: BUILD_ID })),
    )
  }
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || request.headers.has('range')) return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  const kind = kindOf(url.pathname)
  const isolate = request.mode === 'navigate' || request.destination === 'worker' || request.destination === 'sharedworker'
  if (kind === null && !isolate) return
  const response =
    kind === 'module' ? moduleFile(request, url) : kind === 'app' ? networkFirst(request, appKey(url)) : fetch(request)
  // (Chrome keeps the compiled code of openms.wasm only if its response is the stored one)
  const pristine = kind === 'module' && url.pathname.endsWith('/openms.wasm')
  event.respondWith(pristine ? response : response.then(withIsolationHeaders))
})
