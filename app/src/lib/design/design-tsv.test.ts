import { describe, expect, it } from 'vitest'
import { parseDesignTsv, writeDesignTsv } from './design-tsv'
import { input, mockupDesign } from './fixtures'
import { resolveDesign, type DesignInput } from './model'

const HEADER =
  'Fraction_Group\tFraction\tSpectra_Filepath\tLabel\tSample\tMSstats_Condition\tMSstats_BioReplicate'

/** Example 1 of OpenMS ExperimentalDesign.h: 2 conditions, 3 biological replicates each, unfractionated. */
const EXAMPLE_1 = [
  HEADER,
  '1\t1\tctrl_1.mzML\t1\t1\tcontrol\t1',
  '2\t1\tctrl_2.mzML\t1\t2\tcontrol\t2',
  '3\t1\tctrl_3.mzML\t1\t3\tcontrol\t3',
  '4\t1\tdrug_1.mzML\t1\t4\ttreated\t4',
  '5\t1\tdrug_2.mzML\t1\t5\ttreated\t5',
  '6\t1\tdrug_3.mzML\t1\t6\ttreated\t6',
  '',
].join('\n')

function comparable(rows: ReturnType<typeof resolveDesign>['rows']) {
  return rows.map((x) => ({
    fileName: x.fileName,
    condition: x.condition,
    replicate: x.replicate,
    fraction: x.fraction,
    techReplicate: x.techReplicate,
    sample: x.sample,
    fractionGroup: x.fractionGroup,
  }))
}

function withIds(parsed: Partial<DesignInput>[]): DesignInput[] {
  return parsed.map((p, i) => ({ id: `r${i}`, fileName: p.fileName!, fileSize: 0, ...p }))
}

describe('writeDesignTsv', () => {
  it('writes the one-table OpenMS format', () => {
    const files = ['ctrl_1', 'ctrl_2', 'ctrl_3']
    const inputs = [
      ...files.map((f, i) => input(`${f}.mzML`, { condition: 'control', replicate: i + 1 })),
      ...['drug_1', 'drug_2', 'drug_3'].map((f, i) => input(`${f}.mzML`, { condition: 'treated', replicate: i + 1 })),
    ]
    expect(writeDesignTsv(resolveDesign(inputs))).toBe(EXAMPLE_1)
  })

  it('writes fractions of one sample into one fraction group (example 3)', () => {
    const r = resolveDesign([
      input('ctrl_F1.mzML', { condition: 'control', fraction: 1 }),
      input('ctrl_F2.mzML', { condition: 'control', fraction: 2 }),
      input('ctrl_F3.mzML', { condition: 'control', fraction: 3 }),
      input('drug_F1.mzML', { condition: 'treated', fraction: 1 }),
      input('drug_F2.mzML', { condition: 'treated', fraction: 2 }),
      input('drug_F3.mzML', { condition: 'treated', fraction: 3 }),
    ])
    expect(writeDesignTsv(r)).toBe(
      [
        HEADER,
        '1\t1\tctrl_F1.mzML\t1\t1\tcontrol\t1',
        '1\t2\tctrl_F2.mzML\t1\t1\tcontrol\t1',
        '1\t3\tctrl_F3.mzML\t1\t1\tcontrol\t1',
        '2\t1\tdrug_F1.mzML\t1\t2\ttreated\t2',
        '2\t2\tdrug_F2.mzML\t1\t2\ttreated\t2',
        '2\t3\tdrug_F3.mzML\t1\t2\ttreated\t2',
        '',
      ].join('\n'),
    )
  })

  it('writes a technical replicate as a new fraction group of the same sample (example 2)', () => {
    const r = resolveDesign([
      input('p1_inj1.mzML', { condition: 'control', replicate: 1 }),
      input('p1_inj2.mzML', { condition: 'control', replicate: 1 }),
      input('p2_inj1.mzML', { condition: 'treated', replicate: 1 }),
      input('p2_inj2.mzML', { condition: 'treated', replicate: 1 }),
    ])
    expect(writeDesignTsv(r)).toBe(
      [
        HEADER,
        '1\t1\tp1_inj1.mzML\t1\t1\tcontrol\t1',
        '2\t1\tp1_inj2.mzML\t1\t1\tcontrol\t1',
        '3\t1\tp2_inj1.mzML\t1\t2\ttreated\t2',
        '4\t1\tp2_inj2.mzML\t1\t2\ttreated\t2',
        '',
      ].join('\n'),
    )
  })

  it('refuses to write a design with a file name used twice', () => {
    const r = resolveDesign([
      input('run.mzML', { condition: 'A', replicate: 1 }),
      input('run.mzML', { condition: 'A', replicate: 2 }),
      input('other.mzML', { condition: 'A', replicate: 3 }),
    ])
    expect(r.rows).toHaveLength(3)
    expect(() => writeDesignTsv(r)).toThrow(Error)
    expect(() => writeDesignTsv(r)).toThrow(/run\.mzML/)
    expect(() => writeDesignTsv(r)).not.toThrow(/other\.mzML/)
  })

  it('leaves the condition empty without one and keeps tabs out of the cells', () => {
    const r = resolveDesign([input('a\tb.mzML')])
    expect(writeDesignTsv(r)).toBe([HEADER, '1\t1\ta b.mzML\t1\t1\t\t1', ''].join('\n'))
  })
})

