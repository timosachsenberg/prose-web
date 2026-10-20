import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// The real engine worker in the browser (the production build): the module loads with threads on the
// cross-origin isolated page, searches the example, annotates a PSM in the viewer worker and exports
// idXML; it searches many files one at a time (file by file, with fewer threads) and stops at the next
// file when cancelled. With ?debug=engine the page exposes its own EngineClient as window.__engine (no
// second client).

/** What the test uses of EngineClient (the app's types are not visible to the e2e project). */
interface Engine {
  init(threads: number): Promise<{ threads: number; threaded: boolean; isolated: boolean; onnx: boolean; parameters: unknown[] }>
  threadsFor(request: unknown): { threads: number; capped: boolean }
  search(
    request: unknown,
    onProgress: (p: { label: string; file: number; fraction: number }) => void,
  ): Promise<{
    summary: { files: { ms2Spectra: number; targetPSMs: number }[] }
    tables: {
      files: string[]
      psms: { count: number; peptide: Uint32Array; charge: Int8Array; file: Uint16Array }
      peptides: { count: number; openms: string[] }
      proteins: { count: number; accession: string[] }
    }
    spectra: { psmSpectrum: Int32Array; offsets: Uint32Array; mz: Float32Array; intensity: Float32Array }
  }>
  annotate(mz: Float32Array, intensity: Float32Array, peptide: string, charge: number, options: null): Promise<{ matches: unknown[] }>
  idXML(): Promise<Uint8Array>
  cancel(): void
}

/**
 * A worker the page started: the threads of its module, the largest heap its progress reported, and the
 * longest time without a message once it was searching (what the client's watchdog waits for).
 */
type WorkerRecord = {
  /** "openms-search" or "openms-viewer" (the Worker's name). */
  name: string
  threads: number
  /** The module of its `init`: "wasm32" or "wasm64". */
  variant: string
  maxHeap: number
  maxSilentMs: number
  /** When it was terminated (performance.now()). */
  terminated: { at: number } | null
}

/**
 * Records the engine's workers (window.__workers): the threads of their `init`, the largest heap of
 * their progress messages (`memory`, the module's heap at the report), the longest silence while
 * searching and when they were terminated. Before the page loads.
 */
async function recordWorkers(page: Page) {
  await page.addInitScript(() => {
    const records: WorkerRecord[] = []
    ;(window as unknown as { __workers: WorkerRecord[] }).__workers = records
    const Native = window.Worker
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        const record: WorkerRecord = { name: options?.name ?? '', threads: 0, variant: '', maxHeap: 0, maxSilentMs: 0, terminated: null }
        records.push(record)
        let searchingSince: number | null = null
        this.addEventListener('message', (event: MessageEvent) => {
          const data = event.data as { type: string; stage?: string; memory?: { heapSize: number } }
          if (data.memory) record.maxHeap = Math.max(record.maxHeap, data.memory.heapSize)
          const now = performance.now()
          if (searchingSince !== null) record.maxSilentMs = Math.max(record.maxSilentMs, now - searchingSince)
          // as the client's watchdog: armed by the searching stage, re-armed by every progress or stage
          // message (writing a file is a reading stage in between), ended by the result or an error
          const report = data.type === 'progress' || data.type === 'stage'
          searchingSince = report && (searchingSince !== null || data.stage === 'searching') ? now : null
        })
        const post = this.postMessage.bind(this) as (message: unknown, options?: StructuredSerializeOptions) => void
        this.postMessage = ((message: unknown, options?: StructuredSerializeOptions) => {
          const m = message as { type?: string; threads?: number; variant?: string }
          if (m.type === 'init') {
            record.threads = m.threads ?? 0
            record.variant = m.variant ?? ''
          }
          post(message, options)
        }) as Worker['postMessage']
        const terminate = this.terminate.bind(this)
        this.terminate = () => {
          record.terminated ??= { at: performance.now() }
          terminate()
        }
      }
    }
  })
}

