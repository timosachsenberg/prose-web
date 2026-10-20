// ProSE's service worker, registered by src/lib/sw-client.ts with the app's directory as its scope
// (/prose-web/ on GitHub Pages, / in the desktop app). Derived from examples/sw.js (OpenMS PR #10575,
// with the HTTP-cache fix of 80a3b501c4).
//
//  1. Threads. The threaded module needs a cross-origin isolated page: the response headers
//     Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy on the page and on every worker
//     script, which GitHub Pages does not send. The worker adds them to every response it gives,
//     except openms.wasm (see 2), and to every page and worker script within its scope (also the
//     other pages of the site, which it otherwise leaves alone). On the first visit the page reloads
//     once, so that the worker serves it (sw-client.ts). The module's own threads are started from a
//     Blob inside the engine worker and inherit its isolation.
//  2. Only bytes of its own build. The build gives the worker a MANIFEST (path → size, SHA-256) of its
//     files; it stores a response only if its bytes are those (verified on a copy), else it stores
//     nothing. Files of its own module version (?v=MODULE_ID: openms.mjs, openms.wasm, the PeptDeep
//     models) come from its store, cache-first, and on the first request are stored and answered from
//     the store, so Chrome keeps the compiled code of openms.wasm (the stored response itself is
//     given: a response the worker wraps with new headers is never code-cached, so openms.wasm is
//     passed on untouched). If the server has other bytes under such a URL (a newer version was
//     deployed), the answer is an error (409), never the other bytes. Files of another version
//     (another ?v=, other hashed asset names) come from a kept store that has exactly that URL, else
//     from the network, unstored.
//  3. Offline. The hashed assets (assets/) come from a store if there (their names change with their
//     content), else from the network; the page, the example and fasta/ from the network
//     (network-first). Either is stored if it is of this build; offline, or if the server has a file no
//     more (an older tab after a deployment), it comes from a store. Installation stores the shell (index.html, assets/), all of it or the
//     installation fails, and only if the server's index.html is of this build; the installation of
//     an update stores the module (openms.mjs, openms.wasm) as well, so that the new version is
//     complete before it waits. The example and the cRAP database (DATA) are stored when the app asks.
//     The worker reports what is stored (STATUS): "works offline" = this build's shell and module.
//  4. Generations. A generation = this build's app store prose-app-<BUILD_ID> and its module store
//     openms-module-<MODULE_ID>; a marker in the app store records when it was installed and
//     activated. A new version's worker waits until the app tells it to take over (SKIP_WAITING: the
//     user chose "Reload"; or no tab of the old version is left). Once active and complete, it keeps
//     the previous generation while pages of that build are open (it asks them), so they can still
//     start workers and load their module; then, or at the next activation, it is dropped. Never more
//     than one previous generation is kept.
//
// The worker's own requests go past the browser's HTTP cache (cache: "no-cache", i.e. revalidated):
// GitHub Pages sends max-age=600. On activation it also drops what the earlier site (examples/, the
// module in the site's root) left in the demos' stores. Shift+Reload bypasses the worker.

const BUILD_ID = '__BUILD_ID__'
const MODULE_ID = '__MODULE_ID__'
/** The 64-bit module package (openms64/); stored by the worker from a later version on. */
const MODULE64_ID = '__MODULE64_ID__'
/** The app's shell, relative to the scope, stored on installation (all or nothing). */
const SHELL = /* __SHELL__ */ []
/** The example and the cRAP database, relative to the scope, stored when the app asks (STORE_DATA). */
const DATA = /* __DATA__ */ []
/** path → [size, SHA-256 hex] of the build's files (relative to the scope). */
const MANIFEST = /* __MANIFEST__ */ {}

/** The module's files the app cannot start without (stored with ?v=MODULE_ID). */
const MODULE = ['openms/openms.mjs', 'openms/openms.wasm']
const MODELS = Object.keys(MANIFEST).filter((path) => path.startsWith('openms/models/'))

const MODULE_STORE = `openms-module-${MODULE_ID}`
const APP_STORE = `prose-app-${BUILD_ID}`
const APP_STORE_NAME = /^prose-app-([0-9a-f]{12})$/
const MODULE_STORE_NAME = /^openms-module-([0-9a-f]{12})$/
/** The stores of the earlier site's demos, named after the module version (openms-demo/ uses them too). */
const DEMO_STORE = /^openms-(module|app)-\d+\.\d+\.\d+/

const SCOPE = new URL(self.registration.scope)
const at = (path) => new URL(path, SCOPE).href
const GENERATION_KEY = at('__generation__')
const DATA_MARK = at('__data-stored__')

