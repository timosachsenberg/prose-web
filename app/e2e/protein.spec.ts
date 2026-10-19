import { expect, test, type Locator, type Page } from '@playwright/test'
import { activeRow, downloadCsv, exportCount, fields, openDebug } from './helpers.js'

// The protein panel with the synthetic result of ?debug=large (4,000 proteins, 20,000 peptides, 150,000
// PSMs; the first protein of the table, sorted by PSMs, has the most peptides and PSMs). A protein
// opens in a panel at the right of the table: coverage strip, tabs Coverage · Peptides · PSMs, and
// "Open in PSM table".

const number = (text: string | null) => Number((text ?? '').replace(/[^\d.]/g, ''))

/** The protein of table row `index`: its accession as the table shows it and its counts. */
async function proteinRow(page: Page, index: number) {
  const row = page.getByTestId('results-table').locator(`[data-index="${index}"]`)
  const cell = async (id: string) => (await row.locator(`[data-column="${id}"]`).textContent())!.trim()
  return {
    row,
    accession: (await cell('accession')).replace(/\s*(contaminant|decoy)$/, ''),
    peptides: number(await cell('peptides')),
    psms: number(await cell('psms')),
  }
}

const panelOf = (page: Page, accession: string) => page.getByRole('region', { name: `Protein ${accession}` })

/** Whether the focus is inside `panel`. */
const focusInside = (panel: Locator) => panel.evaluate((el) => el.contains(document.activeElement))

test('a protein opens its coverage, peptides and PSMs', async ({ page }) => {
  await openDebug(page, 'large')
  const first = await proteinRow(page, 0)
  expect(first.peptides).toBeGreaterThan(2)
  await expect(page.getByRole('region', { name: /^Protein / })).toHaveCount(0)

  // the CSV of the table has the exact coverage of the first row (the cell rounds it)
  const { lines } = await downloadCsv(page, () => page.getByRole('button', { name: /^Export CSV · / }).click())
  const header = fields(lines[0])
  const csv = fields(lines[1])
  expect(csv[header.indexOf('Accession')]).toContain(first.accession)
  const coverage = csv[header.indexOf('Coverage (%)')]

  await first.row.click()
  const panel = panelOf(page, first.accession)
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('heading', { level: 2 })).toBeVisible()
  await expect(panel.getByTestId('panel-accession')).toContainText(first.accession)
  // the same coverage as the table, the same counts
  await expect(panel.getByTestId('panel-coverage')).toHaveText(`Coverage ${coverage} %`)
  await expect(panel.getByTestId('panel-peptides')).toHaveText(`${first.peptides} peptides`)
  await expect(panel.getByTestId('panel-psms')).toHaveText(`${first.psms.toLocaleString('en-US')} PSMs`)
  // it is a labelled region next to the table, not a dialog; the focus moved into it
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => focusInside(panel)).toBe(true)
  // the table keeps its row selected, and hides the Description to make room
  await expect(first.row).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('results-table').getByRole('columnheader', { name: 'Description' })).toHaveCount(0)

  // Peptides tab (the default): one row per peptide; modified forms of a sequence are rows of their own
  await expect(panel.getByRole('tab', { name: /^Peptides/ })).toHaveAttribute('aria-selected', 'true')
  const peptides = panel.getByTestId('panel-peptide')
  const sequences = new Set(await peptides.evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.sequence)))
  expect(sequences.size).toBe(first.peptides)
  expect(await peptides.count()).toBeGreaterThanOrEqual(first.peptides)

  // the peptide expands in place to its PSMs
  const one = peptides.first()
  const toggle = one.getByRole('button')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const psms = number(await one.locator('[data-column="psms"]').textContent())
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const shown = panel.getByTestId('panel-psm')
  await expect(shown).toHaveCount(Math.min(psms, 10))
  if (psms > 10) await expect(panel.getByRole('button', { name: `+ ${psms - 10} more PSMs` })).toBeVisible()
  // only one peptide is open at a time: the next one closes the first
  if ((await peptides.count()) > 1) {
    await peptides.nth(1).getByRole('button').click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
  }

  // a PSM opens in the PSM table (the PSM view comes with C9): its tab, the PSM selected and in view
  const psm = shown.first()
  const scan = (await psm.getAttribute('data-scan'))!
  expect(scan).toMatch(/^\d+$/)
  await psm.getByRole('button').click()
  await expect(page.getByRole('tab', { name: /^PSMs/ })).toHaveAttribute('aria-selected', 'true')
  await expect(panel).toHaveCount(0)
  const table = page.getByTestId('results-table')
  const selected = table.locator('tr[aria-selected="true"]')
  await expect(selected).toHaveCount(1)
  await expect(selected.locator('[data-column="scan"]')).toHaveText(scan)
  await expect(selected).toBeInViewport()
  await expect(page.getByRole('grid', { name: 'PSMs' })).toBeFocused()
})

