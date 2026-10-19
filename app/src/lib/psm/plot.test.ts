import { describe, expect, it } from 'vitest'
import { bandPath, clipMarks, mzDomain, niceTicks, placeLabels, scale, stickGroups, stickPath, stripFits, textWidth } from './plot'

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

  it('groups sticks by colour on one m/z scale, and clips them at 100 %', () => {
    const x = scale([100, 1100], [0, 1000])
    const y = (r: number) => 100 - 100 * r
    const groups = stickGroups(
      [
        { mz: 500.0025, ratio: 0.5, color: 'blue' }, // an observed b ion, 5 ppm off
        { mz: 600, ratio: 1.8, color: 'grey' }, // a peak stronger than the reference
        { mz: 700, ratio: 1, color: 'blue' },
      ],
      x,
      y,
    )
    expect(groups.map((g) => g.color)).toEqual(['blue', 'grey'])
    expect(groups[0]).toMatchObject({ xs: [400.0025, 600], tops: [50, 0], clipped: [] })
    expect(groups[1]).toMatchObject({ xs: [500], tops: [0], clipped: [500] })
    // the same ion below (its theoretical m/z) is where the observed one is, to the pixel
    const below = stickGroups([{ mz: 500, ratio: 1, color: 'blue', faint: true }], x, (r) => 100 + 100 * r)
    expect(below[0]).toMatchObject({ faint: true, xs: [400], tops: [200] })
    expect(Math.abs(below[0].xs[0] - groups[0].xs[0])).toBeLessThan(0.01)
    expect(clipMarks([500], 0, true)).toBe('M497 0L500 -5L503 0Z')
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

describe('the strip under the mirror spectrum', () => {
  const label = 'PeptDeep · NCE 36 (calibrated) · QE · 100 % = strongest predicted b/y'
  const similarity = 'cosine 0.437 · spectral angle 0.288 (search)'

  it('keeps the label and the similarity on one line when both fit', () => {
    expect(stripFits(label, similarity, 820)).toBe(true)
    expect(stripFits('Theoretical', similarity, 400)).toBe(true)
  })

  it('puts the similarity on a line of its own when they would meet', () => {
    // about 660 px of plot at a window of 1050 px: the label alone is some 400 px wide
    expect(stripFits(label, similarity, 660)).toBe(false)
    expect(stripFits(label, similarity, textWidth(label, 11) + 16 + textWidth(similarity, 11) - 1)).toBe(false)
    expect(stripFits(label, similarity, textWidth(label, 11) + 16 + textWidth(similarity, 11))).toBe(true)
  })

  it('needs no room for a similarity that is not there', () => {
    expect(stripFits(label, null, 100)).toBe(true)
  })
})
