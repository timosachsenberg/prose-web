import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HistoryUnavailableError } from './backend'
import { bytesEqual, smallRecord } from './fixtures'
import {
  deleteSearch,
  HISTORY_LOCK,
  HistoryFullError,
  listSearches,
  loadSearch,
  ORPHAN_AGE_MS,
  pruneOrphans,
  renameSearch,
  saveSearch,
  useBackend,
} from './history'
import { memoryBackend, type MemoryBackend } from './memory-backend'
import { packRecord, ProjectError, type SearchRecord } from './record'

let backend: MemoryBackend

beforeEach(() => {
  backend = memoryBackend()
  useBackend(backend)
})
afterEach(() => useBackend(null))

/** `smallRecord()` as another search. */
function another(id: string, createdAt: string, name = id): SearchRecord {
  return { ...smallRecord(), id, createdAt, name }
}

function expectSameArrays(actual: SearchRecord, expected: SearchRecord) {
  const a = packRecord(actual).arrays
  const e = packRecord(expected).arrays
  expect(a.map((x) => x.name)).toEqual(e.map((x) => x.name))
  a.forEach((x, i) => expect(bytesEqual(x.bytes, e[i].bytes), x.name).toBe(true))
}

describe('History storage', () => {
  it('saves a search, lists it and loads it back with every array', async () => {
    const record = smallRecord()
    await saveSearch(record)
    const list = await listSearches()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: record.id, name: record.name, createdAt: record.createdAt, files: ['ctrl_a.mzML', 'egf_a.mzML'] })
    expect(list[0].psms).toBeGreaterThan(0)
    expect(list[0].bytes).toBe(packRecord(record).arrays.reduce((n, a) => n + a.bytes.length, 0))
    expect(list[0].summary.files).toHaveLength(2)
    const back = await loadSearch(record.id)
    expectSameArrays(back, record)
    expect(back.summary).toEqual(record.summary)
    expect(back.design).toEqual(record.design)
    expect(back.settings).toEqual(record.settings)
    expect(back.name).toBe(record.name)
  })

  it('keeps the metadata apart from the arrays: the manifest has none of them', async () => {
    await saveSearch(smallRecord())
    const meta = [...backend.meta.values()][0]
    expect(JSON.stringify(meta.manifest)).not.toContain('0.004')
    expect(backend.blobs.get(smallRecord().id)!.length).toBe(meta.bytes)
  })

  it('lists the latest search first', async () => {
    await saveSearch(another('a', '2026-10-17T08:00:00Z'))
    await saveSearch(another('c', '2026-10-19T08:00:00Z'))
    await saveSearch(another('b', '2026-10-18T08:00:00Z'))
    expect((await listSearches()).map((e) => e.id)).toEqual(['c', 'b', 'a'])
  })

  it('renames a search without touching its results', async () => {
    const record = smallRecord()
    await saveSearch(record)
    await renameSearch(record.id, 'EGF time course')
    expect((await listSearches())[0].name).toBe('EGF time course')
    const back = await loadSearch(record.id)
    expect(back.name).toBe('EGF time course')
    expectSameArrays(back, record)
  })

  it('deletes the metadata and the arrays', async () => {
    await saveSearch(another('a', '2026-10-17T08:00:00Z'))
    await saveSearch(another('b', '2026-10-18T08:00:00Z'))
    await deleteSearch('a')
    expect((await listSearches()).map((e) => e.id)).toEqual(['b'])
    expect([...backend.blobs.keys()]).toEqual(['b'])
    await expect(loadSearch('a')).rejects.toThrow(/no longer in History/)
  })

  it('replaces a search saved again under the same id', async () => {
    await saveSearch(another('a', '2026-10-17T08:00:00Z', 'first'))
    await saveSearch(another('a', '2026-10-17T08:00:00Z', 'second'))
    const list = await listSearches()
    expect(list.map((e) => e.name)).toEqual(['second'])
  })

  it('names a stored search whose arrays are gone', async () => {
    const record = smallRecord()
    await saveSearch(record)
    backend.blobs.delete(record.id)
    await expect(loadSearch(record.id)).rejects.toThrow(/missing or incomplete/)
    backend.blobs.set(record.id, new Uint8Array(10))
    await expect(loadSearch(record.id)).rejects.toThrow(ProjectError)
  })

  it('lists only what it wrote, and refuses a stored search of a newer version with a message', async () => {
    const record = smallRecord()
    await saveSearch(record)
    backend.meta.set('foreign', { id: 'foreign', note: 'not a search' } as never)
    expect((await listSearches()).map((e) => e.id)).toEqual([record.id])
    const meta = backend.meta.get(record.id)!
    backend.meta.set(record.id, { ...meta, manifest: { ...meta.manifest, schema: 2 as 1 } })
    await expect(loadSearch(record.id)).rejects.toThrow(/^This search was saved by a newer version of ProSE \(schema 2\)/)
  })

  it('removes the arrays that no search lists', async () => {
    await saveSearch(another('a', '2026-10-17T08:00:00Z'))
    backend.blobs.set('cut-short', new Uint8Array(100))
    expect(await pruneOrphans()).toBe(1)
    expect([...backend.blobs.keys()]).toEqual(['a'])
    expect(await pruneOrphans()).toBe(0)
  })

  it("removes the browser's leftovers of a cut-short write, and only files that are a few minutes old", async () => {
    const now = Date.now()
    backend.leftovers.set('k5x2j9ab.bin.crswap', now - ORPHAN_AGE_MS - 1000)
    backend.leftovers.set('fresh.bin.crswap', now - 1000)
    backend.blobs.set('fresh-orphan', new Uint8Array(10))
    backend.modified.set('fresh-orphan', now - 1000)
    expect(await pruneOrphans()).toBe(1)
    expect([...backend.leftovers.keys()]).toEqual(['fresh.bin.crswap'])
    expect([...backend.blobs.keys()]).toEqual(['fresh-orphan'])
  })
})

