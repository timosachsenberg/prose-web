import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// The New search page without running a search: the design table, its notices, paste, the rescoring
// switches and the "All parameters" dialog.

const mzml = (name: string) => ({
  name,
  mimeType: 'application/xml',
  buffer: Buffer.from(`<?xml version="1.0"?><mzML><run id="r"><spectrumList count="1234"></spectrumList></run></mzML>`),
})

async function addFiles(page: Page, names: string[]) {
  await page.locator('input[type="file"][accept=".mzML,.mzml"]').first().setInputFiles(names.map(mzml))
}

test('one file needs no design; two files show it with assumed values', async ({ page }) => {
  await page.goto('./')
  await addFiles(page, ['run_a.mzML'])
  await expect(page.getByText('One file needs no design')).toBeVisible()
  await expect(page.getByLabel('Condition of run_a.mzML')).toHaveCount(0)
  await expect(page.getByRole('cell', { name: '1,234' })).toBeVisible()

  await addFiles(page, ['run_b.mzML'])
  await expect(page.getByTestId('design-summary')).toHaveText('2 files → 2 samples')

  // every editable cell looks like an input; assumed values are grey italic placeholders
  const condition = page.getByLabel('Condition of run_a.mzML')
  const replicate = page.getByLabel('Replicate of run_b.mzML', { exact: true })
  await expect(condition).toHaveAttribute('placeholder', '') // no assumed condition: an empty input
  const look = await replicate.evaluate((el) => {
    const style = getComputedStyle(el)
    const placeholder = getComputedStyle(el, '::placeholder')
    return { border: style.borderTopColor, color: placeholder.color, italic: placeholder.fontStyle }
  })
  expect(look.border).not.toBe('rgba(0, 0, 0, 0)')
  expect(look.italic).toBe('italic')
  expect(look.color).not.toBe('rgb(161, 161, 170)') // zinc-400 is too faint (2.6:1)

  // an entry that is not valid stays, marked, until it is corrected
  await replicate.fill('1.5')
  await replicate.press('Tab')
  await expect(replicate).toHaveValue('1.5')
  await expect(replicate).toHaveAttribute('aria-invalid', 'true')
  await replicate.fill('')
  await expect(replicate).toHaveAttribute('aria-invalid', 'false')

  // the table header sticks over long tables
  expect(await page.locator('thead th').first().evaluate((el) => getComputedStyle(el).position)).toBe('sticky')
  await page.getByLabel('Condition of run_a.mzML').fill('EGF')
  await page.getByLabel('Condition of run_b.mzML').fill('EGF')
  await expect(page.getByTestId('design-summary')).toHaveText('2 files → 2 samples · 1 condition')
  await expect(page.getByLabel('Replicate of run_b.mzML')).toHaveAttribute('placeholder', '2')

  // Advanced: Fraction group (1-based) and Sample labels, and an editable technical replicate
  await page.getByLabel('Advanced').click()
  const rows = page.locator('tbody tr')
  await expect(rows.nth(0)).toContainText('EGF 1')
  await expect(rows.nth(1)).toContainText('EGF 2')
  await expect(rows.nth(0).locator('td').nth(4)).toHaveText('1')
  await expect(rows.nth(1).locator('td').nth(4)).toHaveText('2')

  // the same replicate twice: a technical replicate notice with "Change"
  await page.getByLabel('Replicate of run_b.mzML', { exact: true }).fill('1')
  const notice = page.locator('[data-slot="notice"]')
  await expect(notice.filter({ hasText: 'are the same sample (EGF 1) and are kept as technical replicates' })).toBeVisible()
  // one polite live region announces the notices
  await expect(page.locator('[aria-live="polite"][aria-atomic="true"]')).toHaveText(/^1 notice: run_a and run_b/)
  await page.getByRole('button', { name: 'Change' }).click()
  await expect(page.getByLabel('Replicate of run_b.mzML', { exact: true })).toBeFocused()
})

