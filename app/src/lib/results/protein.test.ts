import { describe, expect, it } from 'vitest'
import { input } from '../design/fixtures'
import { resolveDesign } from '../design/model'
import { cutoffs, sampleDesign, sampleTables } from './fixtures'
import { buildModel, type ResultModel } from './model'
import { groupMates, peptidePsms, proteinDetail, proteinPsms, siteTitle } from './protein'
import { makeLargeTables, makeTables } from './synthetic'

const model = (tables = sampleTables(), opts: Partial<{ psmFdr: number; proteinFdr: number }> = {}) =>
  buildModel(tables, sampleDesign(), { showTechReplicates: false, ...cutoffs, ...opts })

/** One protein AAAAAKCCCCCK (12 residues) whose peptides the tests place and modify by hand. */
function oneProtein(peptides: Parameters<typeof makeTables>[0]['peptides'], sequence = 'AAAAAKCCCCCK'): ResultModel {
  const tables = makeTables({
    files: ['ctrl_a.mzML'],
    proteins: [{ accession: 'P1', sequence }],
    peptides,
    psms: peptides.map((_, k) => ({ peptide: k })),
  })
  const design = resolveDesign([input('ctrl_a.mzML', { condition: 'control', replicate: 1 })])
  return buildModel(tables, design, { showTechReplicates: false, ...cutoffs })
}

