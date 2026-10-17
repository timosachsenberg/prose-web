import { beforeEach, describe, expect, test } from 'vitest'
import { EngineClient, EngineError, type WorkerLike } from './client'
import type { EngineInfo, EngineRequest, SearchOutcome, SearchProgress, SearchRequest } from './protocol'

// EngineClient against a fake worker: what the page sees of the worker's messages, traps and restarts.

const info: EngineInfo = { version: '3.7.0', threads: 4, threaded: true, isolated: true, onnx: true, parameters: [] }

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  received: { message: EngineRequest; transfer: Transferable[] }[] = []
  terminated = false

  constructor(private readonly autoInit: boolean) {}

  postMessage(message: EngineRequest, options?: StructuredSerializeOptions) {
    this.received.push({ message, transfer: options?.transfer ?? [] })
    if (message.type === 'init' && this.autoInit) {
      queueMicrotask(() => this.reply({ id: message.id, type: 'result', result: info }))
    }
  }

  terminate() {
    this.terminated = true
  }

  /** The last request of a type. */
  request<T extends EngineRequest['type']>(type: T): Extract<EngineRequest, { type: T }> {
    const found = this.received.findLast((r) => r.message.type === type)
    if (!found) throw new Error(`no ${type} request`)
    return found.message as Extract<EngineRequest, { type: T }>
  }

  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }

  /** An error the worker did not catch, e.g. a WebAssembly trap on one of OpenMS' threads. */
  crash(message: string) {
    let prevented = false
    this.onerror?.({ message, preventDefault: () => (prevented = true) } as unknown as ErrorEvent)
    return prevented
  }
}

let workers: FakeWorker[]
let client: EngineClient

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

