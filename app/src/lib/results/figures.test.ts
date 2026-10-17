import { describe, expect, it } from 'vitest'
import type { ProSEMultiSummary } from '../engine/openms-types'
import { sampleDesign, sampleTables } from './fixtures'
import { keyFigures, levelTotal } from './figures'
import { buildModel } from './model'

const summary = (ms2: number[], proteinFdrApplied = true) =>
  ({
    files: ms2.map((ms2Spectra, i) => ({ path: `f${i}.mzML`, ms2Spectra })),
    proteinFdrApplied,
    psmFdr: 0.01,
    proteinFdr: 0.01,
    decoyString: 'DECOY_',
    openSearch: false,
    modificationAnalysis: null,
  }) as unknown as ProSEMultiSummary

describe('keyFigures', () => {
  it("counts the targets at the search's cutoffs", () => {
    const tables = sampleTables()
    tables.psms.precursorErrorPpm.set([1, -2, 30, 3, -4, 5, NaN, 0.5, 9])
    tables.proteins.group.set([0, 0, 2, 3]) // ALBU and A1AT in one group
    // PSM FDR 1 %: PSMs 0 1 3 4 5 6 7 (q ≤ 0.01), none decoy; protein FDR 0.3 %: proteins 0 and 2
    const m = buildModel(tables, sampleDesign(), { showTechReplicates: false, psmFdr: 0.01, proteinFdr: 0.003 })
    const f = keyFigures(m, summary([20, 15]))
    expect(f.proteinGroups).toBe(2) // group 0 (ALBU) and the contaminant
    expect(f.peptides).toBe(4) // peptides 0–3; 4 is a decoy
    expect(f.psms).toBe(7)
    expect(f.ms2).toBe(35)
    expect(f.psmShareOfMs2).toBeCloseTo(7 / 35)
    // |error| of PSMs 0 1 3 4 5 7: 1 2 3 4 5 0.5 → median 2.5 (NaN skipped)
    expect(f.medianAbsPpm).toBeCloseTo(2.5)
    expect(f.samples).toBe(2)
    expect(f.conditions).toBe(2)
  })

  it('has no share without MS2 counts and no error without errors', () => {
    const tables = sampleTables()
    tables.psms.precursorErrorPpm.fill(NaN)
    const m = buildModel(tables, sampleDesign(), { showTechReplicates: false, psmFdr: 0.01, proteinFdr: 0.01 })
    const f = keyFigures(m, summary([0]))
    expect(f.psmShareOfMs2).toBeNull()
    expect(f.medianAbsPpm).toBeNull()
  })
})

describe('levelTotal', () => {
  it("counts a level's rows at the search's cutoff, with or without decoys", () => {
    const m = buildModel(sampleTables(), sampleDesign(), { showTechReplicates: false, psmFdr: 0.01, proteinFdr: 1 })
    expect(levelTotal(m, 'proteins', false)).toBe(3)
    expect(levelTotal(m, 'proteins', true)).toBe(4)
    expect(levelTotal(m, 'psms', false)).toBe(7)
    expect(levelTotal(m, 'peptides', true)).toBe(4) // the decoy peptide's PSM is at q 0.03
  })
})
