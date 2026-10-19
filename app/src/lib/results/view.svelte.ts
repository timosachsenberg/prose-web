// The state of the Results view for the open result: the active tab, and per level (proteins,
// peptides, PSMs) one filter state, the sort order, the selected row and the hidden columns. The
// rows of a level are derived from these: the table cells, the sort order and the CSV all read the
// same filter state (one cutoff). Kept outside the view, so that it survives a visit to New search.

import { formatPercent, formatQ } from '../format/fdr'
import type { PsmOptionState } from '../psm/psm'
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

/**
 * Where the open PSM came from: the PSM table, or the protein panel (a PSM of one of its peptides, or
 * of its PSMs tab). From the panel the PSM table shows the PSMs of that protein (and peptide) while
 * the PSM is open; `restore` is the table's filter state before, which it gets back when the PSM closes.
 */
export type PsmOrigin =
  | { kind: 'psms' }
  | { kind: 'panel'; protein: number; peptide: number | null; restore: FilterState }

/** The PSM open in the PSM view (a row of `tables.psms`) and where it came from. */
export type OpenPsm = { row: number; origin: PsmOrigin }

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
  /** The peptide expanded in the panel's Peptides tab (a row of `tables.peptides`), or null. */
  panelPeptide = $state<number | null>(null)

  /**
   * The PSM view: the PSM open beside the PSM table (which narrows to a list), or null. "Previous" and
   * "Next" go through the rows of the PSM table as it is sorted and filtered.
   */
  psm = $state.raw<OpenPsm | null>(null)
  /** The toggles of the PSM view's spectrum, kept from one PSM to the next. */
  psmOptions = $state<PsmOptionState>({ ions: ['b', 'y'], charges: null, losses: null, precursor: false, bottom: null })
  /** Saves the spectrum of the open PSM as SVG: set by the PSM view while it shows a spectrum (the Export menu's item). */
  spectrumExporter: (() => void) | null = null

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
    this.psm = null
    if (p !== this.panel) this.panelPeptide = null
    this.proteins.selected = p
    this.panel = p
  }

  /** Closes the panel; the protein's row stays selected. */
  closeProtein(): void {
    this.panel = null
  }

  /**
   * "Open in PSM table": the PSM table shows the PSMs of one `protein`, or of one `peptide` (a row of
   * `tables.peptides`: "All n in the PSM table"), and only those. A chip ("Protein: <accession>",
   * "Peptide: <ProForma>") says so and removes the filter. The table is at the search's cutoff, without
   * text filter or the other restriction, and shows contaminants or decoys if the protein or peptide is one.
   */
  filterBy(what: { protein: number } | { peptide: number }): void {
    const m = this.model
    const f = this.psms.filters
    const index = 'protein' in what ? what.protein : what.peptide
    const count = 'protein' in what ? m.tables.proteins.count : m.tables.peptides.count
    if (!Number.isInteger(index) || index < 0 || index >= count) return
    this.psm = null
    const contaminant = 'protein' in what ? m.protein.contaminant[index] : m.peptide.contaminant[index]
    const decoy = 'protein' in what ? m.tables.proteins.decoy[index] : m.tables.peptides.decoy[index]
    this.psms.filters = {
      ...f,
      text: '',
      maxQ: m.psmFdr,
      proteinFilter: 'protein' in what ? index : undefined,
      peptideFilter: 'peptide' in what ? index : undefined,
      hideContaminants: contaminant ? false : f.hideContaminants,
      showDecoys: decoy ? true : f.showDecoys,
    }
    this.tab = 'psms'
  }

  /**
   * Opens PSM `i` (a row of `tables.psms`) in the PSM view, from the PSM table: the PSMs tab with the
   * PSM selected. A filter that hides it is lifted (text, protein and peptide filters, the cutoff,
   * contaminants or decoys as far as it is one), so that it is a row of the list beside the view.
   */
  openPsm(i: number): void {
    if (!this.#isPsm(i)) return
    const m = this.model
    const ps = m.tables.psms
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
    // from the PSM view itself (the list beside it), the PSM keeps where it came from
    this.psm = { row: i, origin: this.psm?.origin ?? { kind: 'psms' } }
  }

  /**
   * Opens PSM `i` from the protein panel: a PSM of the open protein's peptide `peptide` (the Peptides
   * tab), or of the protein (`peptide` null: the PSMs tab). The list beside the view is the PSM table
   * with the protein and the peptide as filters (as "Open in PSM table" makes it), at the search's
   * cutoff; the table gets its filters back when the PSM closes.
   */
  openPsmFromPanel(i: number, peptide: number | null): void {
    const protein = this.panel
    if (!this.#isPsm(i) || protein === null) return
    const m = this.model
    const ps = m.tables.psms
    const level = this.psms
    const restore = this.psm?.origin.kind === 'panel' ? this.psm.origin.restore : { ...level.filters }
    level.filters = {
      ...restore,
      text: '',
      maxQ: m.psmFdr,
      proteinFilter: protein,
      peptideFilter: peptide ?? undefined,
      hideContaminants: m.peptide.contaminant[ps.peptide[i]] ? false : restore.hideContaminants,
      showDecoys: ps.decoy[i] ? true : restore.showDecoys,
    }
    level.selected = i
    this.tab = 'psms'
    this.psm = { row: i, origin: { kind: 'panel', protein, peptide, restore } }
  }

  /**
   * Closes the PSM view and says where it came from. Back to the PSM table, the PSM stays selected;
   * back to the protein panel, the PSM table gets its filters back and the Proteins tab shows.
   */
  closePsm(): PsmOrigin | null {
    const open = this.psm
    if (!open) return null
    this.psm = null
    if (open.origin.kind === 'panel') {
      this.psms.filters = open.origin.restore
      this.tab = 'proteins'
    }
    return open.origin
  }

  /** The PSMs before and after the open one in the PSM table as sorted and filtered (null: none). */
  get psmNeighbours(): { prev: number | null; next: number | null; position: number; count: number } {
    const rows = this.psms.rows
    const position = this.psm ? rows.indexOf(this.psm.row) : -1
    return {
      prev: position > 0 ? rows[position - 1] : null,
      next: position >= 0 && position + 1 < rows.length ? rows[position + 1] : null,
      position,
      count: rows.length,
    }
  }

  /** Opens the PSM before (-1) or after (1) the open one, if there is one. */
  stepPsm(direction: 1 | -1): void {
    const { prev, next } = this.psmNeighbours
    const target = direction < 0 ? prev : next
    if (target === null || !this.psm) return
    this.psms.selected = target
    this.psm = { row: target, origin: this.psm.origin }
  }

  #isPsm(i: number): boolean {
    return Number.isInteger(i) && i >= 0 && i < this.model.tables.psms.count
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
