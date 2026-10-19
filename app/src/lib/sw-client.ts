// The page's side of the app's service worker (public/sw.js: cross-origin isolation for threads, the
// module's store, the app offline).
//
// - registerServiceWorker(): GitHub Pages sends no isolation headers, so on the first visit the page
//   is not isolated: once the worker is active, the page reloads (once per tab and session) to come
//   under it. Where that does not help (service workers blocked or unsupported, storage blocked, a
//   hard reload), the app runs on one thread and says so. It never waits forever: a worker that does
//   not become active within `timeoutMs` is not waited for.
// - watchServiceWorker(): whether a worker serves the page (its shell is stored: the app works offline).
// - storeOfflineData(): asks the worker to store the example and the cRAP database as well.
// - watchUpdate() / applyUpdate(): a new version's worker waits; the app offers "Reload", which lets
//   it take over and reloads the page.

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

/** Whether a service worker serves the page (its shell is stored: the app works offline); follows changes. */
export function watchServiceWorker(onChange: (controlled: boolean) => void): () => void {
  const c = container()
  if (!c) {
    onChange(false)
    return () => {}
  }
  const update = () => onChange(c.controller !== null)
  update()
  c.addEventListener('controllerchange', update)
  return () => c.removeEventListener('controllerchange', update)
}

/**
 * Asks the worker serving the page (now, or when one takes over) to store the example and the cRAP
 * database for offline use; `onStored(complete)` hears the answer.
 */
export function storeOfflineData(onStored: (complete: boolean) => void = () => {}): () => void {
  const c = container()
  if (!c) return () => {}
  const ask = () => c.controller?.postMessage({ type: 'STORE_DATA' })
  const answer = (event: MessageEvent) => {
    if (event.data?.type === 'DATA_STORED') onStored(event.data.complete === true)
  }
  c.addEventListener('message', answer)
  c.addEventListener('controllerchange', ask)
  ask()
  return () => {
    c.removeEventListener('message', answer)
    c.removeEventListener('controllerchange', ask)
  }
}

/**
 * Calls `onReady` when a new version's worker is installed and waits (there is a worker serving the
 * page already, of the previous version).
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

/** Lets the waiting worker of the new version take over, then reloads the page. */
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
