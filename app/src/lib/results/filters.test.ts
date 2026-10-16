import { describe, expect, it } from 'vitest'
import { input } from '../design/fixtures'
import { resolveDesign } from '../design/model'
import type { DesignInput } from '../design/model'
import { sampleDesign, sampleTables } from './fixtures'
import { applyFilters, defaultFilters, sortRows, type FilterState } from './filters'
import { buildModel } from './model'
import { makeLargeTables, makeTables, syntheticDesign } from './synthetic'

const model = () => buildModel(sampleTables(), sampleDesign(), { showTechReplicates: false })
const all: FilterState = { ...defaultFilters(), showDecoys: true }
const rows = (...r: number[]) => Uint32Array.from(r)

describe('applyFilters', () => {
  it('returns every row, in order, when nothing is filtered', () => {
    const m = model()
    expect(applyFilters(m, 'proteins', all)).toEqual(rows(0, 1, 2, 3))
    expect(applyFilters(m, 'peptides', all)).toEqual(rows(0, 1, 2, 3, 4))
    expect(applyFilters(m, 'psms', all)).toEqual(rows(0, 1, 2, 3, 4, 5, 6, 7, 8))
  })

  it('hides decoys unless asked to show them, and contaminants when asked to hide them', () => {
    const m = model()
    expect(defaultFilters().showDecoys).toBe(false)
    const noDecoys = { ...all, showDecoys: false }
    expect(applyFilters(m, 'proteins', noDecoys)).toEqual(rows(0, 1, 2))
    expect(applyFilters(m, 'peptides', noDecoys)).toEqual(rows(0, 1, 2, 3))
    expect(applyFilters(m, 'psms', noDecoys)).toEqual(rows(0, 1, 2, 3, 4, 5, 6, 7))
    const noContaminants = { ...all, hideContaminants: true }
    expect(applyFilters(m, 'proteins', noContaminants)).toEqual(rows(0, 1, 3))
    expect(applyFilters(m, 'peptides', noContaminants)).toEqual(rows(0, 1, 2, 4))
    expect(applyFilters(m, 'psms', noContaminants)).toEqual(rows(0, 1, 2, 3, 4, 5, 6, 8))
  })

  it('text matches case-insensitively, every word somewhere', () => {
    const m = model()
    expect(applyFilters(m, 'proteins', { ...all, text: 'ALBU' })).toEqual(rows(0))
    expect(applyFilters(m, 'proteins', { ...all, text: 'antitrypsin' })).toEqual(rows(1)) // description
    expect(applyFilters(m, 'proteins', { ...all, text: 'human trypsin' })).toEqual(rows(1)) // accession and description
    expect(applyFilters(m, 'proteins', { ...all, text: 'albu trypsin' })).toEqual(rows())
    expect(applyFilters(m, 'proteins', { ...all, text: '  trypsin  ' })).toEqual(rows(1, 2))
    // peptides: sequence, ProForma and the accessions of their proteins
    expect(applyFilters(m, 'peptides', { ...all, text: 'tfis' })).toEqual(rows(1))
    expect(applyFilters(m, 'peptides', { ...all, text: 'm[oxidation]' })).toEqual(rows(0))
    expect(applyFilters(m, 'peptides', { ...all, text: 'albu tfis' })).toEqual(rows(1))
    expect(applyFilters(m, 'peptides', { ...all, text: 'albu' })).toEqual(rows(0, 1))
    // PSMs: through their peptide
    expect(applyFilters(m, 'psms', { ...all, text: 'gdahk' })).toEqual(rows(4, 5, 6))
    expect(applyFilters(m, 'psms', { ...all, text: 'albu' })).toEqual(rows(0, 1, 2, 3))
  })

  it('minPeptides and the replicate filter apply to proteins', () => {
    const m = model()
    expect(applyFilters(m, 'proteins', { ...all, minPeptides: 2 })).toEqual(rows(0))
    expect(applyFilters(m, 'peptides', { ...all, minPeptides: 2 })).toEqual(rows(0, 1, 2, 3, 4))
  })

  it('maxQ uses the protein, best-PSM and PSM q-values; a missing q-value passes', () => {
    const m = model()
    expect(applyFilters(m, 'proteins', { ...all, maxQ: 0.003 })).toEqual(rows(0, 2)) // 0.001, 0.002
    expect(applyFilters(m, 'peptides', { ...all, maxQ: 0.0025 })).toEqual(rows(0, 3)) // best PSM 0.001, 0.002
    expect(applyFilters(m, 'psms', { ...all, maxQ: 0.0035 })).toEqual(rows(1, 3, 7))

    const noQ = makeTables({
      files: ['a.mzML'],
      proteins: [{ accession: 'P1', sequence: 'AAAAAK', qValue: NaN }],
      peptides: [{ sequence: 'AAAAAK', proteins: [0] }],
      psms: [{ peptide: 0, qValue: NaN }],
    })
    const n = buildModel(noQ, resolveDesign([input('a.mzML')]), { showTechReplicates: false })
    for (const level of ['proteins', 'peptides', 'psms'] as const) {
      expect(applyFilters(n, level, { ...all, maxQ: 0.001 })).toEqual(rows(0))
    }
  })

  it('maxQ only tightens', () => {
    // 0.01 search: the PSMs with q 0.02 and 0.03 are above it, whatever maxQ says
    const m = buildModel(sampleTables(), sampleDesign(), { showTechReplicates: false, psmFdr: 0.01, proteinFdr: 0.01 })
    const loose = applyFilters(m, 'psms', { ...all, maxQ: 0.05 })
    expect(loose).toEqual(applyFilters(m, 'psms', { ...all, maxQ: 0.01 }))
    expect(loose).toEqual(rows(0, 1, 3, 4, 5, 6, 7))
    expect(applyFilters(m, 'psms', { ...all, maxQ: NaN })).toEqual(loose)
    expect(applyFilters(m, 'psms', { ...all, maxQ: 0.005 })).toEqual(rows(0, 1, 3, 4, 7))
    // peptides by their best PSM, proteins by their own q-value
    expect(applyFilters(m, 'peptides', { ...all, maxQ: 0.05 })).toEqual(rows(0, 1, 2, 3))
    expect(applyFilters(m, 'proteins', { ...all, maxQ: 0.05 })).toEqual(rows(0, 1, 2))
    expect(applyFilters(m, 'proteins', { ...all, maxQ: 0.003 })).toEqual(rows(0, 2))
  })

  it('protein and peptide filters restrict the lower levels', () => {
    // a: only in A, b: only in B, s: shared by A and B
    const tables = makeTables({
      files: ['x.mzML'],
      proteins: [
        { accession: 'A', sequence: 'AAAAAKSSSSSK' },
        { accession: 'B', sequence: 'CCCCCKSSSSSK' },
      ],
      peptides: [
        { sequence: 'AAAAAK', proteins: [0] },
        { sequence: 'CCCCCK', proteins: [1] },
        { sequence: 'SSSSSK', proteins: [0, 1] },
      ],
      psms: [
        { peptide: 0 },
        { peptide: 1 },
        { peptide: 2 },
        { peptide: 0 },
        { peptide: 2 },
      ],
    })
    const m = buildModel(tables, resolveDesign([input('x.mzML')]), { showTechReplicates: false })
    expect(applyFilters(m, 'peptides', { ...all, proteinFilter: 0 })).toEqual(rows(0, 2))
    expect(applyFilters(m, 'peptides', { ...all, proteinFilter: 1 })).toEqual(rows(1, 2))
    expect(applyFilters(m, 'psms', { ...all, proteinFilter: 0 })).toEqual(rows(0, 2, 3, 4))
    expect(applyFilters(m, 'psms', { ...all, proteinFilter: 1 })).toEqual(rows(1, 2, 4))
    expect(applyFilters(m, 'psms', { ...all, peptideFilter: 2 })).toEqual(rows(2, 4))
    expect(applyFilters(m, 'psms', { ...all, proteinFilter: 1, peptideFilter: 0 })).toEqual(rows())
    expect(applyFilters(m, 'psms', { ...all, proteinFilter: 99 })).toEqual(rows())
    // they do not restrict their own level or the one above
    expect(applyFilters(m, 'proteins', { ...all, proteinFilter: 0, peptideFilter: 1 })).toEqual(rows(0, 1))
    expect(applyFilters(m, 'peptides', { ...all, peptideFilter: 1 })).toEqual(rows(0, 1, 2))
    // and they combine with the other filters
    expect(applyFilters(m, 'psms', { ...all, proteinFilter: 0, text: 'ssss' })).toEqual(rows(2, 4))
  })

  const conditionDesign = (inputs: DesignInput[]) => resolveDesign(inputs)

  it('found in ≥ n replicates of a condition', () => {
    // A has three replicates, B two
    const design = conditionDesign([
      input('a1.mzML', { condition: 'A', replicate: 1 }),
      input('a2.mzML', { condition: 'A', replicate: 2 }),
      input('a3.mzML', { condition: 'A', replicate: 3 }),
      input('b1.mzML', { condition: 'B', replicate: 1 }),
      input('b2.mzML', { condition: 'B', replicate: 2 }),
    ])
    const found = [
      [0, 1, 3], // A 2 of 3
      [0, 3], // one replicate each
      [3, 4], // B 2 of 2
      [0, 1, 2], // A 3 of 3
    ]
    const tables = makeTables({
      files: design.rows.map((r) => r.fileName),
      proteins: found.map((_, i) => ({ accession: `P${i}`, sequence: 'AAAAAK' })),
      peptides: found.map((_, i) => ({ sequence: 'AAAAAK', proteins: [i] })),
      psms: found.flatMap((files, peptide) => files.map((file) => ({ peptide, file }))),
    })
    const m = buildModel(tables, design, { showTechReplicates: false })
    expect(Array.from(m.protein.foundIn)).toEqual([3, 2, 2, 3])
    const keep = (n: number) => applyFilters(m, 'proteins', { ...all, minReplicatesInCondition: n })
    expect(keep(0)).toEqual(rows(0, 1, 2, 3))
    expect(keep(1)).toEqual(rows(0, 1, 2, 3))
    expect(keep(2)).toEqual(rows(0, 2, 3)) // in one condition at least twice, not in two conditions once each
    expect(keep(3)).toEqual(rows(3))
    expect(keep(4)).toEqual(rows())
  })

  it('technical replicates of one sample count as one replicate of a condition', () => {
    const design = conditionDesign([
      input('a1.mzML', { condition: 'A', replicate: 1 }),
      input('a1b.mzML', { condition: 'A', replicate: 1 }), // technical replicate of A 1
      input('a2.mzML', { condition: 'A', replicate: 2 }),
    ])
    const found = [[0, 1], [0, 2]] // protein 0: both measurements of A 1; protein 1: A 1 and A 2
    const tables = makeTables({
      files: design.rows.map((r) => r.fileName),
      proteins: found.map((_, i) => ({ accession: `P${i}`, sequence: 'AAAAAK' })),
      peptides: found.map((_, i) => ({ sequence: 'AAAAAK', proteins: [i] })),
      psms: found.flatMap((files, peptide) => files.map((file) => ({ peptide, file }))),
    })
    for (const showTechReplicates of [false, true]) {
      const m = buildModel(tables, design, { showTechReplicates })
      expect(Array.from(m.protein.foundIn)).toEqual(showTechReplicates ? [2, 2] : [1, 2])
      expect(applyFilters(m, 'proteins', { ...all, minReplicatesInCondition: 2 })).toEqual(rows(1))
    }
  })

  it('samples without a condition count as one group', () => {
    const design = conditionDesign([input('x.mzML'), input('y.mzML')])
    const tables = makeTables({
      files: ['x.mzML', 'y.mzML'],
      proteins: [
        { accession: 'both', sequence: 'AAAAAK' },
        { accession: 'one', sequence: 'CCCCCK' },
      ],
      peptides: [
        { sequence: 'AAAAAK', proteins: [0] },
        { sequence: 'CCCCCK', proteins: [1] },
      ],
      psms: [{ peptide: 0, file: 0 }, { peptide: 0, file: 1 }, { peptide: 1, file: 0 }],
    })
    const m = buildModel(tables, design, { showTechReplicates: false })
    expect(applyFilters(m, 'proteins', { ...all, minReplicatesInCondition: 1 })).toEqual(rows(0, 1))
    expect(applyFilters(m, 'proteins', { ...all, minReplicatesInCondition: 2 })).toEqual(rows(0))
  })
})

