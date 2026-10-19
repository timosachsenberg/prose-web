import { describe, expect, it } from 'vitest'
import { MINUS, signedNumber } from './number'

describe('signedNumber', () => {
  it('signs a number with a real minus (U+2212) and a plus', () => {
    expect(MINUS).toBe('−')
    expect(signedNumber(2.049, 2)).toBe('+2.05')
    expect(signedNumber(-5.912, 2)).toBe('−5.91')
    expect(signedNumber(-1.26, 1)).toBe('−1.3')
  })

  it('rounds before it signs: what rounds to zero has no sign', () => {
    expect(signedNumber(-0.04, 1)).toBe('0.0')
    expect(signedNumber(-0.001, 2)).toBe('0.00')
    expect(signedNumber(0.004, 2)).toBe('0.00')
    expect(signedNumber(-0, 3)).toBe('0.000')
    expect(signedNumber(0, 4)).toBe('0.0000')
  })

  it('can leave the plus out (a score that is usually positive)', () => {
    expect(signedNumber(3.14159, 3, { plus: false })).toBe('3.142')
    expect(signedNumber(-1.5, 3, { plus: false })).toBe('−1.500')
    expect(signedNumber(-0.0004, 3, { plus: false })).toBe('0.000') // no "-0.000"
  })

  it('can drop the zeros at the end of the decimals (axis ticks)', () => {
    expect(signedNumber(-2.5, 2, { plus: false, trim: true })).toBe('−2.5')
    expect(signedNumber(-1, 2, { plus: false, trim: true })).toBe('−1')
    expect(signedNumber(0, 2, { plus: false, trim: true })).toBe('0')
    expect(signedNumber(-0.001, 2, { plus: false, trim: true })).toBe('0')
    expect(signedNumber(10, 2, { plus: false, trim: true })).toBe('10')
    expect(signedNumber(0.25, 2, { plus: true, trim: true })).toBe('+0.25')
    expect(signedNumber(100, 0, { plus: false, trim: true })).toBe('100')
  })

  it('writes a dash for what is no number', () => {
    expect(signedNumber(NaN, 2)).toBe('–')
    expect(signedNumber(Infinity, 2)).toBe('–')
    expect(signedNumber(-Infinity, 2, { plus: false })).toBe('–')
  })
})
