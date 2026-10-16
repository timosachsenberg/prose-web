import { expect, test } from '@playwright/test'

test('the app shell renders', async ({ page }) => {
  await page.goto('./')
  await expect(page).toHaveTitle('ProSE')

  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link', { name: 'New search' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Results' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'History' })).toBeVisible()

  await expect(page.getByTestId('engine-status')).toContainText('OpenMS')
})

test('the URL hash mirrors the view', async ({ page }) => {
  await page.goto('./')
  const nav = page.getByRole('navigation', { name: 'Main' })
  const search = nav.getByRole('link', { name: 'New search' })
  const results = nav.getByRole('link', { name: 'Results' })
  const history = nav.getByRole('link', { name: 'History' })

  // no hash: the search view, with its hash written back
  await expect(search).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveURL(/#\/search$/)

  await history.click()
  await expect(page).toHaveURL(/#\/history$/)
  await expect(history).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible()

  await results.click()
  await expect(page).toHaveURL(/#\/results$/)
  await expect(results).toHaveAttribute('aria-current', 'page')

  // a result id in the hash opens the results view and survives a reload
  await page.goto('./#/results/abc123')
  await expect(results).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('view-results')).toContainText('abc123')
  await page.reload()
  await expect(page).toHaveURL(/#\/results\/abc123$/)

  // browser back follows the views
  await search.click()
  await expect(page).toHaveURL(/#\/search$/)
  await page.goBack()
  await expect(page).toHaveURL(/#\/results\/abc123$/)
  await expect(results).toHaveAttribute('aria-current', 'page')

  // an unknown hash falls back to the search view
  await page.goto('./#/nonsense')
  await expect(search).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveURL(/#\/search$/)
})

test('the page is cross-origin isolated', async ({ page }) => {
  const response = await page.goto('./')
  expect(response?.headers()['cross-origin-opener-policy']).toBe('same-origin')
  expect(response?.headers()['cross-origin-embedder-policy']).toBe('require-corp')
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true)
})
