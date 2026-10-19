import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// The Results view with a stored synthetic result: ?debug=large opens makeLargeTables (150,000 PSMs,
// 20,000 peptides, 4,000 proteins in 6 files, control 1–3 and EGF 1–3), ?debug=small a 3,000-PSM one.
// The debug result's PSM FDR is 100 % (every PSM counts), its protein FDR 1 %.

async function openDebug(page: Page, which: 'large' | 'large1' | 'small') {
  await page.goto(`./?debug=${which}`)
  await expect(page).toHaveURL(/#\/results\/[^/]+$/)
  await expect(page.getByTestId('results-table')).toBeVisible({ timeout: 30_000 })
}

/** The number of rows the export button promises ("Export CSV · 1,234 rows"). */
async function exportCount(page: Page): Promise<number> {
  const text = await page.getByRole('button', { name: /^Export CSV · / }).textContent()
  return Number(text!.replace(/^.*·/, '').replace(/[^\d]/g, ''))
}

/** The fields of a CSV line (RFC 4180 quotes; the test data have no line breaks in fields). */
function fields(line: string): string[] {
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
async function downloadCsv(page: Page, trigger: () => Promise<void>): Promise<{ name: string; lines: string[] }> {
  const download = page.waitForEvent('download')
  await trigger()
  const file = await download
  const text = readFileSync((await file.path())!, 'utf8')
  expect(text.charCodeAt(0)).toBe(0xfeff)
  expect(text.endsWith('\n')).toBe(true)
  return { name: file.suggestedFilename(), lines: text.slice(1, -1).split('\n') }
}

test('scrolls a 150k-row PSM table', async ({ page }) => {
  test.setTimeout(120_000)
  await openDebug(page, 'large')
  await page.getByRole('tab', { name: /^PSMs/ }).click()
  // contaminants and decoys too: all 150,000 PSMs (the search's PSM FDR is 100 %)
  await page.getByRole('button', { name: /Contaminants hidden/ }).click()
  await page.getByRole('button', { name: '+ Filter' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Show decoys' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Export CSV · 150,000 rows' })).toBeVisible()
  const table = page.getByTestId('results-table')
  await expect(table.getByRole('grid')).toHaveAttribute('aria-rowcount', '150001')

  // scroll from the top to the bottom over 90 frames, and time every frame; the first rendered row
  // shows that each frame rendered new rows
  const scroll = () =>
    page.getByTestId('table-scroll').evaluate(async (box: HTMLElement) => {
      const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve))
      const firstRow = () => Number(box.querySelector('tr[data-index]')?.getAttribute('data-index'))
      box.scrollTop = 0
      await frame()
      const end = box.scrollHeight - box.clientHeight
      const steps = 90
      const times: number[] = []
      const firsts: number[] = []
      let last = await frame()
      for (let i = 1; i <= steps; i++) {
        box.scrollTop = Math.round((end * i) / steps)
        const now = await frame()
        times.push(now - last)
        firsts.push(firstRow())
        last = now
      }
      for (let i = 0; i < 5; i++) {
        const now = await frame()
        times.push(now - last)
        last = now
      }
      return { times, firsts }
    })
  const report = (what: string, times: number[]) => {
    const sorted = [...times].sort((a, b) => a - b)
    const max = sorted.at(-1)!
    const slow = times.flatMap((x, i) => (x > 20 ? [`#${i}: ${x.toFixed(1)}`] : []))
    console.log(
      `${what}: ${times.length} frames, median ${sorted[times.length >> 1].toFixed(1)} ms, max ${max.toFixed(1)} ms` +
        (slow.length > 0 ? ` (over 20 ms: ${slow.join(', ')})` : ''),
    )
    return max
  }

  const { times, firsts } = await scroll()
  expect(report('frame times', times)).toBeLessThan(50)
  expect(new Set(firsts).size).toBeGreaterThan(80) // new rows in (almost) every frame
  expect(firsts.at(-1)).toBeGreaterThan(149_000)

  // the same on a 4× slower CPU (Chromium's throttling), for slower computers: each frame here jumps
  // 1,700 rows (all rows new), so frames take one to three vsyncs; reported, with a loose bound
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const slow = await scroll()
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  expect(report('frame times at 4× CPU throttling', slow.times)).toBeLessThan(100)

  const lastRow = table.locator('[data-index="149999"]')
  await expect(lastRow).toBeInViewport()
  await expect(lastRow).toBeVisible()
  await expect(lastRow).toHaveAttribute('aria-rowindex', '150001')
})