test('the engine worker searches the example', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('./?debug=engine')
  await page.waitForFunction(() => '__engine' in window)

  const result = await page.evaluate(async () => {
    const engine = (window as unknown as { __engine: Engine }).__engine
    const info = await engine.init(2)
    const file = async (path: string, name: string) => new File([await (await fetch(path)).blob()], name)
    const progress: { label: string; file: number; fraction: number }[] = []
    const outcome = await engine.search(
      {
        files: [{ id: 'run', file: await file('example/DatabaseSuitability_in_spec.mzML', 'run.mzML') }],
        database: await file('example/DatabaseSuitability_database.fasta', 'db.fasta'),
        contaminants: true,
        parameters: {},
        rescore: false,
        peptdeep: false,
      },
      (p) => progress.push(p),
    )
    const { tables, spectra } = outcome
    const row = spectra.psmSpectrum.findIndex((s) => s >= 0)
    const s = spectra.psmSpectrum[row]
    const [from, to] = [spectra.offsets[s], spectra.offsets[s + 1]]
    const peptide = tables.peptides.openms[tables.psms.peptide[row]]
    const [mz, intensity] = [spectra.mz.subarray(from, to), spectra.intensity.subarray(from, to)]
    const annotation = await engine.annotate(mz, intensity, peptide, tables.psms.charge[row], null)
    const xml = await engine.idXML()
    return {
      info: { ...info, parameters: info.parameters.length },
      files: outcome.summary.files,
      psms: tables.psms.count,
      contaminants: tables.proteins.accession.filter((a) => a.startsWith('CON__')).length,
      last: progress.at(-1),
      peaksKept: spectra.mz.length > 0,
      matches: annotation.matches.length,
      xmlStart: new TextDecoder().decode(xml.subarray(0, 5)),
    }
  })

  expect(result.info).toMatchObject({ threads: 2, threaded: true, isolated: true, onnx: true })
  expect(result.info.parameters).toBeGreaterThan(50)
  expect(result.files).toHaveLength(1)
  expect(result.files[0].ms2Spectra).toBe(2789)
  expect(result.psms).toBeGreaterThan(800)
  expect(result.contaminants).toBeGreaterThan(0)
  // file by file: the spectra of the PSMs are read in the file's step, and nothing reports after it
  expect(result.last).toEqual({ label: 'Searching run.mzML (1 of 1)...', file: 0, fraction: 0.95 })
  expect(result.peaksKept).toBe(true)
  expect(result.matches).toBeGreaterThan(3)
  expect(result.xmlStart).toBe('<?xml')
})

/**
 * Searches `copies` copies of the File in window.__file (one File: the same name, distinct paths) in a
 * new search worker, with `parameters`; returns what to compare and the worker's threads and heap.
 */
async function searchCopies(
  page: Page,
  copies: number,
  init: number,
  parameters: Record<string, unknown>,
  rescore: boolean,
  slowSteps = false,
) {
  return page.evaluate(
    async ({ copies, init, parameters, rescore, slowSteps }) => {
      const w = window as unknown as { __engine: Engine; __workers: WorkerRecord[]; __file: File; __database: File }
      const engine = w.__engine
      await engine.init(init)
      const request = {
        files: Array.from({ length: copies }, (_, i) => ({ id: `copy${i}`, file: w.__file })),
        database: w.__database,
        contaminants: false,
        parameters,
        rescore,
        peptdeep: false,
        slowSteps,
      }
      const threads = engine.threadsFor(request)
      const started = performance.now()
      const outcome = await engine.search(request, () => {})
      const seconds = (performance.now() - started) / 1000
      const worker = w.__workers.findLast((r) => r.name === 'openms-search')!
      const { summary, tables } = outcome
      const perFile = Array.from({ length: copies }, () => 0)
      for (const f of tables.psms.file) perFile[f]++
      return {
        threads,
        worker,
        seconds,
        files: summary.files.map((f) => ({ ms2: f.ms2Spectra, targetPSMs: f.targetPSMs })),
        paths: tables.files,
        psms: tables.psms.count,
        perFile,
        peptides: tables.peptides.count,
        proteins: tables.proteins.count,
        proteinList: [...tables.proteins.accession].sort().join(' '),
      }
    },
    { copies, init, parameters, rescore, slowSteps },
  )
}

