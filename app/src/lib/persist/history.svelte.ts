// The state of History for the page: the stored searches, what became of the last save, and the actions
// of the views (open from History, open and save a project file, rename, delete). A finished search is
// saved here automatically; saving never breaks the results view, it only reports. The other tabs of the
// app hear of each change (a BroadcastChannel) and read the list again.

import { download } from '../download'
import { engineState } from '../engine/app-engine.svelte'
import { formatBytes } from '../format/bytes'
import { resultName } from '../results/display'
import { navigate } from '../route.svelte'
import { onSearchFinished, openResult, openStoredResult, type OpenResult } from '../search/session.svelte'
import { HistoryUnavailableError, type Quota } from './backend'
import {
  deleteSearch,
  HistoryFullError,
  listSearches,
  loadSearch,
  persistence as readPersistence,
  pruneOrphans,
  renameSearch,
  saveSearch,
  storageEstimate,
} from './history'
import { projectFileName, readProject, writeProjectBlob } from './project'
import { recordFromResult, resultFromRecord, type HistoryEntry, type SearchRecord } from './record'

export type Persistence = 'unknown' | 'granted' | 'denied' | 'unavailable'

/** What became of the save of a finished search. */
export type SaveStatus =
  | { id: string; state: 'saving' }
  | { id: string; state: 'saved' }
  | { id: string; state: 'unsaved'; message: string }

let entries = $state.raw<HistoryEntry[]>([])
let ready = $state(false)
let unavailable = $state<string | null>(null)
let status = $state<SaveStatus | null>(null)
let persistence = $state<Persistence>('unknown')
let quota = $state<Quota | null>(null)

export const history = {
  /** The stored searches, the latest first. */
  get entries(): HistoryEntry[] {
    return entries
  },
  /** The list has been read. */
  get ready(): boolean {
    return ready
  },
  /** Why the browser cannot keep History, or null. */
  get unavailable(): string | null {
    return unavailable
  },
  /** The last save of a finished search. */
  get save(): SaveStatus | null {
    return status
  },
  /** Whether the browser promised to keep History when space runs low (once the first search was saved). */
  get persistence(): Persistence {
    return persistence
  },
  /** The browser's estimate of its storage for this site. */
  get quota(): Quota | null {
    return quota
  },
}

const ASKED_KEY = 'prose-persistence-asked'

function asked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) !== null
  } catch {
    return false
  }
}

function markAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, '1')
  } catch {
    // (a private window: it asks again next time)
  }
}

const KEEP_AS_FILE = 'The results stay open here; Export › Project (.prose) keeps them as a file.'

/** What to tell the user about a save that did not happen. */
export function describeSaveFailure(error: unknown): string {
  if (error instanceof HistoryFullError) return `Not saved to History: needs ${formatBytes(error.needed)}, ${formatBytes(error.free)} free. ${KEEP_AS_FILE}`
  if (error instanceof HistoryUnavailableError) return `Not saved to History. ${error.message} ${KEEP_AS_FILE}`
  if ((error as DOMException)?.name === 'QuotaExceededError') return `Not saved to History: the browser's storage is full. ${KEEP_AS_FILE}`
  return `Not saved to History (${String((error as Error)?.message ?? error)}). ${KEEP_AS_FILE}`
}

/** The latest refresh: an older one that finishes later must not overwrite its list. */
let refreshes = 0

/** Reads the list of stored searches (and how much room is left). */
export async function refreshHistory(): Promise<void> {
  const refresh = ++refreshes
  try {
    const listed = await listSearches()
    const estimate = await storageEstimate()
    if (refresh !== refreshes) return
    entries = listed
    unavailable = null
    quota = estimate
  } catch (e) {
    if (refresh !== refreshes) return
    entries = []
    unavailable = e instanceof HistoryUnavailableError ? e.message : `History could not be read (${String((e as Error)?.message ?? e)}).`
  } finally {
    ready = true
  }
}

/**
 * The name of a result in History and in its project file: the one History has (it may have been
 * renamed since it was opened), else the one it was stored with, else the exports' (from its files).
 */
function nameOf(result: OpenResult): string {
  return entries.find((e) => e.id === result.id)?.name ?? result.stored?.name ?? resultName(result.design.rows.map((r) => r.fileName))
}