test('sorts and filters proteins', async ({ page }) => {
  await openDebug(page, 'large')
  await expect(page.getByRole('tab', { name: /^Proteins/ })).toHaveAttribute('aria-selected', 'true')
  const table = page.getByTestId('results-table')
  const psmsHeader = table.getByRole('columnheader', { name: /^PSMs/ })

  // ascending first, then descending
  const sortButton = psmsHeader.getByRole('button')
  for (let i = 0; i < 3 && (await psmsHeader.getAttribute('aria-sort')) !== 'ascending'; i++) await sortButton.click()
  await expect(psmsHeader).toHaveAttribute('aria-sort', 'ascending')
  await sortButton.click()
  await expect(psmsHeader).toHaveAttribute('aria-sort', 'descending')

  const first = table.locator('[data-index="0"]')
  const accession = (await first.locator('[data-column="accession"]').textContent())!.trim()
  const topPsms = Number((await first.locator('[data-column="psms"]').textContent())!.replace(/[^\d]/g, ''))
  expect(topPsms).toBeGreaterThan(0)

  // the first row has the highest PSM count of the whole (filtered) table: the CSV has all of them
  const { lines } = await downloadCsv(page, () => page.getByRole('button', { name: /^Export CSV · / }).click())
  const header = fields(lines[0])
  const psmColumn = header.indexOf('PSMs')
  const counts = lines.slice(1).map((line) => Number(fields(line)[psmColumn]))
  expect(Math.max(...counts)).toBe(topPsms)
  expect(counts[0]).toBe(topPsms)
  expect(lines[1]).toContain(accession)

  // the first accession in the filter: one row
  await page.getByLabel('Filter proteins').fill(accession)
  await expect(page.getByRole('button', { name: 'Export CSV · 1 row' })).toBeVisible()
  await expect(table.locator('[data-index="0"] [data-column="accession"]')).toHaveText(accession)
  await expect(table.locator('[data-index="1"]')).toHaveCount(0)
})

test('exports the filtered view as CSV', async ({ page }) => {
  await openDebug(page, 'large')
  const all = await exportCount(page)
  await page.getByLabel('Filter proteins').fill('family 7')
  await expect.poll(() => exportCount(page)).toBeLessThan(all)
  const n = await exportCount(page)
  expect(n).toBeGreaterThan(1)
  await expect(page.getByTestId('row-count')).toHaveText(new RegExp(`^${n.toLocaleString('en-US')} of `))

  const { name, lines } = await downloadCsv(page, () => page.getByRole('button', { name: /^Export CSV · / }).click())
  expect(name).toMatch(/proteins\.csv$/)
  expect(lines).toHaveLength(n + 1)
  for (const sample of ['control 1', 'control 2', 'control 3', 'EGF 1', 'EGF 2', 'EGF 3']) {
    expect(fields(lines[0])).toContain(sample)
  }

  // the header's Export menu: CSV of the current view; the project waits for History; no idXML
  // without the engine's result
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'CSV (current view)' })).toBeEnabled()
  await expect(page.getByRole('menuitem', { name: 'Design (design.tsv)' })).toBeEnabled()
  await expect(page.getByRole('menuitem', { name: 'Project (.prose)' })).toHaveAttribute('aria-disabled', 'true')
  const idxml = page.getByRole('menuitem', { name: 'idXML (merged)' })
  await expect(idxml).toHaveAttribute('aria-disabled', 'true')
  await expect(idxml).toHaveAttribute('title', 'Run the search again to export idXML')
  const fromMenu = await downloadCsv(page, () => page.getByRole('menuitem', { name: 'CSV (current view)' }).click())
  expect(fromMenu.lines).toEqual(lines)
})

test('switches modifications to ProForma', async ({ page }) => {
  await openDebug(page, 'large')
  await page.getByRole('tab', { name: /^Peptides/ }).click()
  await expect(page.getByText('Best PSM q-value ≤')).toBeVisible()
  await page.getByLabel('Filter peptides').fill('oxidation')
  const cell = page.getByTestId('results-table').locator('[data-index="0"] [data-column="peptide"]')
  // marked: the residue carries the short label (Mᵒˣ), no brackets
  await expect(cell.locator('.m').first()).toHaveText('Mox')
  await expect(cell).not.toContainText('[Oxidation]')
  await expect(page.getByTestId('mod-legend')).toContainText('not marked')

  await page.getByRole('button', { name: 'Columns' }).click()
  await page.getByRole('menuitemradio', { name: 'ProForma' }).click()
  await page.keyboard.press('Escape')
  await expect(cell).toContainText('M[Oxidation]')
  await expect(page.getByTestId('mod-legend')).toContainText('fixed modifications included')

  // back to marked residues (the setting persists across sessions)
  await page.getByRole('button', { name: 'Columns' }).click()
  await page.getByRole('menuitemradio', { name: 'Marked residues' }).click()
  await page.keyboard.press('Escape')
  await expect(cell).not.toContainText('[Oxidation]')
})

