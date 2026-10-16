import { describe, expect, it } from 'vitest'
import { resolveDesign } from './model'
import { parseSdrf } from './sdrf'

const sdrf = (...lines: string[]) => lines.join('\n') + '\n'

describe('parseSdrf', () => {
  it('reads the data file, factor value, biological replicate, fraction', () => {
    const text = sdrf(
      [
        'source name',
        'characteristics[organism]',
        'characteristics[biological replicate]',
        'comment[data file]',
        'comment[fraction identifier]',
        'comment[technical replicate]',
        'comment[label]',
        'factor value[treatment]',
      ].join('\t'),
      ['s1', 'Homo sapiens', '1', 'ctrl_a_F1.mzML', '1', '1', 'label free sample', 'control'].join('\t'),
      ['s1', 'Homo sapiens', '1', 'ctrl_a_F2.mzML', '2', '1', 'label free sample', 'control'].join('\t'),
      ['s2', 'Homo sapiens', '1', 'egf_F1.mzML', '1', '1', 'label free sample', 'EGF'].join('\t'),
    )
    const { inputs, notices } = parseSdrf(text)
    expect(notices).toEqual([])
    expect(inputs).toEqual([
      { fileName: 'ctrl_a_F1.mzML', condition: 'control', replicate: 1, fraction: 1, techReplicate: 1 },
      { fileName: 'ctrl_a_F2.mzML', condition: 'control', replicate: 1, fraction: 2, techReplicate: 1 },
      { fileName: 'egf_F1.mzML', condition: 'EGF', replicate: 1, fraction: 1, techReplicate: 1 },
    ])
    // The explicit technical replicate numbers mean no notice when resolved.
    const r = resolveDesign(inputs.map((p, i) => ({ id: `r${i}`, fileName: p.fileName!, fileSize: 0, ...p })))
    expect(r.samples.map((s) => s.label)).toEqual(['control 1', 'EGF 1'])
    expect(r.notices).toEqual([])
  })

  it('combines several factor values into the condition and treats "not available" as empty', () => {
    const text = sdrf(
      ['comment[data file]', 'factor value[treatment]', 'factor value[time]', 'comment[fraction identifier]'].join('\t'),
      ['a.mzML', 'EGF', '30min', 'not applicable'].join('\t'),
      ['b.mzML', 'EGF', 'not available', 'not available'].join('\t'),
      ['c.mzML', 'not available', 'not available', ''].join('\t'),
    )
    const { inputs } = parseSdrf(text)
    expect(inputs).toEqual([
      { fileName: 'a.mzML', condition: 'EGF/30min' },
      { fileName: 'b.mzML', condition: 'EGF' },
      { fileName: 'c.mzML' },
    ])
  })

  it('matches column names case-insensitively and survives CRLF and short lines', () => {
    const text =
      'Comment[Data File]\tFactor Value[Treatment]\tCharacteristics[Biological Replicate]\r\n' +
      'a.mzML\tEGF\t2\r\n' +
      '\r\n' +
      'b.mzML\r\n'
    const { inputs, notices } = parseSdrf(text)
    expect(notices).toEqual([])
    expect(inputs).toEqual([{ fileName: 'a.mzML', condition: 'EGF', replicate: 2 }, { fileName: 'b.mzML' }])
  })

  it('loads multiplexed SDRF as one row per file with a notice', () => {
    const text = sdrf(
      ['comment[data file]', 'comment[label]', 'factor value[treatment]', 'characteristics[biological replicate]'].join('\t'),
      ['tmt1.mzML', 'TMT126', 'control', '1'].join('\t'),
      ['tmt1.mzML', 'TMT127N', 'EGF', '1'].join('\t'),
      ['tmt2.mzML', 'TMT126', 'control', '2'].join('\t'),
      ['tmt2.mzML', 'TMT127N', 'control', '2'].join('\t'),
    )
    const { inputs, notices } = parseSdrf(text)
    expect(inputs).toEqual([
      { fileName: 'tmt1.mzML', replicate: 1 },
      { fileName: 'tmt2.mzML', condition: 'control', replicate: 2 },
    ])
    expect(notices.map((n) => n.kind)).toEqual(['multiplexed'])
    expect(notices[0].message).toContain('tmt1.mzML')
    expect(notices[0].message).toContain('tmt2.mzML')
  })

  it('does not call label-free files with repeated labels multiplexed', () => {
    const text = sdrf(
      ['comment[data file]', 'comment[label]'].join('\t'),
      ['a.mzML', 'label free sample'].join('\t'),
      ['b.mzML', 'label free sample'].join('\t'),
    )
    const { inputs, notices } = parseSdrf(text)
    expect(inputs).toHaveLength(2)
    expect(notices).toEqual([])
  })

  it('says so when there is no data file column', () => {
    for (const text of ['', 'source name\tcomment[label]\ns1\tTMT126\n']) {
      const { inputs, notices } = parseSdrf(text)
      expect(inputs).toEqual([])
      expect(notices.map((n) => n.kind)).toEqual(['unknownColumn'])
      expect(notices[0].message).toContain('comment[data file]')
    }
  })
})