/** Puts the files at these paths into the page as Files (window.__file, window.__database), as a person would pick them. */
async function pickFiles(page: Page, mzML: string, fasta: string) {
  await page.evaluate(() => {
    for (const id of ['pick-mzml', 'pick-fasta']) {
      const input = document.createElement('input')
      input.type = 'file'
      input.id = id
      input.hidden = true
      document.body.append(input)
    }
  })
  await page.setInputFiles('#pick-mzml', mzML)
  await page.setInputFiles('#pick-fasta', fasta)
  await page.evaluate(() => {
    const w = window as unknown as { __file: File; __database: File }
    w.__file = (document.getElementById('pick-mzml') as HTMLInputElement).files![0]
    w.__database = (document.getElementById('pick-fasta') as HTMLInputElement).files![0]
  })
}

test('searches many files one at a time, with fewer threads', async ({ page }) => {
  test.setTimeout(240_000)
  await recordWorkers(page)
  await page.goto('./?debug=engine')
  await page.waitForFunction(() => '__engine' in window)
  await pickFiles(page, 'public/example/DatabaseSuitability_in_spec.mzML', 'public/example/DatabaseSuitability_database.fasta')

  const one = await searchCopies(page, 1, 8, {}, false)
  const six = await searchCopies(page, 6, 8, {}, false)

  // one file: all 8 threads; six: at most 4 (the heap grows with every file, the more, the more threads)
  expect(one.threads).toEqual({ threads: 8, capped: false })
  expect(one.worker.threads).toBe(8)
  expect(six.threads).toEqual({ threads: 4, capped: true })
  expect(six.worker.threads).toBe(4)
  // six copies of one File, at distinct paths, each searched as the one alone
  expect(six.paths).toEqual(Array.from({ length: 6 }, (_, i) => `/input/${i}/DatabaseSuitability_in_spec.mzML`))
  expect(six.files).toEqual(Array.from({ length: 6 }, () => one.files[0]))
  expect(six.perFile).toEqual(Array.from({ length: 6 }, () => one.psms))
  expect(six.proteinList).toBe(one.proteinList)
})

test('cancel ends the search at once, and the next search runs', async ({ page }) => {
  test.setTimeout(120_000)
  await recordWorkers(page)
  await page.goto('./?debug=engine')
  await page.waitForFunction(() => '__engine' in window)
  await pickFiles(page, 'public/example/DatabaseSuitability_in_spec.mzML', 'public/example/DatabaseSuitability_database.fasta')

  const cancel = await page.evaluate(async () => {
    const w = window as unknown as { __engine: Engine; __workers: WorkerRecord[]; __file: File; __database: File }
    const engine = w.__engine
    await engine.init(4)
    const files = Array.from({ length: 6 }, (_, i) => ({ id: `copy${i}`, file: w.__file }))
    const request = { files, database: w.__database, contaminants: false, parameters: {}, rescore: false, peptdeep: false }
    let cancelledAt = 0
    let worker: WorkerRecord | null = null
    const error = await engine
      .search(request, (p) => {
        // in the second file's step
        if (p.file !== 1 || cancelledAt) return
        cancelledAt = performance.now()
        worker = w.__workers.findLast((r) => r.name === 'openms-search')!
        engine.cancel()
      })
      .then(
        () => null,
        (e: { kind: string; message: string }) => ({ kind: e.kind, message: e.message }),
      )
    const rejectedMs = performance.now() - cancelledAt
    const ended = (worker as WorkerRecord | null)?.terminated
    const next = w.__workers.at(-1)!
    return { error, rejectedMs, endedMs: ended ? ended.at - cancelledAt : null, next: { name: next.name, threads: next.threads } }
  })
  expect(cancel.error).toEqual({ kind: 'cancelled', message: 'The search was cancelled.' })
  expect(cancel.rejectedMs).toBeLessThan(100) // at once
  // the worker was ended at once, and a new one started with the threads of the search
  expect(cancel.endedMs).not.toBeNull()
  expect(cancel.endedMs!).toBeLessThan(100)
  expect(cancel.next).toEqual({ name: 'openms-search', threads: 4 })

  const next = await searchCopies(page, 1, 4, {}, false)
  expect(next.files[0].ms2).toBe(2789)
  expect(next.files[0].targetPSMs).toBeGreaterThan(800)
})

