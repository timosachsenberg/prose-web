import { describe, expect, it } from 'vitest'
import { keyTarget, scrollToShow, visibleRange } from './virtual'

describe('visibleRange', () => {
  it('covers the viewport plus the overscan, within the rows', () => {
    expect(visibleRange(0, 330, 33, 1000, 5)).toEqual({ start: 0, end: 15 })
    expect(visibleRange(3300, 330, 33, 1000, 5)).toEqual({ start: 95, end: 115 })
    expect(visibleRange(32_967, 330, 33, 1000, 5)).toEqual({ start: 994, end: 1000 })
    expect(visibleRange(0, 330, 33, 0, 5)).toEqual({ start: 0, end: 0 })
  })
})

describe('keyTarget', () => {
  it('moves the focus by row, by page and to the ends', () => {
    expect(keyTarget('ArrowDown', 3, 10, 4)).toBe(4)
    expect(keyTarget('ArrowDown', 9, 10, 4)).toBe(9)
    expect(keyTarget('ArrowUp', 0, 10, 4)).toBe(0)
    expect(keyTarget('ArrowUp', 5, 10, 4)).toBe(4)
    expect(keyTarget('PageDown', 3, 10, 4)).toBe(7)
    expect(keyTarget('PageDown', 8, 10, 4)).toBe(9)
    expect(keyTarget('PageUp', 3, 10, 4)).toBe(0)
    expect(keyTarget('Home', 7, 10, 4)).toBe(0)
    expect(keyTarget('End', 2, 10, 4)).toBe(9)
    expect(keyTarget('a', 2, 10, 4)).toBeNull()
    expect(keyTarget('ArrowDown', 0, 0, 4)).toBeNull()
  })
})

describe('scrollToShow', () => {
  it('scrolls just enough to show a row below the sticky header', () => {
    // rows of 33 px under a 40 px header in a 370 px box: 330 px of rows
    expect(scrollToShow(5, 0, 370, 33, 40)).toBe(0)
    expect(scrollToShow(10, 0, 370, 33, 40)).toBe(33) // row 10 ends at 363
    expect(scrollToShow(2, 200, 370, 33, 40)).toBe(66)
    expect(scrollToShow(999, 0, 370, 33, 40)).toBe(33_000 - 330)
  })
})