/** The grid's active row (aria-activedescendant): its position and whether it is in the scroll box's view. */
async function activeRow(page: Page): Promise<{ index: number; inView: boolean }> {
  return page.getByTestId('table-scroll').evaluate((box: HTMLElement) => {
    const id = box.getAttribute('aria-activedescendant')
    const row = id ? document.getElementById(id) : null
    if (!row) return { index: -1, inView: false }
    const header = box.querySelector('thead')!.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    return { index: Number(row.dataset.index), inView: r.top >= header.bottom - 1 && r.bottom <= b.bottom + 1 }
  })
}

test('tables are keyboard-navigable and filters are labelled', async ({ page }) => {
  await openDebug(page, 'small')
  const table = page.getByTestId('results-table')
  const grid = page.getByRole('grid', { name: 'Proteins' })

  // the grid is the table's one tab stop: from "+ Filter", Tab goes to it
  await page.getByRole('button', { name: '+ Filter' }).focus()
  await page.keyboard.press('Tab')
  await expect(grid).toBeFocused()
  expect(await activeRow(page)).toEqual({ index: 0, inView: true })
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  expect(await activeRow(page)).toEqual({ index: 2, inView: true })
  await page.keyboard.press('Enter')
  await expect(table.locator('[data-index="2"]')).toHaveAttribute('aria-selected', 'true')
  await expect(table.locator('[aria-selected="true"]')).toHaveCount(1)
  await page.keyboard.press('End')
  expect(await activeRow(page)).toMatchObject({ inView: true })
  expect((await activeRow(page)).index).toBe((await exportCount(page)) - 1)
  await page.keyboard.press('Home')
  expect(await activeRow(page)).toEqual({ index: 0, inView: true })

  // a click selects the row and makes it the active one
  await table.locator('[data-index="4"]').click()
  await expect(table.locator('[data-index="4"]')).toHaveAttribute('aria-selected', 'true')
  await expect(grid).toBeFocused()
  expect((await activeRow(page)).index).toBe(4)

  // the sort buttons in the header keep their keys: Enter on one sorts, it does not select a row
  const selectedAccession = await table.locator('[aria-selected="true"] [data-column="accession"]').textContent()
  const egf3 = grid.getByRole('button', { name: 'EGF 3', exact: true })
  await egf3.focus()
  await page.keyboard.press('Enter')
  await expect(grid.getByRole('columnheader', { name: 'EGF 3' })).toHaveAttribute('aria-sort', 'descending')
  await expect(egf3).toBeFocused()
  for (const cell of await table.locator('[aria-selected="true"] [data-column="accession"]').all()) {
    await expect(cell).toHaveText(selectedAccession!) // still the same protein, wherever it is now
  }

  // sample columns are named with their condition
  await expect(grid.getByRole('button', { name: 'control 1', exact: true })).toBeVisible()
  await expect(grid.getByRole('button', { name: 'EGF 3', exact: true })).toBeVisible()

  // contaminants are hidden by default; the chip shows them again
  const chip = page.getByRole('button', { name: /Contaminants hidden/ })
  await expect(chip).toBeVisible()
  const before = await exportCount(page)
  await chip.click()
  await expect.poll(() => exportCount(page)).toBeGreaterThan(before)
  await expect(page.getByText('contaminant', { exact: true }).first()).toBeVisible()

  // every filter of every level has an accessible name
  for (const tab of ['Proteins', 'Peptides', 'PSMs']) {
    await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click()
    const unlabelled = await page.getByTestId('filter-bar').evaluate((bar) =>
      [...bar.querySelectorAll('input, button, [role="combobox"]')]
        .filter((el) => !(el as HTMLElement).innerText?.trim() && !el.getAttribute('aria-label') && !(el as HTMLInputElement).labels?.length)
        .map((el) => el.outerHTML.slice(0, 80)),
    )
    expect(unlabelled).toEqual([])
  }
  await expect(page.getByLabel('Filter PSMs')).toBeVisible()
})