test('a search of many files shows its threads in the progress, and Cancel stops it', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('./')
  const cores = await page.evaluate(() => navigator.hardwareConcurrency)
  test.skip(cores <= 4, 'needs more than 4 cores: the search of many files is capped at 4 threads')
  await expect(page.getByTestId('engine-status')).toContainText('thread', { timeout: 60_000 })
  const example = readFileSync('public/example/DatabaseSuitability_in_spec.mzML')
  await page.locator('input[type="file"][accept=".mzML,.mzml"]').first().setInputFiles(
    Array.from({ length: 8 }, (_, i) => ({ name: `run${i + 1}.mzML`, mimeType: 'application/xml', buffer: example })),
  )
  await page.locator('input[type="file"][accept^=".fasta"]').setInputFiles('public/example/DatabaseSuitability_database.fasta')
  await expect(page.getByTestId('fasta-proteins')).toContainText('proteins')
  await page.getByRole('button', { name: /^Start search/ }).click()

  const threads = page.getByTestId('search-threads')
  await expect(threads).toHaveText('4 threads (memory)', { timeout: 30_000 })
  await expect(threads).toHaveAttribute('title', /at most 4 threads/)
  await expect(page.getByTestId('search-progress')).toContainText('File 2 of 8', { timeout: 60_000 })
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('The search was cancelled.')).toBeVisible({ timeout: 2000 })
  await expect(page.getByRole('button', { name: /^Start search/ })).toBeEnabled()
})

/**
 * The heap growth of a further file in wasm32 (settings/memory.ts `growthPerFile`, which the e2e project
 * cannot import): 0.05 GiB for files up to 75 MiB, 0.15 GiB from 733 MiB on, linear between.
 */
function growthPerFile(bytes: number): number {
  const [MiB, GiB] = [2 ** 20, 2 ** 30]
  const t = Math.min(1, Math.max(0, (bytes - 75 * MiB) / ((733 - 75) * MiB)))
  return 0.05 * GiB + (0.15 - 0.05) * GiB * t
}

// A real-size check, run on demand: PROSE_BIG_MZML=<an mzML of several hundred MB> PROSE_BIG_FASTA=<its
// FASTA>. Three copies of it do not fit into the module at once (two copies of 733 MB written first
// took the heap to 3.9 GB), file by file they take the heap of one and a little more. PROSE_BIG_PARAMETERS:
// ProSE parameters as JSON (default: none).
const big = { mzML: process.env.PROSE_BIG_MZML, fasta: process.env.PROSE_BIG_FASTA }
test('searches three copies of a large file with the heap of one', async ({ page }) => {
  test.skip(!big.mzML || !big.fasta, 'set PROSE_BIG_MZML and PROSE_BIG_FASTA')
  test.setTimeout(1_200_000)
  const parameters = JSON.parse(process.env.PROSE_BIG_PARAMETERS ?? '{}') as Record<string, unknown>
  await recordWorkers(page)
  await page.goto('./?debug=engine')
  await page.waitForFunction(() => '__engine' in window)
  await pickFiles(page, big.mzML!, big.fasta!)

  // a semi- or non-specific search, as the app sends it (`slowSteps`: the watchdog waits longer)
  const slow = parameters.enzyme === 'unspecific cleavage' || (parameters['peptide:enzyme_specificity'] ?? 'full') !== 'full'
  const one = await searchCopies(page, 1, 4, parameters, true, slow)
  const three = await searchCopies(page, 3, 4, parameters, true, slow)
  const MiB = 2 ** 20
  const report = (r: typeof one) => ({
    ...r,
    proteinList: undefined,
    maxHeapMiB: Math.round(r.worker.maxHeap / MiB),
    maxSilentS: Math.round(r.worker.maxSilentMs / 100) / 10,
  })
  console.log(`one file: ${JSON.stringify(report(one))}`)
  console.log(`three files: ${JSON.stringify(report(three))}`)

  expect(three.files).toEqual([one.files[0], one.files[0], one.files[0]])
  expect(three.perFile).toEqual([one.psms, one.psms, one.psms])
  expect(three.peptides).toBe(one.peptides)
  expect(three.proteinList).toBe(one.proteinList)
  // the heap of one file and the growth of two more (the app's model, at most 0.15 GiB per file): below
  // what two more files would add if they stayed in the heap (with OpenMS' allocator also for a chunked
  // semi-tryptic search, whose heap no longer scatters)
  const size = await page.evaluate(() => (window as unknown as { __file: File }).__file.size)
  expect(three.worker.maxHeap - one.worker.maxHeap).toBeLessThan(2 * size + 2 * growthPerFile(size))
  // the watchdog's budget (60 s once the heap is fully grown, else 120 s) leaves room for the silent steps
  expect(Math.max(one.worker.maxSilentMs, three.worker.maxSilentMs)).toBeLessThan(60_000)
})

