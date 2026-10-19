import { describe, expect, it } from 'vitest'
import { cutoffs } from './fixtures'
import { buildModel } from './model'
import { loadDebugResult, makeLargeTables, makeTables, syntheticDesign } from './synthetic'

describe('makeLargeTables', () => {
  const t = makeLargeTables(5000, 800, 150)

  it('is deterministic and has the sizes asked for', () => {
    expect(t.psms.count).toBe(5000)
    expect(t.peptides.count).toBe(800)
    expect(t.proteins.count).toBe(150)
    expect(t.files).toHaveLength(6)
    expect(makeLargeTables(5000, 800, 150).psms.qValue).toEqual(t.psms.qValue)
  })

  it('is consistent: every peptide is the stretch of its proteins that start and end name', () => {
    const p = t.peptides
    for (let k = 0; k < p.count; k++) {
      expect(p.proteinOffsets[k + 1]).toBeGreaterThan(p.proteinOffsets[k])
      for (let r = p.proteinOffsets[k]; r < p.proteinOffsets[k + 1]; r++) {
        expect(t.proteins.sequence[p.protein[r]].slice(p.start[r], p.end[r])).toBe(p.sequence[k])
      }
      expect(p.modOffsets[k + 1]).toBeGreaterThanOrEqual(p.modOffsets[k])
    }
    expect(Math.max(...t.psms.peptide)).toBeLessThan(p.count)
    expect(Math.max(...t.psms.file)).toBeLessThan(t.files.length)
  })

  it('has decoys, contaminants, shared peptides and modifications', () => {
    expect(t.proteins.decoy.some((d) => d === 1)).toBe(true)
    expect(t.proteins.accession.some((a) => a.startsWith('CON__'))).toBe(true)
    expect(t.peptides.proforma.some((f) => f.includes('[Oxidation]'))).toBe(true)
    expect(t.peptides.proteinOffsets[800]).toBeGreaterThan(800)
    expect(t.psms.decoy.some((d) => d === 1)).toBe(true)
  })

  it('has a design that gives six samples in two conditions', () => {
    const d = syntheticDesign(t.files)
    expect(d.samples.map((s) => s.label)).toEqual(['control 1', 'control 2', 'control 3', 'EGF 1', 'EGF 2', 'EGF 3'])
    const m = buildModel(t, d, { showTechReplicates: false, ...cutoffs })
    expect(m.samples).toHaveLength(6)
  })
})

describe('makeTables', () => {
  it('finds a peptide in its protein, or says it cannot', () => {
    const spec = { files: ['a.mzML'], psms: [], proteins: [{ accession: 'P1', sequence: 'AAAAAK' }] }
    const t = makeTables({ ...spec, peptides: [{ sequence: 'AAK', proteins: [0] }] })
    expect([t.peptides.start[0], t.peptides.end[0]]).toEqual([3, 6])
    expect(() => makeTables({ ...spec, peptides: [{ sequence: 'CCK', proteins: [0] }] })).toThrow(/CCK/)
  })
})

describe('loadDebugResult', () => {
  it('loads the large and small synthetic results, with a summary of the search', () => {
    const small = loadDebugResult('small')
    expect(small.tables.psms.count).toBe(3000)
    expect(small.design.samples).toHaveLength(6)
    expect(small.psmFdr).toBe(1)
    expect(small.proteinFdr).toBe(0.01)
    const s = small.summary
    expect(s.files.map((f) => f.path)).toEqual(small.tables.files)
    expect(s.files.reduce((n, f) => n + f.targetPSMs + f.decoyPSMs, 0)).toBe(3000)
    expect(s.files.every((f) => f.ms2Spectra > f.targetPSMs + f.decoyPSMs)).toBe(true)
    // small: an open search without protein FDR and without Percolator
    expect(s).toMatchObject({ proteinFdrApplied: false, psmFdr: 1, proteinFdr: 0.01, openSearch: true })
    expect(s.files.every((f) => f.percolator === null)).toBe(true)
    expect(small.tables.proteins.qValue.every((q) => Number.isNaN(q))).toBe(true)
    expect(small.tables.psms.deltaMass[5]).toBeCloseTo(15.994915)
    expect(small.tables.psms.deltaMass[7]).toBeCloseTo(-17.026549)
    expect(Math.abs(small.tables.psms.deltaMass[1])).toBeLessThanOrEqual(0.05)

    // its modification analysis counts the shifted PSMs, as the engine's does (shifts above 0.05 Da)
    const a = s.modificationAnalysis!
    const delta = small.tables.psms.deltaMass
    const shifted = Array.from(delta).filter((d) => Math.abs(d) > 0.05).length
    expect(a.deltaMasses).toMatchObject({ totalPSMs: 3000, modifiedPSMs: shifted, unmodifiedPSMs: 3000 - shifted })
    expect(a.deltaMasses.entries.reduce((n, e) => n + e.count, 0)).toBe(shifted)
    expect(a.deltaMasses.entries.length).toBeGreaterThan(4)
    expect(a.deltaMasses.entries.reduce((n, e) => n + e.percentage, 0)).toBeCloseTo(100)
    const oxidation = a.deltaMasses.entries.find((e) => e.modification === 'Oxidation')!
    expect(oxidation).toMatchObject({ known: true })
    expect(oxidation.deltaMass).toBeCloseTo(15.9949, 3)
    expect(a.deltaMasses.entries.some((e) => !e.known && e.modification === '')).toBe(true)
    // the known shifts are the mapped modifications
    expect(a.ptms.entries.map((e) => e.name)).toEqual(expect.arrayContaining(['Oxidation', 'Ammonia-loss']))
    expect(a.ptms.totalModifiedPSMs + a.ptms.unknownModificationPSMs).toBe(shifted)
    expect(a.ptms.uniqueModifications).toBe(a.ptms.entries.length)

    // large1: the same tables at a PSM FDR of 1 %
    const large1 = loadDebugResult('large1')
    expect(large1.tables.psms.count).toBe(150000)
    expect([large1.psmFdr, large1.proteinFdr, large1.summary.psmFdr]).toEqual([0.01, 0.01, 0.01])

    const large = loadDebugResult('large')
    expect(large.tables.psms.count).toBe(150000)
    expect(large.summary).toMatchObject({ proteinFdrApplied: true, openSearch: false })
    expect(large.summary.files.every((f) => f.percolator?.applied)).toBe(true)
  })

  it('loads the dense result: 20 proteins with about a thousand peptides each, in 24 files', () => {
    const dense = loadDebugResult('dense')
    expect(dense.tables.psms.count).toBe(150000)
    expect(dense.tables.proteins.count).toBe(20)
    expect(dense.tables.files).toHaveLength(24)
    expect(dense.design.samples).toHaveLength(24)
    expect([dense.psmFdr, dense.proteinFdr]).toEqual([1, 0.01])
    // the peptides of the first target proteins: 20,000 peptides over 19 targets, a tenth of them shared
    const t = dense.tables
    const perProtein = new Uint32Array(t.proteins.count)
    for (const p of t.peptides.protein) perProtein[p]++
    expect(Math.max(...perProtein)).toBeGreaterThan(900)
  })
})
