// The page's side of the engine: OpenMS runs in Web Workers (worker.ts), and `EngineClient` sends them
// requests and turns their answers into promises. As in the ProSE example of the module
// (`examples/prose/app.mjs`), an error a worker does not catch, e.g. a WebAssembly trap on one of
// OpenMS' threads, ends its module: its pending calls are rejected and a new worker is started.
//
// Two workers:
// - The search worker: a new one for every search (the module's memory grows with each search and never
//   shrinks), with fewer threads for searches of many files (`threadsForSearch`: the heap grows per file,
//   the more, the more threads), and in the module the search needs (`SearchRequest.engine`: wasm32, or
//   wasm64 for one that needs more than 4 GB, see variant.ts). It keeps the results of its search for
//   `idXML()` until the next search. A restart (after a trap, a cancel) keeps its threads and module.
// - The viewer worker, for `annotate()` and `predict()`: started on their first call, with 2 threads, in
//   wasm32, and kept. They never wait behind a search, and they do not take the search's memory.
//
// A watchdog ends a search that stops reporting (an abort on one of OpenMS' threads can hang the module
// instead of trapping; modules of more than one thread only). `cancel()` ends the search's worker at
// once and starts a new one: a worker is never reused after a search anyway, and it holds nothing that
// outlives it.

import type { AnnotationOptions, MemoryInfo, PeakAnnotationResult, PredictedIon } from './openms-types'
import {
  isOutOfMemoryMessage,
  isTrapMessage,
  outOfMemoryMessage,
  RELOAD,
  threadsForSearch,
  trapMessage,
  UNRESPONSIVE,
  type EngineCall,
  type EngineCalls,
  type EngineInfo,
  type EngineRequest,
  type EngineResponse,
  type EngineStage,
  type EngineVariant,
  type SearchOutcome,
  type SearchProgress,
  type SearchRequest,
  type SearchThreads,
} from './protocol'

export type { EngineInfo, EngineVariant, ParamEntry, SearchOutcome, SearchProgress, SearchRequest, SearchThreads } from './protocol'

/** The two kinds of worker (see above). */
export type WorkerRole = 'search' | 'viewer'

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

/**
 * When the watchdog ends a search: from its `searching` stage on, and only when its module runs more
 * than one thread. Only the thread that runs the search reports; the steps in between (building the
 * index or a chunk's index, Percolator, PeptDeep, reading an mzML file, writing a file, the final
 * tables) are silent, for seconds (measured at most 6 s for 733 MB files and for a chunked semi-tryptic
 * human search, at 4 threads); the index of a semi- or non-specific search (`slowSteps`; in wasm64
 * unchunked, up to 16 GB) or Percolator on a large pool take longer, so such a search gets longer
 * budgets. Every progress or stage message re-arms it.
 */
export interface WatchdogOptions {
  /** No report for this long; default 120 s. */
  silentMs: number
  /** No report for this long while the heap is fully grown (`nearMaxBytes`); default 60 s. */
  nearMaxSilentMs: number
  /** `silentMs` for a search with `slowSteps` (semi- or non-specific); default 300 s. */
  slowSilentMs: number
  /** `nearMaxSilentMs` for a search with `slowSteps`; default 120 s. */
  slowNearMaxSilentMs: number
  /**
   * The heap counts as fully grown when the last report's `heapSize` is within this of `heapMax`; default
   * 64 MiB. (The heap never shrinks: "close to the maximum" once would hold for the rest of the search.)
   */
  nearMaxBytes: number
}

export interface EngineClientOptions {
  /** Starts a worker of a role; default: `worker.ts` as a module worker named "openms-<role>". */
  createWorker?: (role: WorkerRole) => WorkerLike
  /** The base URL of the app's files (`openms/`, `fasta/`); default: Vite's BASE_URL on this page. */
  baseUrl?: string
  /**
   * How long a worker may take to load OpenMS before it counts as failed, until one has loaded (the first
   * load downloads the module); default 30 s.
   */
  startTimeoutMs?: number
  /** The same for the workers after that (the module comes from the cache); default 30 s. */
  restartTimeoutMs?: number
  watchdog?: Partial<WatchdogOptions>
}