test('the same file name twice disables Save design.tsv and says why', async ({ page }) => {
  await page.goto('./')
  await addFiles(page, ['same.mzML', 'same.mzML'])
  await expect(page.locator('[data-slot="notice"]').filter({ hasText: 'same.mzML is listed 2 times' })).toBeVisible()
  const save = page.getByRole('button', { name: 'Save design.tsv' })
  await expect(save).toHaveAttribute('aria-disabled', 'true')
  await save.hover()
  await expect(page.getByRole('tooltip')).toContainText('same.mzML is listed 2 times')
  // focusable for keyboard users, with the tooltip as its description
  await page.mouse.move(0, 0)
  await save.focus()
  await expect(save).toHaveAttribute('aria-describedby', /.+/)
})

test('saves design.tsv and pastes conditions from a spreadsheet', async ({ page }) => {
  await page.goto('./')
  await addFiles(page, ['ctrl_F1.mzML', 'ctrl_F2.mzML', 'egf.mzML'])
  await page.getByRole('button', { name: 'Paste from spreadsheet' }).click()
  await page.getByLabel('Pasted rows').fill('File\tCondition\tFraction\nctrl_F1.mzML\tcontrol\t1\nctrl_F2\tcontrol\t2\negf.mzML\tEGF\t')
  await page.getByRole('button', { name: 'Apply to the table' }).click()
  await expect(page.getByTestId('design-summary')).toHaveText('3 files → 2 samples · 2 conditions · fractions 1–2')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save design.tsv' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('design.tsv')
  const text = await (await file.createReadStream()).toArray()
  expect(Buffer.concat(text).toString()).toContain('Fraction_Group\tFraction\tSpectra_Filepath')
})

test('PeptDeep needs Percolator; the dialog has no second control for them', async ({ page }) => {
  await page.goto('./')
  const peptdeep = page.getByRole('switch', { name: 'PeptDeep predictions' })
  await expect(peptdeep).toBeEnabled({ timeout: 120_000 }) // once OpenMS reports ONNX Runtime
  await page.getByRole('switch', { name: 'Percolator' }).click()
  await expect(peptdeep).toBeDisabled()
  await expect(page.getByText('Needs Percolator')).toBeVisible()

  await page.getByRole('button', { name: /^All \d+ parameters/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('enzyme', { exact: true })).toBeVisible()
  for (const name of ['rescore', 'peptdeep:enable', 'peptdeep:ms2_model', 'peptdeep:rt_model', 'peptdeep:instrument']) {
    await expect(dialog.getByText(name, { exact: true })).toHaveCount(0)
  }
  // a change in the dialog reaches the page's field
  await dialog.getByLabel('Find a parameter').fill('missed')
  await dialog.locator('#param-peptide-missed_cleavages').fill('3')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByLabel('Missed cleavages')).toHaveValue('3')
  await expect(page.getByText('modified', { exact: true })).toBeVisible()
})

test('the table fits the card with long names and Advanced on; a stale invalid entry does not come back', async ({ page }) => {
  const names = ['20240115_QExactiveHF_sample_ctrl_rep1_F01.mzML', '20240115_QExactiveHF_sample_ctrl_rep2_F02.mzML']
  for (const width of [1024, 1280]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('./')
    await addFiles(page, names)
    await page.getByLabel('Advanced').click()
    const m = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="design-scroll"]') as HTMLElement
      const card = box.closest('[data-slot="card"]') as HTMLElement
      const sample = document.querySelector('tbody tr td:nth-of-type(6)') as HTMLElement
      return {
        over: box.getBoundingClientRect().right - card.getBoundingClientRect().right,
        pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        sampleTitle: sample.title,
        sampleTruncated: sample.scrollWidth > sample.clientWidth,
      }
    })
    expect(m.over, `table box overflows the card at ${width} px`).toBeLessThanOrEqual(0)
    expect(m.pageScroll, `page scrolls sideways at ${width} px`).toBe(0)
    expect(m.sampleTitle).toBe('20240115_QExactiveHF_sample_ctrl_rep1_F01')
    expect(m.sampleTruncated).toBe(true)
  }

  // "abc" typed and left, then a pasted 2, then a pasted empty cell: the cell is empty, not "abc"
  const replicate = page.getByLabel(`Replicate of ${names[1]}`, { exact: true })
  await replicate.fill('abc')
  await replicate.press('Tab')
  await expect(replicate).toHaveValue('abc')
  const paste = async (cell: string) => {
    await page.getByRole('button', { name: 'Paste from spreadsheet' }).click()
    await page.getByLabel('Pasted rows').fill(`File\tReplicate\n${names[1]}\t${cell}`)
    await page.getByRole('button', { name: 'Apply to the table' }).click()
  }
  await paste('2')
  await expect(replicate).toHaveValue('2')
  await paste('')
  await expect(replicate).toHaveValue('')
  await expect(replicate).toHaveAttribute('aria-invalid', 'false')
})

