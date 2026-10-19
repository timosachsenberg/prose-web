import { describe, expect, it } from 'vitest'
import { input } from '../design/fixtures'
import { resolveDesign } from '../design/model'
import { cutoffs, sampleDesign, sampleTables } from './fixtures'
import { buildModel } from './model'
import { makeTables } from './synthetic'
import { columnSpecs, csvColumns, defaultHidden, visibleSpecs } from './table-columns'

const model = (opts: { rescored?: boolean; psmFdr?: number } = {}) =>
  buildModel(sampleTables(), sampleDesign(), { showTechReplicates: false, ...cutoffs, ...opts })
const ids = (specs: { id: string }[]) => specs.map((s) => s.id)

describe('columnSpecs', () => {
  it('proteins: per-sample counts grouped by condition, then "Found in"', () => {
    const specs = columnSpecs(model(), 'proteins', { openSearch: false })
    expect(ids(specs)).toEqual([
      'accession', 'gene', 'description', 'coverage', 'peptides', 'psms',
      'sample:0', 'sample:1', 'foundIn', 'qValue', 'score', 'length', 'group',
    ])
    const samples = specs.filter((s) => s.id.startsWith('sample:'))
    expect(samples.map((s) => [s.group, s.header, s.ariaLabel, s.sortKey, s.csv])).toEqual([
      ['control', '1', 'control 1', 'sample:0', ['sample:0']],
      ['EGF', '1', 'EGF 1', 'sample:1', ['sample:1']],
    ])
    // what shows is what the CSV writes: the gene too
    const gene = specs.find((s) => s.id === 'gene')!
    expect([gene.sortKey, gene.csv]).toEqual(['gene', ['gene']])
  })

  it('says that the protein counts are at the search PSM FDR', () => {
    const specs = columnSpecs(model({ psmFdr: 0.01 }), 'proteins', { openSearch: false })
    for (const id of ['peptides', 'psms']) {
      expect(specs.find((s) => s.id === id)!.title).toBe('At the search PSM FDR (1 %, q ≤ 0.01)')
    }
    expect(specs.find((s) => s.id === 'sample:0')!.title).toBe('control 1: at the search PSM FDR (1 %, q ≤ 0.01)')
  })

  it('names the score after the rescoring', () => {
    const score = (rescored: boolean) => columnSpecs(model({ rescored }), 'psms', { openSearch: false }).find((s) => s.id === 'score')!
    expect(score(true).header).toBe('Percolator score')
    expect(score(false).header).toBe('ln(hyperscore)')
  })

  it('peptides: the best PSM q-value, counts per sample; PSMs: no sample counts', () => {
    expect(ids(columnSpecs(model(), 'peptides', { openSearch: false }))).toEqual([
      'peptide', 'proteins', 'psms', 'sample:0', 'sample:1', 'foundIn', 'bestQ', 'length',
    ])
    expect(ids(columnSpecs(model(), 'psms', { openSearch: false }))).toEqual([
      'peptide', 'proteins', 'sample', 'scan', 'charge', 'mz', 'rt', 'precursorError', 'score', 'qValue',
      'pep', 'deltaMass', 'file', 'isotopeError',
    ])
  })

  it('samples without a condition have no group', () => {
    const design = resolveDesign([input('a.mzML'), input('b.mzML')])
    const tables = makeTables({ files: ['a.mzML', 'b.mzML'], proteins: [], peptides: [], psms: [] })
    const m = buildModel(tables, design, { showTechReplicates: false, ...cutoffs })
    const samples = columnSpecs(m, 'peptides', { openSearch: false }).filter((s) => s.id.startsWith('sample:'))
    expect(samples.map((s) => [s.group, s.header])).toEqual([[undefined, 'a'], [undefined, 'b']])
  })
})

describe('defaultHidden', () => {
  it('hides the less common columns, and the mass shift of a closed search', () => {
    const m = model()
    expect(defaultHidden(columnSpecs(m, 'proteins', { openSearch: false }), m)).toEqual(['gene', 'qValue', 'score', 'length', 'group'])
    expect(defaultHidden(columnSpecs(m, 'psms', { openSearch: false }), m)).toEqual(['pep', 'deltaMass', 'file', 'isotopeError'])
    expect(defaultHidden(columnSpecs(m, 'psms', { openSearch: true }), m)).toEqual(['pep', 'file', 'isotopeError'])
  })

  it('shows the gene when the descriptions name one', () => {
    const tables = sampleTables()
    tables.proteins.description[0] = 'Serum albumin OS=Homo sapiens GN=ALB'
    const m = buildModel(tables, sampleDesign(), { showTechReplicates: false, ...cutoffs })
    expect(defaultHidden(columnSpecs(m, 'proteins', { openSearch: false }), m)).toEqual(['qValue', 'score', 'length', 'group'])
  })
})

describe('visibleSpecs and csvColumns', () => {
  it('leave out hidden columns; "samples" hides all per-sample columns', () => {
    const specs = columnSpecs(model(), 'proteins', { openSearch: false })
    expect(ids(visibleSpecs(specs, ['gene', 'samples', 'qValue', 'score', 'length', 'group']))).toEqual([
      'accession', 'description', 'coverage', 'peptides', 'psms', 'foundIn',
    ])
    expect(csvColumns(visibleSpecs(specs, ['gene', 'qValue', 'score', 'length', 'group']))).toEqual([
      'accession', 'description', 'coverage', 'peptides', 'psms', 'sample:0', 'sample:1', 'foundIn',
    ])
    // every visible column is exported
    expect(csvColumns(visibleSpecs(specs, []))).toEqual(ids(specs))
  })

  it('write what a PSM column shows: the scan as the native ID, RT in seconds, the file', () => {
    const specs = columnSpecs(model(), 'psms', { openSearch: true })
    expect(csvColumns(visibleSpecs(specs, []))).toEqual([
      'peptide', 'proteins', 'sample', 'nativeId', 'charge', 'mz', 'rt', 'precursorErrorPpm', 'score', 'qValue',
      'pep', 'deltaMass', 'file', 'isotopeError',
    ])
  })
})
