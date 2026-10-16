import { describe, expect, it } from 'vitest'
import { formatHash, parseHash, type Route } from './route'

describe('parseHash', () => {
  it('reads the three views', () => {
    expect(parseHash('#/search')).toEqual({ view: 'search' })
    expect(parseHash('#/results')).toEqual({ view: 'results', id: null })
    expect(parseHash('#/results/abc123')).toEqual({ view: 'results', id: 'abc123' })
    expect(parseHash('#/history')).toEqual({ view: 'history' })
  })

  it('falls back to the search view for an empty, unknown or malformed hash', () => {
    for (const hash of ['', '#', '#/', '#/nonsense', '#/results/%E0%A4%A']) {
      expect(parseHash(hash)).toEqual({ view: 'search' })
    }
  })

  it('tolerates a missing slash and a trailing one', () => {
    expect(parseHash('#history')).toEqual({ view: 'history' })
    expect(parseHash('#/results/abc/')).toEqual({ view: 'results', id: 'abc' })
  })
})

describe('formatHash', () => {
  it('writes the canonical hash', () => {
    expect(formatHash({ view: 'search' })).toBe('#/search')
    expect(formatHash({ view: 'results', id: null })).toBe('#/results')
    expect(formatHash({ view: 'results', id: 'abc123' })).toBe('#/results/abc123')
    expect(formatHash({ view: 'history' })).toBe('#/history')
  })

  it('round-trips, including ids that need escaping', () => {
    const routes: Route[] = [
      { view: 'search' },
      { view: 'history' },
      { view: 'results', id: null },
      { view: 'results', id: 'a b/c#d' },
    ]
    for (const route of routes) expect(parseHash(formatHash(route))).toEqual(route)
  })
})