test('after scrolling with the mouse, the keyboard goes on from a row in view', async ({ page }) => {
  await openDebug(page, 'large')
  await page.getByRole('tab', { name: /^PSMs/ }).click()
  const table = page.getByTestId('results-table')
  const grid = page.getByRole('grid', { name: 'PSMs' })

  // focus row 2, then scroll 40 rows away with the mouse wheel
  await table.locator('[data-index="2"]').click()
  await page.keyboard.press('ArrowDown')
  expect(await activeRow(page)).toEqual({ index: 3, inView: true })
  await grid.hover()
  await page.mouse.wheel(0, 33 * 40)
  await expect.poll(async () => (await activeRow(page)).index).toBeGreaterThan(30)
  const moved = await activeRow(page)
  expect(moved.inView).toBe(true)
  await expect(grid).toBeFocused()
  // Enter selects the row the user sees, ArrowDown goes on from it
  await page.keyboard.press('Enter')
  await expect(table.locator(`[data-index="${moved.index}"]`)).toHaveAttribute('aria-selected', 'true')
  await expect(table.locator('[aria-selected="true"]')).toHaveCount(1) // not row 3 any more
  await page.keyboard.press('ArrowDown')
  expect(await activeRow(page)).toEqual({ index: moved.index + 1, inView: true })

  // scrolled with the mouse and nothing focused: Tab still reaches the grid, at a row in view
  await page.getByLabel('Filter PSMs').focus()
  await grid.hover()
  await page.mouse.wheel(0, 33 * 500)
  await expect.poll(async () => (await activeRow(page)).index).toBeGreaterThan(400)
  await page.getByRole('button', { name: '+ Filter' }).focus()
  await page.keyboard.press('Tab')
  await expect(grid).toBeFocused()
  const after = await activeRow(page)
  expect(after.inView).toBe(true)
  await page.keyboard.press('ArrowUp')
  expect(await activeRow(page)).toEqual({ index: after.index - 1, inView: true })
})

test('a search at a PSM FDR of 1 %: the PSM filter tightens it, and the CSV follows', async ({ page }) => {
  await openDebug(page, 'large1')
  await page.getByRole('tab', { name: /^PSMs/ }).click()
  const filter = page.getByRole('button', { name: /^PSM FDR ≤ 1 %/ })
  await expect(filter).toContainText('(q ≤ 0.01)')
  const atSearch = await exportCount(page)
  expect(atSearch).toBeGreaterThan(10_000)
  expect(atSearch).toBeLessThan(150_000)

  // looser choices are disabled; 0.1 % tightens it
  await filter.click()
  await expect(page.getByRole('button', { name: '5 %', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '0.1 %', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /^PSM FDR ≤ 0.1 %/ })).toBeVisible()
  await expect.poll(() => exportCount(page)).toBeLessThan(atSearch)
  const n = await exportCount(page)
  const { lines } = await downloadCsv(page, () => page.getByRole('button', { name: /^Export CSV · / }).click())
  expect(lines).toHaveLength(n + 1)
  const q = fields(lines[0]).indexOf('q-value')
  expect(lines.slice(1).every((line) => Number(fields(line)[q]) <= 0.001)).toBe(true)
  await expect(page.getByRole('button', { name: /^Export CSV · / })).toBeEnabled()
})

test('an open search without protein FDR: the shifts, the score, the unavailable filter', async ({ page }) => {
  await openDebug(page, 'small')
  // no protein q-values: the protein FDR filter is unavailable, and says why
  const fdr = page.getByRole('button', { name: 'Protein FDR: not available' })
  await expect(fdr).toHaveAttribute('aria-disabled', 'true')
  await fdr.hover()
  await expect(page.getByRole('tooltip')).toContainText('applied no protein FDR')
  await expect(page.getByTestId('protein-count').locator('..')).toContainText('no protein FDR')
  await page.mouse.move(0, 700)
  await expect(page.getByRole('tooltip')).toHaveCount(0)

  await page.getByRole('tab', { name: /^PSMs/ }).click()
  const table = page.getByTestId('results-table')
  // the score is ln(hyperscore) without Percolator; the mass shift column shows in an open search
  await expect(table.getByRole('columnheader', { name: 'ln(hyperscore)' })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: /Δ mass/ })).toBeVisible()
  // sorted by spectrum (as text: scan=1, scan=10, scan=100, scan=1000, scan=1001, scan=1002, …): PSM 0
  // (scan=1) has +15.9949 Da, PSM 9 (scan=10) none (|Δ| ≤ 0.05 Da), PSM 1001 (scan=1002) -17.0265 Da
  await table.getByRole('columnheader', { name: 'Spectrum' }).getByRole('button').click()
  const peptideOf = (scan: number) =>
    table.locator('tr[data-index]').filter({ has: page.locator(`[data-column="scan"]`, { hasText: new RegExp(`^${scan}$`) }) }).locator('[data-column="peptide"]')
  await expect(peptideOf(1)).toContainText('[+15.9949]?')
  await expect(peptideOf(10)).not.toContainText('?')
  await expect(peptideOf(1002)).toContainText('[-17.0265]?')

  // the CSV writes the shift as an unlocalized ProForma mass
  const { lines } = await downloadCsv(page, () => page.getByRole('button', { name: /^Export CSV · / }).click())
  const header = fields(lines[0])
  const first = fields(lines[1])
  expect(first[header.indexOf('Spectrum')]).toContain('scan=1')
  expect(first[header.indexOf('Peptide')]).toMatch(/^\[\+15\.9949\]\?[A-Z]/)
})
