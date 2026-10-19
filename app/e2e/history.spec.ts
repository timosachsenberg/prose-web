import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { chromium, devices, expect, test, type BrowserContext, type Page } from '@playwright/test'
import { searchExample } from './helpers.js'

// History and project files: a finished search is kept in the browser (metadata in IndexedDB, arrays in
// OPFS) and opens again after a reload or a restart of the browser, with its spectra and without the
// mzML. A .prose file saves and opens a search. The searches of the quicker tests are the synthetic
// debug results saved with `&save`.

/** Waits until the open result has been written to History. */
async function saved(page: Page) {
  await expect(page.getByTestId('history-state')).toHaveAttribute('data-state', 'saved', { timeout: 60_000 })
}

/** The number in a key figure ("1,234" is 1234). */
async function figure(page: Page, id: string): Promise<number> {
  return Number((await page.getByTestId(id).textContent())!.replace(/[^\d]/g, ''))
}

const historyLink = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'History' })

/** A browser profile on disk, so that closing and relaunching it keeps IndexedDB and OPFS (as quitting and starting a browser does). */
async function launchProfile(dir: string, baseURL: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(dir, { ...devices['Desktop Chrome'], baseURL })
}

/** Opens the first PSM of the PSM table and expects its annotated spectrum. */
async function expectSpectrum(page: Page) {
  await page.getByRole('tab', { name: /^PSMs/ }).click()
  const rows = page.getByTestId('results-table').locator('tr[data-index]')
  await rows.first().click()
  const psm = page.getByTestId('psm-view')
  await expect(psm).toBeVisible()
  const spectrum = psm.getByTestId('spectrum')
  await expect(spectrum).toHaveAttribute('role', 'img')
  await expect(spectrum.locator('[data-testid="peak-label"][data-ions~="b"]').first()).toBeVisible({ timeout: 60_000 })
  await expect(spectrum.locator('[data-testid="peak-label"][data-ions~="y"]').first()).toBeVisible()
  return psm
}

