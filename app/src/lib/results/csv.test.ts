import { describe, expect, it } from 'vitest'
import { input } from '../design/fixtures'
import { resolveDesign } from '../design/model'
import { cutoffs, sampleDesign, sampleTables } from './fixtures'
import { applyFilters, defaultFilters, sortRows, type FilterState } from './filters'
import { buildModel } from './model'
import { toCsv } from './csv'
import { makeTables } from './synthetic'

const model = () => buildModel(sampleTables(), sampleDesign(), { showTechReplicates: false, ...cutoffs })
const rows = (...r: number[]) => Uint32Array.from(r)
/** No filter: decoys too, at the search's cutoffs. */
const all: FilterState = { ...defaultFilters(), showDecoys: true }

/** The lines of a CSV text: it starts with a byte order mark and ends with a line break. */
function lines(csv: string): string[] {
  expect(csv.charCodeAt(0)).toBe(0xfeff)
  expect(csv.endsWith('\n')).toBe(true)
  return csv.slice(1, -1).split('\n')
}

describe('toCsv', () => {
  it('CSV writes ProForma and one column per sample', () => {
    const m = model()
    const proteins = toCsv(m, 'proteins', rows(0, 1), ['accession', 'description', 'coverage', 'peptides', 'psms', 'samples', 'foundIn'], all)
    expect(lines(proteins)).toEqual([
      'Accession,Description,Coverage (%),Peptides,PSMs,control 1,EGF 1,Found in',
      'sp|P02768|ALBU_HUMAN,"Serum albumin, mature chain",50.0,2,4,3,1,2',
      'sp|P01009|A1AT_HUMAN,Alpha-1-antitrypsin,25.0,1,3,0,3,1',
    ])

    const peptides = toCsv(m, 'peptides', rows(0), ['peptide', 'proteins', 'psms', 'bestQ', 'samples'], all)
    expect(lines(peptides)).toEqual([
      'Peptide,Proteins,PSMs,Best PSM q-value,control 1,EGF 1',
      'M[Oxidation]KWVTF,sp|P02768|ALBU_HUMAN,3,0.001,2,1',
    ])
  })

  it('starts with a byte order mark, and every line ends with a line break', () => {
    const csv = toCsv(model(), 'proteins', rows(0, 1), ['accession'], all)
    expect(csv).toBe('\uFEFFAccession\nsp|P02768|ALBU_HUMAN\nsp|P01009|A1AT_HUMAN\n') // n + 1 lines
    expect(toCsv(model(), 'proteins', rows(), ['accession', 'samples'], all)).toBe('\uFEFFAccession,control 1,EGF 1\n')
  })

  it('writes the rows in the order given, for the PSMs too', () => {
    const m = model()
    const csv = toCsv(m, 'psms', rows(2, 0), ['nativeId', 'peptide', 'charge', 'qValue', 'sample', 'decoy'], all)
    expect(lines(csv)).toEqual([
      'Spectrum,Peptide,Charge,q-value,Sample,Decoy',
      'scan=3,M[Oxidation]KWVTF,2,0.02,EGF 1,0',
      'scan=1,M[Oxidation]KWVTF,2,0.004,control 1,0',
    ])
  })

  it('quotes fields with commas, quotes and line breaks', () => {
    const m = model()
    m.tables.proteins.description[1] = 'say "hi", then\nleave'
    const csv = toCsv(m, 'proteins', rows(1), ['description'], all)
    expect(csv).toBe('\uFEFFDescription\n"say ""hi"", then\nleave"\n')
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
    const m = buildModel(tables, resolveDesign([input('a.mzML')]), { showTechReplicates: false, ...cutoffs })
    expect(lines(toCsv(m, 'peptides', rows(0), ['proteins'], all))).toEqual(['Proteins', 'P1;P2'])
    expect(lines(toCsv(m, 'psms', rows(0), ['qValue', 'score'], all))).toEqual(['q-value,ln(hyperscore)', ',50'])
  })

  it('writes the filtered, sorted view', () => {
    const m = model()
    const f = { ...defaultFilters(), text: 'albu', maxQ: 0.005 }
    const view = sortRows(m, 'psms', applyFilters(m, 'psms', f), 'qValue', 'asc', f)
    expect(lines(toCsv(m, 'psms', view, ['nativeId', 'qValue'], f))).toEqual([
      'Spectrum,q-value',
      'scan=2,0.001',
      'scan=4,0.003',
      'scan=1,0.004',
    ])
  })

  it('writes the peptide counts at the cutoff of the peptide table', () => {
    // one peptide with a PSM at q 0.0005 in sample 1 and one at 0.005 in sample 2; a 1 % search
    const design = resolveDesign([input('a.mzML', { condition: 'A' }), input('b.mzML', { condition: 'A' })])
    const tables = makeTables({
      files: ['a.mzML', 'b.mzML'],
      proteins: [{ accession: 'P1', sequence: 'AAAAAK' }],
      peptides: [{ sequence: 'AAAAAK', proteins: [0] }],
      psms: [{ peptide: 0, file: 0, qValue: 0.0005 }, { peptide: 0, file: 1, qValue: 0.005 }],
    })
    const m = buildModel(tables, design, { showTechReplicates: false, psmFdr: 0.01, proteinFdr: 0.01 })
    const columns = ['psms', 'samples', 'foundIn', 'bestQ']
    expect(lines(toCsv(m, 'peptides', rows(0), columns, all))).toEqual(['PSMs,A 1,A 2,Found in,Best PSM q-value', '2,1,1,2,0.0005'])
    expect(lines(toCsv(m, 'peptides', rows(0), columns, { ...all, maxQ: 0.001 }))).toEqual(['PSMs,A 1,A 2,Found in,Best PSM q-value', '1,1,0,1,0.0005'])
    expect(lines(toCsv(m, 'peptides', rows(0), columns, { ...all, maxQ: 0.05 }))[1]).toBe('2,1,1,2,0.0005') // above the search's 1 %
  })

  it('protects text cells against spreadsheet formulas, not numbers', () => {
    const design = resolveDesign([input('a.mzML', { condition: '=evil' })])
    const tables = makeTables({
      files: ['a.mzML'],
      proteins: [
        { accession: '@user', description: '=HYPERLINK("http://x","y")', sequence: 'AAAAAK' },
        { accession: 'ok', description: '+49 (0)7071, Tübingen', sequence: 'CCCCCK' },
        { accession: '\tTab', description: '-1 is text here', sequence: 'DDDDDK' },
      ],
      peptides: [
        { sequence: 'AAAAAK', proteins: [0] },
        { sequence: 'CCCCCK', proteins: [1] },
      ],
      psms: [{ peptide: 0, score: -12.5 }, { peptide: 1 }],
    })
    tables.psms.deltaMass[0] = -0.002
    const m = buildModel(tables, design, { showTechReplicates: false, ...cutoffs })
    expect(lines(toCsv(m, 'proteins', rows(0, 1, 2), ['accession', 'description', 'score', 'samples'], all))).toEqual([
      "Accession,Description,Best ln(hyperscore),'=evil 1",
      `'@user,"'=HYPERLINK(""http://x"",""y"")",1,1`,
      `ok,"'+49 (0)7071, Tübingen",1,1`,
      "'\tTab,'-1 is text here,1,0", // a tab needs no quotes
    ])
    // numbers keep their sign
    expect(lines(toCsv(m, 'psms', rows(0), ['score', 'deltaMass', 'peptide'], all))).toEqual(['ln(hyperscore),Delta mass (Da),Peptide', '-12.5,-0.002,AAAAAK'])
  })

  it('writes and sorts the gene of a UniProt description', () => {
    const tables = sampleTables()
    tables.proteins.description[0] = 'Serum albumin OS=Homo sapiens OX=9606 GN=ALB PE=1 SV=2'
    tables.proteins.description[1] = 'Alpha-1-antitrypsin OS=Homo sapiens GN=SERPINA1'
    const m = buildModel(tables, sampleDesign(), { showTechReplicates: false, ...cutoffs })
    expect(lines(toCsv(m, 'proteins', rows(0, 1, 2), ['accession', 'gene'], all))).toEqual([
      'Accession,Gene',
      'sp|P02768|ALBU_HUMAN,ALB',
      'sp|P01009|A1AT_HUMAN,SERPINA1',
      'CON__P00761,',
    ])
    expect(sortRows(m, 'proteins', rows(0, 1, 2), 'gene', 'desc', all)).toEqual(rows(1, 0, 2))
  })

  it('writes the file of a PSM without its directories', () => {
    const tables = sampleTables()
    tables.files = ['/input/0/ctrl_a.mzML', 'C:\\data\\egf_a.mzML']
    const m = buildModel(tables, sampleDesign(), { showTechReplicates: false, ...cutoffs })
    expect(lines(toCsv(m, 'psms', rows(0, 2), ['file'], all))).toEqual(['File', 'ctrl_a.mzML', 'egf_a.mzML'])
  })

  it("writes an open search's mass shift as an unlocalized ProForma mass, above 0.05 Da", () => {
    const m = model()
    const { deltaMass } = m.tables.psms
    deltaMass.fill(NaN) // a closed search
    deltaMass[1] = 15.99491
    deltaMass[2] = -57.02146
    deltaMass[3] = 0.05 // counts as unmodified
    expect(lines(toCsv(m, 'psms', rows(0, 1, 2, 3), ['peptide'], all))).toEqual([
      'Peptide',
      'M[Oxidation]KWVTF',
      '[+15.9949]?M[Oxidation]KWVTF',
      '[-57.0215]?M[Oxidation]KWVTF',
      'TFISLL',
    ])
  })

  it('names the score after what the search used: Percolator or ln(hyperscore)', () => {
    const percolator = buildModel(sampleTables(), sampleDesign(), { showTechReplicates: false, rescored: true, ...cutoffs })
    expect(lines(toCsv(percolator, 'psms', rows(), ['score'], all))).toEqual(['Percolator score'])
    expect(lines(toCsv(percolator, 'proteins', rows(), ['score'], all))).toEqual(['Best Percolator score'])
    const hyperscore = model()
    expect(lines(toCsv(hyperscore, 'psms', rows(), ['score'], all))).toEqual(['ln(hyperscore)'])
    expect(lines(toCsv(hyperscore, 'proteins', rows(), ['score'], all))).toEqual(['Best ln(hyperscore)'])
  })

  it('writes only the header for no rows, and rejects unknown columns', () => {
    const m = model()
    expect(lines(toCsv(m, 'proteins', rows(), ['accession', 'samples'], all))).toEqual(['Accession,control 1,EGF 1'])
    expect(() => toCsv(m, 'proteins', rows(0), ['nativeId'], all)).toThrow(/nativeId/)
    expect(() => toCsv(m, 'psms', rows(0), ['samples'], all)).toThrow(/samples/)
  })
})