/** A path of the scope, relative to it; null outside. */
function relative(url) {
  return url.pathname.startsWith(SCOPE.pathname) ? url.pathname.slice(SCOPE.pathname.length) : null
}

/** What a path is to the worker: "module", "app", or null (the site's other pages, data/, ...). */
function kindOf(rest) {
  if (rest === null) return null
  if (rest.startsWith('openms/')) return 'module'
  if (rest === '' || rest === 'index.html' || /^(assets|example|fasta)\//.test(rest)) return 'app'
  return null
}

/** What the earlier site stored under this scope: its module in the root, its models, examples/. */
function earlierSiteFile(url) {
  const rest = relative(url)
  return rest !== null && /^(openms\.(wasm|mjs|data)|index\.mjs|package\.json|models\/[^/]+|examples\/.*)$/.test(rest)
}

/** The store's key of an app file: the page under one name, without a query. */
function appKey(url) {
  return at(url.pathname === SCOPE.pathname ? 'index.html' : relative(url))
}

/** The key of a file of this module version. */
const moduleKey = (path) => `${at(path)}?v=${MODULE_ID}`

/** Set when a store failed for lack of room (this worker's life; an update's marker records it too). */
let storageFull = false

/** The bytes of the module's files (openms.mjs, openms.wasm). */
const MODULE_BYTES = MODULE.reduce((sum, path) => sum + (MANIFEST[path]?.[0] ?? 0), 0)

/** Whether the browser's storage for the site has room for `bytes` more (with a margin); true if it cannot tell. */
async function room(bytes) {
  try {
    const { quota, usage } = await navigator.storage.estimate()
    return quota === undefined || usage === undefined || quota - usage > bytes * 1.1 + 4e6
  } catch {
    return true
  }
}

/** cache.put that never fails its caller: false when it could not store (the storage is full). */
async function store(cache, key, response) {
  try {
    await cache.put(key, response)
    return true
  } catch (error) {
    if (error?.name === 'QuotaExceededError') storageFull = true
    return false
  }
}

/** From the server, past the browser's HTTP cache (revalidated: a 304 where nothing changed). */
const fromServer = (request) => fetch(request, { cache: 'no-cache' })

async function sha256(buffer) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Whether `response` (consumed: give a copy) has the bytes of `path` in `manifest` (default: this build's). */
async function isOwn(response, path, manifest = MANIFEST) {
  const expected = manifest[path]
  if (!expected || !response.ok) return false
  const bytes = await response.arrayBuffer()
  return bytes.byteLength === expected[0] && (await sha256(bytes)) === expected[1]
}

/** The stores of this worker's kind (any build): app and module stores. */
async function ownStores() {
  return (await caches.keys()).filter((name) => APP_STORE_NAME.test(name) || MODULE_STORE_NAME.test(name))
}

/** `request` (exact URL) from any of the kept stores. */
async function fromKept(request) {
  for (const name of await ownStores()) {
    const hit = await (await caches.open(name)).match(request)
    if (hit) return hit
  }
  return undefined
}

/** The manifest of the generation (of any kept build) with module version `module`, if one is stored. */
async function manifestOfModule(module) {
  for (const name of await caches.keys()) {
    if (!APP_STORE_NAME.test(name)) continue
    const marker = await (await (await caches.open(name)).match(GENERATION_KEY))?.json().catch(() => null)
    if (marker?.module === module && marker.manifest) return marker.manifest
  }
  return null
}

/**
 * A file of another module version (a page of a newer deployment under this worker, an older tab):
 * from a store that has exactly that URL; else from the network, unstored, and verified against that
 * version's manifest where a generation of it is stored (else as the server has it).
 */
async function otherModuleFile(request, path, version) {
  const hit = await fromKept(request)
  if (hit) return hit
  const response = await fromServer(request)
  const manifest = response.ok ? await manifestOfModule(version) : null
  if (manifest && !(await isOwn(response.clone(), path, manifest))) return conflict(path)
  return response
}

function conflict(path) {
  return new Response(`${path}: the server has another version of this file (a newer ProSE was deployed). Reload the page.`, {
    status: 409,
    statusText: 'Another version was deployed; reload the page',
    headers: { 'content-type': 'text/plain' },
  })
}

/**
 * A file of this module version: from the store; the first time from the network, verified, stored
 * and answered from the store (the stored response: Chrome code-caches openms.wasm only for it). Where
 * the storage has no room it is answered from the network, unstored.
 */
async function ownModuleFile(request, path) {
  const cache = await caches.open(MODULE_STORE)
  const key = moduleKey(path)
  const hit = await cache.match(key)
  if (hit) return hit
  const response = await fromServer(request)
  if (!response.ok) return response
  const fits = await room(MANIFEST[path]?.[0] ?? 0)
  const forPage = response.clone()
  if (!(await isOwn(response.clone(), path))) {
    void forPage.body?.cancel()
    return conflict(path)
  }
  if (fits && (await store(cache, key, response))) {
    void forPage.body?.cancel()
    void reportStatus()
    return (await cache.match(key)) ?? fromServer(request)
  }
  if (!fits) storageFull = true
  void response.body?.cancel()
  void reportStatus()
  return forPage
}

/**
 * A hashed asset (assets/: its name changes with its content, so a URL always means the same bytes):
 * from a store (this generation's, else a kept one); else from the network, stored if it is this
 * build's. An old tab thus keeps its own chunks whatever the server has now.
 */
async function asset(request, url) {
  const key = appKey(url)
  const hit = (await (await caches.open(APP_STORE)).match(key)) ?? (await fromKept(key))
  if (hit) return hit
  const response = await fromServer(request)
  const path = key.slice(SCOPE.href.length)
  if (MANIFEST[path] && (await isOwn(response.clone(), path))) await store(await caches.open(APP_STORE), key, response.clone())
  return response
}

/** An app file (the page, the example, fasta/): from the network (stored if it is of this build); else from a store. */
async function networkFirst(request, url) {
  const key = appKey(url)
  const path = key.slice(SCOPE.href.length)
  const stored = async () => (await (await caches.open(APP_STORE)).match(key)) ?? (await fromKept(key))
  let response
  try {
    response = await fromServer(request)
  } catch (error) {
    const hit = await stored()
    if (hit) return hit
    throw error
  }
  if (!response.ok) return (await stored()) ?? response
  if (MANIFEST[path] && (await isOwn(response.clone(), path))) await store(await caches.open(APP_STORE), key, response.clone())
  return response
}

function withIsolationHeaders(response) {
  if (response.status === 0) return response // opaque, or a redirect of a navigation
  const headers = new Headers(response.headers)
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
  headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

/**
 * Fetches `path` (at `url`), verifies it, and stores it under `key` in `cache`; throws if it is not
 * this build's or cannot be stored (a QuotaExceededError where the storage is full).
 */
async function storeVerified(cache, path, url, key) {
  if (await cache.match(key)) return
  const response = await fromServer(url)
  if (!(await isOwn(response.clone(), path))) throw new Error(`${path}: not the file of build ${BUILD_ID}`)
  if (!(await store(cache, key, response))) throw new DOMException(`${path}: no room to store it`, 'QuotaExceededError')
}

/** Stores the module (openms.mjs, openms.wasm), verified; false where the storage has no room for it. */
async function storeModule() {
  if (!(await room(MODULE_BYTES))) return false
  const module = await caches.open(MODULE_STORE)
  try {
    for (const path of MODULE) await storeVerified(module, path, moduleKey(path), moduleKey(path))
    return true
  } catch (error) {
    if (error?.name === 'QuotaExceededError') return false
    throw error
  }
}

/**
 * The installation: the shell, all of it or nothing (a failure fails the installation; the browser
 * tries again later), verified against the manifest, so also only with an index.html of this build (a
 * deployment landing during the installation aborts it). An update (a worker of another version is
 * active) also stores the module, so it is complete before it waits.
 */
async function install() {
  const app = await caches.open(APP_STORE)
  const marker = { build: BUILD_ID, module: MODULE_ID, installed: Date.now(), activated: null, manifest: MANIFEST }
  if (!(await store(app, GENERATION_KEY, Response.json(marker)))) throw new Error('no room for the shell')
  const responses = await Promise.all(
    SHELL.map(async (path) => {
      const response = await fromServer(at(path))
      if (!(await isOwn(response.clone(), path))) throw new Error(`${path}: not the file of build ${BUILD_ID}`)
      return [at(path), response]
    }),
  )
  const stored = await Promise.all(responses.map(([key, response]) => store(app, key, response)))
  if (!stored.every(Boolean)) throw new Error('no room for the shell')
  if (self.registration.active) {
    // an update: complete before it waits; where the storage has no room for the module even after
    // dropping what no open page needs, it arrives without (online only, "storage full")
    let complete = await storeModule()
    if (!complete) {
      await freeGenerations()
      complete = await storeModule()
    }
    if (complete) await carryOver(app, await caches.open(MODULE_STORE))
    else await store(app, GENERATION_KEY, Response.json({ ...marker, moduleSkipped: 'storage full' }))
  }
}

/**
 * An update takes over what the previous generations stored of DATA and the models, where the bytes
 * are those of this build (no download; what differs is fetched when used).
 */
async function carryOver(app, module) {
  const others = (await ownStores()).filter((name) => name !== APP_STORE && name !== MODULE_STORE)
  const find = async (matches) => {
    for (const name of others) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) if (matches(new URL(request.url))) return cache.match(request)
    }
    return undefined
  }
  const take = async (cache, path, key, matches) => {
    if (await cache.match(key)) return true
    const response = await find(matches)
    if (!response || !(await isOwn(response.clone(), path))) return false
    return store(cache, key, response)
  }
  let data = true
  for (const path of DATA) data = (await take(app, path, at(path), (url) => url.href === at(path))) && data
  if (data) await store(app, DATA_MARK, new Response(new Date().toISOString()))
  for (const path of MODELS) await take(module, path, moduleKey(path), (url) => url.origin + url.pathname === at(path))
}

/**
 * Stores DATA (what is not stored yet); true when all of it is. Also the module, if a page loaded it
 * before this worker served it (a page isolated by its server, as in the desktop app, starts at once).
 */
async function storeData() {
  await storeModule().catch(() => {})
  const cache = await caches.open(APP_STORE)
  if (await cache.match(DATA_MARK)) return true
  const stored = await Promise.all(
    DATA.map((path) =>
      storeVerified(cache, path, at(path), at(path)).then(
        () => true,
        () => false, // offline, or another build on the server: the next STORE_DATA tries again
      ),
    ),
  )
  const complete = stored.every(Boolean)
  if (complete) await store(cache, DATA_MARK, new Response(new Date().toISOString()))
  return complete
}

/** What this worker has stored: the shell and the module (= works offline), the models, the data. */
async function status() {
  const app = await caches.open(APP_STORE)
  const module = await caches.open(MODULE_STORE)
  const all = async (cache, keys) => (await Promise.all(keys.map((key) => cache.match(key)))).every(Boolean)
  const shell = await all(app, SHELL.map(at))
  const moduleStored = await all(module, MODULE.map(moduleKey))
  const models = {}
  for (const path of MODELS) models[path.split('/').pop()] = Boolean(await module.match(moduleKey(path)))
  const previous = (await generations()).find((g) => g.kept)
  const marker = await (await app.match(GENERATION_KEY))?.json().catch(() => null)
  const offline = shell && moduleStored
  return {
    type: 'STATUS',
    build: BUILD_ID,
    module: MODULE_ID,
    shell,
    moduleStored,
    offline,
    // not stored for lack of room (the app then works online only)
    storageFull: !offline && (storageFull || Boolean(marker?.moduleSkipped) || !(await room(MODULE_BYTES))),
    models,
    data: Boolean(await app.match(DATA_MARK)),
    kept: previous?.build ?? null,
  }
}

async function reportStatus(client) {
  const report = await status()
  const clients = client ? [client] : await self.clients.matchAll({ type: 'window' })
  for (const c of clients) c.postMessage(report)
}

/** The other generations: their builds, module ids and markers (null: no marker, an older kind of store). */
async function generations() {
  const own = await (await (await caches.open(APP_STORE)).match(GENERATION_KEY))?.json()
  const out = []
  for (const name of await caches.keys()) {
    const build = APP_STORE_NAME.exec(name)?.[1]
    if (!build || build === BUILD_ID) continue
    const marker = await (await (await caches.open(name)).match(GENERATION_KEY))?.json().catch(() => null)
    out.push({ build, store: name, module: marker?.module ?? null, marker, kept: false })
  }
  // previous = activated before this one; newer = installed after it (installing or waiting: not ours to drop)
  const previous = out.filter((g) => g.marker?.activated && (!own?.activated || g.marker.activated < own.activated))
  previous.sort((a, b) => b.marker.activated - a.marker.activated)
  if (previous[0]) previous[0].kept = true
  for (const g of out) g.newer = Boolean(g.marker && own && g.marker.installed > own.installed && !g.marker.activated)
  return out
}

/** The builds of the open pages (they answer BUILD?); null for a page that does not answer in time. */
async function openBuilds() {
  // the app's own windows only (its page, any query or hash): not the site's other pages, nor other
  // sites of the origin (on GitHub Pages: every project site of the user), which never answer
  const clients = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter((client) => {
    const rest = relative(new URL(client.url))
    return rest === '' || rest === 'index.html'
  })
  return Promise.all(
    clients.map(
      (client) =>
        new Promise((resolve) => {
          const channel = new MessageChannel()
          const timer = setTimeout(() => resolve(null), 1000)
          channel.port1.onmessage = (event) => {
            clearTimeout(timer)
            resolve(event.data?.build ?? null)
          }
          client.postMessage({ type: 'BUILD?' }, [channel.port2])
        }),
    ),
  )
}

/**
 * Drops the generations this worker no longer needs: all but the previous one; the previous one when
 * this generation is complete (shell and module) and no page of its build is open. Never one that is
 * newer (installing or waiting). Only the active worker cleans.
 */
let cleaning = null
function cleanGenerations() {
  cleaning ??= (async () => {
    try {
      // (a waiting worker of a newer version must not drop the generation that is in use)
      if (self.serviceWorker && self.registration.active !== self.serviceWorker) return
      const own = await status()
      // the previous generation stays while this one is incomplete (unless for lack of room: then it
      // goes as soon as no page needs it, to make room) or a page of its build is open
      const settled = own.offline || own.storageFull
      const builds = settled ? await openBuilds() : null
      const keepModules = new Set([MODULE_ID])
      for (const g of await generations()) {
        const keep = g.newer || (g.kept && (!settled || builds.includes(g.build) || builds.includes(null)))
        if (keep) {
          if (g.module) keepModules.add(g.module)
          continue
        }
        await caches.delete(g.store)
      }
      for (const name of await caches.keys()) {
        const module = MODULE_STORE_NAME.exec(name)?.[1]
        if (module && !keepModules.has(module)) await caches.delete(name)
      }
    } finally {
      cleaning = null
    }
  })()
  return cleaning
}

/**
 * Makes room for an update's module: drops the generations that neither the active worker (the
 * newest previous one) nor an open page of the app needs; never a newer one.
 */
async function freeGenerations() {
  const builds = await openBuilds()
  const keepModules = new Set([MODULE_ID])
  for (const g of await generations()) {
    if (g.newer || g.kept || builds.includes(g.build) || builds.includes(null)) {
      if (g.module) keepModules.add(g.module)
      continue
    }
    await caches.delete(g.store)
  }
  for (const name of await caches.keys()) {
    const module = MODULE_STORE_NAME.exec(name)?.[1]
    if (module && !keepModules.has(module)) await caches.delete(name)
  }
}

/** What the earlier site left in the demos' stores (the entries of openms-demo/ stay). */
async function dropEarlierSite() {
  for (const name of await caches.keys()) {
    if (!DEMO_STORE.test(name)) continue
    const cache = await caches.open(name)
    const keys = await cache.keys()
    const old = keys.filter((request) => earlierSiteFile(new URL(request.url)))
    for (const request of old) await cache.delete(request)
    if (old.length > 0 && old.length === keys.length) await caches.delete(name)
  }
  // openms-meta records the version of the demos' stores; without any of them it is the earlier site's
  const names = await caches.keys()
  if (names.includes('openms-meta') && !names.some((name) => DEMO_STORE.test(name))) await caches.delete('openms-meta')
}

self.addEventListener('install', (event) => {
  event.waitUntil(install())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const app = await caches.open(APP_STORE)
      const marker = (await (await app.match(GENERATION_KEY))?.json().catch(() => null)) ?? { build: BUILD_ID, module: MODULE_ID, installed: Date.now() }
      await store(app, GENERATION_KEY, Response.json({ ...marker, activated: Date.now() }))
      await dropEarlierSite()
      await self.clients.claim()
      await cleanGenerations()
      await reportStatus()
    })(),
  )
})

self.addEventListener('message', (event) => {
  const type = event.data?.type
  if (type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting())
  } else if (type === 'STORE_DATA') {
    event.waitUntil(storeData().then(() => reportStatus(event.source)))
  } else if (type === 'STATUS') {
    // a page says hello: its status, and a chance to drop a generation no page needs any more
    event.waitUntil(Promise.all([reportStatus(event.source), cleanGenerations()]))
  }
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || request.headers.has('range')) return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  const rest = relative(url)
  const kind = kindOf(rest)
  const isolate = request.mode === 'navigate' || request.destination === 'worker' || request.destination === 'sharedworker'
  if (kind === null && !isolate) return
  let response
  if (kind === 'module') {
    const version = url.searchParams.get('v')
    response = version === MODULE_ID ? ownModuleFile(request, rest) : otherModuleFile(request, rest, version)
  } else if (kind === 'app') {
    response = rest.startsWith('assets/') ? asset(request, url) : networkFirst(request, url)
  } else {
    response = fetch(request)
  }
  // (Chrome keeps the compiled code of openms.wasm only if its response is the stored one)
  const pristine = kind === 'module' && url.pathname.endsWith('/openms.wasm')
  event.respondWith(pristine ? response : response.then(withIsolationHeaders))
})
