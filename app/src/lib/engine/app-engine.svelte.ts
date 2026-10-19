// The app's one EngineClient, shared by all views, and its state for the page (the status chip, the
// parameters of the search form). OpenMS is loaded once at startup; with ?debug=engine the client is
// window.__engine (the end-to-end test of the engine uses it; no second client is made).

import { debugFlag } from '../debug'
import { EngineClient, EngineError, type EngineInfo } from './client'
import { MODELS } from './core'
import { NEWER_VERSION } from './protocol'

/** The first download of the module (about 45 MB) can be slow; 30 s (the client's default) is too short. */
export const START_TIMEOUT_MS = 180_000

/** Measured with ProSE: more than about 16 threads hardly shortens a search. */
const MAX_THREADS = 16

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'failed'

let status = $state<EngineStatus>('idle')
// raw: the parameter list is large (thousands of allowed modification names) and never changes
let info = $state.raw<EngineInfo | null>(null)
let error = $state<string | null>(null)

export const engineState = {
  get status(): EngineStatus {
    return status
  },
  /** What the module offers: version, threads, ONNX Runtime, ProSE's parameters. */
  get info(): EngineInfo | null {
    return info
  },
  /** Why OpenMS could not be loaded. */
  get error(): string | null {
    return error
  },
}

let client: EngineClient | null = null
let starting: Promise<EngineInfo> | null = null

/** The threads of the searches: all cores (at most 16) on a cross-origin isolated page, else one. */
export function searchThreads(): number {
  return globalThis.crossOriginIsolated ? Math.max(1, Math.min(navigator.hardwareConcurrency || 1, MAX_THREADS)) : 1
}

/** The app's EngineClient (created on first use). */
export function engineClient(): EngineClient {
  if (!client) {
    client = new EngineClient({ startTimeoutMs: START_TIMEOUT_MS })
    if (debugFlag(location.search) === 'engine') {
      ;(window as unknown as { __engine: EngineClient }).__engine = client
    }
  }
  return client
}

/**
 * Loads OpenMS (once; again after a failure). If someone else restarts the client meanwhile (the
 * end-to-end test through window.__engine), the cancelled start leaves the state idle.
 */
export function startEngine(): Promise<EngineInfo> {
  if (starting) return starting
  status = 'loading'
  error = null
  const promise = engineClient()
    .init(searchThreads())
    .then(
      (loaded) => {
        info = loaded
        status = 'ready'
        return loaded
      },
      (e: unknown) => {
        starting = null
        if (e instanceof EngineError && e.kind === 'cancelled') {
          status = 'idle'
        } else {
          status = 'failed'
          error = String((e as Error)?.message ?? e)
        }
        throw e
      },
    )
  starting = promise
  promise.catch(() => {}) // the state above reports it; callers that await get the error too
  return promise
}

/**
 * Before a search with PeptDeep: whether this version's models can still be had (stored, or this
 * version's on the server), so that a newer deployment fails the search at once, not after its first
 * steps. The service worker answers 409 for another version's bytes; it stores this version's, so the
 * search worker then reads them from the store. Throws the reason; network errors are left to the search.
 */
export async function checkModels(): Promise<void> {
  const base = new URL(import.meta.env.BASE_URL, document.baseURI)
  for (const { file } of MODELS) {
    const status = await fetch(new URL(`openms/models/${file}?v=${__OPENMS_ID__}`, base)).then(
      (r) => (void r.body?.cancel(), r.status),
      () => 0,
    )
    if (status === 409) throw new Error(`The PeptDeep model ${file} of this version is no longer on the server. ${NEWER_VERSION}`)
  }
}
