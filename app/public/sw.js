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
//  3. Offline. The app's files are fetched from the network (network-first) and stored; offline they
//     come from the store. They are all stored on installation (PRECACHE), so after one visit the app
//     and its example work without a network.
//
// The worker's own requests go past the browser's HTTP cache (cache: "no-cache", i.e. revalidated):
// GitHub Pages sends max-age=600, and the HTTP cache would otherwise fill a new version's stores with
// the files of the previous one. The build stamps the ids below (sw-stamp.ts): the module's store is
// named after the module package, the app's store after the whole build; the stores of other ids are
// dropped when a new worker takes over. A hard reload (Shift+Reload) bypasses the worker.

const BUILD_ID = '__BUILD_ID__'
const MODULE_ID = '__MODULE_ID__'
/** The app's files, relative to the scope, stored on installation. */
const PRECACHE = /* __PRECACHE__ */ []

const MODULE_STORE = `openms-module-${MODULE_ID}`
const APP_STORE = `prose-app-${BUILD_ID}`
/** This worker's stores (of any build); not those of the site's other pages (openms-demo/). */
const OWN_STORE = /^(openms-module|prose-app)-[0-9a-f]{12}$/

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

/** The store's key of an app file: the page under one name, without a query. */
function appKey(url) {
  const path = url.pathname === SCOPE.pathname ? `${SCOPE.pathname}index.html` : url.pathname
  return new URL(path, url.origin).href
}

/** From the server, past the browser's HTTP cache (revalidated: a 304 where nothing changed). */
const fromServer = (request) => fetch(request, { cache: 'no-cache' })

/** From the store; the first time from the network, stored and answered from the store. */
async function cacheFirst(request) {
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

/** Stores the app's files (those not stored yet). A file that fails is fetched again when used. */
async function precache() {
  const cache = await caches.open(APP_STORE)
  await Promise.all(
    PRECACHE.map(async (path) => {
      const key = new URL(path, SCOPE).href
      try {
        if (await cache.match(key)) return
        const response = await fromServer(key)
        if (response.ok) await cache.put(key, response)
      } catch {
        // offline or gone: networkFirst() stores it later
      }
    }),
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (OWN_STORE.test(name) && name !== MODULE_STORE && name !== APP_STORE) await caches.delete(name)
      }
      await self.clients.claim()
    })(),
  )
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
    kind === 'module' ? cacheFirst(request) : kind === 'app' ? networkFirst(request, appKey(url)) : fetch(request)
  // (Chrome keeps the compiled code of openms.wasm only if its response is the stored one)
  const pristine = kind === 'module' && url.pathname.endsWith('/openms.wasm')
  event.respondWith(pristine ? response : response.then(withIsolationHeaders))
})
