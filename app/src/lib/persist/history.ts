// History: finished searches kept in the browser. The metadata (settings, design, summary, the list
// fields) goes to IndexedDB, the arrays (result tables, stored spectra) to one OPFS file per search.
// A search is listed only once both are written: the file first, the metadata last.
//
// Saves, deletes, renames and the cleanup of leftover files take turns, also across the tabs of the app
// (a Web Lock), so that a cleanup never sees a file whose metadata another tab is about to write.

import { formatBytes } from '../format/bytes'
import { browserBackend, type HistoryBackend, type Quota, type StoredFile, type StoredMeta } from './backend'
import {
  arrayRefs,
  checkManifest,
  entryOf,
  packRecord,
  ProjectError,
  unpackRecord,
  type HistoryEntry,
  type SearchRecord,
} from './record'

let backend: HistoryBackend | null = null
let opening: Promise<HistoryBackend> | null = null

/** The backend History uses (the browser's, opened on first use). Throws `HistoryUnavailableError`. */
async function store(): Promise<HistoryBackend> {
  if (backend) return backend
  opening ??= browserBackend().then(
    (b) => (backend = b),
    (e) => {
      opening = null // try again next time
      throw e
    },
  )
  return opening
}

/** Replaces the backend (tests); null goes back to the browser's. */
export function useBackend(next: HistoryBackend | null): void {
  backend = next
  opening = null
}

/** The record does not fit in the free storage: it is not saved. */
export class HistoryFullError extends Error {
  readonly needed: number
  readonly free: number
  constructor(needed: number, free: number) {
    super(`not saved to History: needs ${formatBytes(needed)}, ${formatBytes(free)} free`)
    this.name = 'HistoryFullError'
    this.needed = needed
    this.free = free
  }
}

/** The room the manifest takes besides the arrays, and a margin for the browser's own accounting. */
const SLACK = 1 << 20

/** The name of the Web Lock that the writers of History take. */
export const HISTORY_LOCK = 'prose-history'

/** The turn of this tab where the browser has no Web Locks. */
let turn: Promise<unknown> = Promise.resolve()

/**
 * Runs `work` when no other save, delete, rename or cleanup runs: across tabs with the Web Lock
 * `HISTORY_LOCK`, else (a browser without `navigator.locks`) within this tab.
 */
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { locks?: LockManager }).locks
  if (typeof locks?.request === 'function') return locks.request(HISTORY_LOCK, () => work()) as Promise<T>
  const run = turn.then(work, work)
  turn = run.catch(() => {})
  return run
}

/** The file of a stored search's arrays. */
const fileOf = (meta: StoredMeta) => meta.file ?? meta.id

/**
 * Saves a finished search. Throws `HistoryFullError` if the browser's estimate says it does not fit
 * (nothing is written then), `HistoryUnavailableError` if the browser cannot keep History, and what
 * the browser throws (e.g. a QuotaExceededError) if writing fails; a failed write leaves nothing behind,
 * and a search saved before under the same id stays as it was (a save over it writes a new file).
 */
export async function saveSearch(record: SearchRecord): Promise<void> {
  const b = await store()
  const { manifest, arrays } = packRecord(record)
  const layout: Record<string, number> = {}
  let bytes = 0
  for (const array of arrays) {
    layout[array.name] = bytes
    bytes += array.bytes.length
  }

  await exclusive(async () => {
    const before = await b.getMeta(record.id)
    const quota = await b.estimate()
    if (quota) {
      // (a save over an entry writes the new file before it removes the old one, so that one is not free)
      const free = quota.quota - quota.usage
      if (bytes + SLACK > free) throw new HistoryFullError(bytes + SLACK, Math.max(0, free))
    }

    const file = before ? `${record.id}~${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` : record.id
    try {
      await b.writeBlob(file, arrays.map((a) => a.bytes))
      const { files, psms } = entryOf(record, bytes)
      await b.putMeta({ id: record.id, ...(file !== record.id ? { file } : {}), manifest, layout, bytes, files, psms })
    } catch (e) {
      await b.deleteBlob(file).catch(() => {})
      throw e
    }
    if (before && fileOf(before) !== file) await b.deleteBlob(fileOf(before)).catch(() => {})
  })
}

