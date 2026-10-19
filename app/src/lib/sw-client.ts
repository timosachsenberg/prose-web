// Registers the app's service worker (public/sw.js: cross-origin isolation for threads, the module's
// store, the app offline). GitHub Pages sends no isolation headers, so on the first visit the page is
// not isolated: once the worker is active, the page reloads (once per tab and session) to come under
// it. Where that does not help (service workers blocked, private windows of some browsers, a hard
// reload), the app runs on one thread and the status chip says so. It never waits forever: a worker
// that does not become active within `timeoutMs` is not waited for.

/** What the page and the browser offer (injectable for the tests). */
export interface ServiceWorkerEnv {
  /** navigator.serviceWorker, if the browser has it */
  container: Pick<ServiceWorkerContainer, 'register' | 'ready' | 'controller'> | undefined
  isolated: boolean
  /** http(s), and not the development server (which has no build to serve) */
  enabled: boolean
  /** the service worker script (the app's base URL + sw.js) */
  scriptUrl: string
  session: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  reload: () => void
  warn: (message: string) => void
}

export type ServiceWorkerOutcome =
  /** the page is cross-origin isolated (by the worker or by the server) */
  | 'isolated'
  /** the page reloads to come under the worker */
  | 'reloading'
  /** not isolated: no worker, blocked, failed, too slow, or the reload did not help */
  | 'not-isolated'

/** Marks a tab that has reloaded for the worker (a second reload would not help). */
export const RELOADED_KEY = 'prose-service-worker-reloaded'

/** How long a first visit waits for the worker (it stores the app's files, about 8 MB, first). */
export const READY_TIMEOUT_MS = 30_000

function browserEnv(): ServiceWorkerEnv {
  return {
    container: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
    isolated: globalThis.crossOriginIsolated === true,
    enabled: /^https?:$/.test(location.protocol) && !import.meta.env.DEV,
    scriptUrl: new URL(`${import.meta.env.BASE_URL}sw.js`, document.baseURI).href,
    session: sessionStorage,
    reload: () => location.reload(),
    warn: (message) => console.warn(message),
  }
}

function timeout(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => setTimeout(() => resolve('timeout'), ms))
}

/**
 * Registers the worker and decides whether the page must reload for it. Resolves at once on an
 * isolated page (the registration goes on in the background); on a page that reloads it resolves to
 * 'reloading' (the caller shows nothing more: the page is going away).
 */
export async function registerServiceWorker(
  env: ServiceWorkerEnv = browserEnv(),
  timeoutMs = READY_TIMEOUT_MS,
): Promise<ServiceWorkerOutcome> {
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
    env.session.removeItem(RELOADED_KEY)
    return 'isolated'
  }
  if (!(await registered)) return 'not-isolated'
  if ((await Promise.race([container.ready, timeout(timeoutMs)])) === 'timeout') {
    env.warn('ProSE: the service worker did not start in time; OpenMS runs on one thread.')
    return 'not-isolated'
  }
  if (env.session.getItem(RELOADED_KEY)) return 'not-isolated'
  env.session.setItem(RELOADED_KEY, '1')
  env.reload()
  return 'reloading'
}

/** Whether a service worker serves the page (the app then works offline); follows changes. */
export function watchServiceWorker(onChange: (controlled: boolean) => void): () => void {
  if (!('serviceWorker' in navigator)) {
    onChange(false)
    return () => {}
  }
  const container = navigator.serviceWorker
  const update = () => onChange(container.controller !== null)
  update()
  container.addEventListener('controllerchange', update)
  return () => container.removeEventListener('controllerchange', update)
}