beforeEach(() => {
  workers = []
  client = new EngineClient({
    createWorker: () => {
      const w = new FakeWorker(true)
      workers.push(w)
      return w
    },
    baseUrl: 'http://localhost/prose-web/',
  })
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
    const search = client.search(searchRequest, (p) => progress.push(p))
    await settle()
    const worker = workers.at(-1)!
    const { id, request } = worker.request('search')
    expect(request).toEqual(searchRequest)
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
    const search = client.search(searchRequest, () => {})
    await settle()
    const first = workers.at(-1)!
    first.request('search')
    expect(first.crash('RuntimeError: unreachable')).toBe(true)

    const error = await search.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EngineError)
    expect((error as EngineError).kind).toBe('trap')
    expect((error as Error).message).toMatch(/out of memory|trap/)
    expect((error as Error).message).toContain('database:chunk_size')
    expect((error as Error).message).toContain('RuntimeError: unreachable')

    // a new worker, loaded with the same threads
    expect(first.terminated).toBe(true)
    const second = workers.at(-1)!
    expect(second).not.toBe(first)
    expect(second.request('init').threads).toBe(4)
    await settle()

    // and it serves the next search
    const next = client.search(searchRequest, () => {})
    await settle()
    const { id } = workers.at(-1)!.request('search')
    workers.at(-1)!.reply({ id, type: 'result', result: outcome })
    await expect(next).resolves.toBe(outcome)
  })

  test('an abort reported by the worker counts as a trap', async () => {
    await client.init(2)
    const search = client.search(searchRequest, () => {})
    await settle()
    const worker = workers.at(-1)!
    const { id } = worker.request('search')
    worker.reply({ id, type: 'error', error: 'Aborted(OOM)', trap: false })
    await expect(search).rejects.toThrow(/out of memory|trap/)
    expect(worker.terminated).toBe(true)
    expect(workers.at(-1)).not.toBe(worker)
  })

  test('an OpenMS error rejects without a restart', async () => {
    await client.init(2)
    const search = client.search(searchRequest, () => {})
    await settle()
    const worker = workers.at(-1)!
    const { id } = worker.request('search')
    worker.reply({ id, type: 'error', error: 'InvalidValue: the value of FDR:PSM is out of range', trap: false })
    const error = await search.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EngineError)
    expect((error as EngineError).kind).toBe('failed')
    expect((error as Error).message).toBe('InvalidValue: the value of FDR:PSM is out of range')
    expect(worker.terminated).toBe(false)
    expect(workers.at(-1)).toBe(worker)
  })

  test('starts a fresh worker for every search', async () => {
    await client.init(4)
    const first = client.search(searchRequest, () => {})
    await settle()
    expect(workers).toHaveLength(1) // the worker of init() has not searched yet
    workers[0].reply({ id: workers[0].request('search').id, type: 'result', result: outcome })
    await first

    const second = client.search(searchRequest, () => {})
    await settle()
    expect(workers).toHaveLength(2)
    expect(workers[0].terminated).toBe(true)
    expect(workers[1].request('init').threads).toBe(4)
    workers[1].reply({ id: workers[1].request('search').id, type: 'result', result: outcome })
    await expect(second).resolves.toBe(outcome)
  })

  test('annotate, predict and idXML go to the worker of the last search', async () => {
    await client.init(4)
    const search = client.search(searchRequest, () => {})
    await settle()
    const worker = workers.at(-1)!
    worker.reply({ id: worker.request('search').id, type: 'result', result: outcome })
    await search

    // the peaks are copied: the page keeps its stored spectra
    const mz = new Float32Array([100, 200, 300, 400])
    const intensity = new Float32Array([1, 2, 3, 4])
    const annotation = client.annotate(mz.subarray(1, 3), intensity.subarray(1, 3), 'PEPTIDEK', 2, null)
    await settle()
    const sent = worker.received.at(-1)!
    const request = worker.request('annotate')
    expect(Array.from(request.mz)).toEqual([200, 300])
    expect(request.mz.buffer).not.toBe(mz.buffer)
    expect(sent.transfer).toEqual([request.mz.buffer, request.intensity.buffer])
    expect(mz.length).toBe(4)
    worker.reply({ id: request.id, type: 'result', result: { matches: [], theoretical: [] } })
    await expect(annotation).resolves.toEqual({ matches: [], theoretical: [] })

    const prediction = client.predict('PEPTIDEK', 2, 30, 'QE')
    await settle()
    expect(worker.request('predict')).toMatchObject({ peptide: 'PEPTIDEK', charge: 2, nce: 30, instrument: 'QE' })
    worker.reply({ id: worker.request('predict').id, type: 'result', result: [] })
    await expect(prediction).resolves.toEqual([])

    const bytes = client.idXML()
    await settle()
    worker.reply({ id: worker.request('idXML').id, type: 'result', result: new Uint8Array([60]) })
    await expect(bytes).resolves.toEqual(new Uint8Array([60]))
    expect(workers).toHaveLength(1)
  })

  test('cancel terminates the worker, rejects the pending calls and starts a new one', async () => {
    await client.init(4)
    const search = client.search(searchRequest, () => {})
    await settle()
    const first = workers.at(-1)!
    first.request('search')
    client.cancel()
    const error = await search.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EngineError)
    expect((error as EngineError).kind).toBe('cancelled')
    expect((error as Error).message).toMatch(/cancelled/)
    expect(first.terminated).toBe(true)
    expect(workers).toHaveLength(2)
    expect(workers[1].request('init').threads).toBe(4)
  })

  test('cancel while the new worker loads rejects the search as cancelled', async () => {
    const slow: FakeWorker[] = []
    const client = new EngineClient({
      createWorker: () => {
        const w = new FakeWorker(slow.length === 0) // only the first one loads
        slow.push(w)
        return w
      },
      baseUrl: 'http://localhost/prose-web/',
    })
    await client.init(4)
    const first = client.search(searchRequest, () => {})
    await settle()
    slow[0].reply({ id: slow[0].request('search').id, type: 'result', result: outcome })
    await first

    const second = client.search(searchRequest, () => {}) // a new worker, still loading
    await settle()
    client.cancel()
    await expect(second).rejects.toThrow('The search was cancelled.')
    expect(slow).toHaveLength(3)
    expect(slow[1].terminated).toBe(true)
    expect(slow[1].received.map((r) => r.message.type)).toEqual(['init'])
  })

  test('a worker that fails to load is not restarted in a loop', async () => {
    const failing: FakeWorker[] = []
    const client = new EngineClient({
      createWorker: () => {
        const w = new FakeWorker(failing.length > 0) // the first one never loads
        failing.push(w)
        return w
      },
      baseUrl: 'http://localhost/prose-web/',
    })
    const init = client.init(4)
    failing[0].crash('RangeError: WebAssembly.Memory(): could not allocate memory')
    const error = await init.catch((e: unknown) => e)
    expect((error as EngineError).kind).toBe('failed')
    expect((error as Error).message).toMatch(/could not be loaded/)
    expect(failing).toHaveLength(1)

    // the next search starts a new worker
    const search = client.search(searchRequest, () => {})
    await settle()
    expect(failing).toHaveLength(2)
    failing[1].reply({ id: failing[1].request('search').id, type: 'result', result: outcome })
    await expect(search).resolves.toBe(outcome)
  })

  test('a search before init is refused', async () => {
    await expect(client.search(searchRequest, () => {})).rejects.toThrow(/init/)
    expect(workers).toHaveLength(0)
  })
})
