// The `.prose` project file: a zip with `manifest.json` (the record without its arrays) and one `.bin`
// per array (see record.ts). Any zip tool opens it.
//
// A record can be hundreds of MB (150,000 PSMs and their spectra), so the file is made and read without
// a second copy of the record, and without blocking the page for long:
// - Writing goes array by array straight from the record's own memory into the parts of a Blob. An array
//   that deflate barely shrinks (the float32 peaks: to about 90 %) is stored as it is; the others are
//   deflated (in the browser with the native CompressionStream, which Chromium runs on the main thread, so
//   it is fed in small slices with pauses between).
// - Reading takes a Blob entry by entry from its central directory, each entry inflated (DecompressionStream,
//   in slices) into its final array and checksummed in slices, with pauses between.
//
// The zip container is written here and not by fflate's streaming `Zip`/`ZipDeflate`: fflate's streaming
// `Deflate` (0.8.2 and 0.8.3) sometimes writes an invalid stream when the data begins with zero bytes
// (about 1 in 10 to 20 random columns of small integers or floats; see "C11 zip container" in
// docs/prose-app-spec/decisions.md). fflate's non-streaming `deflateSync` is not affected (0 in 2,800
// trials) and is what the synchronous path, the small arrays and the browsers without CompressionStream use.

import { deflateSync, Inflate, inflateSync, strToU8 } from 'fflate'
import { crc32 } from './crc32'
import {
  arrayRefs,
  checkManifest,
  manifestFromJson,
  manifestToJson,
  packRecord,
  packRecordSliced,
  ProjectError,
  unpackRecord,
  unpackRecordSliced,
  type Manifest,
  type PackedArray,
  type SearchRecord,
} from './record'

const MANIFEST = 'manifest.json'

/**
 * Arrays are checksummed and fed to the compressor in slices of this size, which bounds how long the page
 * is blocked (1 MB slices: 25 stalls of up to 480 ms while exporting 166 MB; 256 KB: 2 stalls).
 */
const SLICE = 256 << 10

/**
 * The deflate level of `deflateSync` (CompressionStream has no levels). Measured on 150,000 PSMs with
 * their spectra: levels 1 to 6 give the same size (float32 peaks 91 %, the other columns 47 %), level 1
 * is the quickest (the other columns: 0.7 s against 1.1 s at level 6).
 */
const ARRAY_LEVEL = 1

/**
 * An array is deflated only if deflate shrinks it to this share of its size or less, judged on its first
 * `SAMPLE` bytes (deflated in ~10 ms); else it is stored (zip method 0). The float32 peaks shrink only to
 * about 88–91 %: deflating them took most of the time of saving a large project (and inflating them
 * most of the time of opening it) for a tenth of their size.
 */
export const DEFLATE_GAIN = 0.85
const SAMPLE = 256 << 10


export type ProjectProgress = {
  /** Called with the share (0–1) of the project written or read so far, a few times per second. */
  onProgress?: (fraction: number) => void
}
export type ProjectWriteOptions = ProjectProgress

// ---------------------------------------------------------------------------------------------------
// The zip container

const u16le = (v: number) => [v & 0xff, (v >>> 8) & 0xff]
const u32le = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]

/** A part of the output: bytes, or a Blob that the browser keeps outside the JavaScript heap. */
type Part = Uint8Array | Blob

