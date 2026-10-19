// A History backend in memory, for the tests (the browser's IndexedDB and OPFS are tested end to end).

import type { HistoryBackend, Quota, StoredMeta } from './backend'

export type MemoryBackend = HistoryBackend & {
  /** The bytes of the stored files by key. */
  blobs: Map<string, Uint8Array>
  /** When each file of `blobs` was written (absent: long ago). */
  modified: Map<string, number>
  /** Other files of the directory (a `.crswap` left by a cut-short write) and when they were written. */
  leftovers: Map<string, number>
  meta: Map<string, StoredMeta>
  /** What `estimate()` says (null: no estimate). */
  quota: Quota | null
  /** The time a file is written at (ms since 1970). */
  clock: () => number
  /** Called before a file is written; throw to make the write fail. */
  beforeWrite: (key: string) => void
  /** Called after `listMeta` has taken its snapshot and before it returns it (another tab may act then). */
  afterListMeta: () => Promise<void>
  persistAsked: number
  persistAnswer: 'granted' | 'denied' | 'unavailable'
}

export function memoryBackend(): MemoryBackend {
  const blobs = new Map<string, Uint8Array>()
  const modified = new Map<string, number>()
  const leftovers = new Map<string, number>()
  const meta = new Map<string, StoredMeta>()
  const backend: MemoryBackend = {
    blobs,
    modified,
    leftovers,
    meta,
    quota: { usage: 0, quota: 10 ** 12 },
    clock: () => Date.now(),
    beforeWrite: () => {},
    afterListMeta: async () => {},
    persistAsked: 0,
    persistAnswer: 'granted',
    // (structured clones, as IndexedDB stores them)
    getMeta: async (id) => (meta.has(id) ? structuredClone(meta.get(id)) : undefined),
    putMeta: async (m) => void meta.set(m.id, structuredClone(m)),
    deleteMeta: async (id) => void meta.delete(id),
    async listMeta() {
      const snapshot = [...meta.values()].map((m) => structuredClone(m))
      await backend.afterListMeta()
      return snapshot
    },
    async writeBlob(key, parts) {
      backend.beforeWrite(key)
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
      let at = 0
      for (const part of parts) {
        out.set(part, at)
        at += part.length
      }
      blobs.set(key, out)
      modified.set(key, backend.clock())
    },
    async openBlob(key) {
      const bytes = blobs.get(key)
      return bytes ? { size: bytes.length, read: async (start, end) => bytes.slice(start, end) } : null
    },
    async deleteBlob(key) {
      blobs.delete(key)
      modified.delete(key)
    },
    async listFiles() {
      return [
        ...[...blobs.keys()].map((key) => ({ name: `${key}.bin`, key, modified: modified.get(key) ?? 0 })),
        ...[...leftovers].map(([name, at]) => ({ name, key: null, modified: at })),
      ]
    },
    async deleteFile(name) {
      if (leftovers.delete(name)) return
      if (name.endsWith('.bin')) await backend.deleteBlob(name.slice(0, -4))
    },
    estimate: async () => backend.quota,
    async persistence(request) {
      if (request) backend.persistAsked++
      return backend.persistAnswer
    },
  }
  return backend
}
