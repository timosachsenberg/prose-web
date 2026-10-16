import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  })
  return data
}

/** A fresh copy of the module, as after a page load. */
async function load() {
  vi.resetModules()
  return (await import('./settings.svelte')).displaySettings
}

describe('displaySettings', () => {
  beforeEach(() => stubStorage())
  afterEach(() => vi.unstubAllGlobals())

  it('shows marked residues by default', async () => {
    expect((await load()).modMode).toBe('marked')
  })

  it('persists the switch in localStorage "prose.modMode"', async () => {
    const data = stubStorage()
    const settings = await load()
    settings.modMode = 'proforma'
    expect(settings.modMode).toBe('proforma')
    expect(data.get('prose.modMode')).toBe('proforma')
    // a reload picks it up
    expect((await load()).modMode).toBe('proforma')
  })

  it('ignores an unknown stored value', async () => {
    stubStorage({ 'prose.modMode': 'lowercase' })
    expect((await load()).modMode).toBe('marked')
  })

  it('works without localStorage', async () => {
    vi.stubGlobal('localStorage', undefined)
    const settings = await load()
    expect(settings.modMode).toBe('marked')
    settings.modMode = 'proforma'
    expect(settings.modMode).toBe('proforma')
  })
})
