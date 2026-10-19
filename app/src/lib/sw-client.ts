// The page's side of the app's service worker (public/sw.js: cross-origin isolation for threads, the
// module's store, the app offline).
//
// - registerServiceWorker(): GitHub Pages sends no isolation headers, so on the first visit the page
//   is not isolated: once the worker is active, the page reloads (once per tab and session) to come
//   under it. Where that does not help (service workers blocked or unsupported, storage blocked, a
//   hard reload), the app runs on one thread and says so. It never waits forever: a worker that does
//   not become active within `timeoutMs` is not waited for.
// - watchStatus(): what the worker serving the page has stored ("works offline" = this build's shell
//   and module, verified); answerBuildQueries(): tells the worker this page's build.
// - storeOfflineData(): asks the worker to store the example and the cRAP database as well.
// - watchUpdate() / applyUpdate(): a new version's worker installs completely and waits; the app
//   offers "Reload", which lets it take over and reloads the page.

/** What the page and the browser offer (injectable for the tests). */
export interface ServiceWorkerEnv {
  /** navigator.serviceWorker, if the browser has it */
  container: Pick<ServiceWorkerContainer, 'register' | 'ready' | 'controller'> | undefined
  isolated: boolean
  /** http(s), and not the development server (which has no build to serve) */
  enabled: boolean
  /** the service worker script (the app's base URL + sw.js) */
  scriptUrl: string
  /** sessionStorage; reading it throws where the browser blocks site data */
  session: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  reload: () => void
  warn: (message: string) => void
}

export type ServiceWorkerOutcome =
  /** the page is cross-origin isolated (by the worker or by the server) */
  | 'isolated'
  /** the page reloads to come under the worker */
  | 'reloading'
  /** not isolated: no worker, blocked, failed, too slow, no storage, or the reload did not help */
  | 'not-isolated'

/** Marks a tab that has reloaded for the worker (a second reload would not help). */
export const RELOADED_KEY = 'prose-service-worker-reloaded'

/** How long a first visit waits for the worker (it stores the app's shell, about 1 MB, first). */
export const READY_TIMEOUT_MS = 30_000

function browserEnv(): ServiceWorkerEnv {
  return {
    container: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
    isolated: globalThis.crossOriginIsolated === true,
    enabled: /^https?:$/.test(location.protocol) && !import.meta.env.DEV,
    scriptUrl: new URL(`${import.meta.env.BASE_URL}sw.js`, document.baseURI).href,
    session: () => sessionStorage,
    reload: () => location.reload(),
    warn: (message) => console.warn(message),
  }
}

function timeout(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => setTimeout(() => resolve('timeout'), ms))
}

/** Runs `f` on the session storage; null where the browser does not allow it. */
function withSession<T>(env: ServiceWorkerEnv, f: (s: ReturnType<ServiceWorkerEnv['session']>) => T): T | null {
  try {
    return f(env.session())
  } catch {
    return null
  }
}

/**
 * Registers the worker and decides whether the page must reload for it. Resolves at once on an
 * isolated page (the registration goes on in the background); on a page that reloads it resolves to
 * 'reloading' (the caller shows nothing more: the page is going away). Never rejects.
 */
export async function registerServiceWorker(
  env: ServiceWorkerEnv = browserEnv(),
  timeoutMs = READY_TIMEOUT_MS,
): Promise<ServiceWorkerOutcome> {
  try {
    const { container } = env
    if (!container || !env.enabled) return env.isolated ? 'isolated' : 'not-isolated'
    const registered = container.register(env.scriptUrl).then(
      () => true,
      (error: unknown) => {
        env.warn(
          `ProSE: the service worker could not be registered (${(error as Error)?.message ?? error}): ` +
            'OpenMS runs on one thread unless the server sends the cross-origin isolation headers, and the app does not work offline.',
        )
        return false
      },
    )
    if (env.isolated) {
      withSession(env, (s) => s.removeItem(RELOADED_KEY))
      return 'isolated'
    }
    if (!(await registered)) return 'not-isolated'
    if ((await Promise.race([container.ready, timeout(timeoutMs)])) === 'timeout') {
      env.warn('ProSE: the service worker did not start in time; OpenMS runs on one thread.')
      return 'not-isolated'
    }
    // reload once: only where the tab can remember it (else a page the worker cannot isolate would reload forever)
    const marked = withSession(env, (s) => {
      if (s.getItem(RELOADED_KEY)) return false
      s.setItem(RELOADED_KEY, '1')
      return s.getItem(RELOADED_KEY) === '1'
    })
    if (!marked) return 'not-isolated'
    env.reload()
    return 'reloading'
  } catch (error) {
    env.warn(`ProSE: the service worker was not used (${(error as Error)?.message ?? error}).`)
    return env.isolated ? 'isolated' : 'not-isolated'
  }
}