describe('saves, deletes and the cleanup take turns', () => {
  it('a cleanup never removes the file of a save that finishes meanwhile (in another tab)', async () => {
    backend.clock = () => 0 // every file looks old: only taking turns protects the new one
    const record = smallRecord()
    let saving: Promise<void> | undefined
    backend.afterListMeta = async () => {
      // the cleanup has read the list; another tab saves now
      saving ??= saveSearch(record)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    await pruneOrphans()
    backend.afterListMeta = async () => {}
    await saving
    expect((await listSearches()).map((e) => e.id)).toEqual([record.id])
    expectSameArrays(await loadSearch(record.id), record)
  })

  it('take the Web Lock "prose-history" where the browser has one', async () => {
    const names: string[] = []
    vi.stubGlobal('navigator', {
      locks: {
        request: async (name: string, work: () => Promise<unknown>) => {
          names.push(name)
          return work()
        },
      },
    })
    try {
      await saveSearch(another('a', '2026-10-17T08:00:00Z'))
      await renameSearch('a', 'renamed')
      await pruneOrphans()
      await deleteSearch('a')
      expect(names).toEqual([HISTORY_LOCK, HISTORY_LOCK, HISTORY_LOCK, HISTORY_LOCK])
      expect(HISTORY_LOCK).toBe('prose-history')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('a save that cannot happen', () => {
  it('does not write when the record would exceed the free quota, and says how much it needs', async () => {
    await saveSearch(another('a', '2026-10-17T08:00:00Z'))
    backend.quota = { usage: 900, quota: 1000 }
    const error = await saveSearch(another('b', '2026-10-18T08:00:00Z')).catch((e) => e)
    expect(error).toBeInstanceOf(HistoryFullError)
    expect(error.message).toMatch(/^not saved to History: needs \d+(\.\d)? MB, 100 B free$/)
    expect(error.free).toBe(100)
    expect((await listSearches()).map((e) => e.id)).toEqual(['a'])
    expect([...backend.blobs.keys()]).toEqual(['a'])
  })

  it('saves when the browser gives no estimate', async () => {
    backend.quota = null
    await saveSearch(smallRecord())
    expect(await listSearches()).toHaveLength(1)
  })

  it('leaves nothing behind when the write fails (the browser says the quota is exceeded)', async () => {
    backend.beforeWrite = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    await expect(saveSearch(smallRecord())).rejects.toThrow('full')
    expect(await listSearches()).toEqual([])
    expect(backend.blobs.size).toBe(0)
  })

  it('removes the arrays when the metadata cannot be written', async () => {
    backend.putMeta = async () => {
      throw new Error('IndexedDB is full')
    }
    await expect(saveSearch(smallRecord())).rejects.toThrow('IndexedDB is full')
    expect(backend.blobs.size).toBe(0)
  })

  it('keeps the search saved before under the same id when a save over it fails', async () => {
    const first = another('a', '2026-10-17T08:00:00Z', 'first')
    await saveSearch(first)
    backend.beforeWrite = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    await expect(saveSearch(another('a', '2026-10-17T08:00:00Z', 'second'))).rejects.toThrow('full')
    backend.beforeWrite = () => {}
    const putMeta = backend.putMeta
    backend.putMeta = async () => {
      throw new Error('IndexedDB is full')
    }
    await expect(saveSearch(another('a', '2026-10-17T08:00:00Z', 'third'))).rejects.toThrow('IndexedDB is full')
    backend.putMeta = putMeta
    expect((await listSearches()).map((e) => e.name)).toEqual(['first'])
    expectSameArrays(await loadSearch('a'), first)
    expect([...backend.blobs.keys()]).toEqual(['a'])
  })

  it('writes a save over a search to a new file, and removes the old one after', async () => {
    await saveSearch(another('a', '2026-10-17T08:00:00Z', 'first'))
    await saveSearch(another('a', '2026-10-17T08:00:00Z', 'second'))
    const [key] = [...backend.blobs.keys()]
    expect(key).toMatch(/^a~/)
    expect((await loadSearch('a')).name).toBe('second')
    await deleteSearch('a')
    expect(backend.blobs.size).toBe(0)
  })

  it('lists a search only when both parts are written', async () => {
    let listedDuringWrite: number | null = null
    backend.beforeWrite = () => void listSearches().then((l) => (listedDuringWrite = l.length))
    await saveSearch(smallRecord())
    await Promise.resolve()
    expect(listedDuringWrite).toBe(0)
    expect(await listSearches()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------------------------------
// The state of the page, with the session: which searches are saved

const fakeEngine = vi.hoisted(() => ({
  search: vi.fn(),
  cancel: vi.fn(),
  info: { version: '3.6.0-test' },
}))

vi.mock('../engine/app-engine.svelte', () => ({
  engineState: { get info() { return fakeEngine.info } },
  startEngine: async () => fakeEngine.info,
  engineClient: () => ({
    search: fakeEngine.search,
    cancel: fakeEngine.cancel,
    threadsFor: () => ({ threads: 1, capped: false }),
    hasSearchResult: false,
  }),
}))

const store = new Map<string, string>()

// the project file a test saves: its name and its bytes
const downloads = vi.hoisted(() => [] as { name: string; data: Blob }[])
vi.mock('../download', () => ({ download: (name: string, data: Blob) => void downloads.push({ name, data }) }))

describe('automatic saving', () => {
  let page: {
    session: typeof import('../search/session.svelte')
    state: typeof import('./history.svelte')
  }

  beforeEach(async () => {
    vi.resetModules()
    store.clear()
    vi.stubGlobal('location', { hash: '', search: '' })
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
    fakeEngine.search.mockReset()
    page = { session: await import('../search/session.svelte'), state: await import('./history.svelte') }
    // (the history module the page state uses is a new instance: it needs the backend too)
    const history = await import('./history')
    history.useBackend(backend)
    page.state.initHistory()
    await Promise.resolve()
  })
  afterEach(() => vi.unstubAllGlobals())

  const request = () => ({
    files: [{ id: 'f1', file: new File([], 'ctrl_a.mzML') }, { id: 'f2', file: new File([], 'egf_a.mzML') }],
    database: new File([], 'human.fasta'),
    contaminants: true,
    parameters: {},
    rescore: true,
    peptdeep: false,
  })

  const meta = () => {
    const r = smallRecord()
    return {
      design: r.design,
      psmFdr: 0.01,
      proteinFdr: 0.05,
      settings: { parameters: { 'FDR:protein': 0.05 }, fixedMods: ['Carbamidomethyl (C)'], database: 'human.fasta', rescore: true, peptdeep: false, contaminants: true },
    }
  }

  const outcome = () => {
    const r = smallRecord()
    return { summary: r.summary, tables: r.tables, spectra: r.spectra, seconds: 3 }
  }

  const list = async () => {
    const history = await import('./history')
    return (await history.listSearches()).map((e) => e.id)
  }

  it('saves a search that completed', async () => {
    fakeEngine.search.mockResolvedValue(outcome())
    const id = await page.session.runSearch(request(), meta())
    expect(id).not.toBeNull()
    await vi.waitFor(() => expect(page.state.history.save?.state).toBe('saved'))
    expect(await list()).toEqual([id])
    expect(page.state.history.entries.map((e) => e.id)).toEqual([id])
    const record = await (await import('./history')).loadSearch(id!)
    expect(record).toMatchObject({ id, name: 'prose-results', moduleVersion: '3.6.0-test', seconds: 3, psmFdr: 0.01, proteinFdr: 0.05 })
    expect(record.settings.fixedMods).toEqual(['Carbamidomethyl (C)'])
  })

  it('does not save a search that failed', async () => {
    fakeEngine.search.mockRejectedValue(new Error('InvalidValue: the database has no proteins'))
    expect(await page.session.runSearch(request(), meta())).toBeNull()
    expect(page.session.searchRun.status).toBe('failed')
    await new Promise((r) => setTimeout(r, 20))
    expect(await list()).toEqual([])
    expect(page.state.history.save).toBeNull()
    expect(backend.blobs.size).toBe(0)
  })

  it('does not save a search that was cancelled', async () => {
    const { EngineError } = await import('../engine/client')
    fakeEngine.search.mockRejectedValue(new EngineError('cancelled', 'The search was cancelled.'))
    expect(await page.session.runSearch(request(), meta())).toBeNull()
    expect(page.session.searchRun.status).toBe('cancelled')
    await new Promise((r) => setTimeout(r, 20))
    expect(await list()).toEqual([])
    expect(page.state.history.save).toBeNull()
  })

  it('leaves History as it was when a rejected search follows a completed one', async () => {
    fakeEngine.search.mockResolvedValueOnce(outcome())
    const first = await page.session.runSearch(request(), meta())
    await vi.waitFor(() => expect(page.state.history.save?.state).toBe('saved'))
    fakeEngine.search.mockRejectedValueOnce(new Error('out of memory'))
    await page.session.runSearch(request(), meta())
    await new Promise((r) => setTimeout(r, 20))
    expect(await list()).toEqual([first])
  })

  it('reports a save that does not fit, and the results stay open', async () => {
    backend.quota = { usage: 0, quota: 1000 }
    fakeEngine.search.mockResolvedValue(outcome())
    const id = await page.session.runSearch(request(), meta())
    await vi.waitFor(() => expect(page.state.history.save?.state).toBe('unsaved'))
    const save = page.state.history.save
    expect(save).toMatchObject({ id, state: 'unsaved' })
    expect(save!.state === 'unsaved' && save!.message).toMatch(/^Not saved to History: needs \d+(\.\d)? MB, 1000 B free\./)
    expect(page.session.openResult.current?.id).toBe(id)
    expect(page.session.searchRun.status).toBe('done')
    expect(await list()).toEqual([])
    expect(backend.persistAsked).toBe(0)
  })

  it('reports a write that fails, and the next search can still be saved', async () => {
    backend.beforeWrite = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    fakeEngine.search.mockResolvedValue(outcome())
    await page.session.runSearch(request(), meta())
    await vi.waitFor(() => expect(page.state.history.save?.state).toBe('unsaved'))
    expect((page.state.history.save as { message: string }).message).toMatch(/the browser's storage is full/)
    backend.beforeWrite = () => {}
    const id = await page.session.runSearch(request(), meta())
    await vi.waitFor(() => expect(page.state.history.save).toMatchObject({ id, state: 'saved' }))
    expect(await list()).toEqual([id])
  })

  it('reports a browser that cannot keep History', async () => {
    const history = await import('./history')
    history.useBackend({
      ...backend,
      estimate: async () => {
        throw new HistoryUnavailableError('there is no origin-private file system (OPFS).')
      },
    })
    fakeEngine.search.mockResolvedValue(outcome())
    await page.session.runSearch(request(), meta())
    await vi.waitFor(() => expect(page.state.history.save?.state).toBe('unsaved'))
    expect((page.state.history.save as { message: string }).message).toMatch(/History is not available in this browser/)
  })

  it('asks the browser to keep History once, after the first search was saved', async () => {
    fakeEngine.search.mockResolvedValue(outcome())
    await page.session.runSearch(request(), meta())
    await vi.waitFor(() => expect(page.state.history.persistence).toBe('granted'))
    await page.session.runSearch(request(), meta())
    await vi.waitFor(() => expect(page.state.history.entries).toHaveLength(2))
    expect(backend.persistAsked).toBe(1)
    expect(store.get('prose-persistence-asked')).toBe('1')
  })

  it('says when the browser did not promise', async () => {
    backend.persistAnswer = 'denied'
    fakeEngine.search.mockResolvedValue(outcome())
    await page.session.runSearch(request(), meta())
    await vi.waitFor(() => expect(page.state.history.persistence).toBe('denied'))
  })

  it('opens a stored search under its own id, as a result without an engine', async () => {
    fakeEngine.search.mockResolvedValue(outcome())
    const id = (await page.session.runSearch(request(), meta()))!
    await vi.waitFor(() => expect(page.state.history.save?.state).toBe('saved'))
    await page.state.rename(id, '  EGF time course  ')
    page.session.openStoredResult(
      { design: meta().design, psmFdr: 1, proteinFdr: 1, outcome: outcome(), settings: meta().settings },
      { id: 'other', createdAt: '2026-01-01T00:00:00Z' },
    )
    expect(page.session.openResult.current?.id).toBe('other')
    await page.state.openFromHistory(id)
    const open = page.session.openResult.current!
    expect(open).toMatchObject({ id, engineResult: false, psmFdr: 0.01, proteinFdr: 0.05 })
    expect(open.stored).toMatchObject({ name: 'EGF time course', moduleVersion: '3.6.0-test' })
    expect(open.outcome.seconds).toBe(3)
    expect(open.outcome.spectra.mz.length).toBeGreaterThan(0)
    expect(open.settings.database).toBe('human.fasta')
    expect(open.createdAt).toBe(page.state.history.entries[0].createdAt)
  })

  it('saves the project of an open search under the name it was renamed to in History', async () => {
    fakeEngine.search.mockResolvedValue(outcome())
    const id = (await page.session.runSearch(request(), meta()))!
    await vi.waitFor(() => expect(page.state.history.save?.state).toBe('saved'))
    downloads.length = 0
    await page.state.saveProjectFile(page.session.openResult.current!)
    expect(downloads.map((d) => d.name)).toEqual(['prose-results.prose'])
    await page.state.rename(id, 'EGF time course')
    expect(page.session.openResult.current?.id).toBe(id)
    await page.state.saveProjectFile(page.session.openResult.current!)
    expect(downloads[1].name).toBe('EGF time course.prose')
    const { readProject } = await import('./project')
    expect((await readProject(downloads[1].data)).name).toBe('EGF time course')
  })

  it('tells the other tabs of a change, which read the list again', async () => {
    const other = new BroadcastChannel('prose-history')
    const heard: unknown[] = []
    other.onmessage = (e) => heard.push(e.data)
    try {
      fakeEngine.search.mockResolvedValue(outcome())
      const id = (await page.session.runSearch(request(), meta()))!
      await vi.waitFor(() => expect(heard).toEqual(['changed']))
      await page.state.rename(id, 'renamed')
      await page.state.removeFromHistory(id)
      await vi.waitFor(() => expect(heard).toEqual(['changed', 'changed', 'changed']))

      // another tab saved a search: this one lists it
      const { saveSearch } = await import('./history')
      await saveSearch(another('from-another-tab', '2026-10-19T12:00:00Z'))
      other.postMessage('changed')
      await vi.waitFor(() => expect(page.state.history.entries.map((e) => e.id)).toEqual(['from-another-tab']))
    } finally {
      other.close()
    }
  })

  it('removes a search from the list and the storage', async () => {
    fakeEngine.search.mockResolvedValue(outcome())
    const id = (await page.session.runSearch(request(), meta()))!
    await vi.waitFor(() => expect(page.state.history.entries).toHaveLength(1))
    await page.state.removeFromHistory(id)
    expect(page.state.history.entries).toEqual([])
    expect(backend.blobs.size).toBe(0)
  })
})