describe('sortRows', () => {
  it('sorts numbers ascending and descending, ties in input order', () => {
    const m = model()
    const every = applyFilters(m, 'psms', all)
    expect(sortRows(m, 'psms', every, 'qValue', 'asc')).toEqual(rows(1, 7, 3, 0, 4, 5, 6, 2, 8))
    expect(sortRows(m, 'psms', every, 'qValue', 'desc')).toEqual(rows(8, 2, 6, 5, 4, 0, 3, 7, 1))
    const proteins = applyFilters(m, 'proteins', all)
    expect(sortRows(m, 'proteins', proteins, 'psms', 'desc')).toEqual(rows(0, 1, 2, 3))
    expect(sortRows(m, 'proteins', proteins, 'psms', 'asc')).toEqual(rows(2, 3, 1, 0))
    expect(sortRows(m, 'proteins', proteins, 'coverage', 'desc')).toEqual(rows(0, 2, 3, 1))
    expect(sortRows(m, 'proteins', proteins, 'peptides', 'asc')).toEqual(rows(1, 2, 3, 0))
  })

  it('sorts by a sample column', () => {
    const m = model()
    const proteins = applyFilters(m, 'proteins', all)
    expect(sortRows(m, 'proteins', proteins, 'sample:1', 'desc')).toEqual(rows(1, 0, 2, 3))
    expect(sortRows(m, 'proteins', proteins, 'sample:0', 'desc')).toEqual(rows(0, 3, 1, 2))
    const peptides = applyFilters(m, 'peptides', all)
    expect(sortRows(m, 'peptides', peptides, 'sample:1', 'desc')).toEqual(rows(2, 0, 3, 1, 4))
    expect(() => sortRows(m, 'proteins', proteins, 'sample:2', 'asc')).toThrow(/sample:2/)
  })

  it('sorts text case-insensitively', () => {
    const m = model()
    const proteins = applyFilters(m, 'proteins', all)
    expect(sortRows(m, 'proteins', proteins, 'accession', 'asc')).toEqual(rows(2, 3, 1, 0))
    expect(sortRows(m, 'proteins', proteins, 'accession', 'desc')).toEqual(rows(0, 1, 3, 2))
    const peptides = applyFilters(m, 'peptides', all)
    expect(sortRows(m, 'peptides', peptides, 'sequence', 'asc')).toEqual(rows(2, 3, 0, 4, 1))
  })

  it('puts missing values last in either direction', () => {
    const tables = makeTables({
      files: ['a.mzML'],
      proteins: [],
      peptides: [{ sequence: 'AAAAAK', proteins: [] }],
      psms: [{ peptide: 0, qValue: 0.3 }, { peptide: 0, qValue: NaN }, { peptide: 0, qValue: 0.1 }, { peptide: 0, qValue: 0.2 }],
    })
    const m = buildModel(tables, resolveDesign([input('a.mzML')]), { showTechReplicates: false })
    const every = applyFilters(m, 'psms', all)
    expect(sortRows(m, 'psms', every, 'qValue', 'asc')).toEqual(rows(2, 3, 0, 1))
    expect(sortRows(m, 'psms', every, 'qValue', 'desc')).toEqual(rows(0, 3, 2, 1))
  })

  it('sorts a subset without changing it, and rejects unknown keys', () => {
    const m = model()
    const subset = rows(8, 1, 2)
    expect(sortRows(m, 'psms', subset, 'qValue', 'asc')).toEqual(rows(1, 2, 8))
    expect(subset).toEqual(rows(8, 1, 2))
    expect(() => sortRows(m, 'psms', subset, 'coverage', 'asc')).toThrow(/coverage/)
    expect(sortRows(m, 'psms', rows(), 'qValue', 'asc')).toEqual(rows())
  })
})

