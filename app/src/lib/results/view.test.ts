import { describe, expect, it } from 'vitest'
import type { ProSEMultiSummary, StoredSpectra } from '../engine/openms-types'
import type { OpenResult } from '../search/session.svelte'
import { sampleDesign, sampleTables } from './fixtures'
import { resultsViewFor } from './view.svelte'

function result(psmFdr = 0.01, proteinFdr = 0.01, rescored = false): OpenResult {
  const tables = sampleTables()
  return {
    id: 'r1',
    createdAt: '2026-10-17T00:00:00Z',
    engineResult: false,
    design: sampleDesign(),
    psmFdr,
    proteinFdr,
    settings: { parameters: {}, fixedMods: [], rescore: rescored, peptdeep: false, contaminants: true },
    outcome: {
      tables,
      spectra: {} as StoredSpectra,
      seconds: 1,
      summary: {
        files: tables.files.map((path) => ({ path, ms2Spectra: 10, percolator: rescored ? { applied: true } : null })),
        proteinFdrApplied: true,
        psmFdr,
        proteinFdr,
        decoyString: 'DECOY_',
        openSearch: false,
        modificationAnalysis: null,
      } as unknown as ProSEMultiSummary,
    },
  }
}

const csvLines = (csv: string) => csv.slice(1, -1).split('\n')

describe('ResultsView', () => {
  it('is kept while the same result is open, and new for another one', () => {
    const r = result()
    const view = resultsViewFor(r)
    view.tab = 'psms'
    expect(resultsViewFor(r)).toBe(view)
    expect(resultsViewFor(r).tab).toBe('psms')
    const other = resultsViewFor(result())
    expect(other).not.toBe(view)
    expect(other.tab).toBe('proteins')
  })

  it('starts each level at its search cutoff, contaminants hidden, sorted by PSMs or q-value', () => {
    const view = resultsViewFor(result(0.01, 0.003))
    expect(view.proteins.filters).toMatchObject({ maxQ: 0.003, hideContaminants: true, showDecoys: false })
    expect(Array.from(view.proteins.rows)).toEqual([0]) // A1AT is at q 0.004, trypsin a contaminant
    expect(view.proteins.total).toBe(2) // ALBU and the contaminant
    expect(Array.from(view.psms.rows)).toEqual([1, 3, 0, 4, 5, 6]) // by q-value; PSM 7 is trypsin's
    expect(view.peptides.sort).toEqual({ key: 'psms', dir: 'desc' })
  })

  it('sorts a new column by its kind, and flips the same column', () => {
    const view = resultsViewFor(result(1, 1))
    const p = view.proteins
    p.sortBy('psms')
    expect(p.sort).toEqual({ key: 'psms', dir: 'asc' })
    p.sortBy('accession')
    expect(p.sort).toEqual({ key: 'accession', dir: 'asc' })
    p.sortBy('coverage')
    expect(p.sort).toEqual({ key: 'coverage', dir: 'desc' })
    expect(Array.from(p.rows)).toEqual([0, 1]) // 50 % before 25 %
  })

  it('reads one cutoff for the cells, the sort order and the CSV of the peptides', () => {
    const view = resultsViewFor(result(1, 1))
    const p = view.peptides
    p.filters.maxQ = 0.004 // peptide 0: PSMs at 0.004 and 0.001 count, not the one at 0.02
    expect(p.counts.psms[0]).toBe(2)
    expect(Array.from(p.rows)).toEqual([0, 1]) // peptide 2's best PSM is at 0.005, peptide 3 is trypsin's
    const lines = csvLines(p.csv())
    expect(lines[0]).toBe('Peptide,Proteins,PSMs,control 1,EGF 1,Found in,Best PSM q-value')
    expect(lines[1]).toBe('M[Oxidation]KWVTF,sp|P02768|ALBU_HUMAN,2,2,0,1,0.001')
  })

  it('writes the visible columns only, and the rows of the filtered view', () => {
    const view = resultsViewFor(result(1, 1))
    const p = view.proteins
    p.toggleColumn('samples', false)
    p.toggleColumn('qValue', true)
    p.filters.text = 'albumin'
    expect(csvLines(p.csv())).toEqual([
      'Accession,Description,Coverage (%),Peptides,PSMs,Found in,q-value',
      'sp|P02768|ALBU_HUMAN,"Serum albumin, mature chain",50.0,2,4,2,0.001',
    ])
  })

  it('says why a table is empty', () => {
    const view = resultsViewFor(result(0.01, 0.0001)) // no protein is at q ≤ 0.0001
    expect(view.proteins.rows.length).toBe(0)
    expect(view.proteins.emptyText).toBe("No proteins pass the search's protein FDR (0.01 %, q ≤ 0.0001).")
    view.psms.filters.text = 'nothing like this'
    expect(view.psms.emptyText).toBe('No PSMs match the filters.')
  })

  it('falls back to the default sort when its sample column goes away', () => {
    const view = resultsViewFor(result(1, 1))
    view.proteins.sortBy('sample:1')
    expect(view.proteins.effectiveSort.key).toBe('sample:1')
    view.proteins.sort = { key: 'sample:5', dir: 'desc' }
    expect(view.proteins.effectiveSort).toEqual({ key: 'psms', dir: 'desc' })
    expect(view.proteins.rows.length).toBe(2)
  })
})
