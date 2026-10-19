import { describe, expect, it } from 'vitest'
import { debugFlag, debugPeaks, debugSave } from './debug'

describe('debugFlag', () => {
  it('reads ?debug= once for the whole app', () => {
    expect(debugFlag('?debug=engine')).toBe('engine')
    expect(debugFlag('?x=1&debug=large')).toBe('large')
    expect(debugFlag('?debug=small')).toBe('small')
    expect(debugFlag('?debug=large1')).toBe('large1')
    expect(debugFlag('?debug=dense')).toBe('dense')
    expect(debugFlag('?debug=other')).toBeNull()
    expect(debugFlag('')).toBeNull()
  })
})

describe('debugSave and debugPeaks', () => {
  it('read &save and &peaks=n', () => {
    expect(debugSave('?debug=small&save')).toBe(true)
    expect(debugSave('?debug=small')).toBe(false)
    expect(debugPeaks('?debug=large&peaks=125')).toBe(125)
    expect(debugPeaks('?debug=large')).toBe(0)
    expect(debugPeaks('?peaks=-3')).toBe(0)
    expect(debugPeaks('?peaks=abc')).toBe(0)
    expect(debugPeaks('?peaks=1e9')).toBe(5000)
    expect(debugPeaks('?peaks=99999')).toBe(5000)
  })
})
