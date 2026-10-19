import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'

// Shared by the Results e2e specs: opening a stored synthetic result (see debug.ts), reading the
// export button and the CSV files, and the grid's active row.

export async function openDebug(page: Page, which: 'large' | 'large1' | 'dense' | 'small') {
  await page.goto(`./?debug=${which}`)
  await expect(page).toHaveURL(/#\/results\/[^/]+$/)
  await expect(page.getByTestId('results-table')).toBeVisible({ timeout: 30_000 })
}

/** The number of rows the export button promises ("Export CSV · 1,234 rows"). */
export async function exportCount(page: Page): Promise<number> {
  const text = await page.getByRole('button', { name: /^Export CSV · / }).textContent()
  return Number(text!.replace(/^.*·/, '').replace(/[^\d]/g, ''))
}

/** The fields of a CSV line (RFC 4180 quotes; the test data have no line breaks in fields). */
export function fields(line: string): string[] {
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
export async function downloadCsv(page: Page, trigger: () => Promise<void>): Promise<{ name: string; lines: string[] }> {
  const download = page.waitForEvent('download')
  await trigger()
  const file = await download
  const text = readFileSync((await file.path())!, 'utf8')
  expect(text.charCodeAt(0)).toBe(0xfeff)
  expect(text.endsWith('\n')).toBe(true)
  return { name: file.suggestedFilename(), lines: text.slice(1, -1).split('\n') }
}

/** The grid's active row (aria-activedescendant): its position and whether it is in the scroll box's view. */
export async function activeRow(page: Page): Promise<{ index: number; inView: boolean }> {
  return page.getByTestId('table-scroll').first().evaluate((box: HTMLElement) => {
    const id = box.getAttribute('aria-activedescendant')
    const row = id ? document.getElementById(id) : null
    if (!row) return { index: -1, inView: false }
    const header = box.querySelector('thead')!.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    return { index: Number(row.dataset.index), inView: r.top >= header.bottom - 1 && r.bottom <= b.bottom + 1 }
  })
}
