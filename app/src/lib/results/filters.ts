// Filtering and sorting of the three levels. Both work on arrays of row indices (protein, peptide
// or PSM numbers): `applyFilters` returns the rows that pass, in table order, and `sortRows` a sorted
// copy of any such array. No row is ever turned into an object.

import { columnDef } from './columns'
import { naturalKey, scanNumber } from './display'
import { peptideCounts, qLimit, type Level, type ResultModel } from './model'

export type FilterState = {
  /** Words that all have to match, case-insensitively, anywhere in a row (see `applyFilters`). */
  text: string
  /**
   * The q-value limit of the level (a protein's own, a peptide's best PSM, a PSM's). It can only
   * tighten the search: a value above the search's FDR (`ResultModel.psmFdr` / `proteinFdr`) works
   * like the search's FDR, and so does NaN. The Peptides table shows its PSM counts at this cutoff:
   * `sortRows` and `toCsv` take the level's filter state for that (and the cells read
   * `peptideCounts(m, maxQ)`).
   */
  maxQ: number
  /** Proteins only: at least this many peptides with PSMs. 0 = any. */
  minPeptides: number
  /** Proteins only: in at least one condition, at least this many of its samples found the protein. 0 = any. */
  minReplicatesInCondition: number
  hideContaminants: boolean
  showDecoys: boolean
  /** Peptides and PSMs: only those of this protein. */
  proteinFilter?: number
  /** PSMs: only those of this peptide. */
  peptideFilter?: number
}

/**
 * The filters a level starts with: its search cutoff (`proteinFdr` for proteins, `psmFdr` for
 * peptides and PSMs), contaminants and decoys hidden. A new object per call: one state per level.
 */
export function initialFilters(m: ResultModel, level: Level): FilterState {
  return { ...defaultFilters(), maxQ: level === 'proteins' ? m.proteinFdr : m.psmFdr, hideContaminants: true }
}

/** No filter, at the search's own FDR, decoys hidden. */
export function defaultFilters(): FilterState {
  return { text: '', maxQ: 1, minPeptides: 0, minReplicatesInCondition: 0, hideContaminants: false, showDecoys: false }
}

/**
 * What the protein text filter searches, per protein, lower-cased: its accession, its description and
 * the sequences of its peptides. Made once per model, on the first text filter.
 */
const proteinTexts = new WeakMap<ResultModel, string[]>()
function proteinText(m: ResultModel): string[] {
  let texts = proteinTexts.get(m)
  if (!texts) {
    const pr = m.tables.proteins
    const { offsets, peptide } = m.protein.members
    const sequence = m.tables.peptides.sequence
    texts = new Array(pr.count)
    for (let p = 0; p < pr.count; p++) {
      const parts = [pr.accession[p], pr.description[p]]
      for (let i = offsets[p]; i < offsets[p + 1]; i++) parts.push(sequence[peptide[i]])
      texts[p] = parts.join('\n').toLowerCase()
    }
    proteinTexts.set(m, texts)
  }
  return texts
}

const words = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean)
const matches = (haystack: string, tokens: string[]) => tokens.every((t) => haystack.includes(t))

/** In at least one condition, at least `need` of its biological samples have a PSM for the protein. */
function foundInReplicates(m: ResultModel, protein: number, need: number): boolean {
  const counts = m.protein.perSample
  const base = protein * m.samples.length
  for (const condition of m.conditionColumns) {
    if (condition.samples.length < need) continue
    let found = 0
    for (const columns of condition.samples) {
      if (columns.some((c) => counts[base + c] > 0) && ++found >= need) return true
    }
  }
  return false
}

/**
 * The peptides that the text, contaminant and protein filters let through (a mask, 1 = passes); the
 * q-value and decoy filters differ between the peptide and PSM levels and are applied there.
 */
function peptideMask(m: ResultModel, f: FilterState): Uint8Array {
  const pt = m.tables.peptides
  const mask = new Uint8Array(pt.count)
  if (f.proteinFilter === undefined) {
    mask.fill(1)
  } else if (Number.isInteger(f.proteinFilter) && f.proteinFilter >= 0 && f.proteinFilter < m.tables.proteins.count) {
    const { offsets, peptide } = m.protein.members
    for (let i = offsets[f.proteinFilter]; i < offsets[f.proteinFilter + 1]; i++) mask[peptide[i]] = 1
  }
  if (f.hideContaminants) {
    for (let k = 0; k < pt.count; k++) if (m.peptide.contaminant[k]) mask[k] = 0
  }
  const tokens = words(f.text)
  if (tokens.length > 0) {
    const accession = m.tables.proteins.accession
    for (let k = 0; k < pt.count; k++) {
      if (!mask[k]) continue
      const proteins = Array.from(m.peptide.proteins[k], (p) => accession[p])
      mask[k] = matches(`${pt.sequence[k]}\n${pt.proforma[k]}\n${proteins.join('\n')}`.toLowerCase(), tokens) ? 1 : 0
    }
  }
  return mask
}

