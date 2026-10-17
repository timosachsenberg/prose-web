import { describe, expect, it } from 'vitest'
import { formatBytes, GB, MB } from './bytes'

describe('formatBytes', () => {
  it('writes binary units, as the 4 GB of the module count', () => {
    expect(GB).toBe(2 ** 30)
    expect(formatBytes(4 * GB)).toBe('4.0 GB')
    expect(formatBytes(2.25 * GB)).toBe('2.3 GB')
    expect(formatBytes(312 * MB)).toBe('312 MB')
    expect(formatBytes(6518159)).toBe('6.2 MB')
    expect(formatBytes(1200)).toBe('1 KB')
    expect(formatBytes(94)).toBe('94 B')
    expect(formatBytes(0)).toBe('0 B')
  })

  it('moves to the next unit instead of writing 1024', () => {
    expect(formatBytes(1023.8 * MB)).toBe('1.0 GB')
    expect(formatBytes(1023.6)).toBe('1 KB')
  })
})