test('open in PSM table carries the filter', async ({ page }) => {
  await openDebug(page, 'large')
  const first = await proteinRow(page, 0)
  await first.row.click()
  const panel = panelOf(page, first.accession)
  await panel.getByRole('button', { name: /^Open in PSM table/ }).click()

  await expect(page.getByRole('tab', { name: /^PSMs/ })).toHaveAttribute('aria-selected', 'true')
  const chip = page.getByRole('button', { name: new RegExp(`^Protein: ${first.accession}`) })
  await expect(chip).toBeVisible()
  await expect(chip).toContainText('Protein: ' + first.accession)
  await expect(panel).toHaveCount(0) // the panel belongs to the Proteins tab
  // only that protein's PSMs: as many as the protein's PSMs column says
  await expect(page.getByTestId('row-count')).toHaveText(new RegExp(`^${first.psms.toLocaleString('en-US')} of `))
  expect(await exportCount(page)).toBe(first.psms)
  // ... and each of them is a peptide of that protein (the first accession of a shared peptide may be another one)
  const proteins = await page.getByTestId('results-table').locator('tr[data-index] [data-column="proteins"]').allTextContents()
  expect(proteins.length).toBeGreaterThan(3)
  for (const text of proteins) expect(text).toMatch(new RegExp(`${first.accession}|\\+\\d`))

  // the chip removes the filter: all PSMs again
  await chip.click()
  await expect(chip).toHaveCount(0)
  await expect.poll(() => exportCount(page)).toBeGreaterThan(first.psms)

  // back on Proteins, the protein is still open
  await page.getByRole('tab', { name: /^Proteins/ }).click()
  await expect(panelOf(page, first.accession)).toBeVisible()
})

