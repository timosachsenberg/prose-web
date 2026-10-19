// The downloads of the Export menu: the current view as CSV, the design, the merged idXML.

import { writeDesignTsv } from '../design/design-tsv'
import { download } from '../download'
import { engineClient } from '../engine/app-engine.svelte'
import type { OpenResult } from '../search/session.svelte'
import { resultName } from './display'
import type { ResultsView } from './view.svelte'

/** The name of a result's exports (see `resultName`). */
export function exportName(result: OpenResult): string {
  return resultName(result.design.rows.map((r) => r.fileName))
}

/** After the browser has painted (so that "Exporting…" shows before a long export). */
const painted = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))

/**
 * The current level's view as `<name>-<level>.csv` (`view.exporting` meanwhile); false on a tab
 * without a table or while an export runs.
 */
export async function exportCsv(view: ResultsView): Promise<boolean> {
  const level = view.level
  if (!level || view.exporting) return false
  view.exporting = true
  try {
    await painted()
    download(`${exportName(view.result)}-${level.level}.csv`, level.csv(), 'text/csv;charset=utf-8')
    return true
  } finally {
    view.exporting = false
  }
}

/** The design of the searched files as `<name>_design.tsv` (OpenMS' one-table format). */
export function exportDesign(result: OpenResult): void {
  download(`${exportName(result)}_design.tsv`, writeDesignTsv(result.design), 'text/tab-separated-values')
}

/**
 * The merged idXML can be written while the engine's search worker still holds this result: it ran
 * in this session and no search (nor a trap) has replaced the worker since.
 */
export function idXMLAvailable(result: OpenResult): boolean {
  return result.engineResult && engineClient().hasSearchResult
}

/** The merged idXML as `<name>.idXML`, read from the engine worker in chunks. */
export async function exportIdXML(result: OpenResult): Promise<void> {
  const bytes = await engineClient().idXML()
  download(`${exportName(result)}.idXML`, bytes as BlobPart, 'application/xml')
}