test('notices present when the design appears are announced; describedby only names what exists', async ({ page }) => {
  await page.goto('./')
  const start = page.getByRole('button', { name: /^Start search/ })
  await expect(start).not.toHaveAttribute('aria-describedby')
  // what the live region holds when it is inserted (it must start empty to announce the first notices)
  await page.evaluate(() => {
    const w = window as unknown as { firstAnnouncement?: string | null }
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="notice-announcer"]')
      if (el && w.firstAnnouncement === undefined) w.firstAnnouncement = el.textContent
    }).observe(document.body, { childList: true, subtree: true })
  })
  await addFiles(page, ['same.mzML', 'same.mzML'])
  await expect(page.getByTestId('notice-announcer')).toHaveText(/^1 notice: same\.mzML is listed 2 times/)
  expect(await page.evaluate(() => (window as unknown as { firstAnnouncement?: string }).firstAnnouncement)).toBe('')
  await expect(start).toHaveAttribute('aria-describedby', 'start-problem')
  await expect(page.locator('#start-problem')).toHaveText('Choose a FASTA database to start.')
})

test('Start search waits for a database and a PSM FDR above 0', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('prose.presets', JSON.stringify([{ id: 'u1', name: 'No filter', parameters: { 'FDR:PSM': 0 } }]))
  })
  await page.goto('./')
  const start = page.getByRole('button', { name: /^Start search/ })
  await expect(start).toBeDisabled()
  await addFiles(page, ['run.mzML'])
  await expect(page.getByText('Choose a FASTA database to start.')).toBeVisible()
  await page.locator('input[type="file"][accept^=".fasta"]').setInputFiles({
    name: 'db.fasta',
    mimeType: 'text/plain',
    buffer: Buffer.from('>sp|P1|A\nPEPTIDEK\n>sp|P2|B\nAAAK\n'),
  })
  await expect(page.getByTestId('fasta-proteins')).toHaveText('2 proteins')
  await expect(start).toBeEnabled()
  await expect(start).toHaveAttribute('aria-keyshortcuts', 'Control+Enter')
  await expect(start.locator('kbd')).toHaveAttribute('aria-hidden', 'true')
  await expect(page.getByTestId('search-plan')).toContainText('1 file · 2 proteins + 116 cRAP + decoys · estimated memory')

  // a user preset without an FDR filter (FDR:PSM 0) cannot start: the cutoffs must be above 0
  await page.getByLabel('Preset').click()
  await page.getByRole('option', { name: 'No filter' }).click()
  await expect(page.getByText('Set a PSM FDR above 0 %.')).toBeVisible()
  await expect(start).toBeDisabled()
})

test('Cancel while OpenMS loads ends at once; typed modifications are checked when it is loaded', async ({ page }) => {
  test.setTimeout(120_000)
  // hold the module back, so that the search is started while OpenMS loads
  await page.route('**/openms.wasm', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 8000))
    await route.continue().catch(() => {})
  })
  await page.goto('./')
  await expect(page.getByTestId('engine-status')).toHaveText('Loading OpenMS…')
  await page.getByRole('button', { name: 'Try the example' }).click()
  await expect(page.getByTestId('fasta-proteins')).toContainText('proteins')

  await page.getByRole('button', { name: /^Start search/ }).click()
  await expect(page.getByTestId('search-progress')).toContainText('Starting OpenMS')

  // on another view, the top bar shows the running search and leads back to it
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'History' }).click()
  const indicator = page.getByTestId('topbar-search-progress')
  await expect(indicator).toBeVisible()
  await indicator.click()
  await expect(page).toHaveURL(/#\/search$/)
  await expect(indicator).toHaveCount(0)

  const cancelled = Date.now()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('The search was cancelled.')).toBeVisible({ timeout: 2000 })
  expect(Date.now() - cancelled).toBeLessThan(2000)
  await expect(page.getByTestId('engine-status')).toHaveText('Loading OpenMS…') // it goes on loading

  // a name typed while OpenMS loads is marked as not checked yet ...
  await page.getByRole('button', { name: 'Add a variable modification' }).click()
  await page.getByLabel('Find a modification').fill('Foo (X)')
  await page.getByRole('option', { name: /Add Foo \(X\)/ }).click()
  await expect(page.locator('[data-state="unverified"]')).toContainText('Foo (X)')

  // ... and checked when the search starts (OpenMS loaded by then)
  await page.getByRole('button', { name: /^Start search/ }).click()
  const error = page.getByTestId('search-error')
  await expect(error).toContainText('Before the search: Unknown modification: Foo (X).', { timeout: 60_000 })
  await expect(page.locator('[data-state="unknown"]')).toContainText('Foo (X)')
  await expect(page.getByText(/^Unknown modification: Foo \(X\)\./)).toBeVisible() // why Start is disabled
  await expect(page.getByRole('button', { name: /^Start search/ })).toBeDisabled()
})