test('the panel is a labelled region: Esc closes it and the focus returns to the row', async ({ page }) => {
  await openDebug(page, 'large')
  const grid = page.getByRole('grid', { name: 'Proteins' })
  await page.getByRole('button', { name: '+ Filter' }).focus()
  await page.keyboard.press('Tab')
  await expect(grid).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  const third = await proteinRow(page, 2)
  await page.keyboard.press('Enter')

  const panel = panelOf(page, third.accession)
  await expect(panel).toBeVisible()
  await expect.poll(() => focusInside(panel)).toBe(true)
  await expect(grid.getByRole('columnheader', { name: 'Description' })).toHaveCount(0)
  // the key figures give way to the panel, as in the mockup; the grid still has its row
  await expect(page.getByTestId('protein-count')).toHaveCount(0)

  // the expanders are buttons with aria-expanded; the tabs are tabs
  const expander = panel.getByTestId('panel-peptide').first().getByRole('button')
  await expect(expander).toHaveAttribute('aria-expanded', 'false')
  await expander.focus()
  await page.keyboard.press('Enter')
  await expect(expander).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Space')
  await expect(expander).toHaveAttribute('aria-expanded', 'false')

  // Esc closes it; the focus is back on the grid, whose active row is the protein
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(grid).toBeFocused()
  expect(await activeRow(page)).toEqual({ index: 2, inView: true })
  await expect(grid.getByRole('columnheader', { name: 'Description' })).toBeVisible()
  await expect(page.getByTestId('protein-count')).toBeVisible()
  await expect(third.row).toHaveAttribute('aria-selected', 'true')

  // opened again with Enter, and closed with its button this time
  await page.keyboard.press('Enter')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Close protein panel' }).click()
  await expect(panel).toHaveCount(0)
  await expect(grid).toBeFocused()
  expect(await activeRow(page)).toEqual({ index: 2, inView: true })

  // Esc inside another widget does not close it: the menu closes first
  await page.keyboard.press('Enter')
  await expect(panel).toBeVisible()
  await page.getByRole('button', { name: 'Columns' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(panel).toBeVisible()
  // clicking another protein shows that one
  const next = await proteinRow(page, 3)
  await next.row.click()
  await expect(panelOf(page, next.accession)).toBeVisible()
  await expect(panel).toHaveCount(0)
})

test('the coverage strip and map show the coverage and its modified sites', async ({ page }) => {
  await openDebug(page, 'large')
  // the first proteins of the table with a modified site: oxidised M of a peptide (carbamidomethyl-C is
  // fixed, so it is not a site)
  let opened = ''
  let sites = 0
  for (let i = 0; i < 12 && sites === 0; i++) {
    const protein = await proteinRow(page, i)
    await protein.row.click()
    const panel = panelOf(page, protein.accession)
    await expect(panel).toBeVisible()
    sites = number(await panel.getByTestId('panel-sites').textContent())
    opened = protein.accession
  }
  expect(sites, 'a protein with modified sites among the first twelve').toBeGreaterThan(0)
  const panel = panelOf(page, opened)
  await expect(panel.getByTestId('panel-sites')).toHaveText(`${sites} modified ${sites === 1 ? 'site' : 'sites'}`)

  // the strip: one dot per modified site, in the modified-residue colour #1baf7a
  const strip = panel.getByTestId('coverage-strip')
  await expect(strip).toBeVisible()
  const dots = strip.getByTestId('mod-dot')
  await expect(dots).toHaveCount(sites)
  await expect(dots.first()).toHaveCSS('background-color', 'rgb(27, 175, 122)')
  await expect(dots.first()).toHaveAttribute('title', /Oxidation/)
  expect(await strip.getByTestId('coverage-block').count()).toBeGreaterThan(0)

  // the map: blocks of 10 residues, 40 per row; its covered residues are the coverage
  await panel.getByRole('tab', { name: 'Coverage' }).click()
  const map = panel.getByTestId('coverage-map')
  await expect(map).toBeVisible()
  const rows = map.locator('[data-row]')
  const nRows = await rows.count()
  expect(nRows).toBeGreaterThan(1)
  const firstRow = rows.first()
  await expect(firstRow.locator('[data-block]')).toHaveCount(4)
  expect(await firstRow.locator('[data-block]').evaluateAll((b) => b.map((x) => x.textContent!.length))).toEqual([10, 10, 10, 10])
  await expect(firstRow.getByTestId('row-position')).toHaveText('1')
  await expect(rows.nth(1).getByTestId('row-position')).toHaveText('41')
  const { length, covered, dotted } = await map.evaluate((el) => ({
    length: [...el.querySelectorAll('[data-block]')].reduce((n, b) => n + b.textContent!.length, 0),
    covered: [...el.querySelectorAll('[data-covered]')].reduce((n, c) => n + c.textContent!.length, 0),
    dotted: el.querySelectorAll('[data-modified]').length,
  }))
  const percent = number(await panel.getByTestId('panel-coverage').textContent())
  expect(((covered / length) * 100).toFixed(1)).toBe(percent.toFixed(1))
  expect(dotted).toBe(sites)
  // the legend says what is marked, and that fixed modifications are not
  await expect(panel.getByTestId('panel-legend')).toContainText('modified residue')
  await expect(panel.getByTestId('panel-legend')).toContainText('fixed modifications (Carbamidomethyl (C)) are not marked')
})

test('a decoy protein has a panel, too', async ({ page }) => {
  // the small result has no protein q-values, so that its decoys are in the table once they are shown
  await openDebug(page, 'small')
  await page.getByRole('button', { name: '+ Filter' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Show decoys' }).click()
  await page.keyboard.press('Escape')
  await page.getByLabel('Filter proteins').fill('DECOY')
  await expect(page.getByTestId('row-count')).toHaveText(/^\d+ of /)
  await expect.poll(() => page.getByTestId('results-table').locator('[data-index="0"] [data-column="accession"]').textContent()).toContain('decoy')

  const { lines } = await downloadCsv(page, () => page.getByRole('button', { name: /^Export CSV · / }).click())
  const header = fields(lines[0])
  const first = fields(lines[1])
  expect(first[header.indexOf('Accession')]).toContain('DECOY_')
  const row = await proteinRow(page, 0)
  expect(row.psms).toBeGreaterThan(0)
  await row.row.click()
  const panel = panelOf(page, row.accession)
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('panel-coverage')).toHaveText(`Coverage ${first[header.indexOf('Coverage (%)')]} %`)
  await expect(panel.getByTestId('panel-psms')).toHaveText(`${row.psms.toLocaleString('en-US')} PSMs`)
  await expect(panel.getByTestId('panel-decoy')).toBeVisible()
  expect(await panel.getByTestId('panel-peptide').count()).toBeGreaterThan(0)
  await expect(panel.getByTestId('coverage-strip').getByTestId('coverage-block').first()).toBeVisible()

  // its PSMs tab lists them, and the PSM table gets the filter with the decoy shown
  await panel.getByRole('tab', { name: /^PSMs/ }).click()
  await expect(panel.getByRole('grid', { name: /^PSMs of / })).toBeVisible()
  await panel.getByRole('button', { name: /^Open in PSM table/ }).click()
  await expect(page.getByTestId('row-count')).toHaveText(new RegExp(`^${row.psms.toLocaleString('en-US')} of `))
})

test('an open search: the panel\'s PSMs show their mass shift as the PSM table does', async ({ page }) => {
  // in the small result (an open search), every fifth PSM has +15.9949 Da and every seventh -17.0265 Da;
  // the others have no more than 0.05 Da, which shows nothing
  await openDebug(page, 'small')
  const first = await proteinRow(page, 0)
  await first.row.click()
  const panel = panelOf(page, first.accession)
  await panel.getByRole('tab', { name: /^PSMs/ }).click()
  const grid = panel.getByRole('grid', { name: `PSMs of ${first.accession}` })
  await expect(grid).toBeVisible()
  const cells = await grid.locator('tr[data-index] [data-column="peptide"]').allTextContents()
  expect(cells.length).toBeGreaterThan(5)
  const shifted = cells.filter((c) => c.includes('?'))
  expect(shifted.length).toBeGreaterThan(0)
  expect(shifted.length).toBeLessThan(cells.length) // not every PSM has one
  for (const c of shifted) expect(c).toMatch(/^\[[+-]\d+\.\d{4}\]\?/)
  expect(shifted.some((c) => c.startsWith('[+15.9949]?') || c.startsWith('[-17.0265]?'))).toBe(true)

  // and in the expanded peptide of the Peptides tab: a PSM with a shift carries it, one without does not
  await panel.getByRole('tab', { name: /^Peptides/ }).click()
  const peptides = panel.getByTestId('panel-peptide')
  let withShift = 0
  let without = 0
  for (let i = 0; i < Math.min(await peptides.count(), 6); i++) {
    await peptides.nth(i).getByRole('button').click()
    for (const text of await panel.getByTestId('panel-psm').allTextContents()) {
      if (/\[[+-]\d+\.\d{4}\]\?/.test(text)) withShift++
      else without++
    }
  }
  expect(withShift).toBeGreaterThan(0)
  expect(without).toBeGreaterThan(0)
})

test('the PSMs tab of the panel lists the protein\'s PSMs, sorted and virtualized', async ({ page }) => {
  await openDebug(page, 'large')
  const first = await proteinRow(page, 0)
  await first.row.click()
  const panel = panelOf(page, first.accession)
  await panel.getByRole('tab', { name: /^PSMs/ }).click()
  await expect(panel.getByRole('tab', { name: /^PSMs/ })).toContainText(first.psms.toLocaleString('en-US'))
  const grid = panel.getByRole('grid', { name: `PSMs of ${first.accession}` })
  await expect(grid).toBeVisible()
  await expect(grid).toHaveAttribute('aria-rowcount', String(first.psms + 1))
  // best q-value first
  const q = grid.getByRole('columnheader', { name: 'q-value' })
  await expect(q).toHaveAttribute('aria-sort', 'ascending')
  // a click opens the PSM
  const scan = (await grid.locator('[data-index="0"] [data-column="scan"]').textContent())!.trim()
  await grid.locator('[data-index="0"]').click()
  await expect(page.getByRole('tab', { name: /^PSMs/ }).first()).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('results-table').locator('tr[aria-selected="true"] [data-column="scan"]')).toHaveText(scan)
})

test('with the panel open, the filter field does not clip its placeholder', async ({ page }) => {
  await openDebug(page, 'large')
  const first = await proteinRow(page, 0)
  await first.row.click()
  await expect(panelOf(page, first.accession)).toBeVisible()
  const field = page.getByLabel('Filter proteins')
  const { text, room } = await field.evaluate((input: HTMLInputElement) => {
    const style = getComputedStyle(input)
    const canvas = document.createElement('canvas').getContext('2d')!
    canvas.font = style.font
    return { text: canvas.measureText(input.placeholder).width, room: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) }
  })
  expect(text + 4).toBeLessThanOrEqual(room)
})
