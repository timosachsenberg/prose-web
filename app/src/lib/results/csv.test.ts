import { describe, expect, it } from 'vitest'
import { input } from '../design/fixtures'
import { resolveDesign } from '../design/model'
import { sampleDesign, sampleTables } from './fixtures'
import { applyFilters, defaultFilters, sortRows } from './filters'
import { buildModel } from './model'
import { toCsv } from './csv'
import { makeTables } from './synthetic'

const model = () => buildModel(sampleTables(), sampleDesign(), { showTechReplicates: false })
const rows = (...r: number[]) => Uint32Array.from(r)

describe('toCsv', () => {
  it('CSV writes ProForma and one column per sample', () => {
    const m = model()
    const proteins = toCsv(m, 'proteins', rows(0, 1), ['accession', 'description', 'coverage', 'peptides', 'psms', 'samples', 'foundIn'])
    expect(proteins.split('\n')).toEqual([
      'Accession,Description,Coverage (%),Peptides,PSMs,control 1,EGF 1,Found in',
      'sp|P02768|ALBU_HUMAN,"Serum albumin, mature chain",50.0,2,4,3,1,2',
      'sp|P01009|A1AT_HUMAN,Alpha-1-antitrypsin,25.0,1,3,0,3,1',
    ])

    const peptides = toCsv(m, 'peptides', rows(0), ['peptide', 'proteins', 'psms', 'bestQ', 'samples'])
    expect(peptides.split('\n')).toEqual([
      'Peptide,Proteins,PSMs,Best PSM q-value,control 1,EGF 1',
      'M[Oxidation]KWVTF,sp|P02768|ALBU_HUMAN,3,0.001,2,1',
    ])
  })

  it('writes the rows in the order given, for the PSMs too', () => {
    const m = model()
    const csv = toCsv(m, 'psms', rows(2, 0), ['nativeId', 'peptide', 'charge', 'qValue', 'sample', 'decoy'])
    expect(csv.split('\n')).toEqual([
      'Spectrum,Peptide,Charge,q-value,Sample,Decoy',
      'scan=3,M[Oxidation]KWVTF,2,0.02,EGF 1,0',
      'scan=1,M[Oxidation]KWVTF,2,0.004,control 1,0',
    ])
  })

  it('quotes fields with commas, quotes and line breaks', () => {
    const m = model()
    m.tables.proteins.description[1] = 'say "hi", then\nleave'
    const csv = toCsv(m, 'proteins', rows(1), ['description'])
    expect(csv).toBe('Description\n"say ""hi"", then\nleave"')
  })

  it('lists the proteins of a peptide, and leaves missing numbers empty', () => {
    const tables = makeTables({
      files: ['a.mzML'],
      proteins: [
        { accession: 'P1', sequence: 'AAAAAK' },
        { accession: 'P2', sequence: 'CAAAAAKC' },
      ],
      peptides: [{ sequence: 'AAAAAK', proteins: [0, 1] }],
      psms: [{ peptide: 0, qValue: NaN, score: 50 }],
    })
    const m = buildModel(tables, resolveDesign([input('a.mzML')]), { showTechReplicates: false })
    expect(toCsv(m, 'peptides', rows(0), ['proteins'])).toBe('Proteins\nP1;P2')
    expect(toCsv(m, 'psms', rows(0), ['qValue', 'score'])).toBe('q-value,Score\n,50')
  })

  it('writes the filtered, sorted view', () => {
    const m = model()
    const view = sortRows(m, 'psms', applyFilters(m, 'psms', { ...defaultFilters(), text: 'albu', maxQ: 0.005 }), 'qValue', 'asc')
    expect(toCsv(m, 'psms', view, ['nativeId', 'qValue']).split('\n')).toEqual([
      'Spectrum,q-value',
      'scan=2,0.001',
      'scan=4,0.003',
      'scan=1,0.004',
    ])
  })

  it('writes only the header for no rows, and rejects unknown columns', () => {
    const m = model()
    expect(toCsv(m, 'proteins', rows(), ['accession', 'samples'])).toBe('Accession,control 1,EGF 1')
    expect(() => toCsv(m, 'proteins', rows(0), ['nativeId'])).toThrow(/nativeId/)
    expect(() => toCsv(m, 'psms', rows(0), ['samples'])).toThrow(/samples/)
  })
})
