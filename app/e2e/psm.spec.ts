import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { openDebug, searchExample, searchSynthetic } from './helpers.js'
import { psmTestSpectra, scanOf } from './synthetic-mzml.js'

// The PSM view: a PSM of the table opens beside it (the table narrows to a list), with the fragment
// ladder, the annotated spectrum mirrored against PeptDeep's prediction or the theoretical spectrum,
// the ion table, the fragment mass errors and the PSM's features. The example search gives real
// spectra (b and y ions only); a synthetic file of the example's peptides adds a ions, an oxidised
// methionine and a spectrum with thousands of noise peaks.

const spectrumOf = (psm: Locator) => psm.getByTestId('spectrum')
const labels = (psm: Locator, type: string) => spectrumOf(psm).locator(`[data-testid="peak-label"][data-ions~="${type}"]`)
const labelsWith = (psm: Locator, text: string | RegExp) => spectrumOf(psm).locator('[data-testid="peak-label"]', { hasText: text })

/** The losses and precursor menu of the view: sets its items as asked, then closes it. */
async function setMore(page: Page, psm: Locator, items: Record<string, boolean>) {
  await psm.getByRole('button', { name: /^Losses and precursor peaks: / }).click()
  for (const [name, on] of Object.entries(items)) {
    const item = page.getByRole('menuitemcheckbox', { name })
    if ((await item.getAttribute('aria-checked')) !== String(on)) await item.click()
    await expect(item).toHaveAttribute('aria-checked', String(on))
  }
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
}

