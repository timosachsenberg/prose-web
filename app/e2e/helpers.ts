import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import { psmTestSpectra, syntheticMzML } from './synthetic-mzml.js'

// Shared by the Results e2e specs: opening a stored synthetic result (see debug.ts), reading the
// export button and the CSV files, and the grid's active row.

export async function openDebug(page: Page, which: 'large' | 'large1' | 'dense' | 'small') {
  await page.goto(`./?debug=${which}`)
  await expect(page).toHaveURL(/#\/results\/[^/]+$/)
  await expect(page.getByTestId('results-table')).toBeVisible({ timeout: 30_000 })
}

/** The number of rows the export button promises ("Export CSV · 1,234 rows"). */
export async function exportCount(page: Page): Promise<number> {
  const text = await page.getByRole('button', { name: /^Export CSV · / }).textContent()
  return Number(text!.replace(/^.*·/, '').replace(/[^\d]/g, ''))
}

/** The fields of a CSV line (RFC 4180 quotes; the test data have no line breaks in fields). */
export function fields(line: string): string[] {
  const out: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (field += '"'), i++
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') out.push(field), (field = '')
    else field += c
  }
  out.push(field)
  return out
}

/** The rows of a downloaded CSV, without its byte order mark and final line break. */
export async function downloadCsv(page: Page, trigger: () => Promise<void>): Promise<{ name: string; lines: string[] }> {
  const download = page.waitForEvent('download')
  await trigger()
  const file = await download
  const text = readFileSync((await file.path())!, 'utf8')
  expect(text.charCodeAt(0)).toBe(0xfeff)
  expect(text.endsWith('\n')).toBe(true)
  return { name: file.suggestedFilename(), lines: text.slice(1, -1).split('\n') }
}

/** The grid's active row (aria-activedescendant): its position and whether it is in the scroll box's view. */
export async function activeRow(page: Page): Promise<{ index: number; inView: boolean }> {
  return page.getByTestId('table-scroll').first().evaluate((box: HTMLElement) => {
    const id = box.getAttribute('aria-activedescendant')
    const row = id ? document.getElementById(id) : null
    if (!row) return { index: -1, inView: false }
    const header = box.querySelector('thead')!.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    return { index: Number(row.dataset.index), inView: r.top >= header.bottom - 1 && r.bottom <= b.bottom + 1 }
  })
}

/**
 * The bundled example (two copies of one file) searched with Percolator, PeptDeep as asked (default
 * on) and a built-in preset if given by name ("Open search · ±500 Da"). Ends on the results.
 */
export async function searchExample(page: Page, opts: { preset?: string; peptdeep?: boolean } = {}) {
  await page.goto('./')
  await page.getByRole('button', { name: 'Try the example' }).click()
  await expect(page.getByTestId('engine-status')).toContainText('thread', { timeout: 120_000 })
  if (opts.preset) {
    await page.getByLabel('Preset').click()
    await page.getByRole('option', { name: opts.preset }).click()
  }
  const peptdeep = page.getByRole('switch', { name: 'PeptDeep predictions' })
  if ((await peptdeep.getAttribute('aria-checked')) !== String(opts.peptdeep ?? true)) await peptdeep.click()
  await page.getByRole('button', { name: /^Start search/ }).click()
  await expect(page).toHaveURL(/#\/results\/[^/]+$/, { timeout: 150_000 })
}

/**
 * The synthetic file (psmTestSpectra) searched against the example database, without Percolator
 * (about 40 PSMs), with a preset by name and a fragment tolerance in Da if given. `query` is added to
 * the first URL ("?debug=engine" exposes the engine as window.__engine). Ends on the PSMs tab.
 */
export async function searchSynthetic(page: Page, preset?: string, fragmentDa?: number, query = '') {
  await page.goto(`./${query}`)
  await expect(page.getByTestId('engine-status')).toContainText('thread', { timeout: 120_000 })
  await page.locator('input[type="file"][accept=".mzML,.mzml"]').first().setInputFiles({
    name: 'synthetic.mzML',
    mimeType: 'application/xml',
    buffer: syntheticMzML(psmTestSpectra().spectra),
  })
  await page.locator('input[type="file"][accept^=".fasta"]').setInputFiles('public/example/DatabaseSuitability_database.fasta')
  if (preset) {
    await page.getByLabel('Preset').click()
    await page.getByRole('option', { name: preset }).click()
  }
  if (fragmentDa !== undefined) {
    await page.locator('#fragment-tolerance').fill(String(fragmentDa))
    await page.locator('#fragment-tolerance').press('Tab')
    await page.getByRole('button', { name: /^Fragment tolerance unit: ppm/ }).click()
    await expect(page.getByRole('button', { name: /^Fragment tolerance unit: Da/ })).toBeVisible()
  }
  await page.getByRole('switch', { name: 'Percolator' }).click()
  await page.getByRole('button', { name: /^Start search/ }).click()
  await expect(page).toHaveURL(/#\/results\/[^/]+$/, { timeout: 120_000 })
  await page.getByRole('tab', { name: /^PSMs/ }).click()
}
