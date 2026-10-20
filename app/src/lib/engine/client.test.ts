import { beforeEach, describe, expect, test } from 'vitest'
import { EngineClient, EngineError, VIEWER_THREADS, type EngineClientOptions, type WorkerLike, type WorkerRole } from './client'
import {
  fileTooLargeMessage,
  isFatal,
  MAX_FILE_BYTES,
  isTrapMessage,
  thrownMessage,
  threadsForSearch,
  threadsLabel,
  UNRESPONSIVE,
  type EngineInfo,
  type EngineRequest,
  type EngineResponse,
  type SearchOutcome,
  type SearchProgress,
  type SearchRequest,
} from './protocol'

// EngineClient against fake workers: what the page sees of the workers' messages, traps and restarts.

const info: EngineInfo = { version: '3.7.0', threads: 4, threaded: true, isolated: true, onnx: true, parameters: [] }
/** What the next workers' modules report (a module without threads: `threaded` false). */
let workerInfo: EngineInfo

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  received: { message: EngineRequest; transfer: Transferable[] }[] = []
  terminated = false

  constructor(
    private readonly loads: boolean,
    readonly role: WorkerRole,
    private readonly loaded: EngineInfo = workerInfo,
  ) {}

  postMessage(message: EngineRequest, options?: StructuredSerializeOptions) {
    this.received.push({ message, transfer: options?.transfer ?? [] })
    if (message.type === 'init' && this.loads) {
      queueMicrotask(() => this.reply({ id: message.id, type: 'result', result: this.loaded }))
    }
  }

  terminate() {
    this.terminated = true
  }

  /** The threads it was started with. */
  get threads() {
    return this.request('init').threads
  }

  /** The last request of a type. */
  request<T extends EngineRequest['type']>(type: T): Extract<EngineRequest, { type: T }> {
    const found = this.received.findLast((r) => r.message.type === type)
    if (!found) throw new Error(`no ${type} request`)
    return found.message as Extract<EngineRequest, { type: T }>
  }

  types() {
    return this.received.map((r) => r.message.type)
  }

  reply(data: EngineResponse) {
    this.onmessage?.({ data } as MessageEvent)
  }

  /** An error the worker did not catch, e.g. a WebAssembly trap on one of OpenMS' threads. */
  crash(message: string) {
    let prevented = false
    this.onerror?.({ message, preventDefault: () => (prevented = true) } as unknown as ErrorEvent)
    return prevented
  }
}

function file(name: string) {
  return new File(['<mzML/>'], name)
}

const searchRequest: SearchRequest = {
  files: [
    { id: 'a', file: file('a.mzML') },
    { id: 'b', file: file('b.mzML') },
  ],
  database: file('db.fasta'),
  contaminants: true,
  parameters: { 'FDR:PSM': 0.01 },
  rescore: true,
  peptdeep: false,
}

const outcome = { summary: { files: [] }, tables: { files: [] }, spectra: {}, seconds: 1 } as unknown as SearchOutcome

/** Lets the client's awaits run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

let workers: FakeWorker[]
/** Whether the next workers load OpenMS (answer init). */
let loading: boolean[]
let client: EngineClient

function makeClient(startTimeoutMs = 1000, more: Partial<EngineClientOptions> = {}) {
  return new EngineClient({
    createWorker: (role) => {
      const w = new FakeWorker(loading.shift() ?? true, role)
      workers.push(w)
      return w
    },
    baseUrl: 'http://localhost/prose-web/',
    startTimeoutMs,
    restartTimeoutMs: startTimeoutMs,
    ...more,
  })
}

const searchWorkers = () => workers.filter((w) => w.role === 'search')
const viewerWorkers = () => workers.filter((w) => w.role === 'viewer')
const lastSearchWorker = () => searchWorkers().at(-1)!

/** Starts a search and waits until its worker has it; returns the promise and the request id. */
async function startSearch(onProgress: (p: SearchProgress) => void = () => {}, request: SearchRequest = searchRequest) {
  const search = client.search(request, onProgress)
  await settle()
  return { search, worker: lastSearchWorker(), id: lastSearchWorker().request('search').id }
}

