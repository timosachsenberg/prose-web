// The current view of the app, shared by all views: a rune that the URL hash mirrors (#/search,
// #/results/<id>, #/history). `navigate()` changes the view from code; the hash (links, back button,
// a reload) changes it through `readHash()`, which App.svelte calls on hashchange.

import { formatHash, parseHash, type Route } from './route'

let route = $state<Route>(parseHash(location.hash))
// the result that was open last: the "Results" link returns to it
let resultId = $state<string | null>(null)

function remember(r: Route) {
  if (r.view === 'results' && r.id !== null) resultId = r.id
}

export const router = {
  get route(): Route {
    return route
  },
  get resultId(): string | null {
    return resultId
  },
}

/** Shows `next` and pushes its hash (a new history entry, so the back button returns). */
export function navigate(next: Route): void {
  route = next
  remember(next)
  const hash = formatHash(next)
  if (location.hash !== hash) location.hash = hash
}

/** Takes the route from the hash; a hash that is not canonical (empty, unknown) is rewritten in place. */
export function readHash(): void {
  route = parseHash(location.hash)
  remember(route)
  const canonical = formatHash(route)
  if (location.hash !== canonical) history.replaceState(null, '', canonical)
}
