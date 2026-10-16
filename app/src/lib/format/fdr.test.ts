import { describe, expect, it } from 'vitest'
import { fdrChoices, formatPercent, formatQ, parsePercent, percentNumber } from './fdr'

describe('parsePercent', () => {
  it('is explicit about percent', () => {
    expect(parsePercent('1')).toBe(0.01)
    expect(parsePercent('1 %')).toBe(0.01)
    expect(parsePercent('1%')).toBe(0.01)
    expect(parsePercent('0.01')).toBe(0.0001)
    expect(parsePercent('150')).toBeNull()
  })

  it('reads decimals, a decimal comma and surrounding space', () => {
    expect(parsePercent(' 0.1 ')).toBe(0.001)
    expect(parsePercent('0,5 %')).toBe(0.005)
    expect(parsePercent('5.0%')).toBe(0.05)
    expect(parsePercent('.5')).toBe(0.005)
    expect(parsePercent('100')).toBe(1)
  })

  it('rejects junk, empty, negative and zero', () => {
    for (const input of ['', ' ', 'abc', '1 2', '1 %%', '%', '-1', '0', '0 %', '100.5', '1,2,3', 'q ≤ 0.01', 'NaN', 'Infinity']) {
      expect(parsePercent(input), JSON.stringify(input)).toBeNull()
    }
  })
})

describe('formatPercent', () => {
  it('writes a q-value as a percentage', () => {
    expect(formatPercent(0.01)).toBe('1 %')
    expect(formatPercent(0.001)).toBe('0.1 %')
    expect(formatPercent(0.05)).toBe('5 %')
    expect(formatPercent(0.0001)).toBe('0.01 %')
    expect(formatPercent(1)).toBe('100 %')
  })

  it('does not show floating point noise', () => {
    expect(formatPercent(0.07)).toBe('7 %') // 0.07 * 100 = 7.000000000000001
    expect(formatPercent(0.029)).toBe('2.9 %')
  })

  it('has the number alone for the input field', () => {
    expect(percentNumber(0.01)).toBe('1')
    expect(percentNumber(0.001)).toBe('0.1')
    expect(percentNumber(0.07)).toBe('7')
  })

  it('has the quick choices 0.1, 1 and 5 %', () => {
    expect(fdrChoices.map(formatPercent)).toEqual(['0.1 %', '1 %', '5 %'])
  })

  it('round-trips with parsePercent', () => {
    for (const q of [0.001, 0.01, 0.05, 0.07, 0.123]) expect(parsePercent(formatPercent(q))).toBe(q)
  })
})

describe('formatQ', () => {
  it('writes the q-value beside the percentage', () => {
    expect(formatQ(0.01)).toBe('q ≤ 0.01')
    expect(formatQ(0.001)).toBe('q ≤ 0.001')
    expect(formatQ(0.05)).toBe('q ≤ 0.05')
    expect(formatQ(0.0001)).toBe('q ≤ 0.0001')
  })

  it('switches to scientific notation for tiny values', () => {
    expect(formatQ(4e-6)).toBe('q ≤ 4.0e-6')
    expect(formatQ(0.00001)).toBe('q ≤ 1.0e-5')
  })
})
