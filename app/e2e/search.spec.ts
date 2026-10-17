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
})
