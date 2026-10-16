import { describe, expect, it } from 'vitest'
import { input, mockupDesign } from '../design/fixtures'
import { resolveDesign } from '../design/model'
import { cutoffs, sampleDesign, sampleTables } from './fixtures'
import { buildModel, peptideCounts } from './model'
import { makeTables } from './synthetic'

describe('buildModel', () => {
  it('coverage and per-sample counts', () => {
    const m = buildModel(sampleTables(), sampleDesign(), { showTechReplicates: false, ...cutoffs })
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
        { peptide: 1, file: 2 },
      ],
    })

    const merged = buildModel(tables, design, { showTechReplicates: false, ...cutoffs })
    expect(merged.samples.map((s) => s.label)).toEqual(['X 1', 'X 2'])
    expect(Array.from(merged.psmSample)).toEqual([0, 0, 0, 0, 1])
    expect(Array.from(merged.peptide.perSample)).toEqual([3, 0, 1, 1]) // summed over both measurements
    expect(Array.from(merged.peptide.foundIn)).toEqual([1, 2])
    expect(Array.from(merged.protein.perSample)).toEqual([4, 1])
    expect(Array.from(merged.protein.foundIn)).toEqual([2])

    const split = buildModel(tables, design, { showTechReplicates: true, ...cutoffs })
    expect(split.samples.map((s) => s.label)).toEqual(['X 1 · TR1', 'X 1 · TR2', 'X 2'])
    expect(split.samples.map((s) => s.condition)).toEqual(['X', 'X', 'X'])
    expect(split.samples.map((s) => s.index)).toEqual([0, 1, 2])
    expect(split.samples.map((s) => s.techReplicate)).toEqual([1, 2, null])
    expect(Array.from(split.psmSample)).toEqual([0, 1, 1, 1, 2])
    expect(Array.from(split.peptide.perSample)).toEqual([1, 2, 0, 0, 1, 1])
    expect(Array.from(split.protein.perSample)).toEqual([1, 3, 1])
  })

  it('found in counts biological samples, however the technical replicates are shown', () => {
    const design = resolveDesign([
      input('x1a.mzML', { condition: 'X', replicate: 1 }),
      input('x1b.mzML', { condition: 'X', replicate: 1 }),
      input('x2.mzML', { condition: 'X', replicate: 2 }),
    ])
    const tables = makeTables({
      files: ['x1a.mzML', 'x1b.mzML', 'x2.mzML'],
      proteins: [{ accession: 'P1', sequence: 'AAAAAK' }],
      peptides: [{ sequence: 'AAAAAK', proteins: [0] }],
      psms: [{ peptide: 0, file: 0 }, { peptide: 0, file: 1 }], // both measurements of X 1, nothing in X 2
    })
    for (const showTechReplicates of [false, true]) {
      const m = buildModel(tables, design, { showTechReplicates, ...cutoffs })
      expect(m.samples).toHaveLength(showTechReplicates ? 3 : 2)
      expect(Array.from(m.protein.foundIn)).toEqual([1])
      expect(Array.from(m.peptide.foundIn)).toEqual([1])
    }
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
    const merged = buildModel(tables, design, { showTechReplicates: false, ...cutoffs })
    expect(merged.samples.map((s) => s.label)).toEqual(['control 1', 'control 2', 'EGF 1'])
    expect(Array.from(merged.psmSample)).toEqual([0, 0, 1, 1, 2, 2])
    expect(Array.from(merged.protein.perSample)).toEqual([2, 2, 2])
    // only EGF 1 was measured twice, and only it is split
    const split = buildModel(tables, design, { showTechReplicates: true, ...cutoffs })
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
    const merged = buildModel(tables, design, { showTechReplicates: false, ...cutoffs })
    expect(merged.conditionColumns).toEqual([
      { name: 'A', samples: [[0]] },
      { name: 'B', samples: [[1]] },
      { name: null, samples: [[2]] },
    ])
    const split = buildModel(tables, design, { showTechReplicates: true, ...cutoffs })
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
    const m = buildModel(tables, resolveDesign([input('a.mzML', { condition: 'A' })]), { showTechReplicates: false, ...cutoffs })
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
    expect(Array.from(m.peptide.foundIn)).toEqual([1, 1, 1, 1, 0])
    expect(m.peptide.bestQ[4]).toBe(0.03)
    expect(Array.from(m.protein.peptides)).toEqual([2, 1, 1, 0])
  })

  it('handles an empty result', () => {
    const tables = makeTables({ files: ['a.mzML'], proteins: [], peptides: [], psms: [] })
    const m = buildModel(tables, resolveDesign([input('a.mzML', { condition: 'A' })]), { showTechReplicates: false, ...cutoffs })
    expect(m.psmSample.length).toBe(0)
    expect(m.protein.coverage.length).toBe(0)
    expect(m.samples.length).toBe(1)
  })

  it('rejects a design that is not the one of the searched files', () => {
    const files = ['/input/0/a.mzML', '/input/1/b.mzML']
    const tables = makeTables({ files, proteins: [], peptides: [], psms: [] })
    const row = (name: string) => input(name, { condition: 'A' })
    const build = (...names: string[]) => buildModel(tables, resolveDesign(names.map(row)), { showTechReplicates: false, ...cutoffs })
    expect(() => build('a.mzML')).toThrow(/1 rows but 2 files/)
    expect(() => build('a.mzML', 'b.mzML', 'c.mzML')).toThrow(/3 rows but 2 files/)
    expect(() => build('b.mzML', 'a.mzML')).toThrow(/file 1 is "\/input\/0\/a.mzML" but the design row says "b.mzML"/)
    expect(build('a.mzML', 'b.mzML').samples).toHaveLength(2) // the directories of the searched files do not matter
  })

  it('requires the cutoffs of the search', () => {
    const tables = makeTables({ files: ['a.mzML'], proteins: [], peptides: [], psms: [] })
    const design = resolveDesign([input('a.mzML')])
    const build = (psmFdr: number, proteinFdr: number) =>
      buildModel(tables, design, { showTechReplicates: false, psmFdr, proteinFdr })
    expect(build(0.01, 0.05).proteinFdr).toBe(0.05)
    expect(() => build(0, 0.01)).toThrow(/psmFdr/)
    expect(() => build(0.01, NaN)).toThrow(/proteinFdr/)
    expect(() => build(1.5, 0.01)).toThrow(/psmFdr/)
    // @ts-expect-error the cutoffs are not optional
    expect(() => buildModel(tables, design, { showTechReplicates: false })).toThrow(/psmFdr/)
  })
})

