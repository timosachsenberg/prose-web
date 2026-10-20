import { describe, expect, test, vi } from 'vitest'
import { GB } from '../format/bytes'
import { chooseEngine, engineLabel, MEMORY64_PROBE, SWITCH_BYTES, supportsMemory64 } from './variant'

describe('supportsMemory64', () => {
  test('validates the probe module, never throws', () => {
    const validate = vi.fn(() => true)
    expect(supportsMemory64(validate)).toBe(true)
    expect(validate).toHaveBeenCalledWith(MEMORY64_PROBE)
    expect(supportsMemory64(() => false)).toBe(false)
    expect(
      supportsMemory64(() => {
        throw new Error('no WebAssembly here')
      }),
    ).toBe(false)
  })

  test('the probe is the smallest module with a shared 64-bit memory (what the threaded wasm64 module needs)', () => {
    // Node 24 has Memory64, as Chrome and Edge from 133 and Firefox from 134
    expect(WebAssembly.validate(MEMORY64_PROBE)).toBe(true)
    expect(supportsMemory64()).toBe(true)
    // the same memory with 32-bit addresses is another module: the probe tests the 64-bit flag
    const shared32 = MEMORY64_PROBE.slice()
    shared32[shared32.length - 3] = 0x03
    expect(WebAssembly.validate(shared32)).toBe(true)
    expect([...shared32]).not.toEqual([...MEMORY64_PROBE])
    // a browser without Memory64 rejects the flag (simulated: an unknown limits flag)
    const unknown = MEMORY64_PROBE.slice()
    unknown[unknown.length - 3] = 0x0f
    expect(WebAssembly.validate(unknown)).toBe(false)
  })
})

describe('chooseEngine', () => {
  test('wasm32 by default; wasm64 above 3 GB where the browser has Memory64', () => {
    expect(SWITCH_BYTES).toBe(3 * GB)
    expect(chooseEngine({ estimate32: 2.9 * GB, memory64: true })).toBe('wasm32')
    expect(chooseEngine({ estimate32: SWITCH_BYTES, memory64: true })).toBe('wasm32')
    expect(chooseEngine({ estimate32: SWITCH_BYTES + 1, memory64: true })).toBe('wasm64')
    expect(chooseEngine({ estimate32: 8 * GB, memory64: true })).toBe('wasm64')
    // without Memory64 (Safari) every search stays in wasm32, however large
    expect(chooseEngine({ estimate32: 8 * GB, memory64: false })).toBe('wasm32')
  })

  test('a file too large for wasm32 goes to wasm64 too', () => {
    expect(chooseEngine({ estimate32: 1 * GB, fileTooLarge32: true, memory64: true })).toBe('wasm64')
    expect(chooseEngine({ estimate32: 1 * GB, fileTooLarge32: true, memory64: false })).toBe('wasm32')
  })

  test('the debug switch forces wasm64, where the browser has it', () => {
    expect(chooseEngine({ estimate32: 0.5 * GB, memory64: true, force: true })).toBe('wasm64')
    expect(chooseEngine({ estimate32: 0.5 * GB, memory64: false, force: true })).toBe('wasm32')
  })

  test('labels', () => {
    expect(engineLabel('wasm32')).toBe('32-bit')
    expect(engineLabel('wasm64')).toBe('64-bit')
  })
})
