import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SearchRequest } from '../engine/client'

// What the New search form amounts to and what startSearch() sends to the engine (the session and the
// router are replaced): the module of the search, its footer line and advice.

const sent: SearchRequest[] = []
/** The step before the search of the last start (counting the proteins), if any. */
const preludes: string[] = []
vi.mock('./session.svelte', () => ({
  searchRun: { status: 'idle' },
  // as the session runs it: the step before the search first, then the request it gives
  runSearch: vi.fn(
    async (request: SearchRequest, _meta: unknown, _check: unknown, prelude?: { label: string; run: (r: SearchRequest) => Promise<SearchRequest> }) => {
      if (prelude) {
        preludes.push(prelude.label)
        request = await prelude.run(request)
      }
      sent.push(request)
      return null
    },
  ),
}))
vi.mock('../route.svelte', () => ({ navigate: vi.fn() }))

const { searchForm: form } = await import('./form.svelte')
const { searchPlan, startSearch } = await import('./plan.svelte')

/** The form with one mzML file, a database of `proteins` (null: still being counted) and these parameters. */
function fill(proteins: number | null, parameters: Record<string, unknown>, mzmlBytes = 7) {
  form.files = []
  form.addFiles([new File([new Uint8Array(mzmlBytes)], 'run.mzML')])
  // (human-length proteins: 555 residues each)
  form.database = { file: new File(['>p\nPEPTIDEK\n'], 'db.fasta'), proteins, residues: proteins === null ? null : proteins * 555, error: null }
  form.contaminants = false
  form.overrides = { 'FDR:PSM': 0.01, 'FDR:protein': 0.01, ...parameters }
}

async function request(): Promise<SearchRequest> {
  sent.length = 0
  preludes.length = 0
  await startSearch()
  expect(sent).toHaveLength(1)
  return sent[0]
}

const semi = { 'peptide:enzyme_specificity': 'semi' }

describe('startSearch', () => {
  beforeEach(() => {
    sent.length = 0
    searchPlan.memory64 = true
    searchPlan.forceWasm64 = false
  })

  test('a semi- or non-specific search has slow steps (the watchdog waits longer), chunked or not', async () => {
    for (const [proteins, parameters] of [
      [20652, { ...semi, 'database:chunk_size': 2000 }],
      [null, { ...semi, 'database:chunk_size': 2000 }],
      [1000, semi],
      [1000, { enzyme: 'unspecific cleavage' }],
    ] as const) {
      fill(proteins, parameters)
      expect((await request()).slowSteps, JSON.stringify([proteins, parameters])).toBe(true)
    }
    fill(20652, { 'database:chunk_size': 2000 })
    expect((await request()).slowSteps).toBe(false)
  })

  test('the threads are not capped for chunked searches any more', () => {
    fill(20652, { ...semi, 'database:chunk_size': 2000 })
    expect(searchPlan.threads.capped).toBe(false)
  })
})

