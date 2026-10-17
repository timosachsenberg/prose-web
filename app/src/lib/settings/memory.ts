// The memory estimate of the New search page. A search runs in one WebAssembly module, which can
// address 4 GB; a search that needs more stops it. The formula follows the searches measured in
// README-openms-wasm.md (a 78 MB mzML against Erwinia and human): about 0.25 GB for the module, the
// fragment index (0.08 GB per 1,000 proteins, tryptic), the spectra being read, and PeptDeep's models.

import { SEARCH_RESERVE } from '../engine/core'

/** A gigabyte as the module counts it: its limit is 4 × 2³⁰ bytes. */
export const GB = 2 ** 30

/** What the module can address. */
export const LIMIT_BYTES = 4 * GB
/** Above this the footer warns. */
export const WARN_BYTES = 3 * GB
/** The module itself (code, static data, the first heap). */
export const MODULE_BYTES = 0.25 * GB
/** PeptDeep's models and their sessions. */
export const PEPTDEEP_BYTES = 0.6 * GB

/**
 * How many bytes of input files the engine accepts in memory mode: what is left of the 4 GB beside the
 * module and the reserve the search keeps (`SEARCH_RESERVE`). EngineClient refuses more before writing
 * anything (`inputBudget()`, which measures the real heap; this is a little below it, so that the page
 * says so before the engine does).
 */
export const INPUT_BUDGET = LIMIT_BYTES - MODULE_BYTES - SEARCH_RESERVE

/** The fragment index per protein and specificity, relative to a tryptic search. */
const SPECIFICITY_FACTOR = { full: 1, semi: 6, none: 30 } as const
const INDEX_BYTES_PER_PROTEIN = (0.08 * GB) / 1000

export type Specificity = keyof typeof SPECIFICITY_FACTOR

/**
 * Where the engine keeps the input files during the search:
 * - `memory`: in the module's file system, inside its 4 GB, for the whole search (today's engine);
 * - `opfs`: in the browser's origin private file system (part B, Task 9), read from there.
 */
export type StorageMode = 'memory' | 'opfs'

export type MemoryInput = {
  /** The largest mzML file: it is read (and in `opfs` mode copied in) one file at a time. */
  largestMzmlBytes: number
  /** All inputs together, the mzML files and the database; default: the largest file. */
  inputBytes?: number
  /** Target proteins of the database (contaminants included, decoys not). */
  proteins: number
  specificity: Specificity
  variableMods: number
  peptdeep: boolean
  /** Default `memory`, until the engine stores the inputs in OPFS. */
  storage?: StorageMode
  /** `database:chunk_size`: the index is built for at most this many proteins at a time; 0 = not chunked. */
  chunkSize?: number
}

export type MemoryLevel = 'ok' | 'warn' | 'over'

export type MemoryEstimate = {
  bytes: number
  level: MemoryLevel
  /** The fragment index of the database. */
  database: number
  /** The input files: those the module holds during the search and the one being read. */
  inputs: number
  /** What dominates, and so what to change: the database (`database:chunk_size`) or the files (fewer at once). */
  cause: 'database' | 'inputs'
  /** The input files exceed what the engine accepts (memory mode): it refuses the search before writing. */
  inputsOverBudget: boolean
}

/**
 * The memory a search needs:
 *
 * bytes = 0.25 GB + 0.08 GB per 1,000 proteins × (1 full, 6 semi, 30 none) × 1.5^max(0, variableMods − 1)
 *         + inputs + (peptdeep ? 0.6 GB : 0)
 *
 * where inputs = 2 × the largest mzML in `opfs` mode (copied in, then read), and in `memory` mode all
 * inputs (they stay in the module during the search) plus 1 × the largest mzML being read. `warn` above
 * 3 GB, `over` above 4 GB or when the engine would refuse the inputs.
 */
export function estimateMemory(i: MemoryInput): MemoryEstimate {
  const storage = i.storage ?? 'memory'
  const inputBytes = i.inputBytes ?? i.largestMzmlBytes
  const chunk = i.chunkSize !== undefined && i.chunkSize > 0 ? i.chunkSize : Infinity
  const proteins = Math.min(i.proteins, chunk)
  const database =
    INDEX_BYTES_PER_PROTEIN * proteins * SPECIFICITY_FACTOR[i.specificity] * 1.5 ** Math.max(0, i.variableMods - 1)
  const inputs = storage === 'memory' ? inputBytes + i.largestMzmlBytes : 2 * i.largestMzmlBytes
  const bytes = MODULE_BYTES + database + inputs + (i.peptdeep ? PEPTDEEP_BYTES : 0)
  const inputsOverBudget = storage === 'memory' && inputBytes > INPUT_BUDGET
  const level: MemoryLevel = bytes > LIMIT_BYTES || inputsOverBudget ? 'over' : bytes > WARN_BYTES ? 'warn' : 'ok'
  const cause = inputsOverBudget || inputs > database ? 'inputs' : 'database'
  return { bytes, level, database, inputs, cause, inputsOverBudget }
}

/** Memory for people, in the module's gigabytes: "2.6 GB", "0.8 GB". */
export function formatMemory(bytes: number): string {
  return `${(bytes / GB).toFixed(1)} GB`
}
