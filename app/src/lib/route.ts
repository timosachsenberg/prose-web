// The views of the app and their URL hashes: #/search, #/results[/<id>], #/history.

export type View = 'search' | 'results' | 'history'

export type Route =
  | { view: 'search' }
  | { view: 'results'; id: string | null }
  | { view: 'history' }

export const views: readonly View[] = ['search', 'results', 'history']

/** The route of a location hash; anything unknown or malformed is the search view. */
export function parseHash(hash: string): Route {
  const segments = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  switch (segments[0]) {
    case 'history':
      return { view: 'history' }
    case 'results':
      try {
        return { view: 'results', id: segments[1] === undefined ? null : decodeURIComponent(segments[1]) }
      } catch {
        return { view: 'search' }
      }
    default:
      return { view: 'search' }
  }
}

/** The canonical hash of a route; `parseHash(formatHash(r))` gives `r` back. */
export function formatHash(route: Route): string {
  if (route.view === 'results') {
    return route.id === null ? '#/results' : `#/results/${encodeURIComponent(route.id)}`
  }
  return `#/${route.view}`
}
