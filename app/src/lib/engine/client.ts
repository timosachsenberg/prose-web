// The page's side of the engine: OpenMS runs in Web Workers (worker.ts), and `EngineClient` sends them
// requests and turns their answers into promises. As in the ProSE example of the module
// (`examples/prose/app.mjs`), an error a worker does not catch, e.g. a WebAssembly trap on one of
// OpenMS' threads, ends its module: its pending calls are rejected and a new worker is started.
//
// Two workers:
// - The search worker: a new one for every search (the module's memory grows with each search and never
//   shrinks). It keeps the results of its search for `idXML()` until the next search.
// - The viewer worker, for `annotate()` and `predict()`: started on their first call, with 2 threads, and
//   kept. They never wait behind a search, and they do not take the search's memory.

import type { AnnotationOptions, PeakAnnotationResult, PredictedIon } from './openms-types'
import {
  isTrapMessage,
  RELOAD,
  trapMessage,
  type EngineCall,
  type EngineCalls,
  type EngineInfo,
  type EngineRequest,
  type EngineResponse,
  type EngineStage,
  type SearchOutcome,
  type SearchProgress,
  type SearchRequest,
} from './protocol'

export type { EngineInfo, ParamEntry, SearchOutcome, SearchProgress, SearchRequest } from './protocol'

/** What the client needs of a Worker (a fake one in the tests). */
export interface WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: EngineRequest, options?: StructuredSerializeOptions): void
  terminate(): void
}

/**
 * - `trap`: OpenMS stopped (a WebAssembly trap or out of memory); the message says whether it was
 *   restarted.
 * - `cancelled`: `cancel()` (or a new search) ended the worker first.
 * - `failed`: OpenMS reported an error (e.g. an invalid parameter; the worker goes on), or it could not
 *   be loaded.
 */
export type EngineErrorKind = 'trap' | 'cancelled' | 'failed'

export class EngineError extends Error {
  readonly kind: EngineErrorKind

  constructor(kind: EngineErrorKind, message: string) {
    super(message)
    this.name = 'EngineError'
    this.kind = kind
  }
}

export interface EngineClientOptions {
  /** Starts a worker; default: `worker.ts` as a module worker. */
  createWorker?: () => WorkerLike
  /** The base URL of the app's files (`openms/`, `fasta/`); default: Vite's BASE_URL on this page. */
  baseUrl?: string
  /** How long a worker may take to load OpenMS before it counts as failed; default 30 s. */
  startTimeoutMs?: number
}

/** The threads of the viewer worker. */
export const VIEWER_THREADS = 2

interface Pending {
  type: EngineCall
  resolve: (result: never) => void
  reject: (error: Error) => void
  onProgress?: (progress: SearchProgress) => void
}

type Role = 'search' | 'viewer'

/** One worker with its module. */
interface Session {
  role: Role
  worker: WorkerLike
  ready: Promise<EngineInfo>
  state: 'loading' | 'ready' | 'failed'
  /** It ran a request other than init (a fresh module is needed for a search). */
  used: boolean
  /** Its calls in flight, in the order sent (the worker handles them in that order). */
  pending: Map<number, Pending>
  /** What the search in flight is doing, from the worker's stage messages. */
  searchStage: EngineStage
  /** Searches in flight, also those still waiting for the module. */
  searches: number
}

function cancelled(type: EngineCall): string {
  return type === 'search' ? 'The search was cancelled.' : 'The request was cancelled.'
}

function loadFailure(detail: string): string {
  return `OpenMS could not be loaded (${detail || 'the worker stopped'}). ${RELOAD}`
}

function moduleWorker(): WorkerLike {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
}

export class EngineClient {
  readonly #createWorker: () => WorkerLike
  readonly #baseUrl: string
  readonly #startTimeoutMs: number
  #search: Session | null = null
  #viewer: Session | null = null
  #threads = 1
  #nextId = 0