test('an engine error names the stage and the file, with OpenMS\' text as detail', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('./')
  await expect(page.getByTestId('engine-status')).toContainText('thread', { timeout: 60_000 })
  await page.locator('input[type="file"][accept=".mzML,.mzml"]').first().setInputFiles([
    { name: 'good.mzML', mimeType: 'application/xml', buffer: readFileSync('public/example/DatabaseSuitability_in_spec.mzML') },
    { name: 'broken.mzML', mimeType: 'application/xml', buffer: Buffer.from('<?xml version="1.0"?><mzML><run><spectrumList count="2">not really') },
  ])
  await page.locator('input[type="file"][accept^=".fasta"]').setInputFiles({
    name: 'db.fasta',
    mimeType: 'text/plain',
    buffer: Buffer.from('>sp|P1|A\nPEPTIDEK\n>sp|P2|B\nAAAK\n'),
  })
  await page.getByRole('switch', { name: 'Percolator' }).click() // faster
  await page.getByRole('button', { name: /^Start search/ }).click()

  const error = page.getByTestId('search-error')
  await expect(error).toContainText(
    'While searching file 2 of 2 (broken.mzML): Parse Error. The file may be incomplete or not valid mzML.',
    { timeout: 60_000 },
  )
  const detail = error.locator('details')
  await expect(detail).not.toHaveAttribute('open')
  await expect(detail.locator('summary')).toHaveText('OpenMS message')
  await expect(detail).toContainText('XMLHandler')
  await expect(page.getByText('The search stopped: see the message above.')).toBeVisible()
})

/** The example's first `count` spectra as a small mzML (Percolator needs at least 100 PSMs per file). */
function exampleSubset(count: number): Buffer {
  const text = readFileSync('public/example/DatabaseSuitability_in_spec.mzML', 'latin1')
  const start = text.indexOf('<mzML ')
  let end = start
  for (let k = 0; k < count; k++) end = text.indexOf('</spectrum>', end) + '</spectrum>'.length
  const body = text.slice(start, end).replace(/<spectrumList count="\d+"/, `<spectrumList count="${count}"`)
  return Buffer.from(`<?xml version="1.0" encoding="ISO-8859-1"?>\n${body}\n</spectrumList></run></mzML>\n`, 'latin1')
}

test('a Percolator failure is attributed to Percolator, not to the last file searched', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('./')
  await expect(page.getByTestId('engine-status')).toContainText('thread', { timeout: 60_000 })
  await page.locator('input[type="file"][accept=".mzML,.mzml"]').first().setInputFiles([
    { name: 'small.mzML', mimeType: 'application/xml', buffer: exampleSubset(12) },
    { name: 'good.mzML', mimeType: 'application/xml', buffer: readFileSync('public/example/DatabaseSuitability_in_spec.mzML') },
  ])
  await page.locator('input[type="file"][accept^=".fasta"]').setInputFiles('public/example/DatabaseSuitability_database.fasta')
  await expect(page.getByTestId('fasta-proteins')).toContainText('proteins')
  await page.getByRole('button', { name: /^Start search/ }).click()

  const error = page.getByTestId('search-error')
  await expect(error).toContainText('While rescoring with Percolator: Percolator could rescore only some of the files', {
    timeout: 120_000,
  })
  await expect(error).toContainText('not rescored: small.mzML')
  await expect(error).not.toContainText('While searching')
})
