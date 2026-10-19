// The one parser of the ?debug= query, for the whole app:
// - engine: the app's EngineClient is window.__engine (the e2e test of the engine uses it);
// - large / large1 / small: a stored synthetic result opens in Results (150,000 PSMs at a PSM FDR of
//   100 % or 1 %, or 3,000; see results/synthetic.ts), for the e2e tests and for trying the tables
//   without a search.

export type DebugFlag = 'engine' | 'large' | 'large1' | 'small'
export type DebugResultFlag = Exclude<DebugFlag, 'engine'>

const flags: readonly DebugFlag[] = ['engine', 'large', 'large1', 'small']

/** The debug flag of a URL query string (`location.search`), or null. */
export function debugFlag(search: string): DebugFlag | null {
  const value = new URLSearchParams(search).get('debug')
  return (flags as readonly (string | null)[]).includes(value) ? (value as DebugFlag) : null
}