describe('performance', () => {
  it('filters and sorts 150k PSMs in under 300 ms', () => {
    const tables = makeLargeTables(150000, 20000, 4000)
    expect(tables.psms.count).toBe(150000)
    const m = buildModel(tables, syntheticDesign(tables.files), { showTechReplicates: false })

    const t0 = performance.now()
    const kept = applyFilters(m, 'psms', { ...defaultFilters(), maxQ: 0.05, hideContaminants: true, text: 'a' })
    const sorted = sortRows(m, 'psms', kept, 'qValue', 'asc')
    const ms = performance.now() - t0
    console.info(`filter + sort of ${tables.psms.count} PSMs (${kept.length} kept): ${ms.toFixed(1)} ms`)

    expect(kept.length).toBeGreaterThan(1000)
    expect(sorted.length).toBe(kept.length)
    let ordered = true
    for (let i = 1; i < sorted.length; i++) ordered &&= tables.psms.qValue[sorted[i - 1]] <= tables.psms.qValue[sorted[i]]
    expect(ordered).toBe(true)
    expect(ms).toBeLessThan(300)

    // the unfiltered case is the most expensive one
    const t1 = performance.now()
    const everything = sortRows(m, 'psms', applyFilters(m, 'psms', { ...defaultFilters(), showDecoys: true }), 'qValue', 'desc')
    const ms1 = performance.now() - t1
    console.info(`filter + sort of all ${everything.length} PSMs: ${ms1.toFixed(1)} ms`)
    expect(everything.length).toBe(150000)
    expect(ms1).toBeLessThan(300)
  })
})
