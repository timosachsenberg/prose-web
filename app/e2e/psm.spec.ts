import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { openDebug } from './helpers.js'
import { psmTestSpectra, scanOf, syntheticMzML } from './synthetic-mzml.js'

// The PSM view: a PSM of the table opens beside it (the table narrows to a list), with the fragment
// ladder, the annotated spectrum mirrored against PeptDeep's prediction or the theoretical spectrum,
// the ion table, the fragment mass errors and the PSM's features. The example search gives real
// spectra (b and y ions only); a synthetic file of the example's peptides adds a ions, an oxidised
// methionine and a spectrum with thousands of noise peaks.

const spectrumOf = (psm: Locator) => psm.getByTestId('spectrum')
const labels = (psm: Locator, type: string) => spectrumOf(psm).locator(`[data-testid="peak-label"][data-ions~="${type}"]`)

/** The example (two copies of one file) searched with Percolator and PeptDeep. */
async function searchExample(page: Page) {
  await page.goto('./')
  await page.getByRole('button', { name: 'Try the example' }).click()
  await expect(page.getByTestId('engine-status')).toContainText('thread', { timeout: 120_000 })
  const peptdeep = page.getByRole('switch', { name: 'PeptDeep predictions' })
  if ((await peptdeep.getAttribute('aria-checked')) !== 'true') await peptdeep.click()
  await page.getByRole('button', { name: /^Start search/ }).click()
  await expect(page).toHaveURL(/#\/results\/[^/]+$/, { timeout: 150_000 })
}

/** The synthetic file searched against the example database, without Percolator (about 40 PSMs). */
async function searchSynthetic(page: Page, preset?: string) {
  await page.goto('./')
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
  await page.getByRole('switch', { name: 'Percolator' }).click()
  await page.getByRole('button', { name: /^Start search/ }).click()
  await expect(page).toHaveURL(/#\/results\/[^/]+$/, { timeout: 120_000 })
  await page.getByRole('tab', { name: /^PSMs/ }).click()
}

/** Opens the PSM of the synthetic file with scan `scan` (the text filter finds it by its sequence). */
async function openScan(page: Page, sequence: string, scan: number): Promise<Locator> {
  await page.getByLabel('Filter PSMs').fill(sequence)
  const table = page.getByTestId('results-table')
  const scans = async () => (await table.locator('tr[data-index] [data-column="scan"]').allTextContents()).map((s) => s.trim())
  // the filter applies after a short pause: its rows are those of the sequence
  await expect.poll(scans).toContain(String(scan))
  await expect.poll(async () => (await scans()).length).toBeLessThan(5)
  const index = (await scans()).indexOf(String(scan))
  await table.locator(`tr[data-index="${index}"]`).click()
  const psm = page.getByTestId('psm-view')
  await expect(psm.getByTestId('psm-breadcrumb')).toContainText(`scan ${scan}`)
  return psm
}

test('PSM view shows the annotated spectrum, ion table and mass errors', async ({ page }) => {
  test.setTimeout(300_000)
  await searchExample(page)
  await page.getByRole('tab', { name: /^PSMs/ }).click()
  const grid = page.getByRole('grid', { name: 'PSMs' })
  // sorted by m/z, so that "Next" follows an order of the user's
  await grid.getByRole('columnheader', { name: 'm/z' }).getByRole('button').click()
  await expect(grid.getByRole('columnheader', { name: 'm/z' })).toHaveAttribute('aria-sort', 'descending')
  const rows = page.getByTestId('results-table').locator('tr[data-index]')
  const cell = async (i: number, column: string) => (await rows.nth(i).locator(`[data-column="${column}"]`).textContent())!.trim()
  const first = { scan: await cell(0, 'scan'), sequence: await cell(0, 'peptide') }
  const second = await cell(1, 'scan')

  await rows.nth(0).click()
  const psm = page.getByTestId('psm-view')
  await expect(psm).toBeVisible()
  await expect(psm.getByTestId('psm-breadcrumb')).toContainText(`scan ${first.scan}`)
  // the table gave way to a list beside the view, with the PSM selected
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true')

  // the ladder has the peptide's residues
  await expect(psm.getByTestId('ladder-residue')).toHaveText(first.sequence.split(''))

  // the spectrum, annotated: b and y labels on the peaks
  const spectrum = spectrumOf(psm)
  await expect(spectrum).toHaveAttribute('role', 'img')
  await expect(labels(psm, 'b').first()).toBeVisible({ timeout: 60_000 })
  await expect(labels(psm, 'y').first()).toBeVisible()
  expect(await spectrum.locator('title').first().textContent()).toContain(first.sequence)

  // the ion table is a table and highlights the matched cells, b and y
  const table = psm.getByRole('table', { name: /^Fragment ions/ })
  const matched = table.locator('td[data-matched="true"]')
  await expect(table.locator('td[data-matched="true"][data-type="b"]').first()).toBeVisible()
  await expect(table.locator('td[data-matched="true"][data-type="y"]').first()).toBeVisible()
  // the ladder marks the cleavages that the matches explain
  await expect(psm.getByTestId('fragment-ladder').locator('[data-cut="b"]').first()).toBeVisible()

  // the mass errors: one dot per match (b and y 1+ without losses: one per matched cell), all in the band
  const errors = psm.getByTestId('mass-error')
  const dots = errors.getByTestId('error-dot')
  await expect(dots).toHaveCount(await matched.count())
  const band = (await errors.getByTestId('tolerance-band').boundingBox())!
  for (const dot of await dots.evaluateAll((els) =>
    els.map((el) => ({ error: Number(el.getAttribute('data-error-ppm')), box: el.getBoundingClientRect() })),
  )) {
    expect(Math.abs(dot.error)).toBeLessThanOrEqual(20)
    const y = dot.box.top + dot.box.height / 2
    expect(y).toBeGreaterThanOrEqual(band.y - 0.5)
    expect(y).toBeLessThanOrEqual(band.y + band.height + 0.5)
  }
  await expect(errors).toContainText('tolerance ±20 ppm')

  // the bottom half: PeptDeep's prediction at the NCE the search calibrated; the similarity from the features
  await expect(spectrum.getByTestId('bottom-label')).toContainText(/^PeptDeep · NCE \d+ \(calibrated\)/, { timeout: 60_000 })
  await expect(spectrum.getByTestId('bottom-peaks').first()).toBeAttached()
  await expect(spectrum.getByTestId('similarity')).toHaveText(/^cosine \d\.\d{3} · spectral angle \d\.\d{3}$/)
  await expect(psm.getByTestId('psm-features')).toContainText('Percolator score')
  await expect(psm.getByTestId('psm-features')).toContainText('ms2_cosine')

  // "Next" goes to the next row of the table's order
  await psm.getByRole('button', { name: 'Next PSM' }).click()
  await expect(psm.getByTestId('psm-breadcrumb')).toContainText(`scan ${second}`)
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true')
  await psm.getByRole('button', { name: 'Previous PSM' }).click()
  await expect(psm.getByTestId('psm-breadcrumb')).toContainText(`scan ${first.scan}`)

  // the theoretical spectrum instead of the prediction
  await psm.getByRole('radio', { name: 'Theoretical' }).check()
  await expect(spectrum.getByTestId('bottom-label')).toHaveText('Theoretical')
  await expect(spectrum.getByTestId('bottom-peaks').first()).toBeAttached()

  // Esc goes back to the table, at the PSM
  await page.keyboard.press('Escape')
  await expect(psm).toHaveCount(0)
  await expect(grid).toBeFocused()
  await expect(grid.getByRole('columnheader', { name: 'RT (min)' })).toBeVisible()
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true')
})

test.describe('a synthetic file with a ions', () => {
  test.describe.configure({ mode: 'serial' })
  const { oxidised, noisy } = psmTestSpectra()
  const oxidisedScan = scanOf(40)
  const noisyScan = scanOf(41)

  let page: Page
  test.beforeAll(async ({ browser }, info) => {
    info.setTimeout(180_000)
    page = await browser.newPage({ baseURL: info.project.use.baseURL })
    // the model cannot be read: the prediction fails (first test)
    await page.route('**/peptdeep_ms2_dynamic.onnx', (route) => route.abort())
    await searchSynthetic(page)
  })
  test.afterAll(async () => page?.close())

  test('a prediction that fails says why and offers the theoretical spectrum', async () => {
    const psm = await openScan(page, oxidised.sequence, oxidisedScan)
    const status = spectrumOf(psm).getByTestId('bottom-status')
    await expect(status).toContainText('Prediction unavailable:', { timeout: 60_000 })
    await psm.getByRole('button', { name: 'Show the theoretical spectrum' }).click()
    await expect(spectrumOf(psm).getByTestId('bottom-label')).toHaveText('Theoretical')
    await expect(psm.getByRole('radio', { name: 'Theoretical' })).toBeChecked()
    await page.keyboard.press('Escape')
    await expect(psm).toHaveCount(0)
    await page.unroute('**/peptdeep_ms2_dynamic.onnx')
  })

  test('ion toggles change the annotation', async () => {
    const psm = await openScan(page, oxidised.sequence, oxidisedScan)
    // the oxidised methionine: marked in the ladder, its loss offered and on
    await expect(psm.getByTestId('ladder-mod')).toHaveText(['ox'])
    await expect(psm.getByRole('checkbox', { name: 'CH₄SO loss (oxidised M)' })).toBeChecked()

    await expect(labels(psm, 'y').first()).toBeVisible({ timeout: 60_000 })
    await expect(labels(psm, 'a')).toHaveCount(0)
    const table = psm.getByRole('table', { name: /^Fragment ions/ })
    await expect(table.getByRole('columnheader', { name: 'a⁺' })).toHaveCount(0)

    // a on: a labels, an a column in the table, a dots in the mass error plot
    await psm.getByRole('checkbox', { name: 'a ions' }).check()
    await expect(labels(psm, 'a').first()).toBeVisible()
    expect(await labels(psm, 'a').count()).toBeGreaterThan(2)
    await expect(table.getByRole('columnheader', { name: 'a⁺' })).toBeVisible()
    await expect(table.locator('td[data-matched="true"][data-type="a"]').first()).toBeVisible()
    await expect(psm.getByTestId('mass-error').locator('[data-testid="error-dot"][data-type="a"]').first()).toBeAttached()

    // b off: no b label, no b column
    await psm.getByRole('checkbox', { name: 'b ions' }).uncheck()
    await expect(labels(psm, 'b')).toHaveCount(0)
    await expect(table.getByRole('columnheader', { name: 'b⁺' })).toHaveCount(0)
    await psm.getByRole('checkbox', { name: 'b ions' }).check()
    await expect(labels(psm, 'b').first()).toBeVisible()

    // 2+ fragments: their columns
    await psm.getByRole('checkbox', { name: '2+ fragments' }).check()
    await expect(table.getByRole('columnheader', { name: 'y²⁺' })).toBeVisible()

    // the choices hold for the next PSM, and a off again takes the labels away
    await psm.getByRole('checkbox', { name: 'a ions' }).uncheck()
    await expect(labels(psm, 'a')).toHaveCount(0)
    await psm.getByRole('checkbox', { name: '2+ fragments' }).uncheck()
    await page.keyboard.press('Escape')
  })

  test('a spectrum of thousands of peaks stays a small DOM', async () => {
    const psm = await openScan(page, noisy.sequence, noisyScan)
    await expect(labels(psm, 'y').first()).toBeVisible({ timeout: 60_000 })
    const nodes = await spectrumOf(psm).evaluate((svg) => svg.querySelectorAll('*').length)
    expect(nodes).toBeLessThan(400) // 4,000+ peaks: drawn as a few paths
    // hovering a peak tells its m/z and ions
    await spectrumOf(psm).locator('[data-testid="peak-label"]').first().hover()
    await expect(psm.getByTestId('peak-tooltip')).toContainText('m/z')
    await page.keyboard.press('Escape')
  })

  test('Export spectrum (SVG) writes a standalone file named after the peptide and scan', async () => {
    const psm = await openScan(page, oxidised.sequence, oxidisedScan)
    await expect(labels(psm, 'y').first()).toBeVisible({ timeout: 60_000 })
    const download = page.waitForEvent('download')
    await psm.getByRole('button', { name: 'Export spectrum (SVG)' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe(`DC_Carbamidomethyl_PVTAM_Oxidation_QK_scan${oxidisedScan}.svg`)
    const svg = readFileSync((await file.path())!, 'utf8')
    expect(svg.startsWith('<?xml')).toBe(true)
    expect(svg).toContain('<svg')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).not.toMatch(/class=|var\(|url\(|<style|href=|currentColor/)
    expect(svg).toMatch(/<title[^>]*>[^<]*DCPVTAMQK/)
    await page.keyboard.press('Escape')
  })
})

test('an open search: the PSM shows its mass shift, and the annotation is of the peptide without it', async ({ page }) => {
  test.setTimeout(180_000)
  // MPLDLSPLATPIIR with its M oxidised: an open search (no variable modification) finds it with Δ +15.9949
  const { shifted } = psmTestSpectra()
  await searchSynthetic(page, 'Open search · ±500 Da')
  const psm = await openScan(page, shifted.sequence, scanOf(42))
  await expect(psm.getByTestId('psm-breadcrumb')).toContainText('[+15.9949]?MPLDLSPLATPIIR')
  await expect(psm.getByTestId('psm-header')).toContainText('[+15.9949]?')
  await expect(psm.getByTestId('open-search-note')).toContainText('+15.9949 Da')
  // every b ion carries the shift (it is on the first residue): none is annotated; the y ions are
  await expect(labels(psm, 'y').first()).toBeVisible({ timeout: 60_000 })
  expect(await labels(psm, 'y').count()).toBeGreaterThan(8)
  await expect(labels(psm, 'b')).toHaveCount(0)
  await expect(psm.getByTestId('ladder-mod')).toHaveCount(0)
})

test('a PSM without a stored spectrum shows its ladder and features; an open search shows its shift', async ({ page }) => {
  // the synthetic open search of ?debug=small keeps no peaks
  await openDebug(page, 'small')
  await page.getByRole('tab', { name: /^PSMs/ }).click()
  const grid = page.getByRole('grid', { name: 'PSMs' })
  const rows = page.getByTestId('results-table').locator('tr[data-index]')
  // a PSM with a mass shift
  const shifted = rows.filter({ hasText: /\[[+-]\d+\.\d{4}\]\?/ }).first()
  const index = Number(await shifted.getAttribute('data-index'))
  const shift = /\[([+-]\d+\.\d{4})\]\?/.exec((await shifted.textContent())!)![1]
  await grid.focus()
  for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')

  const psm = page.getByTestId('psm-view')
  await expect(psm.getByTestId('psm-breadcrumb')).toContainText(`[${shift}]?`)
  await expect(psm.getByTestId('psm-header')).toContainText(`[${shift}]?`)
  await expect(psm.getByTestId('open-search-note')).toContainText(`${shift} Da`)
  await expect(psm.getByTestId('spectrum-missing')).toContainText('Spectrum not stored')
  await expect(psm.getByTestId('spectrum')).toHaveCount(0)
  await expect(psm.getByTestId('ladder-residue').first()).toBeVisible()
  await expect(psm.getByTestId('psm-features')).toContainText('ln(hyperscore)')
  // the ion table still lists the theoretical ions, none of them matched
  const table = psm.getByRole('table', { name: /^Fragment ions/ })
  await expect(table.locator('td[data-type="y"]').first()).toBeVisible({ timeout: 60_000 })
  await expect(table.locator('td[data-matched="true"]')).toHaveCount(0)

  // Prev and Next work from the keyboard
  const next = psm.getByRole('button', { name: 'Next PSM' })
  await next.focus()
  await page.keyboard.press('Enter')
  await expect(rows.nth(index + 1)).toHaveAttribute('aria-selected', 'true')
  await expect(next).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(rows.nth(index)).toHaveAttribute('aria-selected', 'true')

  // Esc goes back to the table, the focus on the PSM's row
  await page.keyboard.press('Escape')
  await expect(psm).toHaveCount(0)
  await expect(grid).toBeFocused()
  const active = await grid.getAttribute('aria-activedescendant')
  await expect(page.locator(`[id="${active}"]`)).toHaveAttribute('data-index', String(index))
})