describe('proteinDetail: coverage', () => {
  it("is the model's coverage, residue by residue", () => {
    const m = model()
    const albumin = proteinDetail(m, 0, [])
    // MKWVTF [0, 6) and TFISLL [4, 10) overlap: residues 0-9 of 20
    expect(albumin.length).toBe(20)
    expect(albumin.coverage).toBe(m.protein.coverage[0])
    expect(albumin.coverage).toBe(0.5)
    expect(Array.from(albumin.covered)).toEqual([...Array(10).fill(1), ...Array(10).fill(0)])
    expect(albumin.spans).toEqual([{ start: 0, end: 10 }])
    for (let p = 0; p < m.tables.proteins.count; p++) expect(proteinDetail(m, p, []).coverage).toBe(m.protein.coverage[p])
  })

  it('agrees with the table for every protein of a large result, at a tight PSM FDR', () => {
    const tables = makeLargeTables(3000, 600, 120)
    const design = resolveDesign(tables.files.map((fileName, i) => input(fileName, { condition: i < 3 ? 'control' : 'EGF', replicate: (i % 3) + 1 })))
    for (const psmFdr of [1, 0.01]) {
      const m = buildModel(tables, design, { showTechReplicates: false, psmFdr, proteinFdr: 1 })
      let covered = 0
      for (let p = 0; p < m.tables.proteins.count; p++) {
        const detail = proteinDetail(m, p, ['Carbamidomethyl (C)'])
        expect(detail.coverage).toBe(m.protein.coverage[p])
        expect(detail.psms).toBe(m.protein.psms[p])
        expect(detail.sequences).toBe(m.protein.peptides[p])
        if (detail.coverage > 0) covered++
      }
      expect(covered).toBeGreaterThan(20)
    }
  })

  it('only counts peptides with PSMs within the PSM FDR', () => {
    // PSM q-values 0.004 0.001 0.02 (MKWVTF), 0.003 (TFISLL): at 0.25 % only the 0.001 PSM is left
    const m = model(sampleTables(), { psmFdr: 0.0025 })
    const albumin = proteinDetail(m, 0, [])
    expect(albumin.peptides.map((p) => m.tables.peptides.sequence[p.peptide])).toEqual(['MKWVTF'])
    expect(albumin.psms).toBe(1)
    expect(albumin.coverage).toBe(6 / 20)
    expect(albumin.coverage).toBe(m.protein.coverage[0])
  })

  it('clamps what the search recorded beyond the sequence', () => {
    // AAAAAKCCCCCK has 12 residues: the first peptide is recorded at [8, 14), the second at [20, 26)
    const m = oneProtein([
      { sequence: 'CCCK', proteins: [{ protein: 0, start: 8 }] },
      { sequence: 'WWWWWW', proteins: [{ protein: 0, start: 20 }] },
    ])
    const d = proteinDetail(m, 0, [])
    expect(d.coverage).toBe(4 / 12)
    expect(d.coverage).toBe(m.protein.coverage[0])
    expect(d.spans).toEqual([{ start: 8, end: 12 }])
    expect(d.covered.length).toBe(12)
    // both are listed with their PSMs, the second without a place in the sequence
    expect(d.peptides.map((p) => [p.spans, p.located])).toEqual([
      [[{ start: 8, end: 12 }], true],
      [[], false],
    ])
  })

  it('has no coverage without a sequence, and still lists the peptides', () => {
    const m = oneProtein([{ sequence: 'AAAAAK', proteins: [{ protein: 0, start: 0 }] }], '')
    const d = proteinDetail(m, 0, [])
    expect(d.length).toBe(0)
    expect(d.coverage).toBe(0)
    expect(d.covered.length).toBe(0)
    expect(d.spans).toEqual([])
    expect(d.peptides).toHaveLength(1)
    expect(d.peptides[0].located).toBe(false)
    expect(d.sites).toEqual([])
  })

  it('works for a decoy protein, which has a rebuilt sequence', () => {
    const m = model()
    expect(m.tables.proteins.decoy[3]).toBe(1)
    const d = proteinDetail(m, 3, [])
    expect(d.length).toBe(20)
    expect(d.coverage).toBe(6 / 20)
    expect(d.coverage).toBe(m.protein.coverage[3])
    expect(d.peptides.map((p) => m.tables.peptides.sequence[p.peptide])).toEqual(['RSLVQY'])
    expect(d.psms).toBe(1)
  })

  it('lists a peptide that occurs twice once, with both places', () => {
    const m = oneProtein([{ sequence: 'AAAAAK', proteins: [{ protein: 0, start: 0 }, { protein: 0, start: 6 }] }])
    const d = proteinDetail(m, 0, [])
    expect(d.peptides).toHaveLength(1)
    expect(d.peptides[0].spans).toEqual([{ start: 0, end: 6 }, { start: 6, end: 12 }])
    expect(d.coverage).toBe(1)
    expect(d.coverage).toBe(m.protein.coverage[0])
    expect(d.sequences).toBe(1)
    expect(d.psms).toBe(1)
  })

  it('lists the modified forms of a sequence as peptides of their own, in sequence order', () => {
    const m = oneProtein([
      { sequence: 'CCCCCK', proteins: [{ protein: 0, start: 6 }] },
      { sequence: 'AAAAAK', proteins: [{ protein: 0, start: 0 }] },
      { sequence: 'AAAAAK', proforma: 'AAAAAK[Acetyl]', mods: [{ position: 5, name: 'Acetyl' }], proteins: [{ protein: 0, start: 0 }] },
    ])
    const d = proteinDetail(m, 0, [])
    expect(d.peptides.map((p) => m.tables.peptides.proforma[p.peptide])).toEqual(['AAAAAK', 'AAAAAK[Acetyl]', 'CCCCCK'])
    expect(d.sequences).toBe(2) // as the Peptides column counts them
    expect(m.protein.peptides[0]).toBe(2)
    expect(d.peptides.reduce((n, p) => n + p.psms, 0)).toBe(d.psms)
  })
})

