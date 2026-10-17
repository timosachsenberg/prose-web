// The search of this session: its progress while it runs, its error, and the result it opened. Kept
// outside the views, so that a search goes on (and its footer with it) while the user looks elsewhere.

import type { DesignResolution } from '../design/model'
import { engineClient, startEngine } from '../engine/app-engine.svelte'
import { EngineError, type SearchOutcome, type SearchProgress, type SearchRequest } from '../engine/client'
import { RELOAD } from '../engine/protocol'

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
  /** The input file of the step (-1 outside the files) and how many files the search has. */
  file: number
  fileCount: number
  /** 0–1 overall, as the engine reports it. */
  fraction: number
  /** When the fraction last moved (performance.now()). */
  movedAt: number
  startedAt: number
  error: string | null
  /** The error says to reload the page (OpenMS could not be started again). */
  reload: boolean
}>({ status: 'idle', label: '', file: -1, fileCount: 0, fraction: 0, movedAt: 0, startedAt: 0, error: null, reload: false })

// raw: the result's columns are large and never change, so they are not made deeply reactive
let open = $state.raw<OpenResult | null>(null)
/** Cancel was pressed while OpenMS was still loading, before the search was sent. */
let cancelBeforeSearch = false

export const openResult = {
  get current(): OpenResult | null {
    return open
  },
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Runs a search with the app's engine (loading OpenMS first if needed). Resolves with the id of the
 * opened result, or null if the search failed or was cancelled (`searchRun` says which).
 */
export async function runSearch(
  request: SearchRequest,
  meta: Omit<OpenResult, 'id' | 'createdAt' | 'outcome'>,
): Promise<string | null> {
  if (searchRun.status === 'running') return null
  const now = performance.now()
  Object.assign(searchRun, {
    status: 'running',
    label: 'Starting OpenMS...',
    file: -1,
    fileCount: request.files.length,
    fraction: 0,
    movedAt: now,
    startedAt: now,
    error: null,
    reload: false,
  })
  const onProgress = (p: SearchProgress) => {
    if (searchRun.status !== 'running') return
    searchRun.label = p.label
    searchRun.file = p.file
    if (p.fraction > searchRun.fraction) {
      searchRun.fraction = p.fraction
      searchRun.movedAt = performance.now()
    }
  }
  cancelBeforeSearch = false
  try {
    await startEngine()
    if (cancelBeforeSearch) throw new EngineError('cancelled', 'The search was cancelled.')
    searchRun.label = 'Reading the files...'
    const outcome = await engineClient().search(request, onProgress)
    const id = newId()
    open = { ...meta, id, createdAt: new Date().toISOString(), outcome }
    searchRun.status = 'done'
    return id
  } catch (e) {
    if (e instanceof EngineError && e.kind === 'cancelled') {
      searchRun.status = 'cancelled'
      return null
    }
    const message = String((e as Error)?.message ?? e)
    Object.assign(searchRun, { status: 'failed', error: message, reload: message.includes(RELOAD) })
    return null
  }
}

/** Cancels the running search (the engine ends its worker and starts a new one). */
export function cancelSearch(): void {
  if (searchRun.status !== 'running') return
  cancelBeforeSearch = true
  engineClient().cancel()
}

/** Forgets a finished search's error or cancellation (e.g. when the form changes). */
export function clearRunMessage(): void {
  if (searchRun.status === 'failed' || searchRun.status === 'cancelled') {
    Object.assign(searchRun, { status: 'idle', error: null, reload: false })
  }
}