describe('protein peptide counts', () => {
  it('count plain sequences: modified forms of a peptide are one peptide', () => {
    const tables = makeTables({
      files: ['a.mzML'],
      proteins: [
        { accession: 'P1', sequence: 'AAAAAMKCCCCCK' },
        { accession: 'P2', sequence: 'AAAAAMKDDDDDK' },
      ],
      peptides: [
        { sequence: 'AAAAAMK', proteins: [0, 1] },
        { sequence: 'AAAAAMK', proforma: 'AAAAAM[Oxidation]K', mods: [{ position: 5, name: 'Oxidation' }], proteins: [0, 1] },
        { sequence: 'CCCCCK', proteins: [0] },
        { sequence: 'DDDDDK', proteins: [1] },
        { sequence: 'AAAAAMK', proforma: 'AAAAAMK[Label]', mods: [{ position: 6, name: 'Label' }], proteins: [0, 1] }, // no PSMs
      ],
      psms: [{ peptide: 0 }, { peptide: 1 }, { peptide: 1 }, { peptide: 2 }, { peptide: 3 }],
    })
    const m = buildModel(tables, resolveDesign([input('a.mzML')]), { showTechReplicates: false, ...cutoffs })
    expect(Array.from(m.protein.peptides)).toEqual([2, 2]) // AAAAAMK (twice) + CCCCCK, AAAAAMK (twice) + DDDDDK
    expect(Array.from(m.protein.psms)).toEqual([4, 4]) // all PSMs of all forms
    expect(Array.from(m.peptide.psms)).toEqual([1, 2, 1, 1, 0]) // the Peptides table keeps the forms apart
  })
})

describe('peptideCounts', () => {
  // one peptide, six PSMs in six samples: one at q 0.0005 and five at 0.005; a search at 1 %
  const build = () => {
    const files = [1, 2, 3, 4, 5, 6].map((i) => `s${i}.mzML`)
    const design = resolveDesign(files.map((f, i) => input(f, { condition: 'A', replicate: i + 1 })))
    const tables = makeTables({
      files,
      proteins: [{ accession: 'P1', sequence: 'AAAAAK' }],
      peptides: [{ sequence: 'AAAAAK', proteins: [0] }],
      psms: [0.0005, 0.005, 0.005, 0.005, 0.005, 0.005].map((qValue, file) => ({ peptide: 0, file, qValue })),
    })
    return buildModel(tables, design, { showTechReplicates: false, psmFdr: 0.01, proteinFdr: 0.01 })
  }

  it('counts the PSMs within the cutoff of the peptide table', () => {
    const m = build()
    expect(m.peptide.bestQ[0]).toBe(0.0005)
    expect(m.peptide.psms[0]).toBe(6) // at the search's 1 %
    expect(m.peptide.foundIn[0]).toBe(6)

    const tight = peptideCounts(m, 0.001)
    expect(Array.from(tight.psms)).toEqual([1])
    expect(Array.from(tight.perSample)).toEqual([1, 0, 0, 0, 0, 0])
    expect(Array.from(tight.foundIn)).toEqual([1])
    // 0.005 is within 0.005, and so is everything at or above the search's cutoff
    expect(Array.from(peptideCounts(m, 0.005).psms)).toEqual([6])
    for (const maxQ of [0.01, 0.05, 1, NaN]) expect(peptideCounts(m, maxQ)).toBe(m.peptide)
    // the proteins stay at the search's cutoff: their filter is the protein q-value
    expect(Array.from(m.protein.psms)).toEqual([6])
    expect(Array.from(m.protein.foundIn)).toEqual([6])
  })

  it('keeps the counts of a cutoff', () => {
    const m = build()
    expect(peptideCounts(m, 0.001)).toBe(peptideCounts(m, 0.001))
    expect(peptideCounts(m, 0.002)).not.toBe(peptideCounts(m, 0.001))
    // many cutoffs (typing in the field) do not break anything, and the counts stay right
    for (let i = 1; i <= 30; i++) peptideCounts(m, i / 100000)
    expect(Array.from(peptideCounts(m, 0.001).psms)).toEqual([1])
    expect(Array.from(peptideCounts(m, 0.0004).psms)).toEqual([0])
  })
})
