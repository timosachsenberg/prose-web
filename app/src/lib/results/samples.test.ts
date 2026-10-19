import { describe, expect, it } from 'vitest'
import { input } from '../design/fixtures'
import { resolveDesign } from '../design/model'
import { sampleDesign, sampleTables } from './fixtures'
import { buildModel } from './model'
import { makeTables } from './synthetic'
import { sampleTable } from './samples'

const model = (opts: { psmFdr: number; proteinFdr: number }, edit?: (t: ReturnType<typeof sampleTables>) => void) => {
  const tables = sampleTables()
  edit?.(tables)
  return buildModel(tables, sampleDesign(), { showTechReplicates: false, ...opts })
}

describe('sampleTable', () => {
  it('counts PSMs, peptide sequences and protein groups per sample, grouped by condition', () => {
    // PSM FDR 1 %: PSMs 0 1 3 (file 0, control 1) and 4 5 6 7 (file 1, EGF 1)
    const t = sampleTable(model({ psmFdr: 0.01, proteinFdr: 1 }))
    expect(t.grouped).toBe(true)
    expect(t.groups.map((g) => g.name)).toEqual(['control', 'EGF'])
    const [control, egf] = t.groups
    expect(control.samples.map((s) => s.label)).toEqual(['control 1'])
    expect(control.samples[0].counts).toEqual({ psms: 3, peptides: 2, proteins: 1 }) // MKWVTF, TFISLL; ALBU
    expect(egf.samples[0].counts).toEqual({ psms: 4, peptides: 2, proteins: 2 }) // GDAHKSEVAH, IVGGYT; A1AT, trypsin
    expect(control.counts).toEqual({ psms: 3, peptides: 2, proteins: 1 })
    expect(t.total).toEqual({ psms: 7, peptides: 4, proteins: 3 })
    expect(control.samples[0].files).toBe(1)
  })

  it('counts the proteins that pass the search protein FDR', () => {
    // protein FDR 0.3 %: ALBU (q 0.001) and trypsin (0.002) pass, A1AT (0.004) does not
    const t = sampleTable(model({ psmFdr: 0.01, proteinFdr: 0.003 }))
    expect(t.groups[1].samples[0].counts.proteins).toBe(1)
    expect(t.total.proteins).toBe(2)
    // the PSMs and peptides do not depend on the protein FDR
    expect(t.total.psms).toBe(7)
  })

  it('counts a group of proteins that cannot be told apart once', () => {
    const t = sampleTable(model({ psmFdr: 0.01, proteinFdr: 1 }, (tables) => tables.proteins.group.set([0, 5, 5, 3])))
    expect(t.groups[1].samples[0].counts.proteins).toBe(1) // A1AT and trypsin: one group
    expect(t.total.proteins).toBe(2)
    // a protein without a group (-1) is a group of its own
    const alone = sampleTable(model({ psmFdr: 0.01, proteinFdr: 1 }, (tables) => tables.proteins.group.set([-1, -1, -1, -1])))
    expect(alone.total.proteins).toBe(3)
  })

  it('leaves decoys and the PSMs above the PSM FDR out', () => {
    const at1 = sampleTable(model({ psmFdr: 0.01, proteinFdr: 1 }))
    const all = sampleTable(model({ psmFdr: 1, proteinFdr: 1 }))
    expect(at1.total.psms).toBe(7)
    expect(all.total.psms).toBe(8) // PSM 2 (q 0.02) counts, the decoy PSM 8 never does
    expect(all.groups[0].samples[0].counts.psms).toBe(3)
    expect(all.groups[1].samples[0].counts.psms).toBe(5)
  })

  it('counts a sequence once however many modified forms it has, in the sample and in the total', () => {
    const tables = makeTables({
      files: ['ctrl_a.mzML', 'egf_a.mzML'],
      proteins: [{ accession: 'P1', sequence: 'AAAMKAAAAA' }],
      peptides: [
        { sequence: 'AAAMK', proteins: [0] },
        { sequence: 'AAAMK', proforma: 'AAAM[Oxidation]K', openms: 'AAAM(Oxidation)K', proteins: [{ protein: 0, start: 0 }] },
      ],
      psms: [
        { peptide: 0, file: 0 },
        { peptide: 1, file: 0 },
        { peptide: 1, file: 1 },
      ],
    })
    const m = buildModel(tables, sampleDesign(), { showTechReplicates: false, psmFdr: 1, proteinFdr: 1 })
    const t = sampleTable(m)
    expect(t.groups[0].samples[0].counts).toEqual({ psms: 2, peptides: 1, proteins: 1 })
    expect(t.groups[1].samples[0].counts).toEqual({ psms: 1, peptides: 1, proteins: 1 })
    expect(t.total).toEqual({ psms: 3, peptides: 1, proteins: 1 }) // one sequence, in both samples: counted once
  })

  describe('technical replicates', () => {
    // EGF 1 measured twice (two files), control 1 once
    const design = resolveDesign([
      input('egf_a.mzML', { condition: 'EGF', replicate: 1 }),
      input('egf_b.mzML', { condition: 'EGF', replicate: 1 }),
      input('ctrl_a.mzML', { condition: 'control', replicate: 1 }),
    ])
    const tables = makeTables({
      files: ['egf_a.mzML', 'egf_b.mzML', 'ctrl_a.mzML'],
      proteins: [{ accession: 'P1', sequence: 'AAAMKCCCCCK' }],
      peptides: [
        { sequence: 'AAAMK', proteins: [0] },
        { sequence: 'CCCCCK', proteins: [0] },
      ],
      psms: [
        { peptide: 0, file: 0 },
        { peptide: 0, file: 1 },
        { peptide: 1, file: 1 },
        { peptide: 0, file: 2 },
      ],
    })

    it('merges them into their sample', () => {
      const t = sampleTable(buildModel(tables, design, { showTechReplicates: false, psmFdr: 1, proteinFdr: 1 }))
      expect(t.groups.map((g) => g.name)).toEqual(['EGF', 'control'])
      const egf = t.groups[0]
      expect(egf.samples).toHaveLength(1)
      expect(egf.samples[0].label).toBe('EGF 1')
      expect(egf.samples[0].files).toBe(2)
      expect(egf.samples[0].counts).toEqual({ psms: 3, peptides: 2, proteins: 1 })
    })

    it('counts the samples of a condition, not its measurements (a split sample is still one sample)', () => {
      for (const showTechReplicates of [false, true]) {
        const t = sampleTable(buildModel(tables, design, { showTechReplicates, psmFdr: 1, proteinFdr: 1 }))
        expect(t.groups.map((g) => [g.name, g.sampleCount]), `separate: ${showTechReplicates}`).toEqual([['EGF', 1], ['control', 1]])
      }
      // (the rows are the measurements when split)
      expect(sampleTable(buildModel(tables, design, { showTechReplicates: true, psmFdr: 1, proteinFdr: 1 })).groups[0].samples).toHaveLength(2)
    })

    it('shows each measurement as its own row when asked, and the condition adds them up', () => {
      const t = sampleTable(buildModel(tables, design, { showTechReplicates: true, psmFdr: 1, proteinFdr: 1 }))
      const egf = t.groups[0]
      expect(egf.samples.map((s) => s.label)).toEqual(['EGF 1 · TR1', 'EGF 1 · TR2'])
      expect(egf.samples.map((s) => s.counts)).toEqual([
        { psms: 1, peptides: 1, proteins: 1 },
        { psms: 2, peptides: 2, proteins: 1 },
      ])
      expect(egf.counts).toEqual({ psms: 3, peptides: 2, proteins: 1 }) // distinct in the condition, not the sum
      expect(egf.samples.map((s) => s.files)).toEqual([1, 1])
      expect(t.total).toEqual({ psms: 4, peptides: 2, proteins: 1 })
    })
  })

  it('does not group samples without a condition', () => {
    const design = resolveDesign([input('a.mzML'), input('b.mzML')])
    const tables = makeTables({
      files: ['a.mzML', 'b.mzML'],
      proteins: [{ accession: 'P1', sequence: 'AAAMK' }],
      peptides: [{ sequence: 'AAAMK', proteins: [0] }],
      psms: [{ peptide: 0, file: 0 }, { peptide: 0, file: 1 }],
    })
    const t = sampleTable(buildModel(tables, design, { showTechReplicates: false, psmFdr: 1, proteinFdr: 1 }))
    expect(t.grouped).toBe(false)
    expect(t.groups).toHaveLength(1)
    expect(t.groups[0].name).toBeNull()
    expect(t.groups[0].samples.map((s) => s.label)).toEqual(['a', 'b'])
  })
})
