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
/** The tabs of the protein panel. */
export type PanelTab = 'coverage' | 'peptides' | 'psms'
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
  /** A CSV export is being written (the button says "Exporting…"). */
  exporting = $state(false)
  /**
   * The protein open in the panel at the right of the Proteins table (a row of `tables.proteins`), or
   * null. The panel belongs to the Proteins tab; the protein stays open while another tab shows.
   */
  panel = $state<number | null>(null)
  /** The panel's tab: Peptides is the one the mockup opens with. */
  panelTab = $state<PanelTab>('peptides')

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

  /**
   * Splits or merges the technical replicates' count columns. A level sorted by a sample column stays
   * sorted by that sample: by its first measurement when split, by the whole sample when merged.
   */
  setShowTechReplicates(on: boolean): void {
    if (on === this.showTechReplicates) return
    const before = this.model.samples
    this.showTechReplicates = on
    const after = this.model.samples
    for (const level of [this.proteins, this.peptides, this.psms]) {
      const match = /^sample:(\d+)$/.exec(level.sort.key)
      const old = match ? before[Number(match[1])] : undefined
      if (!old) continue
      const next = after.find(
        (s) =>
          s.designSample === old.designSample &&
          (s.techReplicate === old.techReplicate || s.techReplicate === null || old.techReplicate === null),
      )
      if (next) level.sort = { key: `sample:${next.index}`, dir: level.sort.dir }
    }
  }

  /**
   * Opens the panel of protein `p` (a row of the Proteins table) and selects its row. What is no
   * protein (a peptide below the protein FDR has none, an index out of range) opens nothing.
   */
  openProtein(p: number): void {
    if (!Number.isInteger(p) || p < 0 || p >= this.model.tables.proteins.count) return
    this.proteins.selected = p
    this.panel = p
  }

  /** Closes the panel; the protein's row stays selected. */
  closeProtein(): void {
    this.panel = null
  }

  /**
   * "Open in PSM table": the PSM table shows the PSMs of `protein` and only those (a "Protein: <accession>"
   * chip says so and removes the filter): the search's cutoff, no text or peptide filter, and
   * contaminants or decoys shown if the protein is one.
   */
  filterBy({ protein }: { protein: number }): void {
    const m = this.model
    if (!Number.isInteger(protein) || protein < 0 || protein >= m.tables.proteins.count) return
    const f = this.psms.filters
    this.psms.filters = {
      ...f,
      text: '',
      maxQ: m.psmFdr,
      proteinFilter: protein,
      peptideFilter: undefined,
      hideContaminants: m.protein.contaminant[protein] ? false : f.hideContaminants,
      showDecoys: m.tables.proteins.decoy[protein] ? true : f.showDecoys,
    }
    this.tab = 'psms'
  }

  /**
   * Opens PSM `i` (a row of `tables.psms`). Until the PSM view arrives (C9), this shows the PSMs tab
   * with the PSM selected; a filter that hides it is lifted (text, protein and peptide filters, the
   * cutoff, contaminants or decoys as far as it is one). The table scrolls to the selected row.
   */
  openPsm(i: number): void {
    const m = this.model
    const ps = m.tables.psms
    if (!Number.isInteger(i) || i < 0 || i >= ps.count) return
    const level = this.psms
    if (!level.kept.includes(i)) {
      const f = level.filters
      level.filters = {
        ...f,
        text: '',
        maxQ: m.psmFdr,
        proteinFilter: undefined,
        peptideFilter: undefined,
        hideContaminants: m.peptide.contaminant[ps.peptide[i]] ? false : f.hideContaminants,
        showDecoys: ps.decoy[i] ? true : f.showDecoys,
      }
    }
    level.selected = i
    this.tab = 'psms'
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

/** Releases the view of the open result (its model and caches), e.g. when another result opens. */
export function releaseResultsView(): void {
  cached?.destroy()
  cached = null
}

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
