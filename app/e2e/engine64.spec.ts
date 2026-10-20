import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// The 64-bit engine (wasm64, Memory64) in the app. A search runs in it when its memory estimate in the
// standard engine (wasm32) is above 3 GB and the browser has Memory64; `?debug=wasm64` sends every
// search there. Chromium has Memory64; a browser without it is simulated by a WebAssembly.validate
// that refuses 64-bit memories (the app's feature test).

/** The id the build gave the 64-bit package (its files are requested with ?v=<id>). */
function module64Id(): string {
  return /const MODULE64_ID = '([0-9a-f]{12})'/.exec(readFileSync('dist/sw.js', 'utf8'))![1]
}

/** The example, searched from New search (Percolator on, PeptDeep off); ends on the results. */
async function searchExample(page: Page, url: string) {
  await page.goto(url)
  await page.getByRole('button', { name: 'Try the example' }).click()
  await expect(page.getByTestId('fasta-proteins')).toContainText('proteins')
  await expect(page.getByTestId('engine-status')).toContainText('thread', { timeout: 120_000 })
  const peptdeep = page.getByRole('switch', { name: 'PeptDeep predictions' })
  if ((await peptdeep.getAttribute('aria-checked')) === 'true') await peptdeep.click()
}

/** The ?v= of the module files a page's workers loaded, by package ("openms", "openms64"). */
async function loadedPackages(page: Page): Promise<string[]> {
  const out: string[] = []
  // (the engine workers only: the module's threads, Blob workers, may be blocked in a wait)
  for (const worker of page.workers().filter((w) => w.url().includes('/assets/worker-'))) {
    const names = await worker.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name)).catch(() => [])
    for (const name of names) {
      const url = new URL(name)
      const m = /\/(openms|openms64)\/(openms\.(?:mjs|wasm))$/.exec(url.pathname)
      if (m) out.push(`${m[1]}/${m[2]}?v=${url.searchParams.get('v')}`)
    }
  }
  return [...new Set(out)].sort()
}

const count = async (page: Page, id: string) => Number((await page.getByTestId(id).textContent())!.replace(/[^\d]/g, ''))

