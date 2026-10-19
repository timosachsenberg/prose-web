import type { ProSEMultiSummary, ResultTables, StoredSpectra } from '../engine/openms-types'
import { sampleDesign, sampleTables } from '../results/fixtures'
import { makeLargeTables, syntheticDesign, syntheticSpectra, syntheticSummary } from '../results/synthetic'
import { APP_VERSION, SCHEMA_VERSION, type SearchRecord } from './record'

// Shared by the persistence tests; not part of the app.

function recordOf(tables: ResultTables, spectra: StoredSpectra, summary: ProSEMultiSummary, design: SearchRecord['design']): SearchRecord {
  return {
    schema: SCHEMA_VERSION,
    id: 'k5x2j9ab',
    name: 'Ünïcode run · 2 files',
    createdAt: '2026-10-19T10:15:30.000Z',
    appVersion: APP_VERSION,
    moduleVersion: '3.6.0-pre-prose',
    design,
    settings: {
      parameters: { 'FDR:protein': 0.05, 'modifications:variable': ['Oxidation (M)'], decoys: 'auto' },
      rescore: true,
      peptdeep: false,
      contaminants: true,
      presetId: 'orbitrap-hcd-tryptic',
      fixedMods: ['Carbamidomethyl (C)'],
      database: 'human.fasta',
    },
    psmFdr: 0.01,
    proteinFdr: 0.05,
    seconds: 12.5,
    summary,
    tables,
    spectra,
  }
}

/**
 * A small record (the nine PSMs of `sampleTables`) with spectra, and non-finite numbers in its summary
 * (JSON has none): NaN, an infinity.
 */
export function smallRecord(): SearchRecord {
  const tables = sampleTables()
  const design = sampleDesign()
  const summary = syntheticSummary(tables, { psmFdr: 0.01, proteinFdr: 0.05 })
  summary.files[0].secondsSearch = NaN
  summary.files[1].secondsSearch = Infinity
  return recordOf(tables, syntheticSpectra(tables, 12, 0.006), summary, design)
}

/** A record of any result tables (with spectra of a few peaks for every PSM). */
export function recordOfTables(tables: ResultTables): SearchRecord {
  const summary = syntheticSummary(tables, { psmFdr: 0.01, proteinFdr: 0.05 })
  return recordOf(tables, syntheticSpectra(tables, 5), summary, syntheticDesign(tables.files))
}

/** A record of `makeLargeTables(psms, ...)` with `peaks` peaks per spectrum for every PSM. */
export function largeRecord(psms: number, peaks: number): SearchRecord {
  const tables = makeLargeTables(psms, Math.max(10, Math.round(psms / 7.5)), Math.max(5, Math.round(psms / 37)))
  const summary = syntheticSummary(tables, { psmFdr: 1, proteinFdr: 0.01 })
  return recordOf(tables, syntheticSpectra(tables, peaks), { ...summary, psmFdr: 1 }, syntheticDesign(tables.files))
}

/** Whether two byte arrays hold the same bytes. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** The first position of `needle` in `haystack`, or -1. */
export function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}
