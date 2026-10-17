// The page's side of the engine: OpenMS runs in a Web Worker (worker.ts), and `EngineClient` sends it
// requests and turns its answers into promises. As in the ProSE example of the module
// (`examples/prose/app.mjs`), an error the worker does not catch, e.g. a WebAssembly trap on one of
// OpenMS' threads, ends the module: the pending calls are rejected and a new worker is started.
//
// Every search runs in a new worker (the module's memory grows with each search and never shrinks).
// That worker keeps the results for `idXML()`, `annotate()` and `predict()` until the next search.

import type { AnnotationOptions, PeakAnnotationResult, PredictedIon } from './openms-types'
import {
  isTrapMessage,
  trapMessage,
  type EngineCall,
  type EngineCalls,
  type EngineInfo,
  type EngineRequest,
  type EngineResponse,
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
 * - `trap`: OpenMS stopped (a WebAssembly trap or out of memory); it was restarted.
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
}

interface Pending {
  type: EngineCall
  resolve: (result: never) => void
  reject: (error: Error) => void
  onProgress?: (progress: SearchProgress) => void
}

/** One worker with its module. */
interface Session {
  worker: WorkerLike
  ready: Promise<EngineInfo>
  state: 'loading' | 'ready' | 'failed'
  /** It ran a request other than init (a fresh module is needed for a search). */
  used: boolean
}

function cancelled(type: EngineCall): string {
  return type === 'search' ? 'The search was cancelled.' : 'The request was cancelled.'
}

function moduleWorker(): WorkerLike {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
}

export class EngineClient {
  readonly #createWorker: () => WorkerLike
  readonly #baseUrl: string
  #session: Session | null = null
  #threads = 1
  #nextId = 0
  readonly #pending = new Map<number, Pending>()

  constructor(options: EngineClientOptions = {}) {
    this.#createWorker = options.createWorker ?? moduleWorker
    this.#baseUrl = options.baseUrl ?? new URL(import.meta.env.BASE_URL, document.baseURI).href
  }

  /** Loads OpenMS with `threads` threads (again, in a new worker, if it runs already). */
  async init(threads: number): Promise<EngineInfo> {
    this.#threads = threads
    return this.#start().ready
  }

  /** Searches the files in a fresh module: a new worker, or that of init() if it has run nothing else. */
  async search(req: SearchRequest, onProgress: (p: SearchProgress) => void): Promise<SearchOutcome> {
    let session = this.#current()
    if (session.used || session.state === 'failed') session = this.#start()
    session.used = true
    return this.#call(session, 'search', { request: req }, onProgress)
  }

  /** The fragment ions of `peptide` (`peptides.openms`) matched to the peaks (copied, not transferred). */
  async annotate(
    mz: Float32Array,
    intensity: Float32Array,
    peptide: string,
    charge: number,
    opts: AnnotationOptions,
  ): Promise<PeakAnnotationResult> {
    const session = this.#current()
    session.used = true
    const [m, i] = [mz.slice(), intensity.slice()]
    const args = { mz: m, intensity: i, peptide, charge, options: opts }
    return this.#call(session, 'annotate', args, undefined, [m.buffer, i.buffer])
  }

  /** PeptDeep's fragment intensities of `peptide` (`peptides.openms`). */
  async predict(peptide: string, charge: number, nce: number, instrument: string): Promise<PredictedIon[]> {
    const session = this.#current()
    session.used = true
    return this.#call(session, 'predict', { peptide, charge, nce, instrument })
  }

  /** The results of the last search as idXML, while its worker runs (until the next search). */
  async idXML(): Promise<Uint8Array> {
    const session = this.#current()
    session.used = true
    return this.#call(session, 'idXML', {})
  }

  /** Ends the worker (the pending calls are rejected as cancelled) and starts a new one. */
  cancel(): void {
    if (this.#session) this.#start()
  }

  #current(): Session {
    if (!this.#session) throw new Error('EngineClient: call init() first.')
    return this.#session
  }

  /** Ends the current worker, if any, and starts a new one with the threads of the last init(). */
  #start(): Session {
    this.#stop((p) => new EngineError('cancelled', cancelled(p.type)))
    const worker = this.#createWorker()
    const ready = this.#post(worker, 'init', { threads: this.#threads, baseUrl: this.#baseUrl })
    const session: Session = { worker, ready, state: 'loading', used: false }
    this.#session = session
    worker.onmessage = ({ data }) => this.#receive(session, data as EngineResponse)
    worker.onerror = (event) => {
      event.preventDefault()
      this.#crashed(session, event.message)
    }
    ready.then(
      () => {
        if (session.state === 'loading') session.state = 'ready'
      },
      () => {
        session.state = 'failed'
      },
    )
    return session
  }

  /** Terminates the current worker (its session cannot be used any more) and rejects the pending calls. */
  #stop(error: (p: Pending) => Error) {
    if (this.#session) {
      this.#session.state = 'failed'
      this.#session.worker.terminate()
    }
    const pending = [...this.#pending.values()]
    this.#pending.clear()
    for (const p of pending) p.reject(error(p))
  }

  /** A request, once the module is loaded (the init error otherwise). */
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
    if (this.#session !== session || session.state === 'failed') throw new EngineError('cancelled', cancelled(type))
    return this.#post(session.worker, type, args, onProgress, transfer)
  }

  #post<K extends EngineCall>(
    worker: WorkerLike,
    type: K,
    args: EngineCalls[K]['args'],
    onProgress?: (p: SearchProgress) => void,
    transfer: Transferable[] = [],
  ): Promise<EngineCalls[K]['result']> {
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { type, resolve: resolve as (r: never) => void, reject, onProgress })
      try {
        worker.postMessage({ id, type, ...args } as EngineRequest, { transfer })
      } catch (e) {
        this.#pending.delete(id)
        reject(e)
      }
    })
  }

  #receive(session: Session, data: EngineResponse) {
    if (this.#session !== session) return
    const pending = this.#pending.get(data.id)
    if (!pending) return
    if (data.type === 'progress') {
      pending.onProgress?.(data.progress)
      return
    }
    this.#pending.delete(data.id)
    if (data.type === 'result') pending.resolve(data.result as never)
    else if (data.trap || isTrapMessage(data.error)) {
      this.#pending.set(data.id, pending) // rejected with the other pending calls
      this.#crashed(session, data.error)
    } else pending.reject(new EngineError('failed', data.error))
  }

  /**
   * OpenMS stopped: rejects the pending calls and starts a new worker. If the module did not even load,
   * no new one is started here (the next search tries again).
   */
  #crashed(session: Session, detail: string) {
    if (this.#session !== session || session.state === 'failed') return
    const loaded = session.state === 'ready'
    this.#stop(() =>
      loaded
        ? new EngineError('trap', trapMessage(detail))
        : new EngineError('failed', `OpenMS could not be loaded (${detail || 'the worker stopped'}).`),
    )
    if (loaded) this.#start()
  }
}
