import { beforeEach, describe, expect, test } from 'vitest'
import { EngineClient, EngineError, VIEWER_THREADS, type WorkerLike } from './client'
import {
  isTrapMessage,
  type EngineInfo,
  type EngineRequest,
  type EngineResponse,
  type SearchOutcome,
  type SearchProgress,
  type SearchRequest,
} from './protocol'

// EngineClient against fake workers: what the page sees of the workers' messages, traps and restarts.

const info: EngineInfo = { version: '3.7.0', threads: 4, threaded: true, isolated: true, onnx: true, parameters: [] }

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  received: { message: EngineRequest; transfer: Transferable[] }[] = []
  terminated = false

  constructor(private readonly loads: boolean) {}

  postMessage(message: EngineRequest, options?: StructuredSerializeOptions) {
    this.received.push({ message, transfer: options?.transfer ?? [] })
    if (message.type === 'init' && this.loads) {
      queueMicrotask(() => this.reply({ id: message.id, type: 'result', result: info }))
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

function makeClient(startTimeoutMs = 1000) {
  return new EngineClient({
    createWorker: () => {
      const w = new FakeWorker(loading.shift() ?? true)
      workers.push(w)
      return w
    },
    baseUrl: 'http://localhost/prose-web/',
    startTimeoutMs,
  })
}

const searchWorkers = () => workers.filter((w) => w.threads !== VIEWER_THREADS)
const viewerWorkers = () => workers.filter((w) => w.threads === VIEWER_THREADS)
const lastSearchWorker = () => searchWorkers().at(-1)!

/** Starts a search and waits until its worker has it; returns the promise and the request id. */
async function startSearch(onProgress: (p: SearchProgress) => void = () => {}) {
  const search = client.search(searchRequest, onProgress)
  await settle()
  return { search, worker: lastSearchWorker(), id: lastSearchWorker().request('search').id }
}

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
    for (const message of [
      'InvalidValue: the value of FDR:PSM is out of range',
      'OutOfMemory: unable to allocate enough memory (size = 123 bytes)',
    ]) {
      const { search, worker, id } = await startSearch()
      worker.reply({ id, type: 'error', error: message, trap: false, stage: 'searching' })
      const error = await rejection(search)
      expect(error.kind).toBe('failed')
      expect(error.message).toBe(message)
      expect(worker.terminated).toBe(false)
    }
  })

  test('isTrapMessage knows traps from OpenMS exceptions', () => {
    for (const trap of ['RuntimeError: unreachable', 'RuntimeError: memory access out of bounds', 'Aborted(OOM)', 'out of memory']) {
      expect(isTrapMessage(trap)).toBe(true)
    }
    for (const error of [
      'InvalidValue: the value of FDR:PSM is out of range',
      'OutOfMemory: unable to allocate enough memory (size = 123 bytes)',
      'ParseError: index out of bounds while parsing PEPT[X',
      'The files total 7.8 GB; this browser engine can hold about 2.5 GB at once: search fewer files at a time.',
    ]) {
      expect(isTrapMessage(error)).toBe(false)
    }
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
