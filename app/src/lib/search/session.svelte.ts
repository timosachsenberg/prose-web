// The search of this session: its progress while it runs, its error, and the result it opened. Kept
// outside the views, so that a search goes on (with its progress in the footer, or in the top bar on
// other views) while the user looks elsewhere.

import type { DesignResolution } from '../design/model'
import { engineClient, startEngine } from '../engine/app-engine.svelte'
import { EngineError, type EngineInfo, type SearchOutcome, type SearchProgress, type SearchRequest } from '../engine/client'
import { RELOAD } from '../engine/protocol'
import { describeFailure, type Failure } from './failure'

/** A finished search, open in this session (History keeps them later). */
export type OpenResult = {
  id: string
  createdAt: string
  outcome: SearchOutcome
  design: DesignResolution
  /** The search's cutoffs (q-values). */
  psmFdr: number
  proteinFdr: number
  settings: {
    parameters: Record<string, unknown>
    rescore: boolean
    peptdeep: boolean
    contaminants: boolean
    presetId?: string
  }
}

export type RunStatus = 'idle' | 'running' | 'done' | 'failed' | 'cancelled'

export const searchRun = $state<{
  status: RunStatus
  label: string
  /** The input file of the step (-1 outside the files). */
  file: number
  /** The names of the files of the running (or last) search. */
  files: string[]
  /** 0–1 overall, as the engine reports it. */
  fraction: number
  /** When the fraction last moved, when the search started, and now (performance.now(); ticks while running). */
  movedAt: number
  startedAt: number
  now: number
  /** What went wrong: the stage and file, the message, OpenMS' raw text. */
  failure: Failure | null
  /** The error says to reload the page (OpenMS could not be started again). */
  reload: boolean
}>({
  status: 'idle',
  label: '',
  file: -1,
  files: [],
  fraction: 0,
  movedAt: 0,
  startedAt: 0,
  now: 0,
  failure: null,
  reload: false,
})

/** No move of the fraction for this long: the progress turns indeterminate (Percolator sends no progress). */
export const STALL_MS = 2000

class ProgressView {
  running = $derived(searchRun.status === 'running')
  /** Indeterminate while the fraction does not move: reading the files, Percolator, a chunked search. */
  indeterminate = $derived(
    this.running && (searchRun.fraction === 0 || searchRun.now - searchRun.movedAt > STALL_MS),
  )
  percent = $derived(Math.round(searchRun.fraction * 100))
  elapsed = $derived.by(() => {
    const s = Math.max(0, Math.floor((searchRun.now - searchRun.startedAt) / 1000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  })
  /** The step, with its file when the search has several ("File 2 of 6 · Post-processing PSMs…"). */
  label = $derived.by(() => {
    const label = searchRun.label.replace(/\.\.\.$/, '…')
    const { file } = searchRun
    const n = searchRun.files.length
    if (n > 1 && file >= 0 && file < n && !label.includes(`of ${n})`)) return `File ${file + 1} of ${n} · ${label}`
    return label
  })
}

export const searchProgress = new ProgressView()

// raw: the result's columns are large and never change, so they are not made deeply reactive
let open = $state.raw<OpenResult | null>(null)

export const openResult = {
  get current(): OpenResult | null {
    return open
  },
}

/** The run in flight: a cancelled or replaced run ignores what its promises bring later. */
let runId = 0
/** The request of the run has gone to the engine (cancelling then goes through the engine). */
let sent = false
let clock: ReturnType<typeof setInterval> | undefined

function startClock() {
  clearInterval(clock)
  searchRun.now = performance.now()
  clock = setInterval(() => (searchRun.now = performance.now()), 250)
}

function stopClock() {
  clearInterval(clock)
  clock = undefined
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Runs a search with the app's engine (loading OpenMS first if needed; `check` then looks at the
 * request against what OpenMS offers, e.g. its modification names). Resolves with the id of the
 * opened result, or null if the search failed or was cancelled (`searchRun` says which).
 */
export async function runSearch(
  request: SearchRequest,
  meta: Omit<OpenResult, 'id' | 'createdAt' | 'outcome'>,
  check?: (info: EngineInfo) => string | null,
): Promise<string | null> {
  if (searchRun.status === 'running') return null
  const id = ++runId
  sent = false
  const now = performance.now()
  Object.assign(searchRun, {
    status: 'running',
    label: 'Starting OpenMS...',
    file: -1,
    files: request.files.map((f) => f.file.name),
    fraction: 0,
    movedAt: now,
    startedAt: now,
    failure: null,
    reload: false,
  })
  startClock()
  const onProgress = (p: SearchProgress) => {
    if (id !== runId || searchRun.status !== 'running') return
    searchRun.label = p.label
    searchRun.file = p.file
    if (p.fraction > searchRun.fraction) {
      searchRun.fraction = p.fraction
      searchRun.movedAt = performance.now()
    }
  }
  try {
    const info = await startEngine()
    if (id !== runId) return null // cancelled while OpenMS was loading
    const problem = check?.(info) ?? null
    if (problem !== null) {
      Object.assign(searchRun, { status: 'failed', failure: { context: 'Before the search', summary: problem, detail: null } })
      return null
    }
    searchRun.label = 'Reading the files...'
    sent = true
    const outcome = await engineClient().search(request, onProgress)
    if (id !== runId) return null
    const resultId = newId()
    open = { ...meta, id: resultId, createdAt: new Date().toISOString(), outcome }
    searchRun.status = 'done'
    return resultId
  } catch (e) {
    if (id !== runId) return null
    if (e instanceof EngineError && e.kind === 'cancelled') {
      searchRun.status = 'cancelled'
      return null
    }
    const message = String((e as Error)?.message ?? e)
    const failure = describeFailure({ label: searchRun.label, file: searchRun.file, files: searchRun.files }, message)
    Object.assign(searchRun, { status: 'failed', failure, reload: message.includes(RELOAD) })
    return null
  } finally {
    if (id === runId) stopClock()
  }
}

/**
 * Cancels the running search. Sent to the engine, the engine ends its worker (and starts a new one);
 * not sent yet (OpenMS still loading), the run ends at once and OpenMS goes on loading in the background.
 */
export function cancelSearch(): void {
  if (searchRun.status !== 'running') return
  if (sent) {
    engineClient().cancel()
    return
  }
  runId++
  stopClock()
  searchRun.status = 'cancelled'
}

/** Forgets a finished search's error or cancellation (e.g. when the form changes). */
export function clearRunMessage(): void {
  if (searchRun.status === 'failed' || searchRun.status === 'cancelled') {
    Object.assign(searchRun, { status: 'idle', failure: null, reload: false })
  }
}
