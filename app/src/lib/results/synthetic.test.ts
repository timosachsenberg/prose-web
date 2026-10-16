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
  it('loads the large and small synthetic results by the debug query', () => {
    expect(loadDebugResult('?debug=small')?.tables.psms.count).toBe(3000)
    const small = loadDebugResult('?x=1&debug=small')!
    expect(small.design.samples).toHaveLength(6)
    expect(loadDebugResult('')).toBeNull()
    expect(loadDebugResult('?debug=other')).toBeNull()
  })
})
