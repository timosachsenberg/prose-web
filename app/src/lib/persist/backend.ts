// Where History keeps its searches in the browser: the metadata of a record in IndexedDB (through
// idb-keyval) and its arrays as one file in the origin-private file system (OPFS). The two are behind
// one small interface so that the logic of History (history.ts) can be tested without a browser.

import { createStore, del, get, set, values, type UseStore } from 'idb-keyval'
import type { HistoryEntry, Manifest } from './record'

/** What IndexedDB holds of a stored search. */
export type StoredMeta = {
  id: string
  /** The stored file of its arrays (by its key; absent: the id). A save over an entry writes a new file. */
  file?: string
  /** The record without its arrays (its name is the one History shows). */
  manifest: Manifest
  /** Where each array starts in the stored file. */
  layout: Record<string, number>
  /** The size of the stored file. */
  bytes: number
  /** For the list: the searched files and the PSMs of the key figure. */
  files: HistoryEntry['files']
  psms: number
}

/** A stored file that is read in ranges. */
export type StoredBlob = {
  size: number
  read(start: number, end: number): Promise<Uint8Array>
}

export type Quota = { usage: number; quota: number }

/** A file in History's directory. */
export type StoredFile = {
  name: string
  /** The key of a file of arrays (`<key>.bin`); null for anything else (a leftover `.crswap` of a cut-short write). */
  key: string | null
  /** When it was last written (ms since 1970). */
  modified: number
}

export interface HistoryBackend {
  getMeta(id: string): Promise<StoredMeta | undefined>
  putMeta(meta: StoredMeta): Promise<void>
  deleteMeta(id: string): Promise<void>
  listMeta(): Promise<StoredMeta[]>
  /** Stores the parts, one after the other, as the file of `key` (replacing it). All or nothing. */
  writeBlob(key: string, parts: Uint8Array[]): Promise<void>
  openBlob(key: string): Promise<StoredBlob | null>
  deleteBlob(key: string): Promise<void>
  listFiles(): Promise<StoredFile[]>
  /** Removes a file by its name (see `listFiles`). */
  deleteFile(name: string): Promise<void>
  /** The browser's estimate of the storage in use and available, or null if it gives none. */
  estimate(): Promise<Quota | null>
  /**
   * Whether the browser keeps the storage when space runs low; with `request`, asks it to (the
   * browser may decide without asking the user).
   */
  persistence(request: boolean): Promise<'granted' | 'denied' | 'unavailable'>
}

/** The browser cannot keep History (no IndexedDB, no OPFS, or a private window that refuses both). */
export class HistoryUnavailableError extends Error {
  constructor(reason: string) {
    super(`History is not available in this browser: ${reason}`)
    this.name = 'HistoryUnavailableError'
  }
}

/** Written to a file in pieces of this size, so that the browser never copies a whole 150 MB array at once. */
const WRITE_PIECE = 8 << 20

const DIRECTORY = 'prose-history'
const fileName = (key: string) => `${encodeURIComponent(key)}.bin`

/** The key of a file name of `fileName`, or null. */
function keyOf(name: string): string | null {
  if (!name.endsWith('.bin')) return null
  try {
    return decodeURIComponent(name.slice(0, -4))
  } catch {
    return null
  }
}

/** The backend of the browser: idb-keyval for the metadata, OPFS for the arrays. Throws `HistoryUnavailableError`. */
export async function browserBackend(): Promise<HistoryBackend> {
  if (typeof indexedDB === 'undefined') throw new HistoryUnavailableError('there is no IndexedDB.')
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
    throw new HistoryUnavailableError('there is no origin-private file system (OPFS).')
  }
  if (typeof FileSystemFileHandle === 'undefined' || !('createWritable' in FileSystemFileHandle.prototype)) {
    throw new HistoryUnavailableError('its origin-private file system cannot be written in streams.')
  }
  let directory: FileSystemDirectoryHandle
  let store: UseStore
  try {
    directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(DIRECTORY, { create: true })
    store = createStore('prose-history', 'searches')
    await get('probe', store) // opens the database: a private window may refuse here
  } catch (e) {
    throw new HistoryUnavailableError(`the browser refuses to open its storage (${String((e as Error)?.message ?? e)}).`)
  }

  async function removeFile(name: string): Promise<void> {
    try {
      await directory.removeEntry(name)
    } catch (e) {
      if ((e as DOMException)?.name !== 'NotFoundError') throw e
    }
  }

  return {
    getMeta: (id) => get<StoredMeta>(id, store),
    putMeta: (meta) => set(meta.id, meta, store),
    deleteMeta: (id) => del(id, store),
    listMeta: () => values<StoredMeta>(store),

    async writeBlob(key, parts) {
      const handle = await directory.getFileHandle(fileName(key), { create: true })
      const writable = await handle.createWritable()
      try {
        for (const part of parts) {
          for (let at = 0; at < part.length; at += WRITE_PIECE) {
            await writable.write(part.subarray(at, at + WRITE_PIECE) as BufferSource)
          }
        }
        await writable.close()
      } catch (e) {
        await writable.abort().catch(() => {})
        throw e
      }
    },

    async openBlob(key) {
      try {
        const file = await (await directory.getFileHandle(fileName(key))).getFile()
        return {
          size: file.size,
          read: async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()),
        }
      } catch (e) {
        if ((e as DOMException)?.name === 'NotFoundError') return null
        throw e
      }
    },

    deleteBlob: (key) => removeFile(fileName(key)),
    deleteFile: (name) => removeFile(name),

    async listFiles() {
      const files: StoredFile[] = []
      for await (const name of (directory as unknown as { keys(): AsyncIterable<string> }).keys()) {
        let modified = Date.now()
        try {
          modified = (await (await directory.getFileHandle(name)).getFile()).lastModified
        } catch {
          // (gone meanwhile, or not readable: counts as new, so that a cleanup leaves it alone)
        }
        files.push({ name, key: keyOf(name), modified })
      }
      return files
    },

    async estimate() {
      try {
        const { usage, quota } = await navigator.storage.estimate()
        return usage === undefined || quota === undefined ? null : { usage, quota }
      } catch {
        return null
      }
    },

    async persistence(request) {
      if (typeof navigator.storage.persisted !== 'function') return 'unavailable'
      try {
        const kept = (await navigator.storage.persisted()) || (request && (await navigator.storage.persist()))
        return kept ? 'granted' : 'denied'
      } catch {
        return 'unavailable'
      }
    },
  }
}