describe('the module of a search', () => {
  beforeEach(() => {
    searchPlan.memory64 = true
    searchPlan.forceWasm64 = false
  })

  test('wasm32 while the estimate is at most 3 GB', async () => {
    fill(20652, {})
    expect(searchPlan.engine).toBe('wasm32')
    expect(searchPlan.estimate).toMatchObject({ variant: 'wasm32', level: 'ok' })
    expect(searchPlan.line).toMatch(/· estimated memory 0\.8 GB of 4 GB$/)
    expect(searchPlan.lineTitle).toBe(searchPlan.line)
    expect(searchPlan.advice).toBeNull()
    expect((await request()).engine).toBe('wasm32')
  })

  test('wasm64 above 3 GB, estimated with its own constants, said in the footer', async () => {
    // human semi-tryptic, not chunked: 6.4 GB in wasm32
    fill(20652, semi)
    expect(searchPlan.estimate32?.bytes).toBeGreaterThan(6 * 2 ** 30)
    expect(searchPlan.engine).toBe('wasm64')
    expect(searchPlan.estimate).toMatchObject({ variant: 'wasm64', level: 'ok' })
    expect(searchPlan.line).toBe('1 file · 20,652 proteins + decoys · estimated memory 8.1 GB · 64-bit engine (up to 16 GB)')
    // the number that chose it, in the line's title
    expect(searchPlan.lineTitle).toBe(
      '1 file · 20,652 proteins + decoys · estimated memory 8.1 GB · 64-bit engine (up to 16 GB)\n' +
        'Estimated 6.40 GB in the standard 32-bit engine, above 3 GB: the search runs in the 64-bit engine.',
    )
    expect(searchPlan.advice).toBeNull()
    expect(searchPlan.canStart).toBe(true)
    expect((await request()).engine).toBe('wasm64')

    // in chunks of 2000 it fits wasm32
    fill(20652, { ...semi, 'database:chunk_size': 2000 })
    expect(searchPlan.engine).toBe('wasm32')
  })

  test('the default modifications: Acetyl (Protein N-term) does not enlarge the index', () => {
    fill(20652, { ...semi, 'modifications:variable': ['Oxidation (M)', 'Acetyl (Protein N-term)'] })
    const withAcetyl = searchPlan.estimate!.bytes
    fill(20652, { ...semi, 'modifications:variable': ['Oxidation (M)'] })
    expect(searchPlan.estimate!.bytes).toBe(withAcetyl)
    expect(searchPlan.estimate?.level).toBe('ok')
  })

  test('a search started while the proteins are counted waits for the count, and chooses its engine on it', async () => {
    fill(1000, semi)
    // a FASTA of 20,652 proteins whose count is still running when Start is pressed
    form.setDatabase(new File(['>p\nPEPTIDEK\n'.repeat(20652)], 'human.fasta'))
    expect(form.database?.proteins).toBeNull()
    // the footer has no estimate yet (it would be one of 0 proteins); Start stays enabled
    expect(searchPlan.line).toBe('1 file · counting proteins…')
    expect(searchPlan.canStart).toBe(true)
    expect(searchPlan.engine).toBe('wasm32')
    const r = await request()
    expect(preludes).toEqual(['Counting proteins...'])
    expect(form.database?.proteins).toBe(20652)
    // 6.4 GB in wasm32: the 64-bit engine, as the footer now says
    expect(r.engine).toBe('wasm64')
    expect(searchPlan.engine).toBe('wasm64')
    // counted already: no step before the search
    expect((await request()).engine).toBe('wasm64')
    expect(preludes).toEqual([])
    // a small database counted while starting stays in wasm32
    form.setDatabase(new File(['>p\nPEPTIDEK\n'.repeat(100)], 'small.fasta'))
    expect((await request()).engine).toBe('wasm32')
    expect(preludes).toEqual(['Counting proteins...'])
  })

  test('a database that cannot be read: the footer says so, and Start waits for another', async () => {
    fill(1000, {})
    const broken = new File(['>p\nK\n'], 'broken.fasta')
    // (as a file removed or changed on disk since it was chosen)
    // (the browser's message ends with a period, which the app's sentence does not repeat)
    Object.defineProperty(broken, 'slice', { value: () => ({ arrayBuffer: () => Promise.reject(new Error('The requested file could not be read.')) }) })
    form.setDatabase(broken)
    await vi.waitFor(() => expect(form.database?.error).toBe('The requested file could not be read'))
    expect(form.database?.proteins).toBeNull()
    expect(searchPlan.line).toBe('1 file · the database cannot be read')
    expect(searchPlan.problem).toBe('broken.fasta cannot be read (The requested file could not be read). Choose it again, or another FASTA file.')
    expect(searchPlan.canStart).toBe(false)
    // another database: it can start again
    form.setDatabase(new File(['>p\nPEPTIDEK\n'], 'good.fasta'))
    expect(form.database?.error).toBeNull()
    await vi.waitFor(() => expect(form.database?.proteins).toBe(1))
    expect(searchPlan.canStart).toBe(true)
  })

  test('the count held at Start decides, even when the database changes while the search waits for it', async () => {
    fill(1000, semi)
    const human = new File(['>p\nPEPTIDEK\n'.repeat(20652)], 'human.fasta')
    form.setDatabase(human)
    sent.length = 0
    const started = startSearch()
    // the user picks a small database right after Start
    form.setDatabase(new File(['>p\nPEPTIDEK\n'], 'small.fasta'))
    await started
    expect(sent).toHaveLength(1)
    expect(sent[0].database).toBe(human)
    expect(sent[0].engine).toBe('wasm64')
  })

  test('a search already in chunks, or a non-specific one, is pointed to smaller chunks', () => {
    // semi-tryptic in chunks of 9000 (14.8 GB in wasm64): smaller chunks, not "e.g. 2000"
    fill(40000, { ...semi, 'database:chunk_size': 9000, 'modifications:variable': ['Oxidation (M)', 'Deamidated (N)'] })
    expect(searchPlan.estimate?.variant).toBe('wasm64')
    expect(searchPlan.advice?.text).toMatch(/: use smaller chunks \(database:chunk_size under All parameters\)/)
    expect(searchPlan.advice?.text).not.toMatch(/e\.g\. 2000/)
    // non-specific, not chunked: chunks of a few hundred proteins
    fill(20652, { 'peptide:enzyme_specificity': 'none' })
    expect(searchPlan.estimate?.level).not.toBe('ok')
    expect(searchPlan.advice?.text).toMatch(/set database:chunk_size \(e\.g\. 250\) under All parameters/)
  })

  test('wasm64 warns above 14 GB and suggests database:chunk_size', () => {
    // 0.4 + 0.025 × 40 × 15 = 15.4 GB
    fill(40000, semi)
    expect(searchPlan.estimate).toMatchObject({ variant: 'wasm64', level: 'warn' })
    expect(searchPlan.advice).toEqual({
      text: 'Close to the 16 GB limit of the 64-bit engine: set database:chunk_size (e.g. 2000) under All parameters.',
      over: false,
    })
    fill(40000, { ...semi, 'modifications:variable': ['Oxidation (M)', 'Deamidated (N)'] })
    expect(searchPlan.estimate?.level).toBe('over')
    expect(searchPlan.advice?.text).toMatch(/^More than the 16 GB the 64-bit engine can use: set database:chunk_size/)
    expect(searchPlan.canStart).toBe(true)
  })

  test('without Memory64 a search stays in wasm32: between 3 and 4 GB a warning, above 4 GB why it cannot run', async () => {
    searchPlan.memory64 = false
    // 0.2 + 0.03 × 10 × 10 = 3.2 GB
    fill(10000, semi)
    expect(searchPlan.engine).toBe('wasm32')
    expect(searchPlan.advice?.text).toBe('Close to the 4 GB limit: consider database:chunk_size (e.g. 2000) under All parameters.')

    fill(20652, semi)
    expect(searchPlan.engine).toBe('wasm32')
    expect(searchPlan.estimate).toMatchObject({ variant: 'wasm32', level: 'over' })
    expect(searchPlan.line).toMatch(/· estimated memory 6\.4 GB of 4 GB$/)
    expect(searchPlan.advice).toEqual({
      text:
        'This browser cannot run the 64-bit engine, which a search above 4 GB needs: use a Chromium-based browser ' +
        '(Chrome, Edge) or Firefox, smaller chunks (database:chunk_size under All parameters) or fewer files at once.',
      over: true,
    })
    // Start stays enabled (C-R15)
    expect(searchPlan.canStart).toBe(true)
    expect((await request()).engine).toBe('wasm32')
  })

  test('a file too large for wasm32 runs in wasm64; without Memory64 the footer says why not', () => {
    const size = 2080374784 + 1
    // (the File's size is what counts: a sparse Blob would do, but the form reads File.size)
    const file = new File([], 'huge.mzML')
    Object.defineProperty(file, 'size', { value: size })
    fill(1000, {})
    form.files = []
    form.addFiles([file])
    expect(searchPlan.engine).toBe('wasm64')
    expect(searchPlan.estimate?.fileTooLarge).toBe(false)
    searchPlan.memory64 = false
    expect(searchPlan.engine).toBe('wasm32')
    expect(searchPlan.advice?.text).toMatch(/^huge\.mzML is too large \(1\.94 GiB\); a file can be at most 1\.93 GiB\. This browser cannot run the 64-bit engine/)
  })

  test('?debug=wasm64 forces wasm64, where the browser has it', async () => {
    fill(1000, {})
    searchPlan.forceWasm64 = true
    expect(searchPlan.engine).toBe('wasm64')
    expect(searchPlan.line).toMatch(/· 64-bit engine \(up to 16 GB\)$/)
    expect(searchPlan.lineTitle).toMatch(/\nEstimated 0\.\d GB in the standard 32-bit engine; \?debug=wasm64 runs it in the 64-bit engine\.$/)
    expect((await request()).engine).toBe('wasm64')
    searchPlan.memory64 = false
    expect(searchPlan.engine).toBe('wasm32')
  })
})
