import { describe, expect, it } from 'vitest'
import { fixed, sampleIndex, signed, tableColumns } from './cells'

describe('cell helpers', () => {
  it('formats fixed and signed numbers, missing ones as a dash', () => {
    expect(fixed(1134.41513, 4)).toBe('1134.4151')
    expect(fixed(NaN, 2)).toBe('–')
    expect(signed(2.049, 2)).toBe('+2.05')
    expect(signed(-5.912, 2)).toBe('−5.91') // a real minus (U+2212)
    expect(signed(-0.001, 2)).toBe('0.00') // no "-0.00"
    expect(signed(0, 4)).toBe('0.0000')
    expect(signed(NaN, 2)).toBe('–')
  })

  it('reads sample column ids', () => {
    expect(sampleIndex('sample:3')).toBe(3)
    expect(sampleIndex('psms')).toBe(-1)
  })

  it('makes table columns of specs and cells', () => {
    const columns = tableColumns(
      [{ id: 'psms', header: 'PSMs', width: 80, align: 'right', sortKey: 'psms', csv: ['psms'], title: 'at FDR' }],
      () => ({ cell: (row) => String(row * 2) }),
    )
    expect(columns).toHaveLength(1)
    expect(columns[0]).toMatchObject({ id: 'psms', header: 'PSMs', width: 80, align: 'right', sortKey: 'psms', title: 'at FDR' })
    expect(columns[0].cell(21)).toBe('42')
  })
})