const CHANNEL = 'prose-history'
let channel: BroadcastChannel | null = null

/** Tells the other tabs that History changed. */
function announce(): void {
  channel?.postMessage('changed')
}

let queue: Promise<unknown> = Promise.resolve()

/**
 * Saves a search that finished in this session to History. Saves go one after the other; this never
 * rejects: the outcome is `history.save`.
 */
export function saveFinished(result: OpenResult): Promise<void> {
  const run = queue.then(async () => {
    status = { id: result.id, state: 'saving' }
    try {
      const record = recordFromResult(result, nameOf(result), engineState.info?.version ?? 'unknown')
      await saveSearch(record)
      status = { id: result.id, state: 'saved' }
      announce()
    } catch (e) {
      status = { id: result.id, state: 'unsaved', message: describeSaveFailure(e) }
      return
    }
    await refreshHistory()
    // once, after the first save: the browser may clear storage that is not persistent when space runs low
    if (!asked() && persistence === 'unknown') {
      markAsked()
      try {
        persistence = await readPersistence(true)
      } catch {
        persistence = 'unavailable'
      }
    }
  })
  queue = run.catch(() => {})
  return run
}

let started = false

/**
 * Starts History: saves the searches that finish, reads the list (again when another tab changes it),
 * and removes what a cut-short save left.
 */
export function initHistory(): void {
  if (started) return
  started = true
  onSearchFinished((result) => void saveFinished(result))
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = () => void refreshHistory()
    // (Node, in the tests: the channel must not keep the process running)
    ;(channel as BroadcastChannel & { unref?: () => void }).unref?.()
  }
  void (async () => {
    await refreshHistory()
    if (unavailable !== null) return
    try {
      await pruneOrphans()
      if (entries.length > 0 && asked()) persistence = await readPersistence(false)
    } catch {
      // (nothing to clean, or the browser says nothing about persistence)
    }
  })()
}

/** Shows `record` in Results (as `openStoredResult` does) and returns its id. */
export function openRecord(record: SearchRecord): string {
  const id = openStoredResult(resultFromRecord(record), { id: record.id, createdAt: record.createdAt })
  navigate({ view: 'results', id })
  return id
}

/** Opens a stored search in Results; the one already open is just shown. Throws a ProjectError if it cannot be read. */
export async function openFromHistory(id: string): Promise<void> {
  if (openResult.current?.id === id) {
    navigate({ view: 'results', id })
    return
  }
  openRecord(await loadSearch(id))
}

/** Reopens the search of an address (`#/results/<id>`) after a reload; false if History does not have it. */
export async function restoreFromHistory(id: string): Promise<boolean> {
  if (openResult.current?.id === id) return true
  if (!ready) await refreshHistory()
  if (!entries.some((e) => e.id === id)) return false
  const record = await loadSearch(id)
  openStoredResult(resultFromRecord(record), { id, createdAt: record.createdAt })
  return true
}

/**
 * Opens a `.prose` file in Results, read piece by piece with its progress (0–1). Throws a ProjectError
 * (a ProjectVersionError for a newer file) that says what is wrong.
 */
export async function openProjectFile(file: File, onProgress?: (fraction: number) => void): Promise<void> {
  openRecord(await readProject(file, { onProgress }))
}

/** Downloads `result` as `<name>.prose` (see `writeProjectBlob`). */
export async function saveProjectFile(result: OpenResult, onProgress?: (fraction: number) => void): Promise<void> {
  const record = recordFromResult(result, nameOf(result), engineState.info?.version ?? 'unknown')
  const blob = await writeProjectBlob(record, { onProgress })
  download(projectFileName(record.name), blob, 'application/zip')
}

export async function removeFromHistory(id: string): Promise<void> {
  await deleteSearch(id)
  announce()
  await refreshHistory()
}

/** Renames a stored search; an open result of it takes the name (Export › Project writes it, see `nameOf`). */
export async function rename(id: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (trimmed === '') return
  await renameSearch(id, trimmed)
  announce()
  await refreshHistory()
}

/** Forgets the notice about the last save. */
export function dismissSaveStatus(): void {
  status = null
}