test('a search reopens from History with spectra, after a reload and after the browser was restarted', async ({}, testInfo) => {
  test.setTimeout(420_000)
  const baseURL = testInfo.project.use.baseURL!
  const profile = mkdtempSync(join(tmpdir(), 'prose-history-'))
  try {
    let context = await launchProfile(profile, baseURL)
    let page = await context.newPage()
    await searchExample(page, { peptdeep: false })
    const psms = await figure(page, 'psm-count')
    const proteins = await figure(page, 'protein-count')
    expect(psms).toBeGreaterThan(1000)
    const address = page.url()

    // saved automatically, and said so
    await saved(page)
    await expect(page.getByTestId('history-state')).toHaveText('Saved to History')

    // a reload keeps the open result: the address opens it again from History
    await page.reload()
    await expect(page).toHaveURL(address)
    await expect(page.getByTestId('psm-count')).toBeVisible({ timeout: 60_000 })
    expect(await figure(page, 'psm-count')).toBe(psms)

    // the browser is closed and started again: a new page, no files, no engine result
    await context.close()
    context = await launchProfile(profile, baseURL)
    page = await context.newPage()
    await page.goto('./')
    await expect(page.getByTestId('view-search')).toBeVisible()
    await historyLink(page).click()
    const row = page.getByTestId('history-row')
    await expect(row).toHaveCount(1)
    await expect(row.locator('[data-column="name"]')).toHaveText('DatabaseSuitability')
    await expect(row.locator('[data-column="files"]')).toHaveText('DatabaseSuitability_1.mzML, DatabaseSuitability_2.mzML')
    await expect(row.locator('[data-column="psms"]')).toHaveText(new Intl.NumberFormat('en-US').format(psms))
    await expect(row.locator('[data-column="size"]')).toHaveText(/^\d+(\.\d)? (KB|MB)$/)
    await expect(page.getByTestId('history-storage')).toContainText('1 search takes')

    await page.getByRole('button', { name: 'Open DatabaseSuitability', exact: true }).click()
    await expect(page).toHaveURL(address)
    await expect(page.getByTestId('psm-count')).toBeVisible({ timeout: 60_000 })
    expect(await figure(page, 'psm-count')).toBe(psms)
    expect(await figure(page, 'protein-count')).toBe(proteins)

    // the spectrum comes from the stored peaks: there is no mzML in this page
    const psm = await expectSpectrum(page)
    expect(await psm.getByTestId('spectrum').locator('title').first().textContent()).toMatch(/[A-Z]{6,}/)

    // a stored search has no engine result: no merged idXML, but a project can be saved
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const idxml = page.getByRole('menuitem', { name: 'idXML (merged)' })
    await expect(idxml).toHaveAttribute('data-disabled', '')
    await expect(idxml).toHaveAttribute('title', 'Run the search again to export idXML')
    await expect(page.getByRole('menuitem', { name: 'Project (.prose)' })).not.toHaveAttribute('data-disabled', '')
    await context.close()
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

test('"Search again" of a stored search appears once New search holds its files again', async ({ page }) => {
  test.setTimeout(300_000)
  // the example at a protein FDR of 1 % finds no protein: its results offer a search again at 5 %
  await page.goto('./')
  await page.getByRole('button', { name: 'Try the example' }).click()
  await expect(page.getByLabel('Protein FDR')).toHaveValue('5')
  await page.getByLabel('Protein FDR').fill('1')
  await expect(page.getByTestId('search-plan')).toContainText('example: 1 % protein FDR, small database')
  await expect(page.getByTestId('engine-status')).toContainText('thread', { timeout: 120_000 })
  const peptdeep = page.getByRole('switch', { name: 'PeptDeep predictions' })
  if ((await peptdeep.getAttribute('aria-checked')) === 'true') await peptdeep.click()
  await page.getByRole('button', { name: /^Start search/ }).click()
  await expect(page).toHaveURL(/#\/results\/[^/]+$/, { timeout: 150_000 })
  await expect(page.getByTestId('proteins-empty').getByRole('button', { name: 'Search again with protein FDR 5 %' })).toBeVisible()
  await saved(page)

  // a new page has no files: the stored search cannot be searched again, and says where to set the FDR
  await page.goto('./')
  await historyLink(page).click()
  await page.getByRole('button', { name: 'Open DatabaseSuitability', exact: true }).click()
  const empty = page.getByTestId('proteins-empty')
  await expect(empty).toContainText('No protein reaches q ≤ 0.01')
  await expect(empty.getByRole('button', { name: /^Search again/ })).toHaveCount(0)
  await expect(empty).toContainText('set it under Search settings in New search')

  // with the same files and database in New search it can
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'New search' }).click()
  await page.getByRole('button', { name: 'Try the example' }).click()
  await expect(page.getByTestId('design-summary')).toHaveText('2 files → 2 samples · 1 condition')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Results' }).click()
  await empty.getByRole('button', { name: 'Search again with protein FDR 5 %' }).click()
  await expect(page).toHaveURL(/#\/search$/)
  await expect(page.getByLabel('Protein FDR')).toHaveValue('5')
})

test('History stays usable while a search runs', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('./')
  await page.getByRole('button', { name: 'Try the example' }).click()
  await expect(page.getByTestId('engine-status')).toContainText('thread', { timeout: 120_000 })
  const peptdeep = page.getByRole('switch', { name: 'PeptDeep predictions' })
  if ((await peptdeep.getAttribute('aria-checked')) === 'true') await peptdeep.click()
  await page.getByRole('button', { name: /^Start search/ }).click()
  await expect(page.getByTestId('search-progress')).toBeVisible()

  await historyLink(page).click()
  await expect(page.getByTestId('view-history')).toBeVisible()
  await expect(page.getByTestId('topbar-search-progress')).toBeVisible()
  await expect(page.getByTestId('history-empty')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open project…' })).toBeEnabled()

  // the finished search is saved even though it finished while History showed
  await expect(page).toHaveURL(/#\/results\/[^/]+$/, { timeout: 150_000 })
  await saved(page)
  await historyLink(page).click()
  await expect(page.getByTestId('history-row')).toHaveCount(1)
})

test('rename and delete (with a confirmation) keep History in order and survive a reload', async ({ page }) => {
  await page.goto('./?debug=small&save')
  await saved(page)
  await historyLink(page).click()
  const row = page.getByTestId('history-row')
  await expect(row).toHaveCount(1)
  const name = row.locator('[data-column="name"]')
  const original = (await name.textContent())!
  await expect(row.locator('[data-column="psms"]')).toHaveText(/^\d/)

  // rename: Escape leaves it, Enter keeps the new name
  await page.getByRole('button', { name: `Rename ${original}` }).click()
  const input = page.getByRole('textbox', { name: `Name of ${original}` })
  await expect(input).toBeFocused()
  await input.fill('discarded')
  await input.press('Escape')
  await expect(name).toHaveText(original)
  await page.getByRole('button', { name: `Rename ${original}` }).click()
  await page.getByRole('textbox', { name: `Name of ${original}` }).fill('EGF time course')
  await page.getByRole('textbox', { name: `Name of ${original}` }).press('Enter')
  await expect(name).toHaveText('EGF time course')

  // (a reload of ?debug=small&save would open and save the debug result again: load History itself)
  await page.goto('./#/history')
  await expect(page.getByTestId('history-row').locator('[data-column="name"]')).toHaveText('EGF time course')

  // delete asks first
  await page.getByRole('button', { name: 'Delete EGF time course' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('EGF time course')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('history-row')).toHaveCount(1)
  await page.getByRole('button', { name: 'Delete EGF time course' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByTestId('history-empty')).toBeVisible()
  await page.goto('./#/history')
  await expect(page.getByTestId('history-empty')).toBeVisible()
})

test('another tab of the app sees a search saved, renamed and deleted in this one, without a reload', async ({ page, context }) => {
  const other = await context.newPage()
  await other.goto('./#/history')
  await expect(other.getByTestId('history-empty')).toBeVisible()

  await page.goto('./?debug=small&save')
  await saved(page)
  const row = other.getByTestId('history-row')
  await expect(row).toHaveCount(1)
  const original = (await row.locator('[data-column="name"]').textContent())!

  await historyLink(page).click()
  await page.getByRole('button', { name: `Rename ${original}` }).click()
  await page.getByRole('textbox', { name: `Name of ${original}` }).fill('From the first tab')
  await page.getByRole('textbox', { name: `Name of ${original}` }).press('Enter')
  await expect(row.locator('[data-column="name"]')).toHaveText('From the first tab')

  await page.getByRole('button', { name: 'Delete From the first tab' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(other.getByTestId('history-empty')).toBeVisible()
})

test('a search that does not fit in the free storage is not saved, and its results stay usable', async ({ page }) => {
  // the browser says that 300 KB are free
  await page.addInitScript(() => {
    const estimate = async () => ({ usage: 700_000, quota: 1_000_000 })
    Object.defineProperty(navigator.storage, 'estimate', { value: estimate })
  })
  await page.goto('./?debug=small&save')
  await expect(page.getByTestId('history-state')).toHaveAttribute('data-state', 'unsaved')
  await expect(page.getByTestId('history-state')).toHaveText('Not saved to History')
  const notice = page.getByTestId('history-not-saved')
  await expect(notice).toContainText(/Not saved to History: needs [\d.]+ MB, 293 KB free\./)
  await expect(notice).toContainText('Export › Project (.prose)')
  // the results are there and work
  await expect(page.getByTestId('psm-count')).toBeVisible()
  await page.getByRole('tab', { name: /^PSMs/ }).click()
  await expect(page.getByTestId('results-table').locator('tr[data-index]').first()).toBeVisible()
  await historyLink(page).click()
  await expect(page.getByTestId('history-empty')).toBeVisible()
  await page.goto('./#/history')
  await expect(page.getByTestId('history-empty')).toBeVisible()
})

test('a browser without OPFS says that History is unavailable, and the results stay usable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'getDirectory', { value: undefined })
  })
  await page.goto('./?debug=small&save')
  await expect(page.getByTestId('history-state')).toHaveAttribute('data-state', 'unsaved')
  await expect(page.getByTestId('history-not-saved')).toContainText('History is not available in this browser')
  await expect(page.getByTestId('psm-count')).toBeVisible()
  await historyLink(page).click()
  await expect(page.getByTestId('history-unavailable')).toContainText('Export › Project')
})

test.describe('project files', () => {
  test('Save project writes a .prose file that Open project reads in a new page', async ({ page, browser }) => {
    await page.goto('./?debug=small')
    await expect(page.getByTestId('psm-count')).toBeVisible()
    const psms = await figure(page, 'psm-count')
    const proteins = await figure(page, 'protein-count')

    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Project (.prose)' }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/\.prose$/)
    const path = (await file.path())!

    // a zip of manifest.json and .bin files
    const files = unzipSync(readFileSync(path))
    expect(Object.keys(files)[0]).toBe('manifest.json')
    expect(Object.keys(files)).toContain('tables.psms.score.bin')
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']))
    expect(manifest).toMatchObject({ format: 'prose-project', schema: 1 })
    expect(manifest.appVersion).toMatch(/^\d+\.\d+\.\d+/)

    // another browser profile: no History, the project opens in Results
    const fresh = await browser.newContext()
    const other = await fresh.newPage()
    await other.goto('./#/history')
    await expect(other.getByTestId('history-empty')).toBeVisible()
    await other.getByTestId('project-input').setInputFiles(path)
    await expect(other).toHaveURL(/#\/results\/[^/]+$/)
    await expect(other.getByTestId('psm-count')).toBeVisible()
    expect(await figure(other, 'psm-count')).toBe(psms)
    expect(await figure(other, 'protein-count')).toBe(proteins)
    // the project keeps the settings and the design: the Overview shows them
    await other.getByRole('tab', { name: 'Overview' }).click()
    await expect(other.getByTestId('search-facts')).toContainText('synthetic.fasta')
    await expect(other.getByRole('table', { name: 'Searched files' })).toContainText('control_1.mzML')
    await fresh.close()
  })

  test('a project of a newer version is refused with a message that says so', async ({ page }) => {
    await page.goto('./?debug=small')
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Project (.prose)' }).click()
    const files = unzipSync(readFileSync((await (await download).path())!))
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']))
    manifest.schema = 2
    files['manifest.json'] = strToU8(JSON.stringify(manifest))

    await page.goto('./#/history')
    await page.getByTestId('project-input').setInputFiles({ name: 'newer.prose', mimeType: 'application/zip', buffer: Buffer.from(zipSync(files)) })
    const problem = page.getByTestId('history-problem')
    await expect(problem).toContainText('newer.prose could not be opened')
    await expect(problem).toContainText('This project was saved by a newer version of ProSE (schema 2)')
    await expect(page).toHaveURL(/#\/history$/)

    // anything else that is not a project says what it is
    await page.getByTestId('project-input').setInputFiles({ name: 'notes.prose', mimeType: 'text/plain', buffer: Buffer.from('not a zip file at all, only some text') })
    await expect(problem).toContainText('notes.prose could not be opened')
    await expect(problem).toContainText('not a zip archive')
  })
})