/** The worker's container, where the browser has one and the app uses it. */
function container(): ServiceWorkerContainer | null {
  return 'serviceWorker' in navigator && !import.meta.env.DEV ? navigator.serviceWorker : null
}

/** This page's build (index.html's <meta name="prose-build">, stamped by the build). */
export function pageBuild(): string | null {
  const content = document.querySelector('meta[name="prose-build"]')?.getAttribute('content') ?? null
  return content && /^[0-9a-f]{12}$/.test(content) ? content : null
}

/** What the service worker serving the page has stored (its STATUS report, public/sw.js). */
export interface StoreStatus {
  /** the worker's build and module */
  build: string
  module: string
  /** this build's shell and module are stored and verified: the app works offline */
  offline: boolean
  shell: boolean
  moduleStored: boolean
  /** the PeptDeep models by file name: stored or not (they are stored on first use) */
  models: Record<string, boolean>
  /** the example and the cRAP database */
  data: boolean
  /** the previous generation the worker keeps (for pages of that build still open), or null */
  kept: string | null
}

/**
 * Answers the worker's question which build this page is (BUILD?): it keeps the previous generation's
 * files while a page of that build is open. Call once, early.
 */
export function answerBuildQueries(): void {
  const c = container()
  if (!c) return
  c.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type === 'BUILD?') event.ports[0]?.postMessage({ build: pageBuild() })
  })
  c.startMessages()
}

/** Follows what the worker serving the page has stored (asks now and whenever another worker takes over). */
export function watchStatus(onStatus: (status: StoreStatus | null) => void): () => void {
  const c = container()
  if (!c) {
    onStatus(null)
    return () => {}
  }
  const ask = () => {
    if (!c.controller) onStatus(null)
    c.controller?.postMessage({ type: 'STATUS', build: pageBuild() })
  }
  const answer = (event: MessageEvent) => {
    if (event.data?.type === 'STATUS') onStatus(event.data as StoreStatus)
  }
  c.addEventListener('message', answer)
  c.addEventListener('controllerchange', ask)
  ask()
  return () => {
    c.removeEventListener('message', answer)
    c.removeEventListener('controllerchange', ask)
  }
}

/** Asks the worker serving the page (now, or when one takes over) to store the example and the cRAP database. */
export function storeOfflineData(): () => void {
  const c = container()
  if (!c) return () => {}
  const ask = () => c.controller?.postMessage({ type: 'STORE_DATA' })
  c.addEventListener('controllerchange', ask)
  ask()
  return () => c.removeEventListener('controllerchange', ask)
}

/**
 * Calls `onReady` when a new version's worker is installed (complete) and waits, while a worker
 * serves the page.
 */
export function watchUpdate(onReady: () => void): () => void {
  const c = container()
  if (!c) return () => {}
  let stopped = false
  const watch = (registration: ServiceWorkerRegistration) => {
    const check = () => {
      if (!stopped && registration.waiting && c.controller) onReady()
    }
    check()
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed') check()
      })
    })
  }
  void c.getRegistration().then((registration) => registration && watch(registration))
  return () => {
    stopped = true
  }
}

/** Lets a waiting worker of the new version take over and reloads the page (or just reloads it). */
export async function applyUpdate(): Promise<void> {
  const c = container()
  const registration = await c?.getRegistration()
  if (!c || !registration?.waiting) {
    location.reload()
    return
  }
  c.addEventListener('controllerchange', () => location.reload(), { once: true })
  registration.waiting.postMessage({ type: 'SKIP_WAITING' })
}

/**
 * Unregisters the workers of the earlier site's demos: any scope within `examples/` of the app's
 * directory (their client resolved the scope "./" against the page: /prose-web/examples/prose/ and
 * …/browser/ on the site, /examples/prose/ in the desktop app up to 0.2.0); their stores are cleaned by
 * the app's worker.
 */
export async function unregisterEarlierWorkers(): Promise<void> {
  const c = container()
  if (!c) return
  const earlier = new URL(`${import.meta.env.BASE_URL}examples/`, document.baseURI).href
  try {
    for (const registration of await c.getRegistrations()) {
      if (registration.scope.startsWith(earlier)) await registration.unregister()
    }
  } catch {
    // not allowed here: nothing to clean
  }
}