// A search above 3 GB in the app, run on demand: PROSE_LARGE_MZML=<an mzML> PROSE_LARGE_FASTA=<its FASTA>
// PROSE_LARGE_PARAMETERS=<ProSE parameters as JSON, a preset on top of ProSE's defaults>. E.g. the
// calibration's human semi-tryptic search (erwinia_tmt.mzML against human_ref.fasta, TMT settings, not
// chunked: 8.6 GB measured, 6.9 GB estimated in wasm32): from New search, with the preset, it must run
// in the 64-bit engine and finish. Logs the estimate, the heap, the longest silence and the time.
const large = { mzML: process.env.PROSE_LARGE_MZML, fasta: process.env.PROSE_LARGE_FASTA }
test('a search above 3 GB runs in the 64-bit engine and finishes', async ({ page }) => {
  test.skip(!large.mzML || !large.fasta, 'set PROSE_LARGE_MZML and PROSE_LARGE_FASTA')
  test.setTimeout(1_800_000)
  const parameters = JSON.parse(process.env.PROSE_LARGE_PARAMETERS ?? '{}') as Record<string, unknown>
  await page.addInitScript((parameters) => {
    localStorage.setItem('prose.presets', JSON.stringify([{ id: 'user-large', name: 'Large check', parameters, builtin: false }]))
  }, parameters)
  await recordWorkers(page)
  await page.goto('./')
  await expect(page.getByTestId('engine-status')).toContainText('thread', { timeout: 120_000 })
  await page.locator('input[type="file"][accept=".mzML,.mzml"]').first().setInputFiles(large.mzML!)
  await page.locator('input[type="file"][accept^=".fasta"]').setInputFiles(large.fasta!)
  await expect(page.getByTestId('fasta-proteins')).toContainText(/[\d,]+ proteins/, { timeout: 60_000 })
  await page.getByLabel('Preset').click()
  await page.getByRole('option', { name: 'Large check' }).click()
  const plan = page.getByTestId('search-plan')
  await expect(plan).toContainText('· 64-bit engine (up to 16 GB)')
  const planText = (await plan.textContent())!
  const estimate = Number(/estimated memory ([\d.]+) GB/.exec(planText)![1])

  const started = Date.now()
  await page.getByRole('button', { name: /^Start search/ }).click()
  await expect(page.getByTestId('search-engine')).toHaveText('64-bit', { timeout: 120_000 })
  await expect(page).toHaveURL(/#\/results\/[^/]+$/, { timeout: 1_700_000 })
  const seconds = (Date.now() - started) / 1000
  const psms = Number((await page.getByTestId('psm-count').textContent())!.replace(/[^\d]/g, ''))
  await page.getByRole('tab', { name: 'Overview' }).click()
  await expect(page.getByTestId('search-facts')).toContainText('64-bit')

  const worker = await page.evaluate(() => (window as unknown as { __workers: WorkerRecord[] }).__workers.findLast((w) => w.name === 'openms-search')!)
  const GiB = 2 ** 30
  console.log(
    `large: ${planText}; ${psms} PSMs; ${seconds.toFixed(0)} s; worker ${worker.variant}, ${worker.threads} threads, ` +
      `heap ${(worker.maxHeap / GiB).toFixed(2)} GiB (estimate ${estimate} GB), longest silence ${(worker.maxSilentMs / 1000).toFixed(1)} s`,
  )
  expect(worker.variant).toBe('wasm64')
  // more than wasm32 could have given it, and within the estimate
  expect(worker.maxHeap).toBeGreaterThan(4 * GiB)
  expect(worker.maxHeap / GiB).toBeLessThanOrEqual(estimate + 0.05)
})
