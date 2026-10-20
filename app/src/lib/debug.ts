// The one parser of the ?debug= query, for the whole app:
// - engine: the app's EngineClient is window.__engine (the e2e test of the engine uses it);
// - wasm64: every search runs in the 64-bit module (Memory64), where the browser has it, whatever its
//   memory estimate (search/plan.svelte.ts; the e2e tests of the 64-bit engine);
// - large / large1 / dense / small: a stored synthetic result opens in Results (150,000 PSMs at a PSM FDR
//   of 100 % or 1 %, the same PSMs on 20 proteins of about a thousand peptides each, or 3,000 PSMs; see
//   results/synthetic.ts), for the e2e tests and for trying the tables without a search. With `&save`
//   the debug result is also saved to History, as a finished search is; `&peaks=125` gives every PSM a
//   spectrum of that many (random) peaks, as the stored spectra of a real search.

export type DebugFlag = 'engine' | 'wasm64' | 'large' | 'large1' | 'dense' | 'small'
export type DebugResultFlag = Exclude<DebugFlag, 'engine' | 'wasm64'>

const flags: readonly DebugFlag[] = ['engine', 'wasm64', 'large', 'large1', 'dense', 'small']

/** Whether the flag opens a stored synthetic result (the others change how the app runs). */
export function isDebugResult(flag: DebugFlag | null): flag is DebugResultFlag {
  return flag !== null && flag !== 'engine' && flag !== 'wasm64'
}

/** The debug flag of a URL query string (`location.search`), or null. */
export function debugFlag(search: string): DebugFlag | null {
  const value = new URLSearchParams(search).get('debug')
  return (flags as readonly (string | null)[]).includes(value) ? (value as DebugFlag) : null
}

/** `?debug=small&save`: the debug result is also saved to History. */
export function debugSave(search: string): boolean {
  return new URLSearchParams(search).has('save')
}

/** `?debug=large&peaks=125`: the peaks per spectrum of the debug result's stored spectra (0: it has none). */
export function debugPeaks(search: string): number {
  const n = Number(new URLSearchParams(search).get('peaks'))
  return Number.isInteger(n) && n > 0 ? Math.min(n, 5000) : 0
}
