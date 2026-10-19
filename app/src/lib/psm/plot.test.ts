import { describe, expect, it } from 'vitest'
import { bandPath, mzDomain, niceTicks, placeLabels, scale, stickPath, textWidth } from './plot'

describe('axes', () => {
  it('puts ticks on round numbers inside the range', () => {
    expect(niceTicks(0, 1000, 5)).toEqual([0, 200, 400, 600, 800, 1000])
    expect(niceTicks(112.3, 1387.9, 6)).toEqual([200, 400, 600, 800, 1000, 1200])
    expect(niceTicks(-24, 24, 4)).toEqual([-20, -10, 0, 10, 20])
    expect(niceTicks(0, 0.5, 5)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5])
    expect(niceTicks(5, 5, 4)).toEqual([5])
  })

  it('spans the m/z of all the series, with some room', () => {
    expect(mzDomain([Float32Array.of(150, 900), [140, 1000]])).toEqual([105.6, 1034.4])
    // one value: at least 20 on either side
    expect(mzDomain([[500]])).toEqual([480, 520])
    expect(mzDomain([[]])).toEqual([0, 100])
  })

  it('maps linearly', () => {
    const x = scale([100, 200], [0, 50])
    expect(x(150)).toBe(25)
    expect(x(100)).toBe(0)
  })
})

describe('marks', () => {
  it('draws sticks as one path', () => {
    expect(stickPath([10, 20.04], [5, 8.26], 50)).toBe('M10 50V5M20 50V8.3')
    expect(stickPath([], [], 50)).toBe('')
  })

  it('draws a tolerance band that follows m/z for Da', () => {
    // ±10 ppm is a rectangle
    expect(bandPath({ value: 10, unit: 'ppm' }, [100, 1000], (mz) => mz / 10, (ppm) => 100 - ppm, 8)).toBe('M10 90H100V110H10Z')
    // ±0.01 Da is 100 ppm at m/z 100 and 10 ppm at m/z 1000, clipped to the plot's ±50 ppm
    const d = bandPath({ value: 0.01, unit: 'Da' }, [100, 1000], (mz) => mz / 10, (ppm) => 100 - ppm, 3, [-50, 50])
    expect(d).toBe('M10 50L55 81.8L100 90L100 110L55 118.2L10 150Z')
  })
})

describe('labels', () => {
  it('estimates the width of a label', () => {
    expect(textWidth('b12', 11)).toBeGreaterThan(textWidth('b2', 11))
    expect(textWidth('', 11)).toBe(0)
  })

  it('puts labels above their peaks, higher when they would overlap, and leaves out what does not fit', () => {
    const at = placeLabels(
      [
        { x: 100, y: 80, width: 20 }, // the most important first
        { x: 105, y: 80, width: 20 }, // overlaps the first: one line up
        { x: 300, y: 80, width: 20 }, // free
        { x: 102, y: 80, width: 20 }, // overlaps both: two lines up
        { x: 101, y: 80, width: 20 }, // no room left within three lines: left out
      ],
      { lineHeight: 12, tries: 3, top: 40 },
    )
    expect(at).toEqual([80, 68, 80, 56, null])
    // never above the top
    expect(placeLabels([{ x: 0, y: 30, width: 10 }], { lineHeight: 12, tries: 3, top: 40 })).toEqual([40])
  })
})
