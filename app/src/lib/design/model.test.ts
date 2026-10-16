import { describe, expect, it } from 'vitest'
import { input, mockupDesign } from './fixtures'
import { fileStem, resolveDesign } from './model'

describe('resolveDesign', () => {
  it('empty fields mean unfractionated, replicates in file order', () => {
    const r = resolveDesign([
      input('a1.mzML', { condition: 'A' }),
      input('a2.mzML', { condition: 'A' }),
      input('a3.mzML', { condition: 'A' }),
    ])
    expect(r.rows.map((x) => x.replicate)).toEqual([1, 2, 3])
    expect(r.rows.map((x) => x.fraction)).toEqual([1, 1, 1])
    expect(r.rows.every((x) => x.assumed.fraction && x.assumed.replicate)).toBe(true)
    expect(r.samples.map((s) => s.label)).toEqual(['A 1', 'A 2', 'A 3'])
    expect(r.rows.map((x) => x.sample)).toEqual([0, 1, 2])
    expect(r.rows.map((x) => x.fractionGroup)).toEqual([1, 2, 3])
    expect(r.notices).toEqual([])
  })

  it('repeated fraction numbers assign replicates by order', () => {
    const r = resolveDesign([
      input('a_1.mzML', { condition: 'A', fraction: 1 }),
      input('a_2.mzML', { condition: 'A', fraction: 2 }),
      input('a_3.mzML', { condition: 'A', fraction: 1 }),
      input('a_4.mzML', { condition: 'A', fraction: 2 }),
    ])
    expect(r.rows.map((x) => x.replicate)).toEqual([1, 1, 2, 2])
    expect(r.rows.map((x) => x.assumed.replicate)).toEqual([true, true, true, true])
    expect(r.rows.map((x) => x.assumed.fraction)).toEqual([false, false, false, false])
    expect(r.samples.map((s) => s.label)).toEqual(['A 1', 'A 2'])
    expect(r.rows.map((x) => x.fractionGroup)).toEqual([1, 1, 2, 2])
    expect(r.notices).toEqual([])
  })

  it('a fractionated replicate stays one sample when only fractions are given', () => {
    const r = resolveDesign([
      input('a_F1.mzML', { condition: 'A', fraction: 1 }),
      input('a_F2.mzML', { condition: 'A', fraction: 2 }),
      input('a_F3.mzML', { condition: 'A', fraction: 3 }),
    ])
    expect(r.samples).toHaveLength(1)
    expect(r.rows.map((x) => x.replicate)).toEqual([1, 1, 1])
    expect(r.summary).toBe('3 files → 1 sample · 1 condition · fractions 1–3')
  })

  it('nothing entered: each file is its own sample', () => {
    const r = resolveDesign([
      input('run_one.mzML'),
      input('/data/run_two.mzML.gz'),
      input('C:\\data\\run_three.raw'),
    ])
    expect(r.samples.map((s) => s.label)).toEqual(['run_one', 'run_two.mzML', 'run_three'])
    expect(r.samples.every((s) => s.condition === null)).toBe(true)
    expect(r.conditions).toEqual([])
    expect(r.rows.map((x) => x.sample)).toEqual([0, 1, 2])
    expect(r.rows.map((x) => x.condition)).toEqual([null, null, null])
    expect(r.summary).toBe('3 files → 3 samples')
  })

  it('same condition, replicate and fraction twice is a technical replicate', () => {
    const r = resolveDesign([
      input('egf.mzML', { condition: 'EGF', replicate: 1 }),
      input('egf_reinject.mzML', { condition: 'EGF', replicate: 1 }),
    ])
    const notices = r.notices.filter((n) => n.kind === 'techReplicate')
    expect(r.notices).toHaveLength(1)
    expect(notices).toHaveLength(1)
    expect(notices[0].rows).toEqual(r.rows.map((x) => x.id))
    expect(notices[0].message).toContain('egf')
    expect(notices[0].message).toContain('egf_reinject')
    expect(r.rows.map((x) => x.techReplicate)).toEqual([1, 2])
    expect(r.rows[0].sample).toBe(r.rows[1].sample)
    expect(r.samples).toHaveLength(1)
    // Same sample, but two measurements: two fraction groups.
    expect(r.rows.map((x) => x.fractionGroup)).toEqual([1, 2])
  })

  it('explicit technical replicate numbers are kept and raise no notice', () => {
    const r = resolveDesign([
      input('p1_inj1.mzML', { condition: 'control', replicate: 1, techReplicate: 1 }),
      input('p1_inj2.mzML', { condition: 'control', replicate: 1, techReplicate: 2 }),
    ])
    expect(r.rows.map((x) => x.techReplicate)).toEqual([1, 2])
    expect(r.notices).toEqual([])
  })

  it('a clashing explicit technical replicate number is bumped, with a notice', () => {
    const r = resolveDesign([
      input('x1.mzML', { condition: 'A', replicate: 1, techReplicate: 1 }),
      input('x2.mzML', { condition: 'A', replicate: 1, techReplicate: 1 }),
    ])
    expect(r.rows.map((x) => x.techReplicate)).toEqual([1, 2])
    expect(r.notices.map((n) => n.kind)).toEqual(['techReplicate'])
  })

  it('fraction gaps and uneven fractions are notices', () => {
    const r = resolveDesign([
      input('a1_F1.mzML', { condition: 'A', replicate: 1, fraction: 1 }),
      input('a1_F2.mzML', { condition: 'A', replicate: 1, fraction: 2 }),
      input('a1_F4.mzML', { condition: 'A', replicate: 1, fraction: 4 }),
      input('a2_F1.mzML', { condition: 'A', replicate: 2, fraction: 1 }),
      input('a2_F2.mzML', { condition: 'A', replicate: 2, fraction: 2 }),
    ])
    expect(r.notices.map((n) => n.kind).sort()).toEqual(['fractionGap', 'unevenFractions'])
    const gap = r.notices.find((n) => n.kind === 'fractionGap')!
    expect(gap.message).toContain('3')
    const uneven = r.notices.find((n) => n.kind === 'unevenFractions')!
    // The replicate with fewer fractions is the one pointed at.
    expect(uneven.rows).toEqual([r.rows[3].id, r.rows[4].id])
    expect(r.summary).toBe('5 files → 2 samples · 1 condition · fractions 1–4')
  })

  it('numbering that does not start at 1 is a fraction gap', () => {
    const r = resolveDesign([
      input('a_F2.mzML', { condition: 'A', replicate: 1, fraction: 2 }),
      input('a_F3.mzML', { condition: 'A', replicate: 1, fraction: 3 }),
    ])
    expect(r.notices.map((n) => n.kind)).toEqual(['fractionGap'])
  })

  it('does not compare fraction counts across conditions', () => {
    const r = resolveDesign(mockupDesign())
    expect(r.notices.map((n) => n.kind)).toEqual(['techReplicate'])
  })

  it('summary line', () => {
    const r = resolveDesign(mockupDesign())
    expect(r.summary).toBe('6 files → 3 samples · 2 conditions · fractions 1–2')
    expect(r.conditions).toEqual(['control', 'EGF'])
    expect(r.samples.map((s) => s.label)).toEqual(['control 1', 'control 2', 'EGF 1'])
    expect(r.rows.map((x) => x.sample)).toEqual([0, 0, 1, 1, 2, 2])
    expect(r.rows.map((x) => x.fractionGroup)).toEqual([1, 1, 2, 2, 3, 4])
    expect(r.rows.map((x) => x.fraction)).toEqual([1, 2, 1, 2, 1, 1])
    expect(r.rows.map((x) => x.techReplicate)).toEqual([1, 1, 1, 1, 1, 2])
    expect(r.rows.map((x) => x.assumed.fraction)).toEqual([false, false, false, false, true, true])
    expect(r.rows.map((x) => x.assumed.replicate)).toEqual([false, false, false, false, true, false])
    const tech = r.notices.filter((n) => n.kind === 'techReplicate')
    expect(tech).toHaveLength(1)
    expect(tech[0].message).toContain('egf_30min_reinject')
  })

  it('summary line: singular forms, no fractions when none given, no conditions when none given', () => {
    const two = resolveDesign([
      input('a.mzML', { condition: 'EGF', replicate: 1 }),
      input('b.mzML', { condition: 'EGF', replicate: 2 }),
    ])
    expect(two.summary).toBe('2 files → 2 samples · 1 condition')
    expect(resolveDesign([input('a.mzML')]).summary).toBe('1 file → 1 sample')
    expect(resolveDesign([]).summary).toBe('0 files → 0 samples')
    const one = resolveDesign([
      input('a.mzML', { condition: 'A', fraction: 1 }),
      input('b.mzML', { condition: 'B', fraction: 1 }),
    ])
    expect(one.summary).toBe('2 files → 2 samples · 2 conditions · fraction 1')
  })

  it('keeps two files of the same name apart', () => {
    const a = input('run.mzML')
    const b = input('run.mzML')
    const r = resolveDesign([a, b])
    expect(r.rows).toHaveLength(2)
    expect(r.rows.map((x) => x.id)).toEqual([a.id, b.id])
    expect(r.samples).toHaveLength(2)
    expect(r.rows[0].sample).not.toBe(r.rows[1].sample)
    expect(new Set(r.samples.map((s) => s.label)).size).toBe(2)
    expect(r.notices).toEqual([])
  })

  it('orders samples by condition (first appearance) and replicate', () => {
    const r = resolveDesign([
      input('t_2.mzML', { condition: 'treated', replicate: 2 }),
      input('c_1.mzML', { condition: 'control', replicate: 1 }),
      input('t_1.mzML', { condition: 'treated', replicate: 1 }),
    ])
    expect(r.conditions).toEqual(['treated', 'control'])
    expect(r.samples.map((s) => s.label)).toEqual(['treated 1', 'treated 2', 'control 1'])
    expect(r.samples.map((s) => s.index)).toEqual([0, 1, 2])
    expect(r.rows.map((x) => x.sample)).toEqual([1, 2, 0])
    // Fraction groups follow the sample order, so they are consecutive from 1.
    expect(r.rows.map((x) => x.fractionGroup)).toEqual([2, 3, 1])
  })

  it('ignores blank conditions and invalid numbers', () => {
    const r = resolveDesign([
      input('a.mzML', { condition: '  ', replicate: 0, fraction: Number.NaN }),
      input('b.mzML', { condition: ' A ', replicate: 1.5, fraction: -2 }),
    ])
    expect(r.rows.map((x) => x.condition)).toEqual([null, 'A'])
    expect(r.rows.map((x) => x.replicate)).toEqual([1, 1])
    expect(r.rows.map((x) => x.fraction)).toEqual([1, 1])
    expect(r.rows.every((x) => x.assumed.replicate && x.assumed.fraction)).toBe(true)
  })

  it('without a condition, a given replicate still groups the files', () => {
    const r = resolveDesign([
      input('x_F1.mzML', { replicate: 3, fraction: 1 }),
      input('x_F2.mzML', { replicate: 3, fraction: 2 }),
      input('y.mzML', { replicate: 4 }),
    ])
    expect(r.samples.map((s) => s.label)).toEqual(['Replicate 3', 'y'])
    expect(r.rows.map((x) => x.sample)).toEqual([0, 0, 1])
    expect(r.conditions).toEqual([])
  })
})

describe('fileStem', () => {
  it('drops directories and the last extension', () => {
    expect(fileStem('ctrl_a_F1.mzML')).toBe('ctrl_a_F1')
    expect(fileStem('dir/sub/run.mzML')).toBe('run')
    expect(fileStem('C:\\dir\\run.raw')).toBe('run')
    expect(fileStem('noext')).toBe('noext')
    expect(fileStem('.hidden')).toBe('.hidden')
  })
})