/** MS-DOS time and date of a zip entry, in local time (the format's convention, as zip tools show it). */
function dosTime(date: Date): { time: number; date: number } {
  const d = Number.isNaN(date.getTime()) || date.getFullYear() < 1980 ? new Date(1980, 0, 1) : date
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** Collects the entries of a zip file: local headers and data first, the central directory at the end. */
class ZipBuilder {
  readonly parts: Part[] = []
  #offset = 0
  readonly #central: number[][] = []
  readonly #stamp: { time: number; date: number }

  constructor(modified: Date) {
    this.#stamp = dosTime(modified)
  }

  /** Adds an entry whose data is already compressed (method 8) or stored (method 0). */
  add(name: string, method: 0 | 8, crc: number, size: number, packed: Part[], packedSize: number): void {
    const nameBytes = strToU8(name)
    const { time, date } = this.#stamp
    const flags = 0x0800 // UTF-8 names
    const shared = [...u16le(method), ...u16le(time), ...u16le(date), ...u32le(crc), ...u32le(packedSize), ...u32le(size), ...u16le(nameBytes.length), ...u16le(0)]
    this.parts.push(Uint8Array.from([...u32le(0x04034b50), ...u16le(20), ...u16le(flags), ...shared]), nameBytes, ...packed)
    this.#central.push([
      ...u32le(0x02014b50), ...u16le(20), ...u16le(20), ...u16le(flags), ...shared,
      ...u16le(0), ...u16le(0), ...u16le(0), ...u32le(0), ...u32le(this.#offset), ...nameBytes,
    ])
    this.#offset += 30 + nameBytes.length + packedSize
    if (this.#offset > 0xfffffffe || this.#central.length > 0xfffe) throw new Error('The project is too large for the zip format')
  }

  /** The central directory and the end record: call once, after the last entry. */
  finish(): Part[] {
    const directory = Uint8Array.from(this.#central.flat())
    const end = Uint8Array.from([
      ...u32le(0x06054b50), ...u16le(0), ...u16le(0), ...u16le(this.#central.length), ...u16le(this.#central.length),
      ...u32le(directory.length), ...u32le(this.#offset), ...u16le(0),
    ])
    return [...this.parts, directory, end]
  }
}

// ---------------------------------------------------------------------------------------------------
// Writing

/** The entries of the project: the manifest, then each array (views on the record's memory). */
function entriesOf({ manifest, arrays }: { manifest: Manifest; arrays: PackedArray[] }): { name: string; bytes: Uint8Array }[] {
  return [{ name: MANIFEST, bytes: strToU8(manifestToJson(manifest)) }, ...arrays]
}

const modifiedOf = (record: SearchRecord) => new Date(record.createdAt)

/** Whether deflating `size` bytes to `packedSize` is worth it (see `DEFLATE_GAIN`). */
const gains = (packedSize: number, size: number) => packedSize <= DEFLATE_GAIN * size

/** Whether deflating `bytes` pays (judged on its first `SAMPLE` bytes). */
function worthDeflating(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, SAMPLE)
  return gains(deflateSync(sample, { level: ARRAY_LEVEL }).length, sample.length)
}

/** An array deflated if that pays, else stored, in one go. */
function chooseSync(bytes: Uint8Array): { method: 0 | 8; packed: Uint8Array } {
  if (bytes.length > SAMPLE && !worthDeflating(bytes)) return { method: 0, packed: bytes }
  const deflated = deflateSync(bytes, { level: ARRAY_LEVEL })
  return gains(deflated.length, bytes.length) ? { method: 8, packed: deflated } : { method: 0, packed: bytes }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/**
 * The project file as bytes in one piece, for tests and small records. A large record goes through
 * `writeProjectBlob`, which never holds the file in one piece.
 */
export function writeProject(record: SearchRecord): Uint8Array {
  const zip = new ZipBuilder(modifiedOf(record))
  for (const { name, bytes } of entriesOf(packRecord(record))) {
    const { method, packed } = chooseSync(bytes)
    zip.add(name, method, crc32(bytes), bytes.length, [packed], packed.length)
  }
  return concat(zip.finish() as Uint8Array[])
}

/** Lets the page paint and answer input: `scheduler.yield()` where there is one. */
const pause = (): Promise<void> => {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  return scheduler?.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Pauses (and reports the progress) whenever the page has had the thread for 30 ms: `add(n)` counts `n`
 * bytes of `total` as done.
 */
function pacer(total: number, onProgress?: (fraction: number) => void) {
  let done = 0
  let last = performance.now()
  const breathe = async () => {
    if (performance.now() - last > 30) {
      if (total > 0) onProgress?.(Math.min(1, done / total))
      await pause()
      last = performance.now()
    }
  }
  return {
    breathe,
    async add(n: number) {
      done += n
      await breathe()
    },
    set total(n: number) {
      total = n
    },
  }
}

/** The CRC-32 of `bytes`, slice by slice with `add` (see `pacer`) after each. */
async function crc32Sliced(bytes: Uint8Array, add: (n: number) => Promise<void>): Promise<number> {
  let crc = 0
  for (let at = 0; at < bytes.length; at += SLICE) {
    const end = Math.min(at + SLICE, bytes.length)
    crc = crc32(bytes.subarray(at, end), crc)
    await add(end - at)
  }
  return crc
}

/** The deflate of `bytes` through the browser's CompressionStream: the compressed chunks and their total size. */
async function deflateNative(bytes: Uint8Array, onSlice: (bytes: number) => Promise<void>): Promise<{ chunks: Uint8Array[]; size: number }> {
  const stream = new CompressionStream('deflate-raw')
  const chunks: Uint8Array[] = []
  let size = 0
  const reading = (async () => {
    const reader = stream.readable.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      chunks.push(value)
      size += value.length
    }
  })()
  const writer = stream.writable.getWriter()
  try {
    for (let at = 0; at < bytes.length; at += SLICE) {
      const end = Math.min(at + SLICE, bytes.length)
      await writer.write(bytes.subarray(at, end) as BufferSource)
      await onSlice(end - at)
    }
    await writer.close()
  } catch (e) {
    await writer.abort(e).catch(() => {})
    await reading.catch(() => {})
    throw e
  }
  await reading
  return { chunks, size }
}

/** Tests switch these off to exercise the fallbacks of browsers without CompressionStream / DecompressionStream. */
export const compression = {
  native: typeof CompressionStream !== 'undefined',
  nativeInflate: typeof DecompressionStream !== 'undefined',
  /** Entries up to this size (compressed) are inflated at once (~10 ms per MB), larger ones in slices. */
  inflateAtOnce: 1 << 20,
}

/** Pieces of this size are copied into a Blob at a time (a copy of 70 MB at once stalls the page for half a second). */
const BLOB_PIECE = 4 << 20

/** `pieces` as one Blob, copied into the browser's blob storage `BLOB_PIECE` at a time with `breathe` in between. */
async function blobOf(pieces: Uint8Array[], breathe: () => Promise<void>): Promise<Blob> {
  const blobs: Blob[] = []
  let batch: Uint8Array[] = []
  let size = 0
  const flush = async () => {
    if (batch.length === 0) return
    blobs.push(new Blob(batch as BlobPart[]))
    batch = []
    size = 0
    await breathe()
  }
  for (const piece of pieces) {
    for (let at = 0; at < piece.length; at += BLOB_PIECE) {
      const part = piece.subarray(at, at + BLOB_PIECE)
      batch.push(part)
      size += part.length
      if (size >= BLOB_PIECE) await flush()
    }
  }
  await flush()
  return new Blob(blobs) // (by reference: no copy)
}

/**
 * The project file as a Blob, written array by array with pauses in between so that the page stays
 * responsive. Each array goes into a Blob of its own at once, so that the JavaScript heap holds only
 * the array being compressed. Progress: the checksum is the first half of each array, storing or
 * compressing it the second.
 */
export async function writeProjectBlob(record: SearchRecord, options: ProjectWriteOptions = {}): Promise<Blob> {
  const zip = new ZipBuilder(modifiedOf(record))
  const pace = pacer(0, options.onProgress)
  const entries = entriesOf(await packRecordSliced(record, pace.breathe))
  pace.total = 2 * entries.reduce((n, e) => n + e.bytes.length, 0)

  for (const { name, bytes } of entries) {
    if (bytes.length === 0) {
      zip.add(name, 0, 0, 0, [], 0)
      continue
    }
    const crc = await crc32Sliced(bytes, pace.add)
    if (bytes.length <= SAMPLE || !worthDeflating(bytes)) {
      // small (one deflate of at most `SAMPLE`) or not worth deflating
      const { method, packed } = bytes.length <= SAMPLE ? chooseSync(bytes) : { method: 0 as const, packed: bytes }
      zip.add(name, method, crc, bytes.length, [await blobOf([packed], pace.breathe)], packed.length)
      await pace.add(bytes.length)
    } else if (compression.native) {
      const { chunks, size } = await deflateNative(bytes, pace.add)
      if (gains(size, bytes.length)) zip.add(name, 8, crc, bytes.length, [await blobOf(chunks, pace.breathe)], size)
      else zip.add(name, 0, crc, bytes.length, [await blobOf([bytes], pace.breathe)], bytes.length)
    } else {
      await pause() // (one array is compressed in one go: let the page paint before it)
      const { method, packed } = chooseSync(bytes)
      zip.add(name, method, crc, bytes.length, [await blobOf([packed], pace.breathe)], packed.length)
      await pace.add(bytes.length)
    }
  }
  options.onProgress?.(1)
  return new Blob(zip.finish() as BlobPart[], { type: 'application/zip' })
}

/** A file name for a project: the record's name with characters that file systems object to replaced, plus ".prose". */
export function projectFileName(name: string): string {
  const stem = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^[\s.]+|[\s.]+$/g, '')
  return `${stem.slice(0, 120) || 'prose-results'}.prose`
}

// ---------------------------------------------------------------------------------------------------
// Reading

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

type Entry = { method: number; crc: number; compressed: number; size: number; offset: number }

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8)
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0

const notZip = () => new ProjectError('This is not a ProSE project: the file is not a zip archive (or it is cut short).')

/** A byte range to read: [start, end). */
type Range = [number, number]

/**
 * What reading asks its source for: a byte range, or the data of an entry (at `start`, after its local
 * header), inflated and checked against its size and CRC; `total` announces the bytes of all the
 * entries that will be asked for (for the progress).
 */
type Step = { range: Range } | { name: string; entry: Entry; start: number } | { total: number }

const damaged = (name: string, what: string) => new ProjectError(`${name} is damaged: ${what}.`)

/** Checks the data of an entry against its size and CRC (`crc`: computed by the caller). */
function checkEntry(name: string, entry: Entry, bytes: Uint8Array, crc: number): void {
  if (bytes.length !== entry.size) throw damaged(name, `it has ${bytes.length} bytes, not ${entry.size}`)
  if (crc !== entry.crc) throw damaged(name, 'its checksum does not match')
}

function unsupported(name: string, entry: Entry): ProjectError {
  return new ProjectError(`${name} uses compression method ${entry.method}, which ProSE does not read.`)
}

/**
 * Reads a project from a source of `size` bytes: the generator asks for what it needs (`Step`) and gets
 * the bytes back, so the same code reads a byte array at once and a Blob piece by piece.
 */
function* readSteps(size: number): Generator<Step, { manifest: Manifest; bytes: Map<string, Uint8Array> }, Uint8Array> {
  if (size < 22) throw notZip()
  // the end-of-central-directory record is in the last 22 + 65,535 bytes
  const tailStart = Math.max(0, size - 22 - 0xffff)
  const tail: Uint8Array = yield { range: [tailStart, size] }
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw notZip()
  const count = u16(tail, eocd + 10)
  const directorySize = u32(tail, eocd + 12)
  const directoryAt = u32(tail, eocd + 16)
  if (count === 0xffff || directorySize === 0xffffffff || directoryAt === 0xffffffff) {
    throw new ProjectError('This project file uses the zip64 format, which ProSE does not read.')
  }
  if (directoryAt + directorySize > size) throw notZip()

  const directory: Uint8Array = yield { range: [directoryAt, directoryAt + directorySize] }
  const entries = new Map<string, Entry>()
  const decoder = new TextDecoder()
  let at = 0
  for (let i = 0; i < count; i++) {
    if (at + 46 > directory.length || u32(directory, at) !== CENTRAL) throw notZip()
    const flags = u16(directory, at + 8)
    const nameLength = u16(directory, at + 28)
    const skip = nameLength + u16(directory, at + 30) + u16(directory, at + 32)
    const name = decoder.decode(directory.subarray(at + 46, at + 46 + nameLength))
    if (flags & 1) throw new ProjectError('This project file is encrypted; ProSE cannot read it.')
    entries.set(name, {
      method: u16(directory, at + 10),
      crc: u32(directory, at + 16),
      compressed: u32(directory, at + 20),
      size: u32(directory, at + 24),
      offset: u32(directory, at + 42),
    })
    at += 46 + skip
  }

  /** The data of an entry, inflated into a buffer of exactly its size and checked against its CRC. */
  const read = function* (name: string, entry: Entry): Generator<Step, Uint8Array, Uint8Array> {
    const header: Uint8Array = yield { range: [entry.offset, entry.offset + 30] }
    if (header.length < 30 || u32(header, 0) !== LOCAL) throw damaged(name, 'its header is missing')
    const start = entry.offset + 30 + u16(header, 26) + u16(header, 28)
    if (start + entry.compressed > size) throw damaged(name, 'the file ends inside it')
    if (entry.method !== 0 && entry.method !== 8) throw unsupported(name, entry)
    return yield { name, entry, start }
  }

  const manifestEntry = entries.get(MANIFEST)
  if (!manifestEntry) throw new ProjectError('This is not a ProSE project: the zip archive has no manifest.json.')
  // the manifest first: a project of a newer version is refused before anything else is read
  const manifest = checkManifest(manifestFromJson(decoder.decode(yield* read(MANIFEST, manifestEntry))))

  const refs = arrayRefs(manifest)
  for (const { name, byteLength } of refs) {
    const entry = entries.get(name)
    if (!entry) throw new ProjectError(`${name} is missing from the project file.`)
    if (entry.size !== byteLength) {
      throw new ProjectError(`${name} has ${entry.size} bytes, but the manifest describes ${byteLength}.`)
    }
  }
  yield { total: refs.reduce((n, r) => n + r.byteLength, 0) }
  const bytes = new Map<string, Uint8Array>()
  for (const { name } of refs) bytes.set(name, yield* read(name, entries.get(name)!))
  return { manifest, bytes }
}

const bytesIn = (bytes: Map<string, Uint8Array>) => (name: string) => bytes.get(name) ?? new Uint8Array(0)

/** Anything that goes wrong while reading is a ProjectError that says what. */
function readFailure(e: unknown): ProjectError {
  if (e instanceof ProjectError) return e
  return new ProjectError(`The project file could not be read (${String((e as Error)?.message ?? e)}).`)
}

/** Inflates `packed` at once. */
function inflateAtOnce(name: string, packed: Uint8Array, size: number): Uint8Array {
  try {
    return inflateSync(packed, { out: new Uint8Array(size) })
  } catch {
    throw damaged(name, 'its data cannot be decompressed')
  }
}

/** The data of an entry from a byte array, at once. */
function entryOf(input: Uint8Array, name: string, entry: Entry, start: number): Uint8Array {
  const packed = input.subarray(start, start + entry.compressed)
  // (stored data is copied unless it starts the buffer: the record's arrays must not share the file's memory unaligned)
  const bytes = entry.method === 0 ? (packed.byteOffset === 0 ? packed : packed.slice()) : inflateAtOnce(name, packed, entry.size)
  checkEntry(name, entry, bytes, crc32(bytes))
  return bytes
}

/**
 * Inflates `packed` into `size` bytes in slices: through the browser's DecompressionStream, else
 * through fflate's streaming Inflate. `add` is called with the input consumed (see `pacer`).
 */
async function inflateSliced(name: string, packed: Uint8Array, size: number, add: (n: number) => Promise<void>): Promise<Uint8Array> {
  const out = new Uint8Array(size)
  let filled = 0
  const take = (chunk: Uint8Array) => {
    if (filled + chunk.length > size) throw damaged(name, `it has more than ${size} bytes`)
    out.set(chunk, filled)
    filled += chunk.length
  }
  try {
    if (compression.nativeInflate) {
      const stream = new DecompressionStream('deflate-raw')
      const reading = (async () => {
        const reader = stream.readable.getReader()
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) return
            take(value)
          }
        } catch (e) {
          await reader.cancel(e).catch(() => {}) // (errors the writing side too, which would wait otherwise)
          throw e
        }
      })()
      const writer = stream.writable.getWriter()
      try {
        for (let at = 0; at < packed.length; at += SLICE) {
          const end = Math.min(at + SLICE, packed.length)
          await writer.write(packed.subarray(at, end) as BufferSource)
          await add(end - at)
        }
        await writer.close()
      } catch (e) {
        await writer.abort(e).catch(() => {})
        await reading.catch(() => {})
        throw e
      }
      await reading
    } else {
      const inflate = new Inflate((chunk) => take(chunk))
      for (let at = 0; at < packed.length; at += SLICE) {
        const end = Math.min(at + SLICE, packed.length)
        inflate.push(packed.subarray(at, end), end === packed.length)
        await add(end - at)
      }
    }
  } catch (e) {
    if (e instanceof ProjectError) throw e
    throw damaged(name, 'its data cannot be decompressed')
  }
  return filled === size ? out : out.subarray(0, filled)
}