  constructor(options: EngineClientOptions = {}) {
    this.#createWorker = options.createWorker ?? moduleWorker
    this.#baseUrl = options.baseUrl ?? new URL(import.meta.env.BASE_URL, document.baseURI).href
    this.#startTimeoutMs = options.startTimeoutMs ?? 30_000
  }

  /** Loads OpenMS for the searches with `threads` threads (again, in a new worker, if it runs already). */
  async init(threads: number): Promise<EngineInfo> {
    this.#threads = threads
    return this.#start('search').ready
  }

  /** Searches the files in a fresh module: a new worker, or that of init() if it has run nothing else. */
  async search(req: SearchRequest, onProgress: (p: SearchProgress) => void): Promise<SearchOutcome> {
    if (!this.#search) throw new Error('EngineClient: call init() first.')
    let session = this.#search
    if (session.used || session.state === 'failed') session = this.#start('search')
    session.used = true
    session.searchStage = 'reading'
    session.searches++
    try {
      return await this.#call(session, 'search', { request: req }, onProgress)
    } finally {
      session.searches--
    }
  }

  /** The results of the last search as idXML, while its worker runs (until the next search). */
  async idXML(): Promise<Uint8Array> {
    if (!this.#search) throw new Error('EngineClient: call init() first.')
    this.#search.used = true
    return this.#call(this.#search, 'idXML', {})
  }

  /**
   * The fragment ions of `peptide` (`peptides.openms`) matched to the peaks (copied, not transferred:
   * the page keeps its spectra). In the viewer worker.
   */
  async annotate(
    mz: Float32Array,
    intensity: Float32Array,
    peptide: string,
    charge: number,
    opts: AnnotationOptions,
  ): Promise<PeakAnnotationResult> {
    const [m, i] = [mz.slice(), intensity.slice()]
    const args = { mz: m, intensity: i, peptide, charge, options: opts }
    return this.#call(this.#viewerSession(), 'annotate', args, undefined, [m.buffer, i.buffer])
  }

  /** PeptDeep's fragment intensities of `peptide` (`peptides.openms`). In the viewer worker. */
  async predict(peptide: string, charge: number, nce: number, instrument: string): Promise<PredictedIon[]> {
    return this.#call(this.#viewerSession(), 'predict', { peptide, charge, nce, instrument })
  }

  /**
   * Cancels the search in flight: ends the search worker (its pending calls are rejected as cancelled)
   * and starts a new one. Nothing happens without a search in flight; the viewer goes on.
   */
  cancel(): void {
    if (this.#search && this.#search.searches > 0) this.#start('search')
  }

  #viewerSession(): Session {
    if (!this.#viewer || this.#viewer.state === 'failed') this.#start('viewer')
    return this.#viewer!
  }

  #current(role: Role): Session | null {
    return role === 'search' ? this.#search : this.#viewer
  }

  /**
   * Ends the worker of `role`, if any (its pending calls are rejected as cancelled), and starts a new one.
   * Its module counts as failed if it is not loaded within the start timeout.
   */
  #start(role: Role): Session {
    const old = this.#current(role)
    if (old) for (const p of this.#stop(old)) p.reject(new EngineError('cancelled', cancelled(p.type)))

    const worker = this.#createWorker()
    const pending = new Map<number, Pending>()
    const threads = role === 'search' ? this.#threads : VIEWER_THREADS
    const init = this.#post(worker, pending, 'init', { threads, baseUrl: this.#baseUrl })
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      const message = `OpenMS did not start within ${this.#startTimeoutMs / 1000} s. ${RELOAD}`
      timer = setTimeout(() => reject(new EngineError('failed', message)), this.#startTimeoutMs)
    })
    const session: Session = {
      role,
      worker,
      ready: Promise.race([init, timeout]).finally(() => clearTimeout(timer)),
      state: 'loading',
      used: false,
      pending,
      searchStage: 'reading',
      searches: 0,
    }
    if (role === 'search') this.#search = session
    else this.#viewer = session
    worker.onmessage = ({ data }) => this.#receive(session, data as EngineResponse)
    worker.onerror = (event) => {
      event.preventDefault()
      void this.#crashed(session, event.message, this.#stage(session))
    }
    session.ready.then(
      () => {
        if (session.state === 'loading') session.state = 'ready'
      },
      (e: unknown) => {
        // a timeout or a failed init: the module is not usable
        if (session.state === 'failed') return
        for (const p of this.#stop(session)) p.reject(e as Error)
      },
    )
    return session
  }

  /** Terminates the worker of `session` (it cannot be used any more) and hands back its pending calls. */
  #stop(session: Session): Pending[] {
    session.state = 'failed'
    session.worker.terminate()
    const pending = [...session.pending.values()]
    session.pending.clear()
    return pending
  }

  /** A request, once the module is loaded (the load error otherwise). */
  async #call<K extends EngineCall>(
    session: Session,
    type: K,
    args: EngineCalls[K]['args'],
    onProgress?: (p: SearchProgress) => void,
    transfer: Transferable[] = [],
  ): Promise<EngineCalls[K]['result']> {
    try {
      await session.ready
    } catch (e) {
      throw e instanceof EngineError && e.kind === 'cancelled' ? new EngineError('cancelled', cancelled(type)) : e
    }
    if (this.#current(session.role) !== session || session.state === 'failed') {
      throw new EngineError('cancelled', cancelled(type))
    }
    return this.#post(session.worker, session.pending, type, args, onProgress, transfer)
  }

