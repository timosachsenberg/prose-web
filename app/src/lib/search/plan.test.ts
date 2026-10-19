import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SearchRequest } from '../engine/client'

// What startSearch() sends to the engine for the form (the session and the router are replaced).

const sent: SearchRequest[] = []
vi.mock('./session.svelte', () => ({
  searchRun: { status: 'idle' },
  runSearch: vi.fn(async (request: SearchRequest) => {
    sent.push(request)
    return null
  }),
}))
vi.mock('../route.svelte', () => ({ navigate: vi.fn() }))

const { searchForm: form } = await import('./form.svelte')
const { searchPlan, startSearch } = await import('./plan.svelte')

/** The form with one mzML file, a database of `proteins` (null: still being counted) and these parameters. */
function fill(proteins: number | null, parameters: Record<string, unknown>) {
  form.files = []
  form.addFiles([new File(['<mzML/>'], 'run.mzML')])
  form.database = { file: new File(['>p\nPEPTIDEK\n'], 'db.fasta'), proteins }
  form.contaminants = false
  form.overrides = { 'FDR:PSM': 0.01, 'FDR:protein': 0.01, ...parameters }
}

async function request(): Promise<SearchRequest> {
  sent.length = 0
  await startSearch()
  expect(sent).toHaveLength(1)
  return sent[0]
}

describe('startSearch', () => {
  beforeEach(() => {
    sent.length = 0
  })

  test('a chunked semi-specific search asks for fewer threads, also while the proteins are counted', async () => {
    const chunkedSemi = { 'database:chunk_size': 2000, 'peptide:enzyme_specificity': 'semi' }
    fill(20652, chunkedSemi)
    expect(searchPlan.canStart).toBe(true)
    expect((await request()).uncertainMemory).toBe(true)

    // Start before the FASTA is counted: a chunk size counts as chunking
    fill(null, chunkedSemi)
    expect(searchPlan.canStart).toBe(true)
    expect((await request()).uncertainMemory).toBe(true)

    // non-specific (unspecific cleavage) too
    fill(20652, { 'database:chunk_size': 2000, enzyme: 'unspecific cleavage' })
    expect((await request()).uncertainMemory).toBe(true)
  })

  test('other searches do not', async () => {
    // tryptic in chunks; semi without chunks; semi with a chunk larger than the database
    for (const [proteins, parameters] of [
      [20652, { 'database:chunk_size': 2000 }],
      [20652, { 'peptide:enzyme_specificity': 'semi' }],
      [null, { 'peptide:enzyme_specificity': 'semi', 'database:chunk_size': 0 }],
      [1000, { 'peptide:enzyme_specificity': 'semi', 'database:chunk_size': 2000 }],
    ] as const) {
      fill(proteins, parameters)
      expect((await request()).uncertainMemory, JSON.stringify([proteins, parameters])).toBe(false)
    }
  })
})
