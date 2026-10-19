import { expect, test, type Locator } from '@playwright/test'
import { openDebug, searchExample, searchSynthetic } from './helpers.js'

// The Overview, Samples and QC tabs, and the open search's panels. ?debug=large is a closed search of
// six files (control 1–3 and EGF 1–3) rescored by Percolator at a PSM FDR of 100 %; ?debug=small an open
// search without Percolator, whose mass shifts are +15.9949 (every fifth PSM) and −17.0265 Da (every
// seventh one). The real searches are those of the bundled example and of the synthetic file.

const count = (text: string | null) => Number((text ?? '').replace(/[^\d]/g, ''))
const MINUS = '−'

/** The text of each cell of a column in the table's body rows. */
async function column(table: Locator, name: string): Promise<string[]> {
  return (await table.locator(`tbody tr [data-column="${name}"]`).allTextContents()).map((t) => t.trim())
}

test('overview lists every file', async ({ page }) => {
  await openDebug(page, 'large')
  const tab = page.getByRole('tab', { name: 'Overview' })
  await expect(tab).toBeEnabled()
  // Proteins stays the default tab
  await expect(page.getByRole('tab', { name: /^Proteins/ })).toHaveAttribute('aria-selected', 'true')
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')

  const overview = page.getByTestId('overview-tab')
  const table = overview.getByRole('table', { name: 'Searched files' })
  for (const name of ['File', 'Sample', 'MS2 spectra', 'Target PSMs', 'Decoy PSMs', 'Percolator', 'Database search', 'Status']) {
    await expect(table.getByRole('columnheader', { name })).toBeVisible()
  }
  // a closed search without PeptDeep: no NCE column
  await expect(table.getByRole('columnheader', { name: /NCE/ })).toHaveCount(0)

  await expect(table.locator('tbody tr')).toHaveCount(6)
  expect(await column(table, 'file')).toEqual(['control_1.mzML', 'control_2.mzML', 'control_3.mzML', 'EGF_1.mzML', 'EGF_2.mzML', 'EGF_3.mzML'])
  expect(await column(table, 'sample')).toEqual(['control 1', 'control 2', 'control 3', 'EGF 1', 'EGF 2', 'EGF 3'])
  expect(new Set(await column(table, 'percolator'))).toEqual(new Set(['Rescored']))
  expect(new Set(await column(table, 'status'))).toEqual(new Set(['Searched']))
  expect(new Set(await column(table, 'time'))).toEqual(new Set(['10.0 s']))

  // the last row adds the files up, and its PSMs are the key figure's
  const sum = async (name: string) => (await column(table, name)).reduce((n, t) => n + count(t), 0)
  const total = table.locator('tfoot tr')
  await expect(total.locator('th')).toHaveText('All files')
  for (const name of ['ms2', 'targets', 'decoys']) {
    expect(count(await total.locator(`[data-column="${name}"]`).textContent())).toBe(await sum(name))
  }
  expect(await sum('targets')).toBeGreaterThan(1000)
  expect(count(await total.locator('[data-column="targets"]').textContent())).toBe(count(await page.getByTestId('psm-count').textContent()))

  // two different times: the whole run, and the database search of each file
  await expect(overview.getByTestId('search-facts').getByText('Total time', { exact: true })).toBeVisible()
  await expect(overview.getByText('Search time')).toHaveCount(0)

  // a closed search has no mass-shift panel
  await expect(page.getByTestId('delta-mass-panel')).toHaveCount(0)
  // the key figures stay above the tabs
  await expect(page.getByTestId('protein-count')).toBeVisible()
})