/** A request of `n` files. */
function filesRequest(n: number, peptdeep = false): SearchRequest {
  return { ...searchRequest, peptdeep, files: Array.from({ length: n }, (_, i) => ({ id: `f${i}`, file: file(`f${i}.mzML`) })) }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A search that went through. */
async function searched() {
  const { search, worker, id } = await startSearch()
  worker.reply({ id, type: 'result', result: outcome })
  await search
  return worker
}

async function rejection(promise: Promise<unknown>): Promise<EngineError> {
  const error = await promise.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(EngineError)
  return error as EngineError
}

beforeEach(() => {
  workers = []
  loading = []
  workerInfo = info
  client = makeClient()
})

describe('EngineClient', () => {
  test('init loads OpenMS in a worker with the threads and the base URL', async () => {
    await expect(client.init(4)).resolves.toEqual(info)
    expect(workers).toHaveLength(1)
    expect(workers[0].request('init')).toMatchObject({ threads: 4, baseUrl: 'http://localhost/prose-web/' })
  })

  test('progress is forwarded with the file index', async () => {
    await client.init(4)
    const progress: SearchProgress[] = []
    const { search, worker, id } = await startSearch((p) => progress.push(p))
    expect(worker.request('search').request).toEqual(searchRequest)
    worker.reply({ id, type: 'progress', progress: { label: 'Searching a.mzML (1 of 2)...', file: 0, fraction: 0 } })
    worker.reply({ id, type: 'progress', progress: { label: 'Searching b.mzML (2 of 2)...', file: 1, fraction: 0.475 } })
    worker.reply({ id, type: 'result', result: outcome })
    await expect(search).resolves.toBe(outcome)
    expect(progress).toEqual([
      { label: 'Searching a.mzML (1 of 2)...', file: 0, fraction: 0 },
      { label: 'Searching b.mzML (2 of 2)...', file: 1, fraction: 0.475 },
    ])
  })

  test('client restarts after a trap and rejects the search', async () => {
    await client.init(4)
    const { search, worker: first, id } = await startSearch()
    first.reply({ id, type: 'stage', stage: 'searching' })
    expect(first.crash('RuntimeError: unreachable')).toBe(true)

    const error = await rejection(search)
    expect(error.kind).toBe('trap')
    expect(error.message).toMatch(/out of memory|trap/)
    expect(error.message).toContain('database:chunk_size')
    expect(error.message).toContain('RuntimeError: unreachable')
    expect(error.message).toMatch(/OpenMS was restarted\.$/)

    // a new worker, loaded with the same threads
    expect(first.terminated).toBe(true)
    const second = lastSearchWorker()
    expect(second).not.toBe(first)
    expect(second.threads).toBe(4)

    // and it serves the next search
    const next = await startSearch()
    expect(next.worker).toBe(second)
    second.reply({ id: next.id, type: 'result', result: outcome })
    await expect(next.search).resolves.toBe(outcome)
  })

  test('a trap while reading the files does not advise database:chunk_size', async () => {
    await client.init(4)
    const { search, worker, id } = await startSearch()
    worker.reply({ id, type: 'error', error: 'RuntimeError: memory access out of bounds', trap: true, stage: 'reading' })
    const error = await rejection(search)
    expect(error.kind).toBe('trap')
    expect(error.message).toMatch(/^OpenMS stopped while reading the files .*search fewer or smaller files/)
    expect(error.message).not.toContain('database:chunk_size')
  })

  test('a restart that does not load in time says to reload the page', async () => {
    client = makeClient(50)
    loading = [true, false] // the new worker never loads
    await client.init(4)
    const { search, worker } = await startSearch()
    worker.crash('RuntimeError: unreachable')
    const error = await rejection(search)
    expect(error.kind).toBe('trap')
    expect(error.message).toMatch(/Reload the page to start OpenMS again\.$/)
    expect(error.message).not.toContain('restarted')
    expect(lastSearchWorker().terminated).toBe(true) // the one that did not load

    // the next search tries a new worker
    const next = await startSearch()
    expect(searchWorkers()).toHaveLength(3)
    next.worker.reply({ id: next.id, type: 'result', result: outcome })
    await expect(next.search).resolves.toBe(outcome)
  })

  test('an abort reported by the worker counts as a trap', async () => {
    await client.init(4)
    const { search, worker, id } = await startSearch()
    worker.reply({ id, type: 'error', error: 'Aborted(OOM)', trap: false, stage: 'searching' })
    await expect(search).rejects.toThrow(/out of memory|trap/)
    expect(worker.terminated).toBe(true)
    expect(lastSearchWorker()).not.toBe(worker)
  })

  test('an OpenMS error rejects without a restart', async () => {
    await client.init(4)
    const message = 'InvalidValue: the value of FDR:PSM is out of range'
    const { search, worker, id } = await startSearch()
    worker.reply({ id, type: 'error', error: message, trap: false, stage: 'searching' })
    const error = await rejection(search)
    expect(error.kind).toBe('failed')
    expect(error.message).toBe(message)
    expect(worker.terminated).toBe(false)
  })

  test("OpenMS' out-of-memory errors say what to do, without a restart", async () => {
    await client.init(4)
    const cases = [
      {
        stage: 'searching' as const,
        error:
          "SearchFilesError: searchFiles(): provideFile(1, '/input/1/b.mzML') threw: OutOfMemory: unable to allocate " +
          'enough memory (size = 2000000000 bytes) ',
        advice: /^OpenMS ran out of memory while searching \(SearchFilesError: .*bytes\)\)\. A search can use at most the 4 GB.*Search fewer files at a time.*database:chunk_size/,
      },
      { stage: 'reading' as const, error: 'std::bad_alloc', advice: /^OpenMS ran out of memory while reading the files \(std::bad_alloc\)\. Search fewer or smaller files/ },
    ]
    for (const { stage, error: text, advice } of cases) {
      const { search, worker, id } = await startSearch()
      worker.reply({ id, type: 'error', error: text, trap: false, stage })
      const error = await rejection(search)
      expect(error.kind).toBe('failed')
      expect(error.message).toMatch(advice)
      expect(worker.terminated).toBe(false)
    }
  })

  test('isTrapMessage knows traps from OpenMS exceptions', () => {
    for (const trap of [
      'RuntimeError: unreachable',
      'RuntimeError: memory access out of bounds',
      'Aborted(OOM)',
      'out of memory',
      thrownMessage(new WebAssembly.Exception(new WebAssembly.Tag({ parameters: [] }), [])),
      "SearchFilesError: searchFiles(): provideFile(0, '/input/0/a.mzML') threw: WebAssembly.Exception: a C++ exception",
    ]) {
      expect(isTrapMessage(trap)).toBe(true)
    }
    for (const error of [
      'InvalidValue: the value of FDR:PSM is out of range',
      'OutOfMemory: unable to allocate enough memory (size = 123 bytes)',
      'ParseError: index out of bounds while parsing PEPT[X',
      fileTooLargeMessage('big.mzML', 2.5 * 2 ** 30),
    ]) {
      expect(isTrapMessage(error)).toBe(false)
    }
  })

  test('anything thrown that is not an Error is fatal', () => {
    const tag = new WebAssembly.Tag({ parameters: [] })
    const cppException = new WebAssembly.Exception(tag, [])
    for (const fatal of [cppException, new WebAssembly.RuntimeError('unreachable'), 'a string', { code: 1 }, new Error('Aborted(OOM)')]) {
      expect(isFatal(fatal)).toBe(true)
    }
    for (const error of [new Error('InvalidValue: out of range'), new TypeError('x is undefined'), new Error('OutOfMemory: unable to allocate')]) {
      expect(isFatal(error)).toBe(false)
    }
    expect(thrownMessage(cppException)).toMatch(/^WebAssembly\.Exception: a C\+\+ exception .*bad_alloc/)
    expect(thrownMessage(new Error('InvalidValue: x'))).toBe('InvalidValue: x')
    expect(thrownMessage('plain')).toBe('plain')
  })

  test('a fatal throw reported by the worker restarts it', async () => {
    await client.init(4)
    const { search, worker, id } = await startSearch()
    worker.reply({ id, type: 'error', error: thrownMessage(new WebAssembly.Exception(new WebAssembly.Tag({ parameters: [] }), [])), trap: true, stage: 'searching' })
    const error = await rejection(search)
    expect(error.kind).toBe('trap')
    expect(error.message).toMatch(/^OpenMS stopped while searching \(WebAssembly\.Exception: .*OpenMS was restarted\.$/)
    expect(worker.terminated).toBe(true)
    expect(lastSearchWorker()).not.toBe(worker)
  })

  test('starts a fresh worker for every search', async () => {
    await client.init(4)
    await searched()
    expect(workers).toHaveLength(1) // the worker of init() had not searched yet

    const second = await startSearch()
    expect(workers).toHaveLength(2)
    expect(workers[0].terminated).toBe(true)
    expect(second.worker.threads).toBe(4)
    second.worker.reply({ id: second.id, type: 'result', result: outcome })
    await expect(second.search).resolves.toBe(outcome)
  })

  test('a new search cancels the idXML of the previous one', async () => {
    await client.init(4)
    const first = await searched()
    const xml = client.idXML()
    await settle()
    expect(first.types()).toEqual(['init', 'search', 'idXML'])

    const cancelledXml = rejection(xml)
    const next = await startSearch()
    const error = await cancelledXml
    expect(error.kind).toBe('cancelled')
    expect(error.message).toBe('The request was cancelled.')
    next.worker.reply({ id: next.id, type: 'result', result: outcome })
    await expect(next.search).resolves.toBe(outcome)
  })

  test('hasSearchResult: only while the worker of a finished search runs', async () => {
    expect(client.hasSearchResult).toBe(false)
    await client.init(4)
    expect(client.hasSearchResult).toBe(false)
    await searched()
    expect(client.hasSearchResult).toBe(true)
    // a new search replaces the worker: the old result is gone, also when the new search fails
    const next = await startSearch()
    expect(client.hasSearchResult).toBe(false)
    next.worker.reply({ id: next.id, type: 'error', error: 'Parse Error', trap: false, stage: 'searching' })
    await rejection(next.search)
    expect(client.hasSearchResult).toBe(false)
    // a search that went through, then a trap of its worker (e.g. while writing idXML)
    const worker = await searched()
    expect(client.hasSearchResult).toBe(true)
    worker.crash('RuntimeError: unreachable')
    await settle()
    expect(client.hasSearchResult).toBe(false)
  })

  test('an idXML queued behind a search that traps rejects as a trap', async () => {
    await client.init(4)
    const { search, worker, id } = await startSearch()
    worker.reply({ id, type: 'stage', stage: 'searching' })
    const xml = client.idXML()
    await settle()
    expect(worker.types()).toEqual(['init', 'search', 'idXML'])
    worker.crash('RuntimeError: unreachable')
    for (const call of [search, xml]) {
      const error = await rejection(call)
      expect(error.kind).toBe('trap')
      expect(error.message).toContain('database:chunk_size')
    }
  })

  test('late answers of a replaced worker are ignored', async () => {
    await client.init(4)

    // after cancel()
    const first = await startSearch()
    client.cancel()
    await expect(first.search).rejects.toThrow('The search was cancelled.')
    const second = await startSearch()
    first.worker.reply({ id: first.id, type: 'result', result: outcome })
    first.worker.reply({ id: second.id, type: 'error', error: 'late', trap: true, stage: 'searching' })
    first.worker.crash('RuntimeError: unreachable')
    await settle()
    expect(second.worker.terminated).toBe(false)

    // after a trap
    second.worker.crash('RuntimeError: unreachable')
    await expect(second.search).rejects.toThrow(/OpenMS was restarted/)
    const third = await startSearch()
    second.worker.reply({ id: third.id, type: 'result', result: { late: true } })
    second.worker.reply({ id: second.id, type: 'result', result: outcome })
    await settle()
    const late = await Promise.race([third.search.then(() => 'settled'), settle().then(() => 'pending')])
    expect(late).toBe('pending')
    third.worker.reply({ id: third.id, type: 'result', result: outcome })
    await expect(third.search).resolves.toBe(outcome)
  })

  test('annotate and predict go to a viewer worker, not behind the search', async () => {
    await client.init(4)
    const { search, worker: searchWorker, id } = await startSearch() // in flight

    // the peaks are copied: the page keeps its stored spectra
    const mz = new Float32Array([100, 200, 300, 400])
    const intensity = new Float32Array([1, 2, 3, 4])
    const annotation = client.annotate(mz.subarray(1, 3), intensity.subarray(1, 3), 'PEPTIDEK', 2, null)
    await settle()
    expect(viewerWorkers()).toHaveLength(1)
    const viewer = viewerWorkers()[0]
    const sent = viewer.received.at(-1)!
    const request = viewer.request('annotate')
    expect(Array.from(request.mz)).toEqual([200, 300])
    expect(request.mz.buffer).not.toBe(mz.buffer)
    expect(sent.transfer).toEqual([request.mz.buffer, request.intensity.buffer])
    expect(mz.length).toBe(4)
    viewer.reply({ id: request.id, type: 'result', result: { matches: [], theoretical: [] } })
    await expect(annotation).resolves.toEqual({ matches: [], theoretical: [] })

    const prediction = client.predict('PEPTIDEK', 2, 30, 'QE')
    await settle()
    expect(viewer.request('predict')).toMatchObject({ peptide: 'PEPTIDEK', charge: 2, nce: 30, instrument: 'QE' })
    viewer.reply({ id: viewer.request('predict').id, type: 'result', result: [] })
    await expect(prediction).resolves.toEqual([])
    expect(searchWorker.types()).toEqual(['init', 'search'])

    // idXML stays with the search worker
    searchWorker.reply({ id, type: 'result', result: outcome })
    await search
    const bytes = client.idXML()
    await settle()
    searchWorker.reply({ id: searchWorker.request('idXML').id, type: 'result', result: new Uint8Array([60]) })
    await expect(bytes).resolves.toEqual(new Uint8Array([60]))
    expect(viewer.types()).toEqual(['init', 'annotate', 'predict'])
  })

  test('the search worker and the viewer restart independently', async () => {
    await client.init(4)
    const annotation = client.annotate(new Float32Array(1), new Float32Array(1), 'PEPTIDEK', 2, null)
    await settle()
    const viewer = viewerWorkers()[0]
    viewer.reply({ id: viewer.request('annotate').id, type: 'result', result: { matches: [], theoretical: [] } })
    await annotation

    // new searches, a cancel and a trap of the search worker leave the viewer alone
    await searched()
    await searched()
    const cancelled = await startSearch()
    client.cancel()
    await expect(cancelled.search).rejects.toThrow('The search was cancelled.')
    expect(cancelled.worker.terminated).toBe(true)
    expect(viewer.terminated).toBe(false)
    const { search, worker } = await startSearch()
    worker.crash('RuntimeError: unreachable')
    await expect(search).rejects.toThrow(/restarted/)
    expect(viewer.terminated).toBe(false)
    expect(viewerWorkers()).toHaveLength(1)

    // a trap of the viewer restarts the viewer only
    const searchWorker = lastSearchWorker()
    const prediction = client.predict('PEPTIDEK', 2, 30, 'QE')
    await settle()
    viewer.reply({ id: viewer.request('predict').id, type: 'error', error: 'RuntimeError: unreachable', trap: true, stage: 'predict' })
    const error = await rejection(prediction)
    expect(error.kind).toBe('trap')
    expect(error.message).toMatch(/^OpenMS stopped while predicting the spectrum \(RuntimeError: unreachable\)\. OpenMS was restarted\.$/)
    expect(viewer.terminated).toBe(true)
    expect(viewerWorkers()).toHaveLength(2)
    expect(viewerWorkers()[1].threads).toBe(VIEWER_THREADS)
    expect(searchWorker.terminated).toBe(false)
  })

  test('the viewer is not started before the first annotate or predict', async () => {
    await client.init(4)
    await searched()
    const xml = client.idXML()
    await settle()
    lastSearchWorker().reply({ id: lastSearchWorker().request('idXML').id, type: 'result', result: new Uint8Array([60]) })
    await xml
    expect(viewerWorkers()).toHaveLength(0)
    expect(workers).toHaveLength(1)
    const annotation = client.annotate(new Float32Array(1), new Float32Array(1), 'PEPTIDEK', 2, null)
    await settle()
    expect(viewerWorkers()).toHaveLength(1)
    viewerWorkers()[0].reply({ id: viewerWorkers()[0].request('annotate').id, type: 'result', result: { matches: [], theoretical: [] } })
    await annotation
  })

  test('cancel terminates the worker, rejects the pending calls and starts a new one', async () => {
    await client.init(4)
    const { search, worker: first } = await startSearch()
    client.cancel()
    const error = await rejection(search)
    expect(error.kind).toBe('cancelled')
    expect(error.message).toBe('The search was cancelled.')
    expect(first.terminated).toBe(true)
    expect(workers).toHaveLength(2)
    expect(workers[1].threads).toBe(4)
    // the new worker serves the next search
    const next = await startSearch()
    expect(next.worker).toBe(workers[1])
    next.worker.reply({ id: next.id, type: 'result', result: outcome })
    await expect(next.search).resolves.toBe(outcome)
  })

  test('cancel does nothing without a search in flight', async () => {
    await client.init(4)
    client.cancel()
    const first = await searched()
    const xml = client.idXML()
    await settle()
    client.cancel()
    expect(workers).toHaveLength(1)
    expect(first.terminated).toBe(false)
    first.reply({ id: first.request('idXML').id, type: 'result', result: new Uint8Array([60]) })
    await expect(xml).resolves.toEqual(new Uint8Array([60]))
  })

  test('cancel while the new worker loads rejects the search as cancelled', async () => {
    loading = [true, false] // only the first one loads
    await client.init(4)
    await searched()

    const second = client.search(searchRequest, () => {}) // a new worker, still loading
    await settle()
    client.cancel()
    await expect(second).rejects.toThrow('The search was cancelled.')
    expect(workers).toHaveLength(3)
    expect(workers[1].terminated).toBe(true)
    expect(workers[1].types()).toEqual(['init'])
  })

  test('cancel during the restart after a trap cancels the search at once', async () => {
    client = makeClient(5000)
    loading = [true, false] // the restarted worker takes long to load (it never does)
    await client.init(4)
    const { search, worker } = await startSearch()
    worker.crash('RuntimeError: unreachable')
    await settle()
    expect(worker.terminated).toBe(true)
    const restarting = lastSearchWorker()
    expect(restarting).not.toBe(worker)
    client.cancel()
    const error = await rejection(search)
    expect(error.kind).toBe('cancelled')
    expect(error.message).toBe('The search was cancelled.')
    expect(restarting.terminated).toBe(false) // it goes on loading, for the next search
  })

  test('an idXML whose restart a new search replaces does not say to reload the page', async () => {
    loading = [true, false] // the restart after the trap does not load before the next search replaces it
    await client.init(16)
    const worker = await searched()
    const xml = rejection(client.idXML())
    await settle()
    worker.crash('RuntimeError: unreachable')
    await settle()
    const next = await startSearch(() => {}, filesRequest(6)) // 4 threads: a new worker replaces the restart
    const error = await xml
    expect(error.kind).toBe('trap')
    expect(error.message).toMatch(/OpenMS was restarted\.$/)
    expect(error.message).not.toContain('Reload')
    next.worker.reply({ id: next.id, type: 'result', result: outcome })
    await expect(next.search).resolves.toBe(outcome)
  })

  test('a worker that fails to load is not restarted in a loop', async () => {
    loading = [false]
    const init = client.init(4)
    workers[0].crash('RangeError: WebAssembly.Memory(): could not allocate memory')
    const error = await rejection(init)
    expect(error.kind).toBe('failed')
    expect(error.message).toMatch(/^OpenMS could not be loaded \(RangeError.*\)\. Reload the page to start OpenMS again\.$/)
    expect(workers).toHaveLength(1)

    // the next search starts a new worker
    const next = await startSearch()
    expect(workers).toHaveLength(2)
    next.worker.reply({ id: next.id, type: 'result', result: outcome })
    await expect(next.search).resolves.toBe(outcome)
  })

  test('the first load has the start timeout, the workers after it the restart timeout', async () => {
    client = makeClient(150, { restartTimeoutMs: 20 })
    loading = [false, true, false]
    // the first load (the module is downloaded) may take the start timeout
    const first = client.init(4)
    await wait(60)
    expect(workers[0].terminated).toBe(false)
    expect((await rejection(first)).message).toBe('OpenMS did not start within 0.15 s. Reload the page to start OpenMS again.')
    // until one has loaded
    await client.init(4)
    const { search, worker } = await startSearch()
    worker.crash('RuntimeError: unreachable')
    const started = performance.now()
    const error = await rejection(search)
    expect(performance.now() - started).toBeLessThan(120)
    expect(error.message).toMatch(/Reload the page to start OpenMS again\.$/)
  })

  test('a worker that does not load in time counts as failed', async () => {
    client = makeClient(50)
    loading = [false]
    const error = await rejection(client.init(4))
    expect(error.kind).toBe('failed')
    expect(error.message).toBe('OpenMS did not start within 0.05 s. Reload the page to start OpenMS again.')
    expect(workers[0].terminated).toBe(true)
  })

  test('a search before init is refused', async () => {
    await expect(client.search(searchRequest, () => {})).rejects.toThrow(/init/)
    expect(workers).toHaveLength(0)
  })
})

describe('threads of a search', () => {
  test('at most 4 threads for more than 4 files, for more than 2 with PeptDeep, or for an uncertain estimate', () => {
    expect(threadsForSearch(16, 1, false)).toEqual({ threads: 16, capped: false })
    expect(threadsForSearch(16, 4, false)).toEqual({ threads: 16, capped: false })
    expect(threadsForSearch(16, 5, false)).toEqual({ threads: 4, capped: true })
    expect(threadsForSearch(16, 2, true)).toEqual({ threads: 16, capped: false })
    expect(threadsForSearch(16, 3, true)).toEqual({ threads: 4, capped: true })
    expect(threadsForSearch(2, 12, true)).toEqual({ threads: 2, capped: false })
    // a chunked semi- or non-specific search: whatever the files
    expect(threadsForSearch(16, 1, false, true)).toEqual({ threads: 4, capped: true })
    expect(threadsForSearch(16, 1, false, false)).toEqual({ threads: 16, capped: false })
    expect(threadsLabel({ threads: 4, capped: true })).toBe('4 threads (memory)')
    expect(threadsLabel({ threads: 16, capped: false })).toBe('16 threads')
    expect(threadsLabel({ threads: 1, capped: false })).toBe('1 thread')
  })

  test('a search of many files runs in a worker with fewer threads', async () => {
    await client.init(16)
    expect(client.threadsFor(filesRequest(2))).toEqual({ threads: 16, capped: false })
    expect(client.threadsFor(filesRequest(6))).toEqual({ threads: 4, capped: true })
    expect(client.threadsFor(filesRequest(3, true))).toEqual({ threads: 4, capped: true })
    expect(client.threadsFor({ ...filesRequest(1), uncertainMemory: true })).toEqual({ threads: 4, capped: true })

    // two files: the worker of init(), with all threads
    const two = await startSearch(() => {}, filesRequest(2))
    expect(two.worker).toBe(workers[0])
    two.worker.reply({ id: two.id, type: 'result', result: outcome })
    await two.search

    // six files: a new worker with 4 threads
    const six = await startSearch(() => {}, filesRequest(6))
    expect(six.worker.threads).toBe(4)
    six.worker.reply({ id: six.id, type: 'result', result: outcome })
    await six.search

    // a cancel restarts with the threads of the cancelled search, ready for it again
    const deep = await startSearch(() => {}, filesRequest(3, true))
    expect(deep.worker.threads).toBe(4)
    client.cancel()
    await rejection(deep.search)
    const restarted = lastSearchWorker()
    expect(restarted).not.toBe(deep.worker)
    expect(restarted.threads).toBe(4)
    const again = await startSearch(() => {}, filesRequest(3, true))
    expect(again.worker).toBe(restarted)
    // a trap too
    again.worker.crash('RuntimeError: unreachable')
    await rejection(again.search)
    expect(lastSearchWorker().threads).toBe(4)
    // a search of two files then starts one with all threads
    const all = await startSearch(() => {}, filesRequest(2))
    expect(all.worker.threads).toBe(16)
  })
})

describe('watchdog', () => {
  const MiB = 2 ** 20
  const watchdog = { silentMs: 80, nearMaxSilentMs: 25, uncertainSilentMs: 400, uncertainNearMaxSilentMs: 300, nearMaxBytes: 64 * MiB }
  const progress = (label: string, fraction: number): SearchProgress => ({ label, file: 0, fraction })

  test('ends a search that reports nothing for too long', async () => {
    client = makeClient(1000, { watchdog })
    await client.init(4)
    const { search, worker, id } = await startSearch()
    // reading the files (the database, the models): not watched
    worker.reply({ id, type: 'stage', stage: 'reading' })
    await wait(120)
    expect(worker.terminated).toBe(false)
    worker.reply({ id, type: 'stage', stage: 'searching' })
    // reports keep it alive
    for (let i = 0; i < 4; i++) {
      await wait(40)
      worker.reply({ id, type: 'progress', progress: progress('Searching f0.mzML (1 of 2)...', 0.1 * i), memory: { heapSize: 1e9, heapMax: 4e9, maxFileSize: MAX_FILE_BYTES } })
    }
    expect(worker.terminated).toBe(false)
    // then silence
    const error = await rejection(search)
    expect(worker.terminated).toBe(true)
    expect(error.kind).toBe('trap')
    expect(error.message).toBe(`${UNRESPONSIVE} OpenMS was restarted.`)
    expect(UNRESPONSIVE).toBe('OpenMS stopped responding (likely out of memory); search fewer files at a time.')
    expect(lastSearchWorker()).not.toBe(worker)
    expect(lastSearchWorker().threads).toBe(4)
  })

  test('ends a search sooner when the heap is fully grown', async () => {
    client = makeClient(1000, { watchdog: { ...watchdog, silentMs: 1000 } })
    await client.init(4)
    const { search, worker, id } = await startSearch()
    worker.reply({ id, type: 'stage', stage: 'searching' })
    const max = 4096 * MiB
    worker.reply({ id, type: 'progress', progress: progress('Scoring...', 0.2), memory: { heapSize: 3000 * MiB, heapMax: max, maxFileSize: MAX_FILE_BYTES } })
    await wait(60) // longer than nearMaxSilentMs, but the heap can still grow
    expect(worker.terminated).toBe(false)
    // 96 % of the maximum, but it can still grow by more than 64 MiB: the long budget
    worker.reply({ id, type: 'progress', progress: progress('Scoring...', 0.25), memory: { heapSize: 3940 * MiB, heapMax: max, maxFileSize: MAX_FILE_BYTES } })
    await wait(60)
    expect(worker.terminated).toBe(false)
    // fully grown: the short budget
    worker.reply({ id, type: 'progress', progress: progress('Scoring...', 0.3), memory: { heapSize: max - 16 * MiB, heapMax: max, maxFileSize: MAX_FILE_BYTES } })
    const started = performance.now()
    const error = await rejection(search)
    expect(performance.now() - started).toBeLessThan(500)
    expect(error.message).toMatch(/^OpenMS stopped responding/)
    expect(worker.terminated).toBe(true)
  })

  test('does not watch a module of one thread', async () => {
    // without threads, and a threaded module started with one thread
    for (const loaded of [{ ...info, threads: 1, threaded: false }, { ...info, threads: 1, threaded: true }]) {
      workerInfo = loaded
      client = makeClient(1000, { watchdog })
      await client.init(1)
      const { search, worker, id } = await startSearch()
      worker.reply({ id, type: 'stage', stage: 'searching' })
      worker.reply({ id, type: 'progress', progress: progress('Building the index...', 0.1), memory: { heapSize: 4e9, heapMax: 4e9, maxFileSize: MAX_FILE_BYTES } })
      await wait(150) // longer than silentMs: a long step on one thread, not a hang
      expect(worker.terminated).toBe(false)
      worker.reply({ id, type: 'result', result: outcome })
      await expect(search).resolves.toBe(outcome)
    }
  })

  test('writing a file (reading) re-arms it like a report', async () => {
    client = makeClient(1000, { watchdog })
    await client.init(4)
    const { search, worker, id } = await startSearch()
    worker.reply({ id, type: 'stage', stage: 'searching' })
    for (let i = 0; i < 3; i++) {
      await wait(50)
      worker.reply({ id, type: 'stage', stage: i % 2 === 0 ? 'reading' : 'searching' })
    }
    expect(worker.terminated).toBe(false) // 150 ms in, with silentMs 80
    const error = await rejection(search)
    expect(error.message).toMatch(/^OpenMS stopped responding/)
  })

  test('gives a search with an uncertain memory estimate longer budgets', async () => {
    client = makeClient(1000, { watchdog })
    await client.init(4)
    const { search, worker, id } = await startSearch(() => {}, { ...searchRequest, uncertainMemory: true })
    worker.reply({ id, type: 'stage', stage: 'searching' })
    // fully grown heap: 300 ms instead of 25; else 400 instead of 80
    worker.reply({ id, type: 'progress', progress: progress('Searching database chunk 3...', 0.1), memory: { heapSize: 4e9, heapMax: 4e9, maxFileSize: MAX_FILE_BYTES } })
    await wait(150)
    expect(worker.terminated).toBe(false)
    const started = performance.now()
    const error = await rejection(search)
    expect(performance.now() - started).toBeGreaterThan(100)
    expect(error.message).toMatch(/^OpenMS stopped responding/)
  })

  test('stops watching when the search has ended', async () => {
    client = makeClient(1000, { watchdog })
    await client.init(4)
    const { search, worker, id } = await startSearch()
    worker.reply({ id, type: 'stage', stage: 'searching' })
    worker.reply({ id, type: 'result', result: outcome })
    await search
    await wait(120)
    expect(worker.terminated).toBe(false)
    expect(client.hasSearchResult).toBe(true)
  })

  test('cancel stays available while the search is silent', async () => {
    client = makeClient(1000, { watchdog: { ...watchdog, silentMs: 10_000 } })
    await client.init(4)
    const { search, worker, id } = await startSearch()
    worker.reply({ id, type: 'stage', stage: 'searching' })
    await wait(30)
    client.cancel()
    expect((await rejection(search)).kind).toBe('cancelled')
    expect(worker.terminated).toBe(true)
  })
})
