import { describe, expect, it } from 'vitest'
import type { ProSEFileSummary, ProSEMultiSummary } from '../engine/openms-types'
import { sampleDesign, sampleTables } from './fixtures'
import { buildModel } from './model'
import { fileRows, fileStatus, formatSeconds, percolatorStatus, totalsOf } from './overview'

const file = (path: string, more: Partial<ProSEFileSummary> = {}): ProSEFileSummary => ({
  path,
  status: 'EXECUTION_OK',
  ms2Spectra: 1000,
  targetPSMs: 400,
  decoyPSMs: 4,
  percolator: { applied: true, skipped: null, warning: null },
  peptdeepNce: null,
  precursorError: null,
  fragmentError: null,
  secondsSearch: 12.34,
  ...more,
})

const summary = (files: ProSEFileSummary[]): ProSEMultiSummary => ({
  files,
  search: {
    databaseFile: 'db.fasta',
    enzyme: 'Trypsin',
    openSearch: false,
    calibration: false,
    chunked: false,
    decoyMode: 'auto',
    targetProteins: 100,
    decoyProteins: 100,
    indexedPeptides: 1000,
    indexedFragments: 10000,
    secondsIndexBuild: 1,
    secondsTotal: 10,
  },
  proteinFdrApplied: true,
  psmFdr: 0.01,
  proteinFdr: 0.01,
  decoyString: 'DECOY_',
  openSearch: false,
  modificationAnalysis: null,
})

describe('percolatorStatus', () => {
  it('says whether Percolator rescored the file, skipped it (and why) or was not used', () => {
    expect(percolatorStatus({ applied: true, skipped: null, warning: null })).toEqual({ kind: 'applied', label: 'Rescored', detail: null, warning: null })
    expect(percolatorStatus({ applied: false, skipped: 'Fewer than 100 PSMs.', warning: null })).toEqual({
      kind: 'skipped',
      label: 'Skipped',
      detail: 'Fewer than 100 PSMs.',
      warning: null,
    })
    expect(percolatorStatus(null)).toEqual({ kind: 'off', label: 'Not used', detail: null, warning: null })
    expect(percolatorStatus({ applied: true, skipped: null, warning: 'Few decoys' }).warning).toBe('Few decoys')
  })
})

describe('fileStatus', () => {
  it('names every exit status in plain words', () => {
    expect(fileStatus('EXECUTION_OK')).toEqual({ ok: true, label: 'Searched' })
    expect(fileStatus('INPUT_FILE_EMPTY').ok).toBe(false)
    const labels = (['INPUT_FILE_EMPTY', 'UNEXPECTED_RESULT', 'ILLEGAL_PARAMETERS', 'UNKNOWN_ERROR'] as const).map((s) => fileStatus(s).label)
    expect(new Set(labels).size).toBe(4)
    for (const label of labels) expect(label).not.toMatch(/[A-Z]_[A-Z]/) // no exit code shows
  })
})

describe('formatSeconds', () => {
  it('writes a duration in seconds with one decimal, and minutes from a minute on', () => {
    expect(formatSeconds(0.114)).toBe('0.1 s')
    expect(formatSeconds(12.34)).toBe('12.3 s')
    expect(formatSeconds(59.96)).toBe('1 min 0 s')
    expect(formatSeconds(125.4)).toBe('2 min 5 s')
    expect(formatSeconds(NaN)).toBe('–')
  })
})

describe('fileRows', () => {
  const m = buildModel(sampleTables(), sampleDesign(), { showTechReplicates: false, psmFdr: 0.01, proteinFdr: 0.01 })

  it('lists every searched file, with its sample and what the search says of it', () => {
    const rows = fileRows(m, summary([file('/input/0/ctrl_a.mzML'), file('/input/1/egf_a.mzML', { percolator: null, peptdeepNce: 28.6, ms2Spectra: 700 })]))
    expect(rows.map((r) => r.file)).toEqual(['ctrl_a.mzML', 'egf_a.mzML'])
    expect(rows.map((r) => r.sample)).toEqual(['control 1', 'EGF 1'])
    expect(rows[0]).toMatchObject({ ms2: 1000, targets: 400, decoys: 4, nce: null, seconds: 12.34 })
    expect(rows[0].percolator.kind).toBe('applied')
    expect(rows[1]).toMatchObject({ ms2: 700, nce: 28.6 })
    expect(rows[1].percolator.kind).toBe('off')
  })

  it('keeps the order of the search and tolerates a missing summary file', () => {
    expect(fileRows(m, summary([file('/input/0/ctrl_a.mzML')])).map((r) => r.file)).toEqual(['ctrl_a.mzML', 'egf_a.mzML'])
    expect(fileRows(m, summary([file('/input/0/ctrl_a.mzML')]))[1].ms2).toBeNull()
  })
})

describe('totalsOf', () => {
  it('adds up the files', () => {
    const m = buildModel(sampleTables(), sampleDesign(), { showTechReplicates: false, psmFdr: 0.01, proteinFdr: 0.01 })
    const rows = fileRows(m, summary([file('/input/0/ctrl_a.mzML'), file('/input/1/egf_a.mzML', { ms2Spectra: 500, targetPSMs: 100, decoyPSMs: 1, secondsSearch: 1 })]))
    expect(totalsOf(rows)).toEqual({ ms2: 1500, targets: 500, decoys: 5, seconds: 13.34 })
  })
})