/** A signed number as the view writes it (rounded first, a real minus, no negative zero). */
function signedText(v: number, digits: number): string {
  const text = Math.abs(v).toFixed(digits)
  return Number(text) === 0 ? text : `${v < 0 ? '−' : '+'}${text}`
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
  await expect(spectrum.getByTestId('similarity')).toHaveText(/^cosine \d\.\d{3} · spectral angle \d\.\d{3} \(search\)$/)
  // the label under the spectrum and the similarity never meet: side by side while they fit, else the similarity on a line of its own
  const apart = async () => {
    const label = (await spectrum.getByTestId('bottom-label').boundingBox())!
    const similarity = (await spectrum.getByTestId('similarity').boundingBox())!
    const meet = label.x < similarity.x + similarity.width && similarity.x < label.x + label.width && label.y < similarity.y + similarity.height && similarity.y < label.y + label.height
    expect(meet, `label ${JSON.stringify(label)} and similarity ${JSON.stringify(similarity)}`).toBe(false)
    return { stacked: similarity.y > label.y + label.height - 2, within: similarity.x + similarity.width <= (await spectrum.boundingBox())!.x + (await spectrum.boundingBox())!.width + 0.5 }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect.poll(async () => (await apart()).stacked).toBe(false)
  await page.setViewportSize({ width: 1050, height: 900 })
  await expect(spectrum.getByTestId('similarity')).toHaveAttribute('data-stacked', '')
  expect(await apart()).toEqual({ stacked: true, within: true })
  await page.setViewportSize({ width: 1280, height: 720 })
  // each half says what its 100 % is
  await expect(spectrum.getByTestId('top-label')).toHaveText('Observed · 100 % = strongest matched b/y')
  await expect(spectrum.getByTestId('bottom-label')).toContainText('100 % = strongest predicted b/y')
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
  await expect(spectrum.getByTestId('top-label')).toHaveText('Observed · 100 % = base peak')
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
  const { oxidised, noisy, triple } = psmTestSpectra()
  const oxidisedScan = scanOf(40)
  const noisyScan = scanOf(41)
  const tripleScan = scanOf(43)

  let page: Page
  test.beforeAll(async ({ browser }, info) => {
    info.setTimeout(180_000)
    page = await browser.newPage({ baseURL: info.project.use.baseURL })
    // the model cannot be read: the prediction fails (first test)
    await page.route('**/peptdeep_ms2_dynamic.onnx', (route) => route.abort())
    await searchSynthetic(page, undefined, undefined, '?debug=engine') // window.__engine: one test makes a call fail
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

  // (before any test asks for this PSM's precursor peaks: the answers are kept, and a kept answer makes no call)
  test('a failed precursor annotation shows the fragments without it, with a note, and the export stays usable', async () => {
    const psm = await openScan(page, oxidised.sequence, oxidisedScan)
    await expect(labels(psm, 'y').first()).toBeVisible({ timeout: 60_000 })
    // the call for the precursor peaks (no ion types asked) fails; the fragment calls go through
    await page.evaluate(() => {
      const w = window as unknown as { __engine: { annotate: (...args: unknown[]) => Promise<unknown> }; __annotate?: (...args: unknown[]) => Promise<unknown> }
      const original = (w.__annotate = w.__engine.annotate.bind(w.__engine))
      w.__engine.annotate = (mz, intensity, peptide, charge, options) => {
        const o = options as { precursor?: boolean; ions?: string[] } | null
        return o?.precursor && o.ions?.length === 0 ? Promise.reject(new Error('the precursor call failed')) : original(mz, intensity, peptide, charge, options)
      }
    })
    await setMore(page, psm, { 'Precursor peaks': true })
    await expect(psm.getByTestId('precursor-note')).toContainText('precursor peaks could not be annotated')
    await expect(psm.getByTestId('precursor-note')).toContainText('the precursor call failed')
    // no "annotating…" left, the export works, the fragments are there and the precursor is not
    await expect(spectrumOf(psm)).not.toContainText('annotating…')
    await expect(psm.getByRole('button', { name: 'Export spectrum (SVG)' })).toBeEnabled()
    await expect(labels(psm, 'y').first()).toBeVisible()
    await expect(labels(psm, 'precursor')).toHaveCount(0)
    // off and on again asks again: with the call working, the precursor peak shows and the note goes
    await page.evaluate(() => {
      const w = window as unknown as { __engine: { annotate: unknown }; __annotate: unknown }
      w.__engine.annotate = w.__annotate
    })
    await setMore(page, psm, { 'Precursor peaks': false })
    await expect(psm.getByTestId('precursor-note')).toHaveCount(0)
    await setMore(page, psm, { 'Precursor peaks': true })
    await expect(labels(psm, 'precursor')).toHaveText(['[M+2H]++'])
    await expect(psm.getByTestId('precursor-note')).toHaveCount(0)
    await setMore(page, psm, { 'Precursor peaks': false })
    await page.keyboard.press('Escape')
  })

  test('ion toggles change the annotation', async () => {
    const psm = await openScan(page, oxidised.sequence, oxidisedScan)
    // the oxidised methionine: marked in the ladder, its loss offered and on
    await expect(psm.getByTestId('ladder-mod')).toHaveText(['ox'])
    await expect(psm.getByRole('button', { name: /^Losses and precursor peaks: / })).toHaveAccessibleName(
      'Losses and precursor peaks: CH₄SO',
    )

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

    // a off again takes the labels away
    await psm.getByRole('checkbox', { name: 'a ions' }).uncheck()
    await expect(labels(psm, 'a')).toHaveCount(0)
    await psm.getByRole('checkbox', { name: '2+ fragments' }).uncheck()

    // the losses: that of oxidised methionine is on, water is not
    await expect(labelsWith(psm, 'CH₄SO').first()).toBeVisible()
    await expect(labelsWith(psm, '-H₂O')).toHaveCount(0)
    await setMore(page, psm, { 'CH₄SO loss (oxidised M)': false, 'H₂O loss': true })
    await expect(labelsWith(psm, 'CH₄SO')).toHaveCount(0)
    await expect(labelsWith(psm, '-H₂O').first()).toBeVisible()
    await expect(psm.getByRole('button', { name: /^Losses and precursor peaks: / })).toHaveAccessibleName('Losses and precursor peaks: H₂O')

    // the precursor: [M+2H]++ of this 2+ PSM
    await expect(labels(psm, 'precursor')).toHaveCount(0)
    await setMore(page, psm, { 'H₂O loss': false, 'Precursor peaks': true })
    await expect(labels(psm, 'precursor')).toHaveText(['[M+2H]++'])
    await setMore(page, psm, { 'Precursor peaks': false })
    await page.keyboard.press('Escape')
  })

  test('the mass errors spread within the band; the mean and the SD are those of the dots', async () => {
    // the synthetic fragments are up to ±5 ppm off
    const psm = await openScan(page, oxidised.sequence, oxidisedScan)
    await expect(labels(psm, 'y').first()).toBeVisible({ timeout: 60_000 })
    const errors = psm.getByTestId('mass-error')
    const dots = await errors.getByTestId('error-dot').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        return { e: Number(el.getAttribute('data-error-ppm')), y: r.top + r.height / 2 }
      }),
    )
    expect(dots.length).toBeGreaterThan(8)
    const e = dots.map((d) => d.e)
    expect(Math.max(...e.map(Math.abs))).toBeLessThan(5.5)
    const mean = e.reduce((a, b) => a + b, 0) / e.length
    const sd = Math.sqrt(e.reduce((a, b) => a + (b - mean) ** 2, 0) / (e.length - 1))
    expect(sd).toBeGreaterThan(1.5) // not all on the zero line
    const ys = dots.map((d) => d.y)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(8)
    const band = (await errors.getByTestId('tolerance-band').boundingBox())!
    for (const y of ys) expect(y > band.y && y < band.y + band.height).toBe(true)
    await expect(errors.getByTestId('error-stats')).toHaveText(`mean ${signedText(mean, 1)} ppm · SD ${sd.toFixed(1)} ppm · dot size = intensity`)
    await page.keyboard.press('Escape')
  })

  test("the lower half's ions stand where the observed ones are", async () => {
    const psm = await openScan(page, oxidised.sequence, oxidisedScan)
    await expect(labels(psm, 'y').first()).toBeVisible({ timeout: 60_000 })
    await psm.getByRole('radio', { name: 'Theoretical' }).check()
    const spectrum = spectrumOf(psm)
    await expect(spectrum.getByTestId('bottom-label')).toHaveText('Theoretical')
    // the single b and y ions labelled above, and the theoretical ions below
    const above = await spectrum
      .locator('[data-testid="peak-label"]')
      .evaluateAll((els) => els.filter((el) => /^[by]\d+$/.test(el.textContent!.trim())).map((el) => Number(el.getAttribute('x'))))
    const below = await spectrum
      .getByTestId('bottom-peaks')
      .evaluateAll((els) => els.flatMap((el) => [...el.getAttribute('d')!.matchAll(/M([\d.]+) /g)].map((m) => Number(m[1]))))
    expect(above.length).toBeGreaterThan(5)
    for (const x of above) expect(Math.min(...below.map((b) => Math.abs(b - x)))).toBeLessThan(0.6)
    await psm.getByRole('radio', { name: 'PeptDeep prediction' }).check()
    await page.keyboard.press('Escape')
  })

  test('a 3+ PSM: its precursor at 3+, its 2+ fragments, and a peak taller than the matched ones clipped', async () => {
    const psm = await openScan(page, triple.sequence, tripleScan)
    await expect(labels(psm, 'y').first()).toBeVisible({ timeout: 60_000 })
    const twoPlus = labelsWith(psm, /y\d+\+\+/)
    await psm.getByRole('checkbox', { name: '2+ fragments' }).check()
    await expect(twoPlus.first()).toBeVisible()
    await psm.getByRole('checkbox', { name: '2+ fragments' }).uncheck()
    await expect(twoPlus).toHaveCount(0)
    await setMore(page, psm, { 'Precursor peaks': true })
    await expect(labels(psm, 'precursor')).toHaveText(['[M+3H]+++'])
    await setMore(page, psm, { 'Precursor peaks': false })
    // against PeptDeep the observed half is scaled to the strongest matched b/y: the taller peak is clipped
    const spectrum = spectrumOf(psm)
    await expect(spectrum.getByTestId('top-label')).toHaveText('Observed · 100 % = strongest matched b/y')
    await expect(spectrum.getByTestId('clipped-peaks')).toHaveCount(1)
    // against the theoretical spectrum, to the base peak: nothing is clipped
    await psm.getByRole('radio', { name: 'Theoretical' }).check()
    await expect(spectrum.getByTestId('top-label')).toHaveText('Observed · 100 % = base peak')
    await expect(spectrum.getByTestId('clipped-peaks')).toHaveCount(0)
    await psm.getByRole('radio', { name: 'PeptDeep prediction' }).check()
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
    expect(svg).not.toMatch(/class=|var\(|url\(|<style|href=|currentColor|Predicting|annotating|ion table/)
    expect(svg).toMatch(/<title[^>]*>[^<]*DCPVTAMQK/)
    expect(svg).toMatch(/<desc[^>]*>[^<]*Above, 100 % is the strongest matched b\/y/)
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

test('a fragment tolerance in Da: the band narrows with m/z, and every match is inside it', async ({ page }) => {
  test.setTimeout(180_000)
  const { oxidised } = psmTestSpectra()
  await searchSynthetic(page, undefined, 0.02)
  const psm = await openScan(page, oxidised.sequence, scanOf(40))
  await expect(labels(psm, 'y').first()).toBeVisible({ timeout: 60_000 })
  await expect(labels(psm, 'b').first()).toBeVisible()
  const errors = psm.getByTestId('mass-error')
  await expect(errors).toContainText('tolerance ±0.02 Da')
  // 0.02 Da is 100 ppm at m/z 200 and 20 ppm at m/z 1000: the band is no rectangle
  expect(await errors.getByTestId('tolerance-band').getAttribute('d')).toContain('L')
  const dots = await errors.getByTestId('error-dot').evaluateAll((els) =>
    els.map((el) => ({ e: Number(el.getAttribute('data-error-ppm')), mz: Number(el.getAttribute('data-mz')) })),
  )
  expect(dots.length).toBeGreaterThan(8)
  for (const d of dots) expect(Math.abs(d.e)).toBeLessThanOrEqual((0.02 / d.mz) * 1e6)
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
  // ProForma has a hyphen; the note, outside ProForma, a real minus
  await expect(psm.getByTestId('open-search-note')).toContainText(`${shift.replace('-', '\u2212')} Da`)
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