const WATCHDOG: WatchdogOptions = {
  silentMs: 120_000,
  nearMaxSilentMs: 60_000,
  slowSilentMs: 300_000,
  slowNearMaxSilentMs: 120_000,
  nearMaxBytes: 64 * 2 ** 20,
}

/** The threads of the viewer worker. */
export const VIEWER_THREADS = 2

interface Pending {
  type: EngineCall
  resolve: (result: never) => void
  reject: (error: Error) => void
  onProgress?: (progress: SearchProgress) => void
}

/** One worker with its module. */
interface Session {
  role: WorkerRole
  worker: WorkerLike
  /** The threads of its module. */
  threads: number
  /** The build of its module. */
  variant: EngineVariant
  /**
   * Its module runs more than one thread (EngineInfo.threaded and threads > 1, once loaded): only then is
   * the search watched (the hang the watchdog guards against is that of one of the threads).
   */
  multiThreaded: boolean
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
  /** A search of this worker went through: it holds the result (for idXML) while it runs. */
  holdsResult: boolean
  /** The watchdog of the search in flight: its timer and the heap of the last report. */
  watchdog: { timer: ReturnType<typeof setTimeout> | undefined; memory: MemoryInfo | null } | null
  /** The search in flight has long silent steps (`slowSteps`): the watchdog's longer budgets. */
  slowSearch: boolean
}

function cancelled(type: EngineCall): string {
  return type === 'search' ? 'The search was cancelled.' : 'The request was cancelled.'
}

/** "OpenMS", "The 64-bit engine": what a worker of `variant` loads, for the messages. */
function moduleName(variant: EngineVariant): string {
  return variant === 'wasm64' ? 'The 64-bit engine' : 'OpenMS'
}

function loadFailure(detail: string, variant: EngineVariant): string {
  return `${moduleName(variant)} could not be loaded (${detail.replace(/\.$/, '') || 'the worker stopped'}). ${RELOAD}`
}

function moduleWorker(role: WorkerRole): WorkerLike {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: `openms-${role}` })
}

export class EngineClient {
  readonly #createWorker: (role: WorkerRole) => WorkerLike
  readonly #baseUrl: string
  readonly #startTimeoutMs: number
  readonly #restartTimeoutMs: number
  readonly #watchdog: WatchdogOptions
  /** The modules a worker has loaded (later starts of the same module use the restart timeout). */
  readonly #loaded = new Set<EngineVariant>()
  #search: Session | null = null
  #viewer: Session | null = null
  #threads = 1
  #nextId = 0
  /** The calls of a search worker that stopped, waiting until its successor is ready (then rejected as a trap). */
  readonly #awaitingRestart = new Set<Pending>()

  constructor(options: EngineClientOptions = {}) {
    this.#createWorker = options.createWorker ?? moduleWorker
    this.#baseUrl = options.baseUrl ?? new URL(import.meta.env.BASE_URL, document.baseURI).href
    this.#startTimeoutMs = options.startTimeoutMs ?? 30_000
    this.#restartTimeoutMs = options.restartTimeoutMs ?? 30_000
    this.#watchdog = { ...WATCHDOG, ...options.watchdog }
  }

  /** Loads OpenMS for the searches with `threads` threads (again, in a new worker, if it runs already). */
  async init(threads: number): Promise<EngineInfo> {
    this.#threads = threads
    return this.#start('search').ready
  }