test('the tabs are reached with the keyboard', async ({ page }) => {
  await openDebug(page, 'small')
  await page.getByRole('tab', { name: 'Overview' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: /^Proteins/ })).toBeFocused()
  await expect(page.getByRole('tab', { name: /^Proteins/ })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('End')
  await expect(page.getByRole('tab', { name: 'QC' })).toBeFocused()
  await expect(page.getByRole('tab', { name: 'QC' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('qc-tab')).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('tab', { name: 'Samples' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('samples-tab')).toBeVisible()
  await page.keyboard.press('Home')
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('overview-tab')).toBeVisible()
})

test('samples tab groups by condition', async ({ page }) => {
  await openDebug(page, 'large')
  await page.getByRole('tab', { name: 'Samples' }).click()
  const samples = page.getByTestId('samples-tab')
  const table = samples.getByRole('table', { name: 'Samples by condition' })
  for (const name of ['Sample', 'Files', 'PSMs', 'Peptides', 'Proteins']) await expect(table.getByRole('columnheader', { name })).toBeVisible()

  // one body per condition: its row first, then its samples
  const bodies = table.locator('tbody')
  await expect(bodies).toHaveCount(2)
  const conditions = ['control', 'EGF']
  const read = async (row: Locator) => ({
    psms: count(await row.locator('[data-column="psms"]').textContent()),
    peptides: count(await row.locator('[data-column="peptides"]').textContent()),
    proteins: count(await row.locator('[data-column="proteins"]').textContent()),
  })
  let groupPsms = 0
  for (const [i, condition] of conditions.entries()) {
    const body = bodies.nth(i)
    const head = body.locator('tr[data-testid="condition-row"]')
    await expect(head.locator('th')).toContainText(condition)
    await expect(head.locator('th')).toContainText('3 samples')
    const rows = body.locator('tr[data-testid="sample-row"]')
    await expect(rows.locator('th')).toHaveText([1, 2, 3].map((r) => `${condition} ${r}`))
    const members = await Promise.all((await rows.all()).map(read))
    const group = await read(head)
    // a condition adds up the PSMs of its samples; its peptides and proteins are the distinct ones in all of them
    expect(group.psms).toBe(members.reduce((n, s) => n + s.psms, 0))
    expect(group.peptides).toBeGreaterThanOrEqual(Math.max(...members.map((s) => s.peptides)))
    expect(group.peptides).toBeLessThanOrEqual(members.reduce((n, s) => n + s.peptides, 0))
    expect(group.proteins).toBeGreaterThanOrEqual(Math.max(...members.map((s) => s.proteins)))
    expect(members.every((s) => s.psms > 0 && s.peptides > 0 && s.proteins > 0)).toBe(true)
    expect(group.psms).toBeGreaterThan(0)
    groupPsms += group.psms
    // one searched file per sample here, three in the condition
    await expect(rows.locator('[data-column="files"]')).toHaveText(['1', '1', '1'])
    await expect(head.locator('[data-column="files"]')).toHaveText('3')
  }
  // the last row is all samples; its PSMs are the key figure's
  const all = table.locator('tfoot tr')
  await expect(all.locator('th')).toHaveText('All samples')
  expect((await read(all)).psms).toBe(groupPsms)
  expect((await read(all)).psms).toBe(count(await page.getByTestId('psm-count').textContent()))

  // the headers say what they count
  await expect(table.getByRole('columnheader', { name: 'PSMs' })).toHaveAttribute('title', /Target PSMs at the search PSM FDR/)
  await expect(table.getByRole('columnheader', { name: 'Peptides' })).toHaveAttribute('title', /distinct peptide sequences/)
  await expect(table.getByRole('columnheader', { name: 'Peptides' })).toHaveAttribute('title', /Peptides tab/)
  await expect(table.getByRole('columnheader', { name: 'Proteins' })).toHaveAttribute('title', /protein groups/)
})

test('QC shows the score distribution, the precursor error and the PSMs per file', async ({ page }) => {
  await openDebug(page, 'large')
  await page.getByRole('tab', { name: 'QC' }).click()
  const qc = page.getByTestId('qc-tab')

  // every chart: a heading, a subtitle that says what it shows, an SVG with title and description
  for (const id of ['qc-score', 'qc-precursor', 'qc-files']) {
    const card = qc.getByTestId(id)
    await expect(card.getByRole('heading')).toBeVisible()
    await expect(card.getByTestId('qc-subtitle')).not.toBeEmpty()
    const svg = card.getByRole('img')
    await expect(svg).toBeVisible()
    expect(((await svg.locator('title').textContent()) ?? '').length).toBeGreaterThan(10)
    expect(((await svg.locator('desc').textContent()) ?? '').length).toBeGreaterThan(30)
    // a table of the numbers behind it
    const details = card.locator('details')
    await details.locator('summary').click()
    await expect(details.getByRole('table')).toBeVisible()
  }

  // the tab has a heading of its own before the charts' headings
  await expect(qc.getByRole('heading', { level: 2, name: 'Quality control' })).toHaveCount(1)
  expect(await qc.getByRole('heading').evaluateAll((hs) => hs.map((h) => h.tagName))).toEqual(['H2', 'H3', 'H3', 'H3'])

  // targets against decoys
  const score = qc.getByTestId('qc-score')
  await expect(score.getByRole('heading')).toHaveText('Score distribution')
  await expect(score.getByTestId('qc-subtitle')).toHaveText('PSMs at the search FDR (100 %, q ≤ 1) · decoys kept')
  await expect(score.getByTestId('legend')).toContainText(/Targets · [\d,]+/)
  await expect(score.getByTestId('legend')).toContainText(/Decoys · [\d,]+/)
  await expect(score.getByTestId('x-label')).toHaveText('Percolator score')
  expect(await score.getByTestId('target-bar').count()).toBeGreaterThan(5)
  expect(await score.getByTestId('decoy-bar').count()).toBeGreaterThan(0)
  // the plot names its series, so that colour is not the only cue: the labels are in the plot and do not touch
  const names = score.getByTestId('series-label')
  await expect(names).toHaveText(['Targets', 'Decoys'])
  const plot = (await score.getByTestId('histogram').boundingBox())!
  const [t, d] = [(await names.nth(0).boundingBox())!, (await names.nth(1).boundingBox())!]
  for (const box of [t, d]) {
    expect(box.x).toBeGreaterThanOrEqual(plot.x)
    expect(box.x + box.width).toBeLessThanOrEqual(plot.x + plot.width)
    expect(box.y).toBeGreaterThanOrEqual(plot.y)
  }
  expect(t.x + t.width <= d.x || d.x + d.width <= t.x || t.y + t.height <= d.y || d.y + d.height <= t.y).toBe(true)
  // the table has a row per bin and the counts of the legend
  const scoreRows = score.locator('details tbody tr')
  const targets = (await scoreRows.locator('[data-column="targets"]').allTextContents()).reduce((n, t) => n + count(t), 0)
  expect(targets).toBe(count(await score.getByTestId('legend').getByText(/Targets/).textContent()))

  // precursor error: around zero, with the median named
  const precursor = qc.getByTestId('qc-precursor')
  await expect(precursor.getByRole('heading')).toHaveText('Precursor mass error')
  await expect(precursor.getByTestId('qc-subtitle')).toContainText('Target PSMs at the search FDR')
  await expect(precursor.getByTestId('x-label')).toHaveText('Precursor error (ppm)')
  await expect(precursor.getByTestId('median-label')).toHaveText(new RegExp(`^median precursor error \\(unmodified\\) [+${MINUS}]?\\d+\\.\\d ppm$`))
  expect(await precursor.getByTestId('error-bar').count()).toBeGreaterThan(5)
  // one series: no series label; the median's label stays inside the plot
  await expect(precursor.getByTestId('series-label')).toHaveCount(0)
  const precursorPlot = (await precursor.getByTestId('histogram').boundingBox())!
  const median = (await precursor.getByTestId('median-label').boundingBox())!
  expect(median.x).toBeGreaterThanOrEqual(precursorPlot.x)
  expect(median.x + median.width).toBeLessThanOrEqual(precursorPlot.x + precursorPlot.width)

  // PSMs per file
  const files = qc.getByTestId('qc-files')
  await expect(files.getByRole('heading')).toHaveText('PSMs per file')
  await expect(files.getByTestId('file-bar')).toHaveCount(6)
  await expect(files.getByTestId('file-name')).toHaveText(['control_1.mzML', 'control_2.mzML', 'control_3.mzML', 'EGF_1.mzML', 'EGF_2.mzML', 'EGF_3.mzML'])
  const perFile = (await files.getByTestId('file-value').allTextContents()).map(count)
  expect(perFile.reduce((a, b) => a + b, 0)).toBe(count(await page.getByTestId('psm-count').textContent()))
})

test('the charts follow the width of the window, in both directions, and stay inside their cards', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openDebug(page, 'small')
  await page.getByRole('tab', { name: 'QC' }).click()
  const qc = page.getByTestId('qc-tab')
  await expect(qc.getByTestId('histogram').first()).toBeVisible()
  const inside = async () => {
    for (const id of ['qc-score', 'qc-precursor', 'qc-files']) {
      const card = (await qc.getByTestId(id).boundingBox())!
      const svg = (await qc.getByTestId(id).getByRole('img').boundingBox())!
      expect(svg.x + svg.width, `the chart of ${id} ends inside its card`).toBeLessThanOrEqual(card.x + card.width + 0.5)
    }
  }
  await inside()
  const wide = (await qc.getByTestId('qc-score').getByRole('img').boundingBox())!.width
  await page.setViewportSize({ width: 1100, height: 800 })
  await expect.poll(async () => (await qc.getByTestId('qc-score').getByRole('img').boundingBox())!.width).toBeLessThan(1100)
  await inside()
  await page.getByRole('tab', { name: 'Overview' }).click()
  const chart = page.getByTestId('delta-mass-chart')
  await expect(chart).toBeVisible()
  expect((await chart.boundingBox())!.x + (await chart.boundingBox())!.width).toBeLessThanOrEqual(1100)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('tab', { name: 'QC' }).click()
  await expect.poll(async () => (await qc.getByTestId('qc-score').getByRole('img').boundingBox())!.width).toBeGreaterThan(wide * 0.9)
  await inside()
})

test('the QC of an open search says that it uses the unmodified PSMs, and ln(hyperscore) without Percolator', async ({ page }) => {
  await openDebug(page, 'small')
  await page.getByRole('tab', { name: 'QC' }).click()
  const qc = page.getByTestId('qc-tab')
  await expect(qc.getByTestId('qc-score').getByTestId('x-label')).toHaveText('ln(hyperscore)')
  const precursor = qc.getByTestId('qc-precursor')
  await expect(precursor.getByTestId('qc-subtitle')).toContainText(/Unmodified PSMs only \(\|Δ\| ≤ 0\.05 Da\): [\d,]+ of [\d,]+ target PSMs/)
  // (the synthetic shifts: every fifth PSM +15.9949 Da, every seventh −17.0265 Da, a few more: about 55 % are unmodified)
  const [used, of] = (await precursor.getByTestId('qc-subtitle').textContent())!.match(/: ([\d,]+) of ([\d,]+)/)!.slice(1).map(count)
  expect(used / of).toBeGreaterThan(0.45)
  expect(used / of).toBeLessThan(0.65)
})

test('the mass shifts of a stored open search: a histogram, the shifts and the mapped modifications', async ({ page }) => {
  await openDebug(page, 'small')
  await page.getByRole('tab', { name: 'Overview' }).click()
  const panel = page.getByTestId('delta-mass-panel')
  await expect(panel).toBeVisible()
  const chart = panel.getByTestId('delta-mass-chart')
  await expect(chart).toBeVisible()
  await expect(chart).toHaveAttribute('role', 'img')
  expect(((await chart.locator('title').textContent()) ?? '').length).toBeGreaterThan(10)
  expect(((await chart.locator('desc').textContent()) ?? '').length).toBeGreaterThan(30)
  expect(await chart.getByTestId('shift-bar').count()).toBeGreaterThan(2)
  await expect(chart.getByTestId('x-label')).toHaveText('Δ mass (Da)')
  // the known modifications carry their names, the others their masses
  await expect(chart.getByTestId('shift-label').filter({ hasText: 'Oxidation' })).toBeVisible()
  await expect(panel.getByTestId('legend')).toContainText('Known modification')
  await expect(panel.getByTestId('legend')).toContainText('No known modification')

  await expect(panel.getByTestId('shift-summary')).toContainText(/[\d,]+ of 3,000 PSMs \(targets and decoys\) carry a mass shift/)
  const shifts = panel.getByRole('table', { name: 'Mass shifts' })
  await expect(shifts.locator('tbody tr').first()).toBeVisible()
  const masses = await column(shifts, 'mass')
  expect(masses.length).toBeGreaterThan(2)
  for (const mass of masses) expect(mass).toMatch(new RegExp(`^[+${MINUS}]\\d+\\.\\d{4}$`))
  // (binned to 0.0005 Da, as the engine bins)
  expect(masses).toContain('+15.9950')
  expect(masses).toContain(`${MINUS}17.0265`)

  const ptms = panel.getByRole('table', { name: 'Mapped modifications' })
  expect(await column(ptms, 'name')).toEqual(expect.arrayContaining(['Oxidation']))
  const oxidation = ptms.locator('tbody tr', { hasText: 'Oxidation' })
  await expect(oxidation.locator('[data-column="theoretical"]')).toHaveText('+15.9949')
  await expect(oxidation.locator('[data-column="residues"]')).toHaveText('M')
})

test('open search shows delta masses', async ({ page }) => {
  test.setTimeout(300_000)
  // the bundled example with the "open-search" preset
  await searchExample(page, { preset: 'Open search · ±500 Da', peptdeep: false })
  await page.getByRole('tab', { name: 'Overview' }).click()

  // the files of the search
  const files = page.getByTestId('overview-tab').getByRole('table', { name: 'Searched files' })
  await expect(files.locator('tbody tr')).toHaveCount(2)
  expect(new Set(await column(files, 'percolator'))).toEqual(new Set(['Rescored']))
  expect(new Set(await column(files, 'status'))).toEqual(new Set(['Searched']))

  // the histogram of the mass shifts
  const panel = page.getByTestId('delta-mass-panel')
  await expect(panel).toBeVisible()
  const chart = panel.getByTestId('delta-mass-chart')
  await expect(chart).toBeVisible()
  expect(await chart.getByTestId('shift-bar').count()).toBeGreaterThan(2)
  const total = (await panel.getByTestId('shift-summary').textContent())!
  expect(total).toMatch(/^[\d,]+ of [\d,]+ PSMs \(targets and decoys\) carry a mass shift above 0\.05 Da/)

  // the shifts as a table: a row for each bar, the most frequent first
  const shifts = panel.getByRole('table', { name: 'Mass shifts' })
  const rows = shifts.locator('tbody tr')
  expect(await rows.count()).toBeGreaterThanOrEqual(1)
  expect(await rows.count()).toBe(await chart.getByTestId('shift-bar').count())
  const psms = (await column(shifts, 'psms')).map(count)
  expect([...psms].sort((a, b) => b - a)).toEqual(psms)
  for (const mass of await column(shifts, 'mass')) expect(mass).toMatch(new RegExp(`^[+${MINUS}]\\d+\\.\\d{4}$`))

  // the example has unalkylated cysteines (−57.0215 Da, no known modification): no shift maps to a modification, and
  // the table says so instead of staying empty
  const ptms = panel.getByRole('table', { name: 'Mapped modifications' })
  await expect(ptms).toBeVisible()
  await expect(ptms.getByTestId('ptm-empty')).toContainText('The engine matched none of the')

  // the QC uses the unmodified PSMs for the precursor error
  await page.getByRole('tab', { name: 'QC' }).click()
  await expect(page.getByTestId('qc-precursor').getByTestId('qc-subtitle')).toContainText('Unmodified PSMs only (|Δ| ≤ 0.05 Da)')
  await expect(page.getByTestId('qc-score').getByTestId('x-label')).toHaveText('Percolator score')
  await expect(page.getByTestId('qc-files').getByTestId('file-bar')).toHaveCount(2)

  // a PSM with a shift shows it after the sequence, with a real minus outside ProForma
  await page.getByRole('tab', { name: /^PSMs/ }).click()
  await expect(page.getByTestId('results-table').locator('tr[data-index]').filter({ hasText: /\[[+-]\d+\.\d{4}\]\?/ }).first()).toBeVisible()
})

test('a mapped modification fills the mapped-modification table', async ({ page }) => {
  test.setTimeout(240_000)
  // MPLDLSPLATPIIR with an oxidised M, searched without any variable modification: Δ +15.9949 Da
  await searchSynthetic(page, 'Open search · ±500 Da')
  await page.getByRole('tab', { name: 'Overview' }).click()
  const panel = page.getByTestId('delta-mass-panel')
  await expect(panel).toBeVisible()
  const ptms = panel.getByRole('table', { name: 'Mapped modifications' })
  const rows = ptms.locator('tbody tr[data-testid="ptm-row"]')
  await expect(rows).toHaveCount(1)
  await expect(ptms.getByTestId('ptm-empty')).toHaveCount(0)
  // the shift is the oxidation's (+15.9949 Da observed); the engine names the modification it maps to
  // (the lowest mass within its tolerance, which is not always Oxidation), and the deviation says how far off that is
  await expect(rows.locator('[data-column="observed"]')).toHaveText('+15.9949')
  const name = (await rows.locator('[data-column="name"]').textContent())!.trim()
  expect(name.length).toBeGreaterThan(2)
  await expect(rows.locator('[data-column="psms"]')).toHaveText('1')
  await expect(rows.locator('[data-column="peptides"]')).toHaveText('1')
  await expect(rows.locator('[data-column="deviation"]')).toHaveText(/^[\d.]+$|^\u2212[\d.]+$/)
  // the chart names the bar after it, and the table of the shifts agrees
  await expect(panel.getByTestId('delta-mass-chart').getByTestId('shift-label')).toHaveText(name)
  await expect(panel.getByRole('table', { name: 'Mass shifts' }).locator('tbody tr')).toHaveCount(1)
  await expect(panel.getByRole('table', { name: 'Mass shifts' }).locator('[data-column="modification"]')).toHaveText(name)
  await expect(panel.getByTestId('shift-summary')).toContainText('1 of 43 PSMs (targets and decoys) carry a mass shift above 0.05 Da (2.3 %)')
})

test('technical replicates: one sample on the Samples tab, its measurements when asked', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('./')
  await page.getByRole('button', { name: 'Try the example' }).click()
  // the second copy of the file is a second measurement of the first sample
  const replicate = page.getByLabel('Replicate of DatabaseSuitability_2.mzML')
  await replicate.fill('1')
  await replicate.press('Tab')
  await expect(page.getByTestId('design-summary')).toHaveText('2 files → 1 sample · 1 condition')
  await expect(page.getByTestId('engine-status')).toContainText('thread', { timeout: 120_000 })
  const peptdeep = page.getByRole('switch', { name: 'PeptDeep predictions' })
  if ((await peptdeep.getAttribute('aria-checked')) === 'true') await peptdeep.click()
  await page.getByRole('button', { name: /^Start search/ }).click()
  await expect(page).toHaveURL(/#\/results\/[^/]+$/, { timeout: 150_000 })

  await page.getByRole('tab', { name: 'Samples' }).click()
  const samples = page.getByTestId('samples-tab')
  const table = samples.getByRole('table', { name: 'Samples by condition' })
  const condition = table.getByTestId('condition-row')
  const rows = table.getByTestId('sample-row')
  const sw = samples.getByRole('switch', { name: 'Show technical replicates separately' })

  // merged: one sample of two files
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  await expect(condition.locator('th')).toContainText('example')
  await expect(condition.locator('th')).toContainText('1 sample')
  await expect(rows).toHaveCount(1)
  await expect(rows.locator('th')).toHaveText('example 1')
  await expect(rows.locator('[data-column="files"]')).toHaveText('2')
  const merged = count(await rows.locator('[data-column="psms"]').textContent())
  expect(merged).toBe(count(await page.getByTestId('psm-count').textContent()))

  // separate: a row for each measurement, and still one sample in the condition
  await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', 'true')
  await expect(rows).toHaveCount(2)
  await expect(rows.locator('th')).toHaveText(['example 1 · TR1', 'example 1 · TR2'])
  await expect(rows.locator('[data-column="files"]')).toHaveText(['1', '1'])
  await expect(condition.locator('th')).toContainText('1 sample')
  await expect(condition.locator('th')).not.toContainText('2 samples')
  const parts = (await rows.locator('[data-column="psms"]').allTextContents()).map(count)
  expect(parts[0] + parts[1]).toBe(merged)
  // the setting is the one of the Columns menu: it holds on the Proteins tab
  await page.getByRole('tab', { name: /^Proteins/ }).click()
  await page.getByRole('button', { name: 'Columns' }).click()
  await expect(page.getByRole('menuitemcheckbox', { name: /Show technical replicates separately/ })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')

  // merged again
  await page.getByRole('tab', { name: 'Samples' }).click()
  await sw.click()
  await expect(rows).toHaveCount(1)
  await expect(condition.locator('th')).toContainText('1 sample')
})
