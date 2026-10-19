// The memory estimate of the New search page. A search runs in one WebAssembly module, which can
// address 4 GB; a search that needs more stops it. The engine searches the files one at a time (file by
// file): only the file being searched is in the module, in a block of the largest file's size, but the
// heap still grows with every further file, the more, the more threads (mimalloc does not reuse what
// the searches of the files before freed). The formula follows the searches measured with the module
// (README-openms-wasm.md and part B's final review): about 0.25 GB for the module, the fragment index
// (0.08 GB per 1,000 proteins, tryptic), the file being searched and its spectra, the growth per further
// file, and PeptDeep's models. A chunked semi- or non-specific search is not estimated by the formula
// but by what it measured (`uncertain`).

import { isTooLarge } from '../engine/protocol'
import { GB, MB } from '../format/bytes'

export { GB }

/** What the module can address. */
export const LIMIT_BYTES = 4 * GB
/** Above this the footer warns. */
export const WARN_BYTES = 3 * GB
/** The module itself (code, static data, the first heap). */
export const MODULE_BYTES = 0.25 * GB
/** PeptDeep's models and their sessions. */
export const PEPTDEEP_BYTES = 0.6 * GB

/**
 * The heap growth of each further file at 4 threads, by the size of the files: measured 0.2 GB per
 * file for 12 copies of a 75 MB file, 0.07-0.12 GB per file for copies of a 733 MB one (more for the
 * first few files). Between the two linear, outside them constant.
 */
export const GROWTH_SMALL = { fileBytes: 75 * MB, bytes: 0.2 * GB }
export const GROWTH_LARGE = { fileBytes: 733 * MB, bytes: 0.09 * GB }
/** PeptDeep's growth per further file and per thread above 4 (12 × 75 MB: +0.3 GB at 4 threads, +1.0 GB at 8). */
export const PEPTDEEP_GROWTH_PER_THREAD = 10 * MB

/**
 * How the growth per file scales with the threads, relative to 4 threads: none with one thread (the heap
 * stayed flat over 12 files), linear up to 1 at 4, then 0.035 more per thread (1.14 at 8, 1.42 at 16).
 */
export function threadFactor(threads: number): number {
  if (threads <= 1) return 0
  if (threads <= 4) return (threads - 1) / 3
  return 1 + 0.035 * (threads - 4)
}

/** The heap growth of a further file of `fileBytes` at 4 threads (GROWTH_SMALL to GROWTH_LARGE). */
export function growthPerFile(fileBytes: number): number {
  const t = (fileBytes - GROWTH_SMALL.fileBytes) / (GROWTH_LARGE.fileBytes - GROWTH_SMALL.fileBytes)
  const at = Math.min(1, Math.max(0, t))
  return GROWTH_SMALL.bytes + (GROWTH_LARGE.bytes - GROWTH_SMALL.bytes) * at
}

/** The fragment index per protein and specificity, relative to a tryptic search. */
const SPECIFICITY_FACTOR = { full: 1, semi: 6, none: 30 } as const
const INDEX_BYTES_PER_PROTEIN = (0.08 * GB) / 1000

export type Specificity = keyof typeof SPECIFICITY_FACTOR

/**
 * What a chunked semi- or non-specific search (`uncertain`) shows instead of the formula: it builds the
 * index of every chunk again for every file, and the allocator reuses that memory poorly, so its heap
 * is set neither by the chunk nor by the inputs. Measured (human semi-tryptic in chunks of 2000, a 78 MB
 * mzML, Chromium, 4 threads, file by file): 2.3, 2.4 and 3.7 GB for one file in three runs, 3.8 GB for
 * three files (in each of three runs); the formula gives 1.4 and 1.8 GB.
 */
export const UNCERTAIN_BYTES = 3.8 * GB
export const UNCERTAIN_MEASURED = 'measured 2.3–3.8 GB'
/** From this many files on, a chunked semi- or non-specific search is `over` (three measured 3.8 GB of 4). */
export const UNCERTAIN_OVER_FILES = 3

/**
 * A chunked semi- or non-specific search: the database is searched in chunks (`chunkSize` below
 * `proteins`). `proteins` null (not counted yet): chunked whenever a chunk size is set.
 */
export function isUncertain(i: { proteins: number | null; specificity: Specificity; chunkSize?: number }): boolean {
  const chunked = i.chunkSize !== undefined && i.chunkSize > 0 && (i.proteins === null || i.chunkSize < i.proteins)
  return chunked && i.specificity !== 'full'
}