  /** The threads a search of these files runs with: all of init()'s, at most 4 for many files (`threadsForSearch`). */
  threadsFor(req: Pick<SearchRequest, 'files' | 'peptdeep'>): SearchThreads {
    return threadsForSearch(this.#threads, req.files.length, req.peptdeep)
  }

  /**
   * Searches the files in a fresh module of `req.engine` (default wasm32) with the threads of
   * `threadsFor()`: a new worker, or that of init() if it has run nothing else and has those threads
   * and that module.
   */
  async search(req: SearchRequest, onProgress: (p: SearchProgress) => void): Promise<SearchOutcome> {
    if (!this.#search) throw new Error('EngineClient: call init() first.')
    const { threads } = this.threadsFor(req)
    const variant = req.engine ?? 'wasm32'
    let session = this.#search
    if (session.used || session.state === 'failed' || session.threads !== threads || session.variant !== variant) {
      session = this.#start('search', threads, variant)
    }
    session.used = true
    session.searchStage = 'reading'
    session.slowSearch = req.slowSteps === true
    session.searches++
    try {
      const outcome = await this.#call(session, 'search', { request: req }, onProgress)
      session.holdsResult = true
      return outcome
    } finally {
      session.searches--
      this.#unwatch(session)
    }
  }

  /**
   * The search worker holds the result of its search, so `idXML()` can write it: false before the
   * first search, from the start of a new search (whether it succeeds or not) and after a trap.
   */
  get hasSearchResult(): boolean {
    const s = this.#search
    return s !== null && s.holdsResult && s.state !== 'failed'
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
   * Cancels the search in flight: its calls are rejected as cancelled at once, and its worker is ended
   * and replaced by a new one with the same threads and module (ready for the same search again). The
   * calls of a search whose worker stopped and is being restarted are cancelled too. Without a search in
   * flight nothing happens; the viewer goes on.
   */
  cancel(): void {
    for (const p of this.#awaitingRestart) p.reject(new EngineError('cancelled', cancelled(p.type)))
    this.#awaitingRestart.clear()
    const session = this.#search
    if (!session || session.searches === 0) return
    this.#start('search', session.threads, session.variant)
  }

  #viewerSession(): Session {
    if (!this.#viewer || this.#viewer.state === 'failed') this.#start('viewer')
    return this.#viewer!
  }

  #current(role: WorkerRole): Session | null {
    return role === 'search' ? this.#search : this.#viewer
  }

  /**
   * Ends the worker of `role`, if any (its pending calls are rejected as cancelled), and starts a new one
   * (a search worker with `threads`, default init()'s, and the module `variant`; the viewer: wasm32). Its
   * module counts as failed if it is not loaded within the start timeout (the restart timeout once a
   * module of that build has loaded: the first load of each downloads it).
   */
  #start(role: WorkerRole, threads = role === 'search' ? this.#threads : VIEWER_THREADS, variant: EngineVariant = 'wasm32'): Session {
    const old = this.#current(role)
    if (old) for (const p of this.#stop(old)) p.reject(new EngineError('cancelled', cancelled(p.type)))

    const worker = this.#createWorker(role)
    const pending = new Map<number, Pending>()
    const init = this.#post(worker, pending, 'init', { threads, baseUrl: this.#baseUrl, variant })
    const timeoutMs = this.#loaded.has(variant) ? this.#restartTimeoutMs : this.#startTimeoutMs
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      const message = `${moduleName(variant)} did not start within ${timeoutMs / 1000} s. ${RELOAD}`
      timer = setTimeout(() => reject(new EngineError('failed', message)), timeoutMs)
    })
    const session: Session = {
      role,
      worker,
      threads,
      variant,
      multiThreaded: false,
      ready: Promise.race([init, timeout]).finally(() => clearTimeout(timer)),
      state: 'loading',
      used: false,
      pending,
      searchStage: 'reading',
      searches: 0,
      holdsResult: false,
      watchdog: null,
      slowSearch: false,
    }
    if (role === 'search') this.#search = session
    else this.#viewer = session
    worker.onmessage = ({ data }) => this.#receive(session, data as EngineResponse)
    worker.onerror = (event) => {
      event.preventDefault()
      void this.#crashed(session, event.message, this.#stage(session))
    }
    session.ready.then(
      (info) => {
        this.#loaded.add(variant)
        session.multiThreaded = info.threaded && info.threads > 1
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
    this.#unwatch(session)
    const pending = [...session.pending.values()]
    session.pending.clear()
    return pending
  }

  /**
   * (Re)arms the watchdog of the search of `session` after a report: it ends the search after
   * `silentMs` without a report, or `nearMaxSilentMs` once the reported heap is fully grown (the
   * `slow…` budgets for a search with `slowSteps`). Not for a module of one thread: the hang
   * it guards against is that of one of the threads, and on one thread a long silent step (building the
   * index of a non-specific search) would count as one.
   */
  #watch(session: Session, memory?: MemoryInfo) {
    if (!session.multiThreaded) return
    const watch = (session.watchdog ??= { timer: undefined, memory: null })
    clearTimeout(watch.timer)
    if (memory) watch.memory = memory
    const w = this.#watchdog
    const near = watch.memory !== null && watch.memory.heapSize >= watch.memory.heapMax - w.nearMaxBytes
    const ms = session.slowSearch
      ? near ? w.slowNearMaxSilentMs : w.slowSilentMs
      : near ? w.nearMaxSilentMs : w.silentMs
    watch.timer = setTimeout(() => {
      const restart = (restarted: boolean) => `${UNRESPONSIVE} ${restarted ? 'OpenMS was restarted.' : RELOAD}`
      void this.#crashed(session, '', session.searchStage, restart)
    }, ms)
  }

  #unwatch(session: Session) {
    if (session.watchdog) clearTimeout(session.watchdog.timer)
    session.watchdog = null
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
      if (session.watchdog) this.#watch(session, data.memory)
      pending.onProgress?.(data.progress)
      return
    }
    if (data.type === 'stage') {
      session.searchStage = data.stage
      // armed when the search begins; writing a file in between (reading) re-arms it like any report
      if (pending.type === 'search' && (data.stage === 'searching' || session.watchdog)) this.#watch(session)
      return
    }
    if (pending.type === 'search') this.#unwatch(session)
    if (data.type === 'result') {
      session.pending.delete(data.id)
      pending.resolve(data.result as never)
    } else if (data.trap || isTrapMessage(data.error)) {
      void this.#crashed(session, data.error, data.stage)
    } else {
      session.pending.delete(data.id)
      const message =
        pending.type === 'init'
          ? loadFailure(data.error, session.variant)
          : isOutOfMemoryMessage(data.error)
            ? outOfMemoryMessage(data.stage, data.error, session.variant)
            : data.error
      pending.reject(new EngineError('failed', message))
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
   * OpenMS stopped (or stopped responding: `message`): starts a new worker of the same role, threads and
   * module, waits until it is ready (at most the restart timeout), then rejects the pending calls with a
   * message that says what was interrupted and whether OpenMS was restarted. `cancel()` meanwhile
   * cancels those of the search worker at once. A module that did not even load is not restarted (the
   * next call tries again).
   */
  async #crashed(
    session: Session,
    detail: string,
    stage: EngineStage,
    message: (restarted: boolean) => string = (restarted) => trapMessage(stage, detail, restarted, session.variant),
  ) {
    if (this.#current(session.role) !== session || session.state === 'failed') return
    const loaded = session.state === 'ready'
    const pending = this.#stop(session)
    if (!loaded) {
      for (const p of pending) p.reject(new EngineError('failed', loadFailure(detail, session.variant)))
      return
    }
    const waiting = session.role === 'search' ? this.#awaitingRestart : new Set<Pending>()
    for (const p of pending) waiting.add(p)
    const next = this.#start(session.role, session.threads, session.variant)
    // a successor replaced by a newer worker meanwhile (e.g. a new search) did not fail to load
    const restarted = await next.ready.then(
      () => true,
      () => this.#current(next.role) !== next,
    )
    for (const p of pending) {
      if (!waiting.delete(p)) continue // cancelled meanwhile
      p.reject(new EngineError('trap', message(restarted)))
    }
  }
}
