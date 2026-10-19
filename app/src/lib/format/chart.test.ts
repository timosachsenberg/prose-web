import { describe, expect, it } from 'vitest'
import { textWidth } from '../psm/plot'
import { barPath, fitText, hBarPath, tickLabel } from './chart'

describe('tickLabel', () => {
  it('writes round ticks plainly, a minus as a real minus, thousands compact', () => {
    expect(tickLabel(0)).toBe('0')
    expect(tickLabel(-0)).toBe('0')
    expect(tickLabel(2.5)).toBe('2.5')
    expect(tickLabel(-4)).toBe('−4')
    expect(tickLabel(0.1 * 3)).toBe('0.3') // not 0.30000000000000004
    expect(tickLabel(999)).toBe('999')
    expect(tickLabel(1000)).toBe('1K')
    expect(tickLabel(1500)).toBe('1.5K')
    expect(tickLabel(20000)).toBe('20K')
    expect(tickLabel(1_200_000)).toBe('1.2M')
    expect(tickLabel(-1500)).toBe('−1.5K')
    expect(tickLabel(NaN)).toBe('')
  })
})

describe('bar paths', () => {
  it('rounds the data end of a column and keeps the baseline square', () => {
    // x 10, top 20, width 12, height 30 (baseline at y = 50), radius 4
    expect(barPath(10, 20, 12, 30, 4)).toBe('M10 50V24Q10 20 14 20H18Q22 20 22 24V50Z')
  })

  it('rounds no more than the bar allows', () => {
    // a bar 2 px high and 6 px wide: the radius is the height at most, and half the width at most
    expect(barPath(0, 48, 6, 2, 4)).toBe('M0 50V50Q0 48 2 48H4Q6 48 6 50V50Z')
    expect(barPath(0, 0, 0, 10, 4)).toBe('')
    expect(barPath(0, 0, 5, 0, 4)).toBe('')
  })

  it('rounds the data end of a horizontal bar on the right', () => {
    expect(hBarPath(40, 10, 100, 16, 4)).toBe('M40 10H136Q140 10 140 14V22Q140 26 136 26H40Z')
    expect(hBarPath(40, 10, 0, 16, 4)).toBe('')
  })
})

describe('fitText', () => {
  it('leaves a text that fits', () => {
    expect(fitText('control_1.mzML', 200, 12)).toBe('control_1.mzML')
  })

  it('shortens a long file name in the middle, keeping its start and its end', () => {
    const name = 'DatabaseSuitability_in_spec_replicate_with_a_very_long_name_3.mzML'
    const fitted = fitText(name, 150, 12)
    expect(fitted).toContain('…')
    expect(textWidth(fitted, 12)).toBeLessThanOrEqual(150)
    expect(fitted.startsWith('DatabaseSu')).toBe(true)
    expect(fitted.endsWith('3.mzML')).toBe(true)
    // as much as fits: one more character would not
    expect(fitted.length).toBeGreaterThan(15)
  })

  it('gives an ellipsis where nothing fits', () => {
    expect(fitText('abcdefgh', 3, 12)).toBe('…')
  })
})