/** Whether an entry of the database is one History wrote (anything else is left out of the list). */
const isMeta = (m: unknown): m is StoredMeta =>
  typeof m === 'object' && m !== null && typeof (m as StoredMeta).id === 'string' &&
  typeof (m as StoredMeta).manifest === 'object' && (m as StoredMeta).manifest !== null && Array.isArray((m as StoredMeta).files)

const toEntry = (m: StoredMeta): HistoryEntry => ({
  id: m.id,
  name: m.manifest.name,
  createdAt: m.manifest.createdAt,
  summary: m.manifest.summary,
  files: m.files,
  psms: m.psms,
  bytes: m.bytes,
})

/** The stored searches, the latest first. */
export async function listSearches(): Promise<HistoryEntry[]> {
  const b = await store()
  return (await b.listMeta()).filter(isMeta).map(toEntry).sort((x, y) => (x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : 0))
}

/**
 * The stored search `id`, arrays and all. Throws a `ProjectError` if it is gone or damaged, a
 * `ProjectVersionError` if a newer version of ProSE saved it.
 */
export async function loadSearch(id: string): Promise<SearchRecord> {
  const b = await store()
  const meta = await b.getMeta(id)
  if (!meta) throw new ProjectError('This search is no longer in History.')
  const manifest = checkManifest(meta.manifest, 'search')
  const blob = await b.openBlob(fileOf(meta))
  if (!blob || blob.size !== meta.bytes) {
    throw new ProjectError(
      'The stored results of this search are missing or incomplete (the browser may have cleared its storage). Delete the entry.',
    )
  }
  const arrays = new Map<string, Uint8Array>()
  for (const { name, byteLength } of arrayRefs(manifest)) {
    const start = meta.layout[name]
    if (start === undefined) throw new ProjectError(`${name} is not in the stored results.`)
    arrays.set(name, await blob.read(start, start + byteLength))
  }
  return unpackRecord(manifest, (name) => arrays.get(name) ?? new Uint8Array(0))
}

/** Removes a search from History. */
export async function deleteSearch(id: string): Promise<void> {
  const b = await store()
  await exclusive(async () => {
    const meta = await b.getMeta(id)
    await b.deleteMeta(id) // first: a crash in between leaves a file nobody lists, which `pruneOrphans` removes
    await b.deleteBlob(meta ? fileOf(meta) : id)
  })
}

/** Renames a search. */
export async function renameSearch(id: string, name: string): Promise<void> {
  const b = await store()
  await exclusive(async () => {
    const meta = await b.getMeta(id)
    if (!meta) throw new ProjectError('This search is no longer in History.')
    await b.putMeta({ ...meta, manifest: { ...meta.manifest, name } })
  })
}

/**
 * A file that no search lists is removed only once it is this old: a browser without Web Locks could be
 * writing it in another tab right now (and a `.crswap` is the browser's own while a write runs).
 */
export const ORPHAN_AGE_MS = 5 * 60_000

/**
 * Removes the files that no search lists and that are older than `ORPHAN_AGE_MS`: the arrays of a save or a
 * delete that was cut short, and the browser's `.crswap` of a write that was. Returns how many.
 */
export async function pruneOrphans(): Promise<number> {
  const b = await store()
  return exclusive(async () => {
    const listed = new Set((await b.listMeta()).filter(isMeta).map(fileOf))
    const old = (f: StoredFile) => Date.now() - f.modified > ORPHAN_AGE_MS
    let removed = 0
    for (const f of await b.listFiles()) {
      if ((f.key === null || !listed.has(f.key)) && old(f)) {
        await b.deleteFile(f.name)
        removed++
      }
    }
    return removed
  })
}

/** The browser's estimate of its storage, or null. */
export async function storageEstimate(): Promise<Quota | null> {
  return (await store()).estimate()
}

/** Whether the browser keeps History when space runs low; `request` asks it to (see `HistoryBackend.persistence`). */
export async function persistence(request: boolean): Promise<'granted' | 'denied' | 'unavailable'> {
  return (await store()).persistence(request)
}