/**
 * The rows of `level` that pass the filters, ascending.
 *
 * - Proteins: `text` (accession, description, the sequences of its peptides), `maxQ` (protein q-value, limited by `proteinFdr`),
 *   `minPeptides`, `minReplicatesInCondition`, `hideContaminants`, `showDecoys`.
 * - Peptides: `text` (sequence, ProForma, accessions of the proteins), `maxQ` on the best PSM's
 *   q-value (there is no peptide-level FDR; limited by `psmFdr`), `hideContaminants` (peptides that
 *   map only to contaminants), `showDecoys`, `proteinFilter`.
 * - PSMs: `text` and `hideContaminants` through the peptide, `maxQ` (PSM q-value, limited by `psmFdr`),
 *   `showDecoys`, `proteinFilter` and `peptideFilter`.
 *
 * A row without a q-value passes `maxQ`. The filters that do not belong to a level are ignored by it.
 */
export function applyFilters(m: ResultModel, level: Level, f: FilterState): Uint32Array {
  let kept = 0
  if (level === 'proteins') {
    const pr = m.tables.proteins
    const out = new Uint32Array(pr.count)
    const limit = qLimit(f.maxQ, m.proteinFdr)
    const tokens = words(f.text)
    const texts = tokens.length > 0 ? proteinText(m) : []
    for (let p = 0; p < pr.count; p++) {
      if (!f.showDecoys && pr.decoy[p]) continue
      if (f.hideContaminants && m.protein.contaminant[p]) continue
      if (pr.qValue[p] > limit) continue
      if (m.protein.peptides[p] < f.minPeptides) continue
      if (tokens.length > 0 && !matches(texts[p], tokens)) continue
      if (f.minReplicatesInCondition > 0 && !foundInReplicates(m, p, f.minReplicatesInCondition)) continue
      out[kept++] = p
    }
    return out.slice(0, kept)
  }
  if (level === 'peptides') {
    const pt = m.tables.peptides
    const out = new Uint32Array(pt.count)
    const limit = qLimit(f.maxQ, m.psmFdr)
    const mask = peptideMask(m, f)
    for (let k = 0; k < pt.count; k++) {
      if (!mask[k] || (!f.showDecoys && pt.decoy[k]) || m.peptide.bestQ[k] > limit) continue
      out[kept++] = k
    }
    return out.slice(0, kept)
  }
  const ps = m.tables.psms
  const out = new Uint32Array(ps.count)
  const limit = qLimit(f.maxQ, m.psmFdr)
  const mask = peptideMask(m, f)
  const only = f.peptideFilter
  for (let i = 0; i < ps.count; i++) {
    const k = ps.peptide[i]
    if (!mask[k] || (!f.showDecoys && ps.decoy[i]) || ps.qValue[i] > limit) continue
    if (only !== undefined && k !== only) continue // an index that is no peptide matches nothing
    out[kept++] = i
  }
  return out.slice(0, kept)
}

/**
 * A sorted copy of `rows` by the column `key` (an id of `columns.ts`: "qValue", "psms", "accession",
 * "sample:1", ...). Numbers sort numerically with missing values (NaN) last in both directions, text
 * case-insensitively by UTF-16 code unit with empty text (no gene, no protein) last in both
 * directions. The spectrum (native IDs) sorts by its scan number when every row has one, else in
 * natural order. Rows with equal keys stay in the order they have in `rows`.
 *
 * `filters` is the level's filter state that made `rows`: the peptide counts ("psms", "foundIn",
 * "sample:<n>" of the peptides) are those at its cutoff (see `peptideCounts`), as in the table cells
 * and the CSV. The other columns do not depend on it.
 */
export function sortRows(
  m: ResultModel,
  level: Level,
  rows: Uint32Array,
  key: string,
  dir: 'asc' | 'desc',
  filters: FilterState,
): Uint32Array {
  const def = columnDef(m, level, key)
  if (!def) throw new Error(`Cannot sort the ${level} table by "${key}"`)
  const counts = peptideCounts(m, level === 'peptides' ? filters.maxQ : NaN)
  const n = rows.length
  const order = new Uint32Array(n)
  for (let i = 0; i < n; i++) order[i] = i
  const sign = dir === 'desc' ? -1 : 1

  // numbers (a native ID with a scan number is one), or text
  let numbers: Float64Array | null = null
  let texts: string[] | null = null
  if (def.number) {
    numbers = new Float64Array(n)
    for (let i = 0; i < n; i++) numbers[i] = def.number(m, rows[i], counts)
  } else {
    texts = new Array(n)
    for (let i = 0; i < n; i++) texts[i] = def.text!(m, rows[i], counts)
    if (def.natural) {
      const scans = new Float64Array(n)
      let every = n > 0
      for (let i = 0; i < n && every; i++) {
        const scan = scanNumber(texts[i])
        if (scan === null) every = false
        else scans[i] = scan
      }
      if (every) {
        numbers = scans
        texts = null
      } else {
        texts = texts.map(naturalKey)
      }
    }
  }

  if (numbers) {
    const keys = new Float64Array(n)
    for (let i = 0; i < n; i++) keys[i] = numbers[i] === numbers[i] ? sign * numbers[i] : Infinity
    order.sort((a, b) => keys[a] - keys[b] || a - b) // Infinity - Infinity is NaN, which falls through
  } else {
    const keys = texts!.map((t) => t.toLowerCase())
    order.sort((a, b) => {
      const x = keys[a]
      const y = keys[b]
      if (x === y) return a - b
      if (x === '') return 1 // empty text is missing: last, whichever way it sorts
      if (y === '') return -1
      return x < y ? -sign : sign
    })
  }
  const sorted = new Uint32Array(n)
  for (let i = 0; i < n; i++) sorted[i] = rows[order[i]]
  return sorted
}
