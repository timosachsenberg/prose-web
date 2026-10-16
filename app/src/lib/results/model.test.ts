import { describe, expect, it } from 'vitest'
import { input, mockupDesign } from '../design/fixtures'
import { resolveDesign } from '../design/model'
import { sampleDesign, sampleTables } from './fixtures'
import { buildModel } from './model'
import { makeTables } from './synthetic'

describe('buildModel', () => {
  it('coverage and per-sample counts', () => {
    const m = buildModel(sampleTables(), sampleDesign(), { showTechReplicates: false })
    expect(m.samples.map((s) => s.label)).toEqual(['control 1', 'EGF 1'])
    expect(Array.from(m.psmSample)).toEqual([0, 0, 1, 0, 1, 1, 1, 1, 0])

    // peptides: MKWVTF (3 PSMs), TFISLL (1), GDAHKSEVAH (3), contaminant IVGGYT (1), decoy RSLVQY (1)
    expect(Array.from(m.peptide.psms)).toEqual([3, 1, 3, 1, 1])
    expect(Array.from(m.peptide.perSample)).toEqual([2, 1, 1, 0, 0, 3, 0, 1, 1, 0])
    expect(m.peptide.bestQ[0]).toBe(0.001)
    expect(m.peptide.bestQ[4]).toBe(0.03)
    expect(Array.from(m.peptide.proteins[1])).toEqual([0])

    // ALBU: MKWVTF [0,6) and TFISLL [4,10) overlap, 10 of 20 residues; A1AT: 10 of 40
    expect(m.protein.coverage[0]).toBe(0.5)
    expect(m.protein.coverage[1]).toBe(0.25)
    expect(Array.from(m.protein.peptides)).toEqual([2, 1, 1, 1])
    expect(Array.from(m.protein.psms)).toEqual([4, 3, 1, 1])
    expect(Array.from(m.protein.perSample)).toEqual([3, 1, 0, 3, 0, 1, 1, 0])
    expect(Array.from(m.protein.foundIn)).toEqual([2, 1, 1, 1])
    expect(Array.from(m.protein.contaminant)).toEqual([0, 0, 1, 0])
    expect(Array.from(m.peptide.contaminant)).toEqual([0, 0, 0, 1, 0])
  })

  it('technical replicates merge into their sample unless shown separately', () => {
    // X 1 was measured twice (x1a, x1b), X 2 once
    const design = resolveDesign([
      input('x1a.mzML', { condition: 'X', replicate: 1 }),
      input('x1b.mzML', { condition: 'X', replicate: 1 }),
      input('x2.mzML', { condition: 'X', replicate: 2 }),
    ])
    const tables = makeTables({
      files: ['x1a.mzML', 'x1b.mzML', 'x2.mzML'],
      proteins: [{ accession: 'P1', sequence: 'AAAAAKCCCCCK' }],
      peptides: [
        { sequence: 'AAAAAK', proteins: [0] },
        { sequence: 'CCCCCK', proteins: [0] },
      ],
      psms: [
        { peptide: 0, file: 0 },
        { peptide: 0, file: 1 },
        { peptide: 0, file: 1 },
        { peptide: 1, file: 1 },
      ],
    })

    const merged = buildModel(tables, design, { showTechReplicates: false })
    expect(merged.samples.map((s) => s.label)).toEqual(['X 1', 'X 2'])
    expect(Array.from(merged.psmSample)).toEqual([0, 0, 0, 0])
    expect(Array.from(merged.peptide.perSample)).toEqual([3, 0, 1, 0]) // summed over both measurements
    expect(Array.from(merged.protein.perSample)).toEqual([4, 0])
    expect(Array.from(merged.protein.foundIn)).toEqual([1]) // CCCCCK was seen in the repeat only

    const split = buildModel(tables, design, { showTechReplicates: true })
    expect(split.samples.map((s) => s.label)).toEqual(['X 1 · TR1', 'X 1 · TR2', 'X 2'])
    expect(split.samples.map((s) => s.condition)).toEqual(['X', 'X', 'X'])
    expect(split.samples.map((s) => s.index)).toEqual([0, 1, 2])
    expect(split.samples.map((s) => s.techReplicate)).toEqual([1, 2, null])
    expect(Array.from(split.psmSample)).toEqual([0, 1, 1, 1])
    expect(Array.from(split.peptide.perSample)).toEqual([1, 2, 0, 0, 1, 0])
    expect(Array.from(split.protein.perSample)).toEqual([1, 3, 0])
    expect(Array.from(split.protein.foundIn)).toEqual([2])
  })

  it('the fractions of a sample share its column', () => {
    const design = resolveDesign(mockupDesign())
    const tables = makeTables({
      files: design.rows.map((r) => r.fileName),
      proteins: [{ accession: 'P1', sequence: 'AAAAAK' }],
      peptides: [{ sequence: 'AAAAAK', proteins: [0] }],
      psms: design.rows.map((_, file) => ({ peptide: 0, file })),
    })
    // control 1 = F1 + F2, control 2 = F1 + F2, EGF 1 = the file and its re-injection
    const merged = buildModel(tables, design, { showTechReplicates: false })
    expect(merged.samples.map((s) => s.label)).toEqual(['control 1', 'control 2', 'EGF 1'])
    expect(Array.from(merged.psmSample)).toEqual([0, 0, 1, 1, 2, 2])
    expect(Array.from(merged.protein.perSample)).toEqual([2, 2, 2])
    // only EGF 1 was measured twice, and only it is split
    const split = buildModel(tables, design, { showTechReplicates: true })
    expect(split.samples.map((s) => s.label)).toEqual(['control 1', 'control 2', 'EGF 1 · TR1', 'EGF 1 · TR2'])
    expect(Array.from(split.psmSample)).toEqual([0, 0, 1, 1, 2, 3])
  })

  it('groups the columns of each condition by biological sample', () => {
    const design = resolveDesign([
      input('a1.mzML', { condition: 'A', replicate: 1 }),
      input('a1b.mzML', { condition: 'A', replicate: 1 }),
      input('b1.mzML', { condition: 'B', replicate: 1 }),
      input('loose.mzML'),
    ])
    const tables = makeTables({ files: design.rows.map((r) => r.fileName), proteins: [], peptides: [], psms: [] })
    const merged = buildModel(tables, design, { showTechReplicates: false })
    expect(merged.conditionColumns).toEqual([
      { name: 'A', samples: [[0]] },
      { name: 'B', samples: [[1]] },
      { name: null, samples: [[2]] },
    ])
    const split = buildModel(tables, design, { showTechReplicates: true })
    expect(split.conditionColumns).toEqual([
      { name: 'A', samples: [[0, 1]] },
      { name: 'B', samples: [[2]] },
      { name: null, samples: [[3]] },
    ])
  })

  it('counts a protein once per peptide even when the peptide lists it twice', () => {
    const tables = makeTables({
      files: ['a.mzML'],
      proteins: [{ accession: 'P1', sequence: 'AAAAAKAAAAAK' }],
      peptides: [{ sequence: 'AAAAAK', proteins: [{ protein: 0, start: 0 }, { protein: 0, start: 6 }] }],
      psms: [{ peptide: 0 }, { peptide: 0 }],
    })
    const m = buildModel(tables, resolveDesign([input('a.mzML', { condition: 'A' })]), { showTechReplicates: false })
    expect(Array.from(m.protein.peptides)).toEqual([1])
    expect(Array.from(m.protein.psms)).toEqual([2])
    expect(m.protein.coverage[0]).toBe(1)
  })

  it('counts only the PSMs within the search FDR', () => {
    const m = buildModel(sampleTables(), sampleDesign(), { showTechReplicates: false, psmFdr: 0.01, proteinFdr: 0.01 })
    expect(m.psmFdr).toBe(0.01)
    expect(m.proteinFdr).toBe(0.01)
    // the PSMs with q 0.02 and 0.03 are no evidence; the best q of a peptide still looks at all PSMs
    expect(Array.from(m.peptide.psms)).toEqual([2, 1, 3, 1, 0])
    expect(Array.from(m.peptide.perSample)).toEqual([2, 0, 1, 0, 0, 3, 0, 1, 0, 0])
    expect(m.peptide.bestQ[4]).toBe(0.03)
    expect(Array.from(m.protein.peptides)).toEqual([2, 1, 1, 0])
  })

  it('handles an empty result', () => {
    const tables = makeTables({ files: ['a.mzML'], proteins: [], peptides: [], psms: [] })
    const m = buildModel(tables, resolveDesign([input('a.mzML', { condition: 'A' })]), { showTechReplicates: false })
    expect(m.psmSample.length).toBe(0)
    expect(m.protein.coverage.length).toBe(0)
    expect(m.samples.length).toBe(1)
  })

  it('rejects a design with fewer rows than searched files', () => {
    const tables = makeTables({ files: ['a.mzML', 'b.mzML'], proteins: [], peptides: [], psms: [] })
    const design = resolveDesign([input('a.mzML', { condition: 'A' })])
    expect(() => buildModel(tables, design, { showTechReplicates: false })).toThrow(/design/)
  })
})
