// The state of the Results view for the open result: the active tab, and per level (proteins,
// peptides, PSMs) one filter state, the sort order, the selected row and the hidden columns. The
// rows of a level are derived from these: the table cells, the sort order and the CSV all read the
// same filter state (one cutoff). Kept outside the view, so that it survives a visit to New search.

import { formatPercent, formatQ } from '../format/fdr'
import type { OpenResult } from '../search/session.svelte'
import { columnDef } from './columns'
import { toCsv } from './csv'
import { levelTotal } from './figures'
import { applyFilters, initialFilters, sortRows, type FilterState } from './filters'
import { buildModel, peptideCounts, type Level, type ResultModel } from './model'
import { columnSpecs, csvColumns, defaultHidden, visibleSpecs } from './table-columns'

export type Tab = 'overview' | 'proteins' | 'peptides' | 'psms' | 'samples' | 'qc'
export type SortDir = 'asc' | 'desc'
export type SortState = { key: string; dir: SortDir }

/** How a level is sorted at first: proteins and peptides by PSMs, PSMs by q-value. */
const defaultSort: Record<Level, SortState> = {
  proteins: { key: 'psms', dir: 'desc' },
  peptides: { key: 'psms', dir: 'desc' },
  psms: { key: 'qValue', dir: 'asc' },
}

export class LevelState {
  readonly level: Level
  readonly #view: ResultsView
  filters: FilterState = $state()!
  sort: SortState = $state()!
  /** The selected row (a protein, peptide or PSM index), or null. */
  selected = $state<number | null>(null)
  hidden = $state<string[]>([])

  constructor(view: ResultsView, level: Level) {
    this.#view = view
    this.level = level
    this.filters = initialFilters(view.model, level)
    this.sort = { ...defaultSort[level] }
    this.hidden = defaultHidden(columnSpecs(view.model, level, view.search), view.model)
  }

  /** The rows that pass the filters, in table order. */
  readonly kept = $derived.by(() => applyFilters(this.#view.model, this.level, this.filters))

  /** The sort that applies: the chosen one, or the default if its column is gone (e.g. a sample column). */
  readonly effectiveSort = $derived.by(() =>
    columnDef(this.#view.model, this.level, this.sort.key) ? this.sort : defaultSort[this.level],
  )

  /** The rows of the table: filtered and sorted. */
  readonly rows = $derived.by(() =>
    sortRows(this.#view.model, this.level, this.kept, this.effectiveSort.key, this.effectiveSort.dir, this.filters),
  )

  /** The peptide counts the cells show (at the peptide cutoff on the Peptides level). */
  readonly counts = $derived.by(() =>
    peptideCounts(this.#view.model, this.level === 'peptides' ? this.filters.maxQ : NaN),
  )

  /** The rows at the search's cutoff, before the user's filters ("n of total"). */
  readonly total = $derived.by(() => levelTotal(this.#view.model, this.level, this.filters.showDecoys))

  /** What the table says without rows: nothing passed the search's cutoff, or the filters hide everything. */
  readonly emptyText = $derived.by(() => {
    const what = { proteins: 'proteins', peptides: 'peptides', psms: 'PSMs' }[this.level]
    if (this.total > 0) return `No ${what} match the filters.`
    const m = this.#view.model
    const [fdr, q] = this.level === 'proteins' ? ['protein FDR', m.proteinFdr] : ['PSM FDR', m.psmFdr]
    return `No ${what} pass the search's ${fdr} (${formatPercent(q)}, ${formatQ(q)}).`
  })

  readonly specs = $derived.by(() => columnSpecs(this.#view.model, this.level, this.#view.search))
  readonly visible = $derived.by(() => visibleSpecs(this.specs, this.hidden))

  /** Sorts by `key`: a new column starts descending for numbers and ascending for text; the same column flips. */
  sortBy(key: string): void {
    if (this.effectiveSort.key === key) {
      this.sort = { key, dir: this.effectiveSort.dir === 'asc' ? 'desc' : 'asc' }
    } else {
      const numeric = columnDef(this.#view.model, this.level, key)?.number !== undefined
      this.sort = { key, dir: numeric ? 'desc' : 'asc' }
    }
  }

  toggleColumn(id: string, show: boolean): void {
    this.hidden = show ? this.hidden.filter((h) => h !== id) : [...this.hidden, id]
  }

  /** The CSV of the view: the visible columns, the filtered and sorted rows (peptides in ProForma). */
  csv(): string {
    return toCsv(this.#view.model, this.level, this.rows, csvColumns(this.visible), this.filters)
  }
}

export class ResultsView {
  readonly result: OpenResult
  tab = $state<Tab>('proteins')
  /** "Show technical replicates separately" (the Columns menu): one count column per measurement. */
  showTechReplicates = $state(false)

  readonly search: { openSearch: boolean }

  /** The search rescored its PSMs with Percolator (some file did). */
  readonly rescored: boolean

  readonly model: ResultModel = $derived.by(() =>
    buildModel(this.result.outcome.tables, this.result.design, {
      showTechReplicates: this.showTechReplicates,
      psmFdr: this.result.psmFdr,
      proteinFdr: this.result.proteinFdr,
      rescored: this.rescored,
    }),
  )

  readonly proteins: LevelState
  readonly peptides: LevelState
  readonly psms: LevelState

  constructor(result: OpenResult) {
    this.result = result
    const summary = result.outcome.summary
    this.search = { openSearch: summary.openSearch }
    this.rescored = summary.files.some((f) => f.percolator?.applied === true)
    this.proteins = new LevelState(this, 'proteins')
    this.peptides = new LevelState(this, 'peptides')
    this.psms = new LevelState(this, 'psms')
  }

  /** The level of the active tab, or null on Overview, Samples and QC. */
  get level(): LevelState | null {
    return this.tab === 'proteins' || this.tab === 'peptides' || this.tab === 'psms' ? this[this.tab] : null
  }

  /** The design has technical replicates (a sample measured more than once). */
  get hasTechReplicates(): boolean {
    const seen = new Set<string>()
    for (const row of this.result.design.rows) {
      const key = `${row.sample}\0${row.techReplicate}`
      seen.add(key)
    }
    return seen.size > new Set(this.result.design.rows.map((r) => r.sample)).size
  }
}

/** The view of the open result. Its own effect root owns its deriveds, so that they keep working
 * after the component that first asked for it unmounts (the state survives a visit to New search). */
let cached: { view: ResultsView; destroy: () => void } | null = null

/** The view state of `result`: the same object while the same result stays open, a new one for another result. */
export function resultsViewFor(result: OpenResult): ResultsView {
  if (cached?.view.result !== result) {
    cached?.destroy()
    let view: ResultsView | undefined
    const destroy = $effect.root(() => {
      view = new ResultsView(result)
    })
    // (the server build of Svelte, which the unit tests run on, does not run effect roots)
    cached = { view: view ?? new ResultsView(result), destroy }
  }
  return cached.view
}
