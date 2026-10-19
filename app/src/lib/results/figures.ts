// The key figures above the results tables, and the size of each level (its tab's count), all at the
// search's cutoffs: what the search found, before the user filters anything.

import type { ProSEMultiSummary } from '../engine/openms-types'
import { applyFilters, defaultFilters } from './filters'
import type { Level, ResultModel } from './model'

/**
 * The rows of a level at the search's cutoff (protein FDR for proteins, PSM FDR for peptides and
 * PSMs), contaminants included, decoys only `withDecoys`. Computed once per model; do not modify.
 */
export function levelRows(m: ResultModel, level: Level, withDecoys: boolean): Uint32Array {
  let cache = levelCache.get(m)
  if (!cache) levelCache.set(m, (cache = new Map()))
  const key = `${level}${withDecoys ? '+decoys' : ''}`
  let rows = cache.get(key)
  if (!rows) {
    const maxQ = level === 'proteins' ? m.proteinFdr : m.psmFdr
    rows = applyFilters(m, level, { ...defaultFilters(), maxQ, showDecoys: withDecoys })
    cache.set(key, rows)
  }
  return rows
}

/** The rows of `levelRows`, once per model (the key figures, the tabs and "n of total" share them). */
const levelCache = new WeakMap<ResultModel, Map<string, Uint32Array>>()

/** The number of `levelRows`. */
export function levelTotal(m: ResultModel, level: Level, withDecoys: boolean): number {
  return levelRows(m, level, withDecoys).length
}

export type KeyFigures = {
  /**
   * Target protein groups at the protein FDR (contaminants included). Proteins that cannot be told
   * apart (the same group) count once; a protein without a group (`group` -1) is a group of its own.
   */
  proteinGroups: number
  /** The target proteins behind them: the rows of the Proteins tab (before the user's filters). */
  proteins: number
  /** Target peptides (peptidoforms) whose best PSM is within the PSM FDR. */
  peptides: number
  /** Target PSMs within the PSM FDR. */
  psms: number
  /** MS2 spectra in the searched files. */
  ms2: number
  /** `psms / ms2`, or null without MS2 counts. */
  psmShareOfMs2: number | null
  /** The median absolute precursor error of those PSMs (ppm), or null. */
  medianAbsPpm: number | null
  /** Biological samples and conditions of the design. */
  samples: number
  conditions: number
}

export function keyFigures(m: ResultModel, summary: ProSEMultiSummary): KeyFigures {
  const proteins = levelRows(m, 'proteins', false)
  // a protein without a group (-1) is its own group: counting the -1 as one group would merge them
  const grouped = new Set<number>()
  let ungrouped = 0
  for (const p of proteins) {
    const group = m.tables.proteins.group[p]
    if (group < 0) ungrouped++
    else grouped.add(group)
  }
  const psms = levelRows(m, 'psms', false)
  const ms2 = summary.files.reduce((n, f) => n + f.ms2Spectra, 0)

  const errors = new Float64Array(psms.length)
  let n = 0
  const ppm = m.tables.psms.precursorErrorPpm
  for (const i of psms) {
    const e = ppm[i]
    if (e === e) errors[n++] = Math.abs(e)
  }
  const sorted = errors.subarray(0, n).sort()
  const median = n === 0 ? null : n % 2 === 1 ? sorted[n >> 1] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2

  return {
    proteinGroups: grouped.size + ungrouped,
    proteins: proteins.length,
    peptides: levelTotal(m, 'peptides', false),
    psms: psms.length,
    ms2,
    psmShareOfMs2: ms2 > 0 ? psms.length / ms2 : null,
    medianAbsPpm: median,
    samples: new Set(m.columnSample).size,
    conditions: m.design.conditions.length,
  }
}

/**
 * The target proteins a protein FDR needs at least. Picked-protein q-values are (D + 1) / (T + 1)
 * (OpenMS' conservative estimate), so even without decoys a protein's q-value is at least 1/(T + 1),
 * T being the target proteins that score at least as well: a cutoff f needs T ≥ 1/f − 1 (99 at 1 %).
 */
export function proteinsNeeded(fdr: number): number {
  return Math.max(0, Math.ceil(1 / fdr - 1 - 1e-9))
}