describe('parseDesignTsv', () => {
  it('reads example 1, numbering the replicates within each condition', () => {
    const { inputs, notices } = parseDesignTsv(EXAMPLE_1)
    expect(notices).toEqual([])
    expect(inputs).toEqual([
      { fileName: 'ctrl_1.mzML', condition: 'control', replicate: 1, fraction: 1 },
      { fileName: 'ctrl_2.mzML', condition: 'control', replicate: 2, fraction: 1 },
      { fileName: 'ctrl_3.mzML', condition: 'control', replicate: 3, fraction: 1 },
      { fileName: 'drug_1.mzML', condition: 'treated', replicate: 1, fraction: 1 },
      { fileName: 'drug_2.mzML', condition: 'treated', replicate: 2, fraction: 1 },
      { fileName: 'drug_3.mzML', condition: 'treated', replicate: 3, fraction: 1 },
    ])
  })

  it('round-trips the mockup design', () => {
    const first = resolveDesign(mockupDesign())
    const text = writeDesignTsv(first)
    const { inputs, notices } = parseDesignTsv(text)
    expect(notices).toEqual([])
    const second = resolveDesign(withIds(inputs))
    expect(second.conditions).toEqual(first.conditions)
    expect(second.rows.map((x) => x.condition)).toEqual(first.rows.map((x) => x.condition))
    expect(second.rows.map((x) => x.replicate)).toEqual(first.rows.map((x) => x.replicate))
    expect(second.rows.map((x) => x.fraction)).toEqual(first.rows.map((x) => x.fraction))
    expect(comparable(second.rows)).toEqual(comparable(first.rows))
    expect(second.samples.map((s) => s.label)).toEqual(first.samples.map((s) => s.label))
    expect(writeDesignTsv(second)).toBe(text)
  })

  it('ignores comments, blank lines, CRLF, a BOM and padding', () => {
    const text =
      '\ufeff# written by hand\r\n' +
      `${HEADER}\r\n` +
      ' 1 \t 1 \t a.mzML \t 1 \t 1 \t A \t 1 \r\n' +
      '# 2\t1\tb.mzML\t1\t2\tA\t2\r\n' +
      '\r\n'
    const { inputs, notices } = parseDesignTsv(text)
    expect(notices).toEqual([])
    expect(inputs).toEqual([{ fileName: 'a.mzML', condition: 'A', replicate: 1, fraction: 1 }])
  })

  it('works with only the mandatory columns: the fraction group is the sample', () => {
    const text = 'Fraction_Group\tFraction\tSpectra_Filepath\n1\t1\ta.mzML\n1\t2\tb.mzML\n'
    const { inputs, notices } = parseDesignTsv(text)
    expect(notices).toEqual([])
    expect(inputs).toEqual([
      { fileName: 'a.mzML', replicate: 1, fraction: 1 },
      { fileName: 'b.mzML', replicate: 1, fraction: 2 },
    ])
  })

  it('two fraction groups of two fractions are two samples', () => {
    const text = [
      'Fraction_Group\tFraction\tSpectra_Filepath',
      '1\t1\ta_F1.mzML',
      '1\t2\ta_F2.mzML',
      '2\t1\tb_F1.mzML',
      '2\t2\tb_F2.mzML',
    ].join('\n')
    const { inputs } = parseDesignTsv(text)
    expect(inputs.map((i) => [i.replicate, i.fraction])).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
    ])
    const r = resolveDesign(withIds(inputs))
    expect(r.summary).toBe('4 files → 2 samples · fractions 1–2')
    expect(r.rows.map((x) => x.fractionGroup)).toEqual([1, 1, 2, 2])
    expect(r.notices).toEqual([])
  })

  it('Sample, when there is one, takes precedence over the fraction group', () => {
    const text = [
      'Fraction_Group\tFraction\tSpectra_Filepath\tLabel\tSample',
      '1\t1\ta.mzML\t1\tS1',
      '2\t1\tb.mzML\t1\tS1',
    ].join('\n')
    const { inputs } = parseDesignTsv(text)
    expect(inputs.map((i) => i.replicate)).toEqual([1, 1])
  })

  it('takes the biological unit from Sample when there is no MSstats_BioReplicate', () => {
    const text = [
      'Fraction_Group\tFraction\tSpectra_Filepath\tLabel\tSample\tMSstats_Condition',
      '1\t1\ta_F1.mzML\t1\tBSA1\tA',
      '1\t2\ta_F2.mzML\t1\tBSA1\tA',
      '2\t1\tb_F1.mzML\t1\tBSA2\tA',
      '2\t2\tb_F2.mzML\t1\tBSA2\tA',
    ].join('\n')
    const { inputs } = parseDesignTsv(text)
    expect(inputs.map((i) => i.replicate)).toEqual([1, 1, 2, 2])
  })

  it('reports columns it does not use', () => {
    const text = [`${HEADER}\tgenotype\tbatch`, '1\t1\ta.mzML\t1\t1\tA\t1\tWT\t2'].join('\n')
    const { inputs, notices } = parseDesignTsv(text)
    expect(inputs).toHaveLength(1)
    expect(notices).toHaveLength(1)
    expect(notices[0].kind).toBe('unknownColumn')
    expect(notices[0].message).toContain('genotype')
    expect(notices[0].message).toContain('batch')
  })

  it('reads the two-table format (file section, blank line, sample section)', () => {
    const text = [
      'Fraction_Group\tFraction\tSpectra_Filepath\tLabel\tSample',
      '1\t1\tctrl_1.mzML\t1\t1',
      '2\t1\tctrl_2.mzML\t1\t2',
      '3\t1\tdrug_1.mzML\t1\t3',
      '',
      'Sample\tMSstats_Condition\tMSstats_BioReplicate',
      '1\tcontrol\t1',
      '2\tcontrol\t2',
      '3\ttreated\t3',
      '',
    ].join('\n')
    const { inputs, notices } = parseDesignTsv(text)
    expect(notices).toEqual([])
    expect(inputs).toEqual([
      { fileName: 'ctrl_1.mzML', condition: 'control', replicate: 1, fraction: 1 },
      { fileName: 'ctrl_2.mzML', condition: 'control', replicate: 2, fraction: 1 },
      { fileName: 'drug_1.mzML', condition: 'treated', replicate: 1, fraction: 1 },
    ])
  })

  it('loads a design with several labels per file as one row per file, with a notice', () => {
    const text = [
      HEADER,
      '1\t1\tplex1.mzML\t1\t1\tA\t1',
      '1\t1\tplex1.mzML\t2\t2\tB\t2',
      '1\t1\tplex1.mzML\t3\t3\tA\t3',
      '2\t1\tplex2.mzML\t1\t4\tA\t4',
    ].join('\n')
    const { inputs, notices } = parseDesignTsv(text)
    expect(inputs).toHaveLength(2)
    expect(inputs[0].fileName).toBe('plex1.mzML')
    // Channels disagree on the condition and replicate, so neither is claimed for the file.
    expect(inputs[0].condition).toBeUndefined()
    expect(inputs[0].replicate).toBeUndefined()
    expect(inputs[1]).toEqual({ fileName: 'plex2.mzML', condition: 'A', replicate: 1, fraction: 1 })
    expect(notices.map((n) => n.kind)).toEqual(['multiplexed'])
    expect(notices[0].message).toContain('plex1.mzML')
  })

  it('says so when the file is not a design', () => {
    for (const text of ['', 'just some text\nmore text', 'Fraction\tSample\n1\t1']) {
      const { inputs, notices } = parseDesignTsv(text)
      expect(inputs).toEqual([])
      expect(notices.map((n) => n.kind)).toEqual(['unknownColumn'])
      expect(notices[0].message).toContain('Spectra_Filepath')
    }
  })
})