describe('proteinDetail: modified sites', () => {
  const peptides = [
    // an oxidised M, a carbamidomethylated C and a phosphorylated S in the middle of the protein
    {
      sequence: 'AMCSK',
      proforma: 'AM[Oxidation]C[Carbamidomethyl]S[Phospho]K',
      mods: [
        { position: 1, name: 'Oxidation', unimod: 35, mass: 15.9949 },
        { position: 2, name: 'Carbamidomethyl', unimod: 4, mass: 57.0215 },
        { position: 3, name: 'Phospho', unimod: 21, mass: 79.9663 },
      ],
      proteins: [{ protein: 0, start: 2 }],
    },
  ]
  const protein = 'AAAMCSKGGGGG' // AMCSK at [2, 7)... the residues are A A A M C S K: M is residue 3

  it('puts a dot on every marked modification, and none on a fixed one', () => {
    const m = oneProtein(peptides, protein)
    const sites = proteinDetail(m, 0, ['Carbamidomethyl (C)']).sites
    // the peptide AMCSK starts at residue 2: A 2, M 3, C 4, S 5, K 6
    expect(sites.map((s) => [s.position, s.residue, s.mods.map((mod) => mod.label)])).toEqual([
      [3, 'M', ['ox']],
      [5, 'S', ['ph']],
    ])
    // without the search's fixed modifications, the C is a site as well
    expect(proteinDetail(m, 0, []).sites.map((s) => s.position)).toEqual([3, 4, 5])
  })

  it('counts a residue once, however many of its peptides carry the modification', () => {
    const m = oneProtein(
      [
        { sequence: 'AMCSK', proforma: 'AM[Oxidation]CSK', mods: [{ position: 1, name: 'Oxidation' }], proteins: [{ protein: 0, start: 2 }] },
        { sequence: 'MCSKG', proforma: 'M[Oxidation]CSKG', mods: [{ position: 0, name: 'Oxidation' }], proteins: [{ protein: 0, start: 3 }] },
      ],
      protein,
    )
    expect(proteinDetail(m, 0, []).sites.map((s) => s.position)).toEqual([3])
  })

  it('lists every modification that several peptide forms put on one residue', () => {
    const m = oneProtein(
      [
        { sequence: 'AMCSK', proforma: 'AM[Oxidation]CSK', mods: [{ position: 1, name: 'Oxidation', unimod: 35, mass: 15.9949 }], proteins: [{ protein: 0, start: 2 }] },
        { sequence: 'MCSKG', proforma: 'M[Dioxidation]CSKG', mods: [{ position: 0, name: 'Dioxidation', unimod: 425, mass: 31.9898 }], proteins: [{ protein: 0, start: 3 }] },
        // the same modification again, on the same residue: not listed twice
        { sequence: 'MCSKG', proforma: 'M[Oxidation]CSKG', mods: [{ position: 0, name: 'Oxidation', unimod: 35, mass: 15.9949 }], proteins: [{ protein: 0, start: 3 }] },
        // an N-terminal acetyl on that residue as well
        { sequence: 'MCSKG', proforma: '[Acetyl]-MCSKG', mods: [{ position: -1, name: 'Acetyl', unimod: 1, mass: 42.0106 }], proteins: [{ protein: 0, start: 3 }] },
      ],
      protein,
    )
    const sites = proteinDetail(m, 0, []).sites
    expect(sites).toHaveLength(1)
    expect(sites[0].position).toBe(3)
    expect(sites[0].mods.map((mod) => mod.name).sort()).toEqual(['Acetyl', 'Dioxidation', 'Oxidation'])
    // the title of its dot lists them all, after the residue and its 1-based position
    const title = siteTitle(sites[0])
    expect(title.startsWith('M4: ')).toBe(true)
    expect(title.split('; ')).toHaveLength(3)
    for (const text of ['Oxidation (Unimod:35) +15.9949', 'Dioxidation (Unimod:425) +31.9898', 'Acetyl (Unimod:1) +42.0106']) expect(title).toContain(text)
  })

  it('places terminal modifications on the first and last residue of the peptide', () => {
    const m = oneProtein(
      [
        {
          sequence: 'AMCSK',
          proforma: '[Acetyl]-AMCSK-[Amidated]',
          mods: [
            { position: -1, name: 'Acetyl' },
            { position: 5, name: 'Amidated' },
          ],
          proteins: [{ protein: 0, start: 2 }],
        },
      ],
      protein,
    )
    expect(proteinDetail(m, 0, []).sites.map((s) => [s.position, s.mods.map((mod) => mod.label)])).toEqual([
      [2, ['ac']],
      [6, ['ami']],
    ])
  })

  it('drops modifications of a peptide that lies beyond the sequence', () => {
    const m = oneProtein(
      [
        { sequence: 'AMCSK', proforma: 'AM[Oxidation]CSK', mods: [{ position: 1, name: 'Oxidation' }], proteins: [{ protein: 0, start: 30 }] },
        // starts inside, its modified residue is recorded past the end (12 residues)
        { sequence: 'GGGMK', proforma: 'GGGM[Oxidation]K', mods: [{ position: 3, name: 'Oxidation' }], proteins: [{ protein: 0, start: 9 }] },
      ],
      protein,
    )
    expect(proteinDetail(m, 0, []).sites).toEqual([])
  })

  it('ignores modifications of peptides without PSMs within the FDR', () => {
    const tables = makeTables({
      files: ['ctrl_a.mzML'],
      proteins: [{ accession: 'P1', sequence: protein }],
      peptides: [{ sequence: 'AMCSK', proforma: 'AM[Oxidation]CSK', mods: [{ position: 1, name: 'Oxidation' }], proteins: [{ protein: 0, start: 2 }] }],
      psms: [{ peptide: 0, qValue: 0.5 }],
    })
    const design = resolveDesign([input('ctrl_a.mzML', { condition: 'control', replicate: 1 })])
    const m = buildModel(tables, design, { showTechReplicates: false, psmFdr: 0.01, proteinFdr: 1 })
    const d = proteinDetail(m, 0, [])
    expect(d.sites).toEqual([])
    expect(d.peptides).toEqual([])
    expect(d.coverage).toBe(0)
  })
})