  #post<K extends EngineCall>(
    worker: WorkerLike,
    pending: Map<number, Pending>,
    type: K,
    args: EngineCalls[K]['args'],
    onProgress?: (p: SearchProgress) => void,
    transfer: Transferable[] = [],
  ): Promise<EngineCalls[K]['result']> {
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { type, resolve: resolve as (r: never) => void, reject, onProgress })
      try {
        worker.postMessage({ id, type, ...args } as EngineRequest, { transfer })
      } catch (e) {
        pending.delete(id)
        reject(e)
      }
    })
  }

  #receive(session: Session, data: EngineResponse) {
    // a late answer of a worker that was replaced (cancelled, crashed): ignored
    if (this.#current(session.role) !== session || session.state === 'failed') return
    const pending = session.pending.get(data.id)
    if (!pending) return
    if (data.type === 'progress') {
      pending.onProgress?.(data.progress)
      return
    }
    if (data.type === 'stage') {
      session.searchStage = data.stage
      return
    }
    if (data.type === 'result') {
      session.pending.delete(data.id)
      pending.resolve(data.result as never)
    } else if (data.trap || isTrapMessage(data.error)) {
      void this.#crashed(session, data.error, data.stage)
    } else {
      session.pending.delete(data.id)
      pending.reject(new EngineError('failed', pending.type === 'init' ? loadFailure(data.error) : data.error))
    }
  }

  /** What the worker of `session` is doing: its first pending call (or the stage of its search). */
  #stage(session: Session): EngineStage {
    if (session.state === 'loading') return 'loading'
    const first = session.pending.values().next().value
    if (!first || first.type === 'init') return 'loading'
    return first.type === 'search' ? session.searchStage : first.type
  }

  /**
   * OpenMS stopped: starts a new worker of the same role, waits until it is ready (at most the start
   * timeout), then rejects the pending calls with a message that says what was interrupted and whether
   * OpenMS was restarted. A module that did not even load is not restarted (the next call tries again).
   */
  async #crashed(session: Session, detail: string, stage: EngineStage) {
    if (this.#current(session.role) !== session || session.state === 'failed') return
    const loaded = session.state === 'ready'
    const pending = this.#stop(session)
    if (!loaded) {
      for (const p of pending) p.reject(new EngineError('failed', loadFailure(detail)))
      return
    }
    const next = this.#start(session.role)
    const restarted = await next.ready.then(
      () => true,
      () => false,
    )
    for (const p of pending) p.reject(new EngineError('trap', trapMessage(stage, detail, restarted)))
  }
}
