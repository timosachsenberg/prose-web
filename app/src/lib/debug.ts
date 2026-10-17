// The one parser of the ?debug= query, for the whole app:
// - engine: the app's EngineClient is window.__engine (the e2e test of the engine uses it);
// - large / small: a stored synthetic result opens in Results (150,000 or 3,000 PSMs; see
//   results/synthetic.ts), for the e2e tests and for trying the tables without a search.

export type DebugFlag = 'engine' | 'large' | 'small'

const flags: readonly DebugFlag[] = ['engine', 'large', 'small']

/** The debug flag of a URL query string (`location.search`), or null. */
export function debugFlag(search: string): DebugFlag | null {
  const value = new URLSearchParams(search).get('debug')
  return (flags as readonly (string | null)[]).includes(value) ? (value as DebugFlag) : null
}