describe('the PSMs of a peptide and of a protein', () => {
  it('lists a peptide\'s PSMs within the PSM FDR, best q-value first', () => {
    // MKWVTF: PSMs 0 (q 0.004), 1 (0.001), 2 (0.02)
    const m = model()
    expect(Array.from(peptidePsms(m, 0))).toEqual([1, 0, 2])
    const tight = model(sampleTables(), { psmFdr: 0.01 })
    expect(Array.from(peptidePsms(tight, 0))).toEqual([1, 0])
    expect(Array.from(peptidePsms(tight, 4))).toEqual([]) // the decoy's only PSM has q 0.03
  })

  it('puts PSMs without a q-value last, in table order', () => {
    const tables = sampleTables()
    tables.psms.qValue[0] = NaN
    tables.psms.qValue[1] = NaN
    expect(Array.from(peptidePsms(model(tables), 0))).toEqual([2, 0, 1])
  })

  it("lists all of a protein's PSMs, as many as the table counts", () => {
    const m = model()
    for (let p = 0; p < m.tables.proteins.count; p++) {
      const psms = proteinPsms(m, proteinDetail(m, p, []))
      expect(psms.length).toBe(m.protein.psms[p])
      expect(new Set(psms).size).toBe(psms.length)
    }
    // ALBU: its two peptides' PSMs, best q first overall: PSM 1 (0.001), 3 (0.003), 0 (0.004), 2 (0.02)
    expect(Array.from(proteinPsms(m, proteinDetail(m, 0, [])))).toEqual([1, 3, 0, 2])
  })

  it('counts a peptide shared by two proteins for each', () => {
    const tables = makeTables({
      files: ['ctrl_a.mzML'],
      proteins: [
        { accession: 'P1', sequence: 'AAAAAKGGG' },
        { accession: 'P2', sequence: 'TTAAAAAKTT' },
      ],
      peptides: [{ sequence: 'AAAAAK', proteins: [0, 1] }],
      psms: [{ peptide: 0 }, { peptide: 0 }],
    })
    const design = resolveDesign([input('ctrl_a.mzML', { condition: 'control', replicate: 1 })])
    const m = buildModel(tables, design, { showTechReplicates: false, ...cutoffs })
    expect(proteinPsms(m, proteinDetail(m, 0, [])).length).toBe(2)
    expect(proteinPsms(m, proteinDetail(m, 1, [])).length).toBe(2)
    expect(proteinDetail(m, 1, []).peptides[0].spans).toEqual([{ start: 2, end: 8 }])
  })
})

describe('groupMates', () => {
  it('lists the other proteins of an indistinguishable group', () => {
    const tables = sampleTables()
    tables.proteins.group.set([7, 7, 2, 7])
    const m = model(tables)
    expect(groupMates(m, 0)).toEqual([1]) // the decoy of the same group is not its mate
    expect(groupMates(m, 1)).toEqual([0])
    expect(groupMates(m, 3)).toEqual([]) // a decoy's mates are decoys
    expect(groupMates(m, 2)).toEqual([])
  })

  it('has none without a group', () => {
    const tables = sampleTables()
    tables.proteins.group.fill(-1)
    const m = model(tables)
    for (let p = 0; p < 4; p++) expect(groupMates(m, p)).toEqual([])
  })

  it('lists the contaminant that shares its peptides', () => {
    const tables = sampleTables()
    tables.proteins.group.set([0, 1, 1, 3]) // A1AT and the contaminant trypsin
    const m = model(tables)
    expect(groupMates(m, 1)).toEqual([2])
    expect(groupMates(m, 2)).toEqual([1])
  })
})
