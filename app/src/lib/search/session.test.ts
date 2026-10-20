import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchRequest } from '../engine/client'

// The run of a search in the session, against a fake engine: the step before the search (counting the
// proteins, which decides the engine) and the first load of the 64-bit engine, as the progress shows them.

const fake = vi.hoisted(() => ({
  search: vi.fn(),
  cancel: vi.fn(),
  loaded: new Set<string>(['wasm32']),
}))

vi.mock('../engine/app-engine.svelte', () => ({
  engineState: { info: { version: '3.7.0-test' } },
  startEngine: async () => ({ version: '3.7.0-test', parameters: [] }),
  checkModels: async () => {},
  engineClient: () => ({
    search: fake.search,
    cancel: fake.cancel,
    threadsFor: () => ({ threads: 16, capped: false }),
    hasLoaded: (variant: string) => fake.loaded.has(variant),
  }),
}))

const { cancelSearch, runSearch, searchProgress, searchRun } = await import('./session.svelte')

const request: SearchRequest = {
  files: [{ id: 'f1', file: new File([], 'run.mzML') }],
  database: new File([], 'human.fasta'),
  contaminants: true,
  parameters: {},
  rescore: true,
  peptdeep: false,
  engine: 'wasm32',
}
const meta = {
  design: { rows: [], samples: [], conditions: [] } as never,
  psmFdr: 0.01,
  proteinFdr: 0.01,
  settings: { parameters: {}, fixedMods: [], database: 'human.fasta', rescore: true, peptdeep: false, contaminants: true },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('runSearch', () => {
  beforeEach(() => {
    fake.search.mockReset()
    fake.loaded = new Set(['wasm32'])
    searchRun.status = 'idle'
  })

  it('shows the step before the search (counting the proteins), then searches the request it gives', async () => {
    const counted = deferred<void>()
    const search = deferred<never>()
    fake.search.mockReturnValue(search.promise)
    const run = runSearch(request, meta, undefined, {
      label: 'Counting proteins...',
      run: async (r) => (await counted.promise, { ...r, engine: 'wasm64' }),
    })
    await settle()
    expect(searchRun.status).toBe('running')
    expect(searchProgress.label).toBe('Counting proteins…')
    expect(searchProgress.engine).toBeNull()
    expect(fake.search).not.toHaveBeenCalled()

    counted.resolve()
    await settle()
    // the engine chosen on the count: its first load downloads it, and the step says so
    expect(fake.search).toHaveBeenCalledTimes(1)
    expect(fake.search.mock.calls[0][0].engine).toBe('wasm64')
    expect(searchProgress.label).toBe('Loading the 64-bit engine…')
    expect(searchProgress.engine).toBe('64-bit')
    cancelSearch()
    expect(fake.cancel).toHaveBeenCalled()
    search.resolve(undefined as never)
    await run
  })

  it('a cancel during the step ends the run at once; the search never starts', async () => {
    const counted = deferred<void>()
    const run = runSearch(request, meta, undefined, { label: 'Counting proteins...', run: async (r) => (await counted.promise, r) })
    await settle()
    cancelSearch()
    expect(searchRun.status).toBe('cancelled')
    counted.resolve()
    expect(await run).toBeNull()
    expect(fake.search).not.toHaveBeenCalled()
  })

  it('once the 64-bit engine has loaded, its search reads the files at once', async () => {
    fake.loaded.add('wasm64')
    const search = deferred<never>()
    fake.search.mockReturnValue(search.promise)
    const run = runSearch({ ...request, engine: 'wasm64' }, meta)
    await settle()
    expect(searchProgress.label).toBe('Reading the files…')
    expect(searchProgress.engine).toBe('64-bit')
    cancelSearch()
    search.resolve(undefined as never)
    await run
  })
})
