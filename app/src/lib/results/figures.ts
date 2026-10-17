// The key figures above the results tables, and the size of each level (its tab's count), all at the
// search's cutoffs: what the search found, before the user filters anything.

import type { ProSEMultiSummary } from '../engine/openms-types'
import { applyFilters, defaultFilters } from './filters'
import type { Level, ResultModel } from './model'

/**
 * The rows of a level at the search's cutoff (protein FDR for proteins, PSM FDR for peptides and
 * PSMs), contaminants included, decoys only `withDecoys`.
 */
export function levelRows(m: ResultModel, level: Level, withDecoys: boolean): Uint32Array {
  const maxQ = level === 'proteins' ? m.proteinFdr : m.psmFdr
  return applyFilters(m, level, { ...defaultFilters(), maxQ, showDecoys: withDecoys })
}

/** The number of `levelRows`. */
export function levelTotal(m: ResultModel, level: Level, withDecoys: boolean): number {
  return levelRows(m, level, withDecoys).length
}

export type KeyFigures = {
  /** Target protein groups at the protein FDR (contaminants included). */
  proteinGroups: number
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
  const groups = new Set<number>()
  for (const p of proteins) groups.add(m.tables.proteins.group[p])
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
    proteinGroups: groups.size,
    peptides: levelTotal(m, 'peptides', false),
    psms: psms.length,
    ms2,
    psmShareOfMs2: ms2 > 0 ? psms.length / ms2 : null,
    medianAbsPpm: median,
    samples: new Set(m.columnSample).size,
    conditions: m.design.conditions.length,
  }
}
