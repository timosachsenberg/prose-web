import { describe, expect, it } from 'vitest'
import { debugFlag } from './debug'

describe('debugFlag', () => {
  it('reads ?debug= once for the whole app', () => {
    expect(debugFlag('?debug=engine')).toBe('engine')
    expect(debugFlag('?x=1&debug=large')).toBe('large')
    expect(debugFlag('?debug=small')).toBe('small')
    expect(debugFlag('?debug=large1')).toBe('large1')
    expect(debugFlag('?debug=other')).toBeNull()
    expect(debugFlag('')).toBeNull()
  })
})