export type MemoryInput = {
  /** The largest mzML file: the file being searched is in a block of its size, and its spectra are read. */
  largestMzmlBytes: number
  /** How many mzML files (default 1). */
  files?: number
  /** All mzML files together (default: the largest × files): their mean size sets the growth per file. */
  mzmlBytes?: number
  /** The FASTA file, in the module for the whole search (default 0). */
  databaseBytes?: number
  /** The threads of the search (default 4; see `threadsForSearch`). */
  threads?: number
  /** Target proteins of the database (contaminants included, decoys not). */
  proteins: number
  specificity: Specificity
  variableMods: number
  peptdeep: boolean
  /** `database:chunk_size`: the index is built for at most this many proteins at a time; 0 = not chunked. */
  chunkSize?: number
}

export type MemoryLevel = 'ok' | 'warn' | 'over'

export type MemoryEstimate = {
  bytes: number
  level: MemoryLevel
  /** The fragment index of the database. */
  database: number
  /** The input files: the one being searched (with its spectra), the FASTA, and `growth`. */
  inputs: number
  /** The heap growth of the files after the first. */
  growth: number
  /** What dominates, and so what to change: the database (`database:chunk_size`) or the files (fewer at once). */
  cause: 'database' | 'inputs'
  /** A file is too large for the module's file system (MAX_FILE_BYTES): the engine refuses the search. */
  fileTooLarge: boolean
  /**
   * A chunked semi- or non-specific search (`isUncertain`): `bytes` is at least what such searches
   * measured (UNCERTAIN_BYTES; the formula gives far less), the level at least `warn`, and `over` from
   * three files on.
   */
  uncertain: boolean
}

/**
 * The memory a search needs:
 *
 * bytes = 0.25 GB + 0.08 GB per 1,000 proteins × (1 full, 6 semi, 30 none) × 1.5^max(0, variableMods − 1)
 *         + 2 × the largest mzML + the FASTA
 *         + (files − 1) × threadFactor(threads) × growthPerFile(mean mzML size)
 *         + (peptdeep ? 0.6 GB + (files − 1) × 10 MB × max(0, threads − 4) : 0)
 *
 * The inputs do not add up: the file being searched is in the module (in a block of the largest file's
 * size) and its spectra are read, the others are not there; each further file grows the heap (see
 * `growthPerFile`, `threadFactor`). For a chunked semi- or non-specific search (`uncertain`) bytes is at
 * least UNCERTAIN_BYTES. `warn` above 3 GB or when uncertain; `over` above 4 GB, when a file is too large
 * for the module (MAX_FILE_BYTES), or when uncertain with three files or more.
 */
export function estimateMemory(i: MemoryInput): MemoryEstimate {
  const files = Math.max(1, i.files ?? 1)
  const threads = Math.max(1, i.threads ?? 4)
  const mzmlBytes = i.mzmlBytes ?? i.largestMzmlBytes * files
  const databaseBytes = i.databaseBytes ?? 0
  const chunk = i.chunkSize !== undefined && i.chunkSize > 0 ? i.chunkSize : Infinity
  const proteins = Math.min(i.proteins, chunk)
  const database =
    INDEX_BYTES_PER_PROTEIN * proteins * SPECIFICITY_FACTOR[i.specificity] * 1.5 ** Math.max(0, i.variableMods - 1)
  const perFile =
    threadFactor(threads) * growthPerFile(mzmlBytes / files) +
    (i.peptdeep ? PEPTDEEP_GROWTH_PER_THREAD * Math.max(0, threads - 4) : 0)
  const growth = (files - 1) * perFile
  const inputs = 2 * i.largestMzmlBytes + databaseBytes + growth
  const uncertain = isUncertain(i)
  const formula = MODULE_BYTES + database + inputs + (i.peptdeep ? PEPTDEEP_BYTES : 0)
  const bytes = uncertain ? Math.max(formula, UNCERTAIN_BYTES) : formula
  const fileTooLarge = isTooLarge(i.largestMzmlBytes) || isTooLarge(databaseBytes)
  const over = bytes > LIMIT_BYTES || fileTooLarge || (uncertain && files >= UNCERTAIN_OVER_FILES)
  const level: MemoryLevel = over ? 'over' : bytes > WARN_BYTES || uncertain ? 'warn' : 'ok'
  const cause = fileTooLarge || (inputs > database && !uncertain) ? 'inputs' : 'database'
  return { bytes, level, database, inputs, growth, cause, fileTooLarge, uncertain }
}

/** Memory for people, in the module's gigabytes: "2.6 GB", "0.8 GB". */
export function formatMemory(bytes: number): string {
  return `${(bytes / GB).toFixed(1)} GB`
}