test('the example in the 64-bit engine finds the same PSMs as in the standard one', async ({ page }) => {
  test.setTimeout(360_000)
  // the standard engine (wasm32)
  await searchExample(page, './')
  await expect(page.getByTestId('search-plan')).toContainText(/estimated memory \d\.\d GB of 4 GB/)
  await expect(page.getByTestId('search-plan')).not.toContainText('64-bit')
  await page.getByRole('button', { name: /^Start search/ }).click()
  await expect(page).toHaveURL(/#\/results\/[^/]+$/, { timeout: 150_000 })
  const psms32 = await count(page, 'psm-count')
  const proteins32 = await count(page, 'protein-count')
  expect(psms32).toBe(1790)
  await page.getByRole('tab', { name: 'Overview' }).click()
  await expect(page.getByTestId('search-facts')).toContainText(/Engine\s*OpenMS 3\.7 · 32-bit/)

  // forced into wasm64: the footer, the progress and the Overview say so
  await searchExample(page, './?debug=wasm64')
  await expect(page.getByTestId('search-plan')).toContainText(/estimated memory \d\.\d GB · 64-bit engine \(up to 16 GB\)/)
  await page.getByRole('button', { name: /^Start search/ }).click()
  await expect(page.getByTestId('search-engine')).toHaveText('64-bit', { timeout: 60_000 })
  await expect(page.getByTestId('search-engine')).toHaveAttribute('title', /^The 64-bit engine \(64-bit WebAssembly, up to 16 GB\), for the searches estimated above 3 GB\.$/)
  await expect(page).toHaveURL(/#\/results\/[^/]+$/, { timeout: 150_000 })
  expect(await count(page, 'psm-count')).toBe(psms32)
  expect(await count(page, 'protein-count')).toBe(proteins32)
  await page.getByRole('tab', { name: 'Overview' }).click()
  const engine = page.getByTestId('search-facts').locator('dd').filter({ hasText: '64-bit' })
  await expect(engine).toHaveText(/^OpenMS 3\.7 · 64-bit$/)
  await expect(engine).toHaveAttribute('title', /the 64-bit engine \(64-bit WebAssembly, up to 16 GB of memory\)/)

  // its search worker loaded the 64-bit package, each file with that package's id; the page's own
  // engine (the status chip, the viewer) stays the standard one
  const v64 = module64Id()
  const loaded = await loadedPackages(page)
  expect(loaded).toContain(`openms64/openms.mjs?v=${v64}`)
  expect(loaded).toContain(`openms64/openms.wasm?v=${v64}`)
  expect(loaded.filter((l) => l.startsWith('openms64/') && !l.endsWith(`?v=${v64}`))).toEqual([])

  // History keeps the module: the 64-bit search is marked, the other not
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'History' }).click()
  const rows = page.getByTestId('history-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0).getByTestId('history-engine')).toHaveText('64-bit')
  await expect(rows.nth(1).getByTestId('history-engine')).toHaveCount(0)
})

/** A FASTA of `n` small proteins (tryptic peptides of several lengths). */
function fasta(n: number): Buffer {
  const residues = 'ACDEFGHIKLMNPQRSTVWY'
  const lines: string[] = []
  for (let i = 0; i < n; i++) {
    let sequence = ''
    for (let j = 0; j < 60; j++) sequence += j % 9 === 8 ? 'K' : residues[(i * 7 + j * 13) % 20]
    lines.push(`>sp|T${String(i).padStart(6, '0')}|T${i}_TEST synthetic ${i}`, sequence)
  }
  return Buffer.from(`${lines.join('\n')}\n`)
}

/**
 * New search with the example's mzML and a database of 140,000 proteins, the default preset (Oxidation
 * (M), and Acetyl (Protein N-term), which does not enlarge the index): 4.4–4.7 GB in wasm32.
 */
async function largeSearch(page: Page) {
  await page.goto('./')
  await expect(page.getByTestId('engine-status')).toContainText('thread', { timeout: 120_000 })
  await page.locator('input[type="file"][accept=".mzML,.mzml"]').first().setInputFiles('public/example/DatabaseSuitability_in_spec.mzML')
  await page.locator('input[type="file"][accept^=".fasta"]').setInputFiles({ name: 'large.fasta', mimeType: 'text/plain', buffer: fasta(140_000) })
  await expect(page.getByTestId('fasta-proteins')).toContainText('140,000 proteins', { timeout: 30_000 })
}

test('a search above 3 GB runs in the 64-bit engine, said in the footer', async ({ page }) => {
  await largeSearch(page)
  const plan = page.getByTestId('search-plan')
  await expect(plan).toContainText(/140,000 proteins \+ 116 cRAP \+ decoys · estimated memory \d\.\d GB · 64-bit engine \(up to 16 GB\)/)
  // the number that chose it (the 64-bit estimate shown can be lower)
  await expect(plan).toHaveAttribute('title', /\nEstimated \d\.\d\d GB in the standard 32-bit engine, above 3 GB: the search runs in the 64-bit engine\.$/)
  await expect(page.getByRole('button', { name: /^Start search/ })).toBeEnabled()
})

test('a search started while the proteins are counted waits for the count and runs in the engine it asks for', async ({ page }) => {
  test.setTimeout(120_000)
  // a large FASTA's count takes long: the page's reads of its pieces take 8 s here
  await page.addInitScript(() => {
    const read = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = function (this: Blob) {
      const slow = this.size > 1e6 && this.size <= 16 * 2 ** 20 && !(this instanceof File)
      return slow ? new Promise<void>((r) => setTimeout(r, 8000)).then(() => read.call(this)) : read.call(this)
    }
  })
  await page.goto('./')
  await expect(page.getByTestId('engine-status')).toContainText('thread', { timeout: 120_000 })
  await page.locator('input[type="file"][accept=".mzML,.mzml"]').first().setInputFiles('public/example/DatabaseSuitability_in_spec.mzML')
  await page.locator('input[type="file"][accept^=".fasta"]').setInputFiles({ name: 'large.fasta', mimeType: 'text/plain', buffer: fasta(140_000) })
  // no estimate before the count (it would be one of 0 proteins); Start stays enabled
  await expect(page.getByTestId('search-plan')).toHaveText('1 file · counting proteins…')
  await page.getByRole('button', { name: /^Start search/ }).click()
  const progress = page.getByTestId('search-progress')
  await expect(progress).toContainText('Counting proteins…')
  await expect(page.getByTestId('search-engine')).toHaveCount(0)
  // the count decides: the 64-bit engine
  await expect(page.getByTestId('search-engine')).toHaveText('64-bit', { timeout: 30_000 })
  await expect(progress).not.toContainText('Counting proteins…')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('The search was cancelled.')).toBeVisible()
  await expect(page.getByTestId('search-plan')).toContainText('140,000 proteins + 116 cRAP + decoys · estimated memory')
  await expect(page.getByTestId('search-plan')).toContainText('· 64-bit engine (up to 16 GB)')
})

test('without Memory64 a search above 4 GB stays in wasm32, and the footer says why', async ({ page }) => {
  // a browser without Memory64: WebAssembly.validate refuses a 64-bit memory (limits flag with 0x04)
  await page.addInitScript(() => {
    const validate = WebAssembly.validate.bind(WebAssembly)
    WebAssembly.validate = (bytes: BufferSource) => {
      const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer)
      if (b.length < 32 && b[8] === 5 && (b[11] & 0x04) !== 0) return false
      return validate(bytes)
    }
  })
  await largeSearch(page)
  const plan = page.getByTestId('search-plan')
  await expect(plan).toContainText(/estimated memory 4\.\d GB of 4 GB/)
  await expect(plan).not.toContainText('64-bit engine (up to')
  const advice = page.getByText(/^This browser cannot run the 64-bit engine/)
  await expect(advice).toHaveText(
    'This browser cannot run the 64-bit engine, which a search above 4 GB needs: use a Chromium-based browser (Chrome, Edge) ' +
      'or Firefox, smaller chunks (database:chunk_size under All parameters) or fewer files at once.',
  )
  // Start stays enabled: the estimate may be above what the search takes
  await expect(page.getByRole('button', { name: /^Start search/ })).toBeEnabled()
})
