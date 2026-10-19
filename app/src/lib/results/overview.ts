// The Overview tab's per-file table: what the search reports of each file, in plain words.

import type { ProSEFileStatus, ProSEFileSummary, ProSEMultiSummary } from '../engine/openms-types'
import { baseName, type ResultModel } from './model'

export type PercolatorStatus = {
  /** `off`: the search did not rescore (the PSMs keep ProSE's scores). */
  kind: 'applied' | 'skipped' | 'off'
  label: string
  /** Why Percolator was skipped. */
  detail: string | null
  warning: string | null
}

export function percolatorStatus(p: ProSEFileSummary['percolator']): PercolatorStatus {
  if (p === null) return { kind: 'off', label: 'Not used', detail: null, warning: null }
  if (p.applied) return { kind: 'applied', label: 'Rescored', detail: null, warning: p.warning }
  return { kind: 'skipped', label: 'Skipped', detail: p.skipped, warning: p.warning }
}

const statusLabels: Record<ProSEFileStatus, string> = {
  EXECUTION_OK: 'Searched',
  INPUT_FILE_EMPTY: 'No spectra to search',
  UNEXPECTED_RESULT: 'Unexpected result',
  ILLEGAL_PARAMETERS: 'Settings not accepted',
  UNKNOWN_ERROR: 'Failed (unknown error)',
}

/** The exit status of a file's search in plain words; `ok` for a file that was searched. */
export function fileStatus(status: ProSEFileStatus): { ok: boolean; label: string } {
  return { ok: status === 'EXECUTION_OK', label: statusLabels[status] ?? 'Unknown status' }
}

/** A duration: "0.1 s", "12.3 s", "2 min 5 s". */
export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return '–'
  if (Math.round(seconds * 10) / 10 < 60) return `${(Math.round(seconds * 10) / 10).toFixed(1)} s`
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)} min ${total % 60} s`
}

export type FileRow = {
  index: number
  /** The file's name without directories. */
  file: string
  /** The design's sample of the file, or null. */
  sample: string | null
  /** The numbers of the search's summary; null if it has none for the file. */
  ms2: number | null
  targets: number | null
  decoys: number | null
  percolator: PercolatorStatus
  /** The collision energy PeptDeep calibrated for the file, when PeptDeep ran. */
  nce: number | null
  seconds: number | null
  status: { ok: boolean; label: string }
}

/** One row per searched file, in the order of the search (the summary lists its files in that order). */
export function fileRows(m: ResultModel, summary: ProSEMultiSummary): FileRow[] {
  return m.tables.files.map((path, index) => {
    const f = summary.files[index]
    const designRow = m.design.rows[index]
    return {
      index,
      file: baseName(path),
      sample: designRow ? (m.design.samples[designRow.sample]?.label ?? null) : null,
      ms2: f?.ms2Spectra ?? null,
      targets: f?.targetPSMs ?? null,
      decoys: f?.decoyPSMs ?? null,
      percolator: percolatorStatus(f?.percolator ?? null),
      nce: f?.peptdeepNce ?? null,
      seconds: f?.secondsSearch ?? null,
      status: f ? fileStatus(f.status) : { ok: false, label: 'No report' },
    }
  })
}

/** The sums of the file rows (a file without numbers adds nothing). */
export function totalsOf(rows: FileRow[]): { ms2: number; targets: number; decoys: number; seconds: number } {
  const totals = { ms2: 0, targets: 0, decoys: 0, seconds: 0 }
  for (const r of rows) {
    totals.ms2 += r.ms2 ?? 0
    totals.targets += r.targets ?? 0
    totals.decoys += r.decoys ?? 0
    totals.seconds += r.seconds ?? 0
  }
  return totals
}
