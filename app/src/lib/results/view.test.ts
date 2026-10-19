import { describe, expect, it } from 'vitest'
import type { ProSEMultiSummary, StoredSpectra } from '../engine/openms-types'
import type { OpenResult } from '../search/session.svelte'
import { sampleDesign, sampleTables } from './fixtures'
import { input } from '../design/fixtures'
import { resolveDesign } from '../design/model'
import { makeTables } from './synthetic'
import { peptidePsms } from './protein'
import { releaseResultsView, resultsViewFor } from './view.svelte'

function result(psmFdr = 0.01, proteinFdr = 0.01, rescored = false): OpenResult {
  const tables = sampleTables()
  return {
    id: 'r1',
    createdAt: '2026-10-17T00:00:00Z',
    engineResult: false,
    design: sampleDesign(),
    psmFdr,
    proteinFdr,
    settings: { parameters: {}, fixedMods: [], database: 'db.fasta', rescore: rescored, peptdeep: false, contaminants: true },
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

/** control 1 measured twice (technical replicates) and EGF 1: PSMs 1, 2 and 3 in the three files. */
function techResult(): OpenResult {
  const r = result(1, 1)
  const design = resolveDesign([
    input('a.mzML', { condition: 'control', replicate: 1, techReplicate: 1 }),
    input('b.mzML', { condition: 'control', replicate: 1, techReplicate: 2 }),
    input('c.mzML', { condition: 'EGF', replicate: 1 }),
  ])
  const tables = makeTables({
    files: ['a.mzML', 'b.mzML', 'c.mzML'],
    proteins: [{ accession: 'P1', sequence: 'AAAAAKCCCCCK' }],
    peptides: [{ sequence: 'AAAAAK', proteins: [0] }],
    psms: [{ peptide: 0, file: 0 }, { peptide: 0, file: 1 }, { peptide: 0, file: 1 }, { peptide: 0, file: 2 }],
  })
  return { ...r, design, outcome: { ...r.outcome, tables } }
}

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

  it('keeps sorting by the same sample when technical replicates are split or merged', () => {
    const view = resultsViewFor(techResult())
    expect(view.model.samples.map((s) => s.label)).toEqual(['control 1', 'EGF 1'])
    view.proteins.sortBy('sample:1') // EGF 1
    view.peptides.sortBy('sample:0') // control 1
    view.setShowTechReplicates(true)
    expect(view.model.samples.map((s) => s.label)).toEqual(['control 1 · TR1', 'control 1 · TR2', 'EGF 1'])
    expect(view.proteins.sort).toEqual({ key: 'sample:2', dir: 'desc' })
    expect(view.peptides.sort).toEqual({ key: 'sample:0', dir: 'desc' }) // the first measurement of control 1
    view.peptides.sortBy('sample:1') // control 1 · TR2
    view.setShowTechReplicates(false)
    expect(view.proteins.sort).toEqual({ key: 'sample:1', dir: 'desc' })
    expect(view.peptides.sort).toEqual({ key: 'sample:0', dir: 'desc' }) // merged into control 1
    // other sort keys stay
    view.psms.sortBy('charge')
    view.setShowTechReplicates(true)
    expect(view.psms.sort.key).toBe('charge')
  })

  it('releases the view of a result that closed', () => {
    const r = result()
    const view = resultsViewFor(r)
    releaseResultsView()
    expect(resultsViewFor(r)).not.toBe(view)
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

describe('the protein panel', () => {
  it('opens a protein and closes it, and the selection stays', () => {
    const view = resultsViewFor(result(1, 1))
    expect(view.panel).toBeNull()
    expect(view.panelTab).toBe('peptides')
    view.openProtein(1)
    expect(view.panel).toBe(1)
    expect(view.proteins.selected).toBe(1)
    view.openProtein(0) // another protein replaces it
    expect(view.panel).toBe(0)
    expect(view.proteins.selected).toBe(0)
    view.closeProtein()
    expect(view.panel).toBeNull()
    expect(view.proteins.selected).toBe(0) // the row stays selected, the focus goes back to it
  })

  it('opens no panel for what is no protein (a peptide below the protein FDR has none)', () => {
    const view = resultsViewFor(result(1, 1))
    for (const row of [-1, 4, 1.5, NaN, 1e9]) view.openProtein(row)
    expect(view.panel).toBeNull()
    expect(view.proteins.selected).toBeNull()
  })

  it("'Open in PSM table' filters the PSMs by the protein and shows them", () => {
    const view = resultsViewFor(result(1, 1))
    view.filterBy({ protein: 0 })
    expect(view.tab).toBe('psms')
    expect(view.psms.filters.proteinFilter).toBe(0)
    expect(Array.from(view.psms.rows)).toEqual([1, 3, 0, 2]) // ALBU's PSMs, by q-value
    expect(view.psms.rows.length).toBe(view.model.protein.psms[0])
  })

  it("starts from the search's cutoff, without the other filters of that table", () => {
    const view = resultsViewFor(result(1, 1))
    view.psms.filters.text = 'zzz'
    view.psms.filters.maxQ = 0.001
    view.psms.filters.peptideFilter = 0
    view.filterBy({ protein: 1 })
    expect(view.psms.filters).toMatchObject({ text: '', maxQ: 1, proteinFilter: 1, peptideFilter: undefined })
    expect(Array.from(view.psms.rows)).toEqual([4, 5, 6])
    expect(view.psms.rows.length).toBe(view.model.protein.psms[1])
  })

  it('shows the contaminants or decoys that its protein is one of', () => {
    const view = resultsViewFor(result(1, 1))
    expect(view.psms.filters).toMatchObject({ hideContaminants: true, showDecoys: false })
    view.filterBy({ protein: 2 }) // the trypsin contaminant
    expect(view.psms.filters.hideContaminants).toBe(false)
    expect(Array.from(view.psms.rows)).toEqual([7])
    view.filterBy({ protein: 3 }) // the decoy
    expect(view.psms.filters.showDecoys).toBe(true)
    expect(Array.from(view.psms.rows)).toEqual([8])
    view.filterBy({ protein: 0 })
    expect(view.psms.filters).toMatchObject({ hideContaminants: false, showDecoys: true }) // what was shown stays shown
  })

  it("'All in the PSM table' of a peptide filters the PSMs by that peptide and shows them", () => {
    const view = resultsViewFor(result(1, 1))
    view.psms.filters.text = 'zzz'
    view.psms.filters.maxQ = 0.001
    view.filterBy({ peptide: 0 }) // M[Oxidation]KWVTF: PSMs 0, 1 and 2
    expect(view.tab).toBe('psms')
    expect(view.psms.filters).toMatchObject({ text: '', maxQ: 1, peptideFilter: 0, proteinFilter: undefined })
    expect(Array.from(view.psms.rows)).toEqual([1, 0, 2]) // by q-value
    expect(view.psms.rows.length).toBe(peptidePsms(view.model, 0).length)
    // a contaminant's or a decoy's peptide is shown, too
    view.filterBy({ peptide: 3 })
    expect(view.psms.filters.hideContaminants).toBe(false)
    expect(Array.from(view.psms.rows)).toEqual([7])
    view.filterBy({ peptide: 4 })
    expect(view.psms.filters.showDecoys).toBe(true)
    expect(Array.from(view.psms.rows)).toEqual([8])
    // the protein filter of an earlier "Open in PSM table" does not stay
    view.filterBy({ protein: 0 })
    view.filterBy({ peptide: 2 })
    expect(view.psms.filters.proteinFilter).toBeUndefined()
    expect(Array.from(view.psms.rows)).toEqual([4, 5, 6])
    // what is no peptide opens nothing
    view.filterBy({ peptide: 99 })
    view.filterBy({ peptide: -1 })
    expect(view.psms.filters.peptideFilter).toBe(2)
  })

  it('opens a PSM in the PSM table: its tab, the PSM selected, the filters that hid it lifted', () => {
    const view = resultsViewFor(result(1, 1))
    view.openPsm(3)
    expect(view.tab).toBe('psms')
    expect(view.psms.selected).toBe(3)
    expect(view.psms.rows.includes(3)).toBe(true)

    // a filter that lets it through stays
    view.psms.filters.text = 'TFISLL'
    view.openPsm(3)
    expect(view.psms.filters.text).toBe('TFISLL')
    // one that hides it goes
    view.openPsm(0)
    expect(view.psms.filters.text).toBe('')
    expect(view.psms.selected).toBe(0)
    view.filterBy({ protein: 1 })
    view.openPsm(0)
    expect(view.psms.filters.proteinFilter).toBeUndefined()
    expect(view.psms.rows.includes(0)).toBe(true)
  })

  it('shows a contaminant PSM or a decoy PSM that the default filters hide', () => {
    const view = resultsViewFor(result(1, 1))
    expect(view.psms.rows.includes(7)).toBe(false)
    view.openPsm(7) // trypsin
    expect(view.psms.filters.hideContaminants).toBe(false)
    expect(view.psms.rows.includes(7)).toBe(true)
    expect(view.psms.rows.includes(8)).toBe(false)
    view.openPsm(8) // the decoy
    expect(view.psms.filters.showDecoys).toBe(true)
    expect(view.psms.rows.includes(8)).toBe(true)
    expect(view.psms.selected).toBe(8)
  })
})

describe('the PSM view', () => {
  it('opens a PSM of the PSM table; Prev and Next follow the rows of the table, as sorted and filtered', () => {
    const view = resultsViewFor(result(1, 1))
    // by q-value; 7 (a contaminant) and 8 (a decoy) are hidden
    expect(Array.from(view.psms.rows)).toEqual([1, 3, 0, 4, 5, 6, 2])
    view.openPsm(3)
    expect(view.psm).toEqual({ row: 3, origin: { kind: 'psms' } })
    expect(view.tab).toBe('psms')
    expect(view.psms.selected).toBe(3)
    expect(view.psmNeighbours).toEqual({ prev: 1, next: 0, position: 1, count: 7 })
    view.stepPsm(1)
    expect(view.psm?.row).toBe(0)
    expect(view.psms.selected).toBe(0)
    view.stepPsm(-1)
    view.stepPsm(-1)
    view.stepPsm(-1)
    expect(view.psm?.row).toBe(1)
    expect(view.psmNeighbours.prev).toBeNull()
    view.stepPsm(-1) // nothing before the first
    expect(view.psm?.row).toBe(1)

    // another sort, another order
    view.psms.sortBy('score') // descending: 50 45 42 41 40 40 30
    expect(Array.from(view.psms.rows)).toEqual([1, 3, 4, 5, 0, 6, 2])
    view.openPsm(4)
    expect(view.psmNeighbours).toMatchObject({ prev: 3, next: 5 })
    // a filter that hides the PSM: it stays open, without neighbours
    view.psms.filters.text = 'TFISLL'
    expect(view.psm?.row).toBe(4)
    expect(view.psmNeighbours).toEqual({ prev: null, next: null, position: -1, count: 1 })

    expect(view.closePsm()).toEqual({ kind: 'psms' })
    expect(view.psm).toBeNull()
    expect(view.tab).toBe('psms')
    expect(view.psms.selected).toBe(4)
  })

  it('opens a PSM of the protein panel among the PSMs of its peptide, and restores the PSM table when it closes', () => {
    const view = resultsViewFor(result(1, 1))
    view.openProtein(0)
    view.panelPeptide = 0
    view.psms.filters.text = 'zzz'
    view.psms.filters.maxQ = 0.005
    const before = { ...view.psms.filters }

    view.openPsmFromPanel(0, 0) // PSM 0 of peptide 0 (M[Oxidation]KWVTF of ALBU)
    expect(view.tab).toBe('psms')
    expect(view.psm).toMatchObject({ row: 0, origin: { kind: 'panel', protein: 0, peptide: 0 } })
    expect(view.psms.filters).toMatchObject({ proteinFilter: 0, peptideFilter: 0, text: '', maxQ: 1 })
    expect(Array.from(view.psms.rows)).toEqual([1, 0, 2])
    expect(view.psmNeighbours).toMatchObject({ prev: 1, next: 2 })

    expect(view.closePsm()?.kind).toBe('panel')
    expect(view.tab).toBe('proteins')
    expect(view.panel).toBe(0)
    expect(view.panelPeptide).toBe(0) // the panel shows the peptide as it was
    expect(view.psms.filters).toEqual(before)

    // from the panel's PSMs tab: all PSMs of the protein
    view.openPsmFromPanel(3, null) // TFISLL of ALBU
    expect(view.psms.filters).toMatchObject({ proteinFilter: 0, peptideFilter: undefined })
    expect(Array.from(view.psms.rows)).toEqual([1, 3, 0, 2])
    view.closePsm()

    // another protein forgets the open peptide
    view.openProtein(1)
    expect(view.panelPeptide).toBeNull()
  })

  it('closes when the user goes elsewhere: a protein, a filter of the PSM table', () => {
    const view = resultsViewFor(result(1, 1))
    view.openPsm(0)
    view.openProtein(1)
    expect(view.psm).toBeNull()
    view.openPsm(0)
    view.filterBy({ peptide: 2 })
    expect(view.psm).toBeNull()
    // what is no PSM opens nothing
    view.openPsm(99)
    view.openPsmFromPanel(-1, null)
    expect(view.psm).toBeNull()
  })

  it('keeps the options of the spectrum from one PSM to the next', () => {
    const view = resultsViewFor(result(1, 1))
    expect(view.psmOptions).toEqual({ ions: ['b', 'y'], charges: null, losses: null, precursor: false, bottom: null })
    view.openPsm(1)
    view.psmOptions.ions = ['a', 'b', 'y']
    view.stepPsm(1)
    expect(view.psmOptions.ions).toEqual(['a', 'b', 'y'])
  })
})
