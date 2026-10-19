import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// The New search page with the real engine: the example (two replicates of one file) goes from
// "Try the example" to the Results view.

test('example search end to end', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('./')

  // the empty state: the example, the desktop downloads and the privacy note
  await expect(page.getByText('Spectra and database stay on this computer')).toBeVisible()
  await expect(page.getByRole('link', { name: /Windows/ })).toHaveAttribute(
    'href',
    /releases\/latest\/download\/prose-desktop-win_x64\.zip$/,
  )

  await page.getByRole('button', { name: 'Try the example' }).click()
  await expect(page.getByTestId('design-summary')).toHaveText('2 files → 2 samples · 1 condition')
  await expect(page.getByLabel('Condition of DatabaseSuitability_1.mzML')).toHaveValue('example')
  await expect(page.getByLabel('Condition of DatabaseSuitability_2.mzML')).toHaveValue('example')
  // the replicates are assumed (numbered in file order): greyed placeholders, not values
  await expect(page.getByLabel('Replicate of DatabaseSuitability_2.mzML')).toHaveAttribute('placeholder', '2')
  await expect(page.getByTestId('fasta-proteins')).toContainText('proteins')
  // a small database cannot reach a 1 % protein FDR: the example uses 5 %, and the plan says so
  await expect(page.getByLabel('Protein FDR')).toHaveValue('5')
  await expect(page.getByTestId('search-plan')).toContainText('example: 5 % protein FDR, small database')

  // the common parameters of the preset, the FDR as a percentage with its q-value
  await expect(page.getByLabel('PSM FDR')).toHaveValue('1')
  await expect(page.getByText('q ≤ 0.01').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^All \d+ parameters/ })).toBeVisible()

  // the engine is ready before the search starts (a fresh page loads the module first)
  await expect(page.getByTestId('engine-status')).toContainText('thread', { timeout: 120_000 })

  await page.getByRole('button', { name: /^Start search/ }).click()
  await expect(page.getByTestId('search-progress')).toBeVisible()

  await expect(page).toHaveURL(/#\/results\/[^/]+$/, { timeout: 120_000 })
  const count = page.getByTestId('psm-count')
  await expect(count).toBeVisible()
  const psms = Number((await count.textContent())!.replace(/[^\d]/g, ''))
  expect(psms).toBeGreaterThan(1000)
  // at 5 %, the example's proteins pass
  expect(Number((await page.getByTestId('protein-count').textContent())!.replace(/[^\d]/g, ''))).toBeGreaterThan(10)
  await expect(page.getByTestId('proteins-empty')).toHaveCount(0)

  // the engine still holds the search: the merged idXML can be exported
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'idXML (merged)' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('DatabaseSuitability.idXML')
  const xml = readFileSync((await file.path())!, 'utf8')
  expect(xml.startsWith('<?xml')).toBe(true)
  expect(xml.trimEnd().endsWith('</IdXML>')).toBe(true)
})

test('no protein at 1 %: the results say why, and search again at 5 %', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('./')
  await page.getByRole('button', { name: 'Try the example' }).click()
  await expect(page.getByLabel('Protein FDR')).toHaveValue('5')
  await page.getByLabel('Protein FDR').fill('1')
  await expect(page.getByTestId('search-plan')).toContainText('example: 1 % protein FDR, small database')
  await expect(page.getByTestId('engine-status')).toContainText('thread', { timeout: 120_000 })
  await page.getByRole('button', { name: /^Start search/ }).click()
  await expect(page).toHaveURL(/#\/results\/[^/]+$/, { timeout: 120_000 })

  // 0 proteins but PSMs: an explanation instead of an empty table
  const empty = page.getByTestId('proteins-empty')
  await expect(empty).toContainText('No protein reaches q ≤ 0.01 (protein FDR 1 %).')
  await expect(empty).toContainText('protein q-values cannot go below 1/(N + 1): a 1 % protein FDR needs at least 99 target proteins')
  await expect(empty).toContainText('Small databases cannot reach low protein q-values')
  await expect(page.getByTestId('protein-count')).toHaveText('0')
  await empty.getByRole('button', { name: 'Show the PSMs' }).click()
  await expect(page.getByRole('tab', { name: /^PSMs/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('grid', { name: 'PSMs' })).toBeVisible()
  await page.getByRole('tab', { name: /^Proteins/ }).click()
  await empty.getByRole('button', { name: 'Show the peptides' }).click()
  await expect(page.getByRole('tab', { name: /^Peptides/ })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: /^Proteins/ }).click()

  // back to New search with the same files and 5 %
  await empty.getByRole('button', { name: 'Search again with protein FDR 5 %' }).click()
  await expect(page).toHaveURL(/#\/search$/)
  await expect(page.getByLabel('Protein FDR')).toHaveValue('5')
  await expect(page.getByTestId('design-summary')).toHaveText('2 files → 2 samples · 1 condition')
  await page.getByRole('button', { name: /^Start search/ }).click()
  await expect(page).toHaveURL(/#\/results\/[^/]+$/, { timeout: 120_000 })
  await expect(page.getByRole('grid', { name: 'Proteins' })).toBeVisible()
  expect(Number((await page.getByTestId('protein-count').textContent())!.replace(/[^\d]/g, ''))).toBeGreaterThan(10)
  await expect(page.getByTestId('proteins-empty')).toHaveCount(0)
})