/** The data of an entry from a Blob: read at once, inflated and checksummed in slices with pauses. */
async function entryOfBlob(
  input: Blob,
  name: string,
  entry: Entry,
  start: number,
  pace: ReturnType<typeof pacer>,
): Promise<Uint8Array> {
  const packed = entry.compressed === 0 ? new Uint8Array(0) : new Uint8Array(await input.slice(start, start + entry.compressed).arrayBuffer())
  let bytes: Uint8Array
  if (entry.method === 0) bytes = packed
  else if (packed.length <= compression.inflateAtOnce) bytes = inflateAtOnce(name, packed, entry.size)
  else bytes = await inflateSliced(name, packed, entry.size, async () => pace.breathe())
  checkEntry(name, entry, bytes, await crc32Sliced(bytes, pace.add))
  await pace.breathe()
  return bytes
}

/**
 * The record of a project file. Throws `ProjectVersionError` for a file of a newer version and a
 * `ProjectError` for anything else that is wrong with it. A byte array is read at once; a Blob
 * (a `File` the user chose) piece by piece with pauses (the page is not blocked much over 30 ms at a
 * time), and the call returns a promise.
 */
export function readProject(input: Uint8Array): SearchRecord
export function readProject(input: Blob, options?: ProjectProgress): Promise<SearchRecord>
export function readProject(input: Uint8Array | Blob, options: ProjectProgress = {}): SearchRecord | Promise<SearchRecord> {
  if (input instanceof Uint8Array) {
    try {
      const steps = readSteps(input.length)
      let next = steps.next()
      while (!next.done) {
        const step = next.value
        if ('range' in step) next = steps.next(input.subarray(step.range[0], step.range[1]))
        else if ('total' in step) next = steps.next(new Uint8Array(0))
        else next = steps.next(entryOf(input, step.name, step.entry, step.start))
      }
      return unpackRecord(next.value.manifest, bytesIn(next.value.bytes))
    } catch (e) {
      throw readFailure(e)
    }
  }
  return (async () => {
    try {
      const pace = pacer(0, options.onProgress)
      const steps = readSteps(input.size)
      let next = steps.next()
      while (!next.done) {
        const step = next.value
        if ('range' in step) next = steps.next(new Uint8Array(await input.slice(step.range[0], step.range[1]).arrayBuffer()))
        else if ('total' in step) {
          pace.total = step.total
          next = steps.next(new Uint8Array(0))
        } else next = steps.next(await entryOfBlob(input, step.name, step.entry, step.start, pace))
      }
      const record = await unpackRecordSliced(next.value.manifest, bytesIn(next.value.bytes), pace.breathe)
      options.onProgress?.(1)
      await pause() // (what opens the record next starts in a task of its own)
      return record
    } catch (e) {
      throw readFailure(e)
    }
  })()
}
