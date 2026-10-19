import { describe, expect, it, vi } from 'vitest'
import { RELOADED_KEY, registerServiceWorker, type ServiceWorkerEnv } from './sw-client'

function session(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
    removeItem: (k: string) => void values.delete(k),
  }
}

function env(
  overrides: Partial<ServiceWorkerEnv> & { ready?: Promise<unknown>; registerFails?: boolean; store?: ReturnType<typeof session> } = {},
) {
  const { ready = Promise.resolve({}), registerFails = false, store = session(), ...rest } = overrides as typeof overrides & {
    store?: ReturnType<typeof session>
  }
  const register = vi.fn(() => (registerFails ? Promise.reject(new Error('blocked')) : Promise.resolve({})))
  const e = {
    container: { register, ready, controller: null } as unknown as ServiceWorkerEnv['container'],
    isolated: false,
    enabled: true,
    scriptUrl: 'https://example.org/prose-web/sw.js',
    session: (() => store) as ServiceWorkerEnv['session'],
    reload: vi.fn(),
    warn: vi.fn(),
    ...rest,
  }
  return { env: e as ServiceWorkerEnv & { reload: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> }, register, store }
}

describe('registerServiceWorker', () => {
  it('reloads a page that is not isolated once the worker is active, once per tab', async () => {
    const { env: e, register, store } = env()
    expect(await registerServiceWorker(e)).toBe('reloading')
    expect(register).toHaveBeenCalledWith('https://example.org/prose-web/sw.js')
    expect(e.reload).toHaveBeenCalledTimes(1)
    expect(store.getItem(RELOADED_KEY)).toBe('1')

    // after the reload the page is still not isolated (e.g. service workers bypassed): no second reload
    const again = env({ store })
    expect(await registerServiceWorker(again.env)).toBe('not-isolated')
    expect(again.env.reload).not.toHaveBeenCalled()
  })

  it('does not wait on an isolated page and forgets an earlier reload', async () => {
    const { env: e, register, store } = env({ isolated: true, ready: new Promise(() => {}), store: session({ [RELOADED_KEY]: '1' }) })
    expect(await registerServiceWorker(e)).toBe('isolated')
    expect(register).toHaveBeenCalled()
    expect(e.reload).not.toHaveBeenCalled()
    expect(store.getItem(RELOADED_KEY)).toBeNull()
  })

  it('runs without the worker when registration fails', async () => {
    const { env: e } = env({ registerFails: true })
    expect(await registerServiceWorker(e)).toBe('not-isolated')
    expect(e.reload).not.toHaveBeenCalled()
    expect(e.warn).toHaveBeenCalledWith(expect.stringContaining('could not be registered (blocked)'))
  })

  it('never waits forever for a worker that does not become active', async () => {
    const { env: e } = env({ ready: new Promise(() => {}) })
    expect(await registerServiceWorker(e, 20)).toBe('not-isolated')
    expect(e.reload).not.toHaveBeenCalled()
    expect(e.warn).toHaveBeenCalledWith(expect.stringContaining('did not start in time'))
  })

  it('does nothing without service workers, from a file or on the development server', async () => {
    for (const overrides of [{ container: undefined }, { enabled: false }]) {
      const { env: e, register } = env(overrides)
      expect(await registerServiceWorker(e)).toBe('not-isolated')
      expect(register).not.toHaveBeenCalled()
      expect(e.reload).not.toHaveBeenCalled()
    }
    const { env: isolated } = env({ enabled: false, isolated: true })
    expect(await registerServiceWorker(isolated)).toBe('isolated')
  })

  it('does not reload, and still resolves, where the browser blocks the session storage', async () => {
    const blocked = () => {
      throw new DOMException('Access is denied for this document.', 'SecurityError')
    }
    for (const isolated of [false, true]) {
      const { env: e } = env({ isolated, session: blocked })
      expect(await registerServiceWorker(e)).toBe(isolated ? 'isolated' : 'not-isolated')
      expect(e.reload).not.toHaveBeenCalled()
    }
  })

  it('resolves when the registration throws at once', async () => {
    const { env: e } = env()
    ;(e.container as unknown as { register: () => never }).register = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
    expect(await registerServiceWorker(e)).toBe('not-isolated')
    expect(e.reload).not.toHaveBeenCalled()
    expect(e.warn).toHaveBeenCalledWith(expect.stringContaining('was not used'))
  })
})
