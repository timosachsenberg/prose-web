// The boundary between the page and the engine worker: what `EngineClient` offers (EngineInfo,
// SearchRequest, SearchProgress, SearchOutcome) and the messages it exchanges with `worker.ts`.

import type {
  AnnotationOptions,
  MemoryInfo,
  ParamEntry,
  PeakAnnotationResult,
  PredictedIon,
  ProSEMultiSummary,
  ResultTables,
  StoredSpectra,
} from './openms-types'

export type { ParamEntry }

/**
 * The two builds of the module (`variant.ts`): wasm32 (`public/openms/`, at most 4 GB, the default) and
 * wasm64 (`public/openms64/`, Memory64, at most 16 GB), for searches that need more than wasm32 has.
 */
export type EngineVariant = 'wasm32' | 'wasm64'

export interface EngineInfo {
  /** OpenMS' version (`getVersion()`). */
  version: string
  /** The threads OpenMS computes with. */
  threads: number
  /** The threaded build runs. */
  threaded: boolean
  /** The worker is cross-origin isolated: only then can it share memory between threads. */
  isolated: boolean
  /** The module has ONNX Runtime (PeptDeep rescoring and predicted spectra). */
  onnx: boolean
  /** ProSE's parameters with their defaults, types, descriptions, allowed values and limits. */
  parameters: ParamEntry[]
  /** The build of the module the worker runs. */
  variant: EngineVariant
  /** The largest file its file system holds (`getMemoryInfo().maxFileSize`). */
  maxFileBytes: number
}

export interface SearchRequest {
  /** The mzML files, in the order of the design. */
  files: { id: string; file: File }[]
  /** The FASTA file. */
  database: File
  /** Append the cRAP contaminants (accessions prefixed `CON__`) to the database. */
  contaminants: boolean
  /** ProSE parameters by name. */
  parameters: Record<string, unknown>
  /** Percolator rescoring (ProSE's `rescore`). */
  rescore: boolean
  /** PeptDeep features for Percolator (`peptdeep:enable`, with the models of the package). */
  peptdeep: boolean
  /** The module to search in (default wasm32; `chooseEngine` in variant.ts). */
  engine?: EngineVariant
  /**
   * A semi- or non-specific search: building its index (of the database, or of each chunk) is a long
   * step without progress reports, so the watchdog waits longer (`WatchdogOptions.slow…`).
   */
  slowSteps?: boolean
}

export interface SearchProgress {
  /** The step, as ProSE reports it, e.g. "Searching run.mzML (1 of 2)...". */
  label: string
  /** The input file of the step (its index in `SearchRequest.files`); -1 outside the files. */
  file: number
  /**
   * 0–1 overall, monotone: the files take [0, 0.95] (each file with the reading of the spectra of its
   * PSMs); the pooling of the files after them reports nothing, and the fraction holds at 0.95 until
   * the result.
   */
  fraction: number
}

export interface SearchOutcome {
  summary: ProSEMultiSummary
  tables: ResultTables
  spectra: StoredSpectra
  /** The time of the search proper (without loading the files and the models). */
  seconds: number
  /** The module that searched. */
  variant: EngineVariant
}

/** The requests of the page to the worker: their arguments and results. */
export interface EngineCalls {
  init: { args: { threads: number; baseUrl: string; variant: EngineVariant }; result: EngineInfo }
  search: { args: { request: SearchRequest }; result: SearchOutcome }
  annotate: {
    args: { mz: Float32Array; intensity: Float32Array; peptide: string; charge: number; options: AnnotationOptions }
    result: PeakAnnotationResult
  }
  predict: { args: { peptide: string; charge: number; nce: number; instrument: string }; result: PredictedIon[] }
  idXML: { args: Record<string, never>; result: Uint8Array }
}

export type EngineCall = keyof EngineCalls

/** What the worker is doing: what a trap interrupted. */
export type EngineStage = 'loading' | 'reading' | 'searching' | 'idXML' | 'annotate' | 'predict'

/** A message of the page to the worker. */
export type EngineRequest = { [K in EngineCall]: { id: number; type: K } & EngineCalls[K]['args'] }[EngineCall]

/** A message of the worker to the page, about request `id`. */
export type EngineResponse =
  | { id: number; type: 'result'; result: unknown }
  | { id: number; type: 'error'; error: string; trap: boolean; stage: EngineStage }
  /** `memory`: the module's heap at the report (for the watchdog). */
  | { id: number; type: 'progress'; progress: SearchProgress; memory?: MemoryInfo }
  | { id: number; type: 'stage'; stage: EngineStage }

/**
 * Whether an error message is that of a WebAssembly trap or an Emscripten abort, after which the module
 * cannot go on: `RuntimeError: unreachable`, `RuntimeError: memory access out of bounds`,
 * `Aborted(OOM)`, "out of memory", a `WebAssembly.Exception` (`thrownMessage`). OpenMS' own exceptions (`InvalidValue: …`, also `OutOfMemory: …`,
 * after which the module lives on) are not.
 */
export function isTrapMessage(message: string): boolean {
  return /RuntimeError|unreachable|out of memory|Aborted\(|WebAssembly\.Exception/i.test(message)
}

/**
 * Whether a thrown value ends the module (README "What is not guarded": its state is undefined, a lock
 * of the file system may be held): anything that is not an Error, e.g. a raw `WebAssembly.Exception`
 * (a C++ exception the module did not catch, such as `std::bad_alloc` from inside WasmFS), a
 * `RuntimeError` (a trap, an abort), or an Error with a trap's message.
 */
export function isFatal(e: unknown): boolean {
  return !(e instanceof Error) || e instanceof WebAssembly.RuntimeError || isTrapMessage(e.message)
}

/** The text of a thrown value: an Error's message; a WebAssembly.Exception says what it is. */
export function thrownMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof WebAssembly.Exception === 'function' && e instanceof WebAssembly.Exception) {
    return 'WebAssembly.Exception: a C++ exception the module did not catch (e.g. std::bad_alloc)'
  }
  return String(e)
}

/**
 * OpenMS' own out-of-memory errors, after which the module lives on: `OutOfMemory: unable to allocate
 * enough memory …` (also from `allocateFile()` in provideFile), `std::bad_alloc` caught by OpenMS.
 */
export function isOutOfMemoryMessage(message: string): boolean {
  return /\bOutOfMemory\b|bad_alloc/.test(message)
}

/** The largest file the file system of the wasm32 module holds (2 GiB − 64 MiB, README "Files in parts"). */
export const MAX_FILE_BYTES = 2080374784

/** The same for the wasm64 module (16 GiB − 64 MiB, its `getMemoryInfo().maxFileSize`). */
export const MAX_FILE_BYTES_64 = 17112760320

/** The largest file of a module. */
export function maxFileBytes(variant: EngineVariant): number {
  return variant === 'wasm64' ? MAX_FILE_BYTES_64 : MAX_FILE_BYTES
}

/** Whether a file of `bytes` is larger than the module's file system holds (`max`, default wasm32's). */
export function isTooLarge(bytes: number, max = MAX_FILE_BYTES): boolean {
  return bytes > max
}

/** "big.mzML is too large (2.5 GiB); a file can be at most 1.93 GiB." (for sizes above `max`, default wasm32's). */
export function fileTooLargeMessage(name: string, bytes: number, max = MAX_FILE_BYTES): string {
  const gib = bytes / 2 ** 30
  // the limit rounded down (1.9375 GiB → 1.93); two decimals near the limit: "1.94 GiB", not "1.9 GiB",
  // for a file that is too large
  const limit = Math.floor((max / 2 ** 30) * 100) / 100
  return `${name} is too large (${gib.toFixed(gib < limit + 0.12 ? 2 : 1)} GiB); a file can be at most ${limit.toFixed(2)} GiB.`
}

/** The threads a search of many files uses at most: the heap grows with each file, the more, the more threads. */
export const MULTI_FILE_THREADS = 4

/** The threads of a search; `capped`: fewer than the engine has, for the memory. */
export interface SearchThreads {
  threads: number
  capped: boolean
}

/**
 * The threads of a search of `files` files when `available` are there: at most 4 for more than 4 files
 * and for more than 2 with PeptDeep; else all. (Part B measured 12 files of 75 MB, file by file, with
 * Emscripten's allocator: 2.9 GB at 4 threads, 4.0 GB at 16; with PeptDeep the 4 GB limit at 16.)
 */
export function threadsForSearch(available: number, files: number, peptdeep: boolean): SearchThreads {
  const capped = files > 4 || (peptdeep && files > 2)
  const threads = capped ? Math.min(available, MULTI_FILE_THREADS) : available
  return { threads, capped: threads < available }
}

/** "16 threads", "1 thread", "4 threads (memory)" (capped). */
export function threadsLabel({ threads, capped }: SearchThreads): string {
  return `${threads} ${threads === 1 ? 'thread' : 'threads'}${capped ? ' (memory)' : ''}`
}

const interrupted: Record<EngineStage, string> = {
  loading: 'while loading',
  reading: 'while reading the files',
  searching: 'while searching',
  idXML: 'while writing the idXML',
  annotate: 'while annotating the spectrum',
  predict: 'while predicting the spectrum',
}

/** What the advice after running out of memory knows of the search. */
export interface SearchContext {
  /** The engine it ran in (default wasm32). */
  variant?: EngineVariant
  /** It searched the database in chunks (database:chunk_size). */
  chunked?: boolean
  /** The browser has the 64-bit engine (default true). */
  memory64?: boolean
}

/**
 * What to do when a search ran out of memory: the engine's limit, then fewer files, the index in parts
 * (smaller parts for a search in chunks already), fewer modifications or a narrower specificity, and
 * without the 64-bit engine in this browser, where larger searches run.
 */
function searchMemory({ variant = 'wasm32', chunked = false, memory64 = true }: SearchContext): string {
  const limit =
    variant === 'wasm64'
      ? 'a search can use at most the 16 GB of the 64-bit engine.'
      : 'a search can use at most the 4 GB of the standard 32-bit engine.'
  const index = chunked
    ? 'use smaller chunks (database:chunk_size under All parameters)'
    : 'set database:chunk_size (e.g. 2000) under All parameters to build and search the index in parts'
  const elsewhere = variant === 'wasm32' && !memory64 ? ' Chrome, Edge or Firefox run larger searches in the 64-bit engine.' : ''
  return `${limit} Search fewer files at a time, or ${index}, or use fewer variable modifications or a narrower enzyme specificity.${elsewhere}`
}

const advice: Record<EngineStage, (context: SearchContext) => string> = {
  loading: () => '.',
  reading: () => ', most likely out of memory: search fewer or smaller files at a time.',
  searching: (context) => `, most likely out of memory: ${searchMemory(context)}`,
  idXML: () => ', most likely out of memory. The idXML of this search is no longer available.',
  annotate: () => '.',
  predict: () => '.',
}

const outOfMemoryAdvice: Record<EngineStage, (context: SearchContext) => string> = {
  loading: () => '',
  reading: () => ' Search fewer or smaller files at a time.',
  searching: (context) => ` ${searchMemory(context)[0].toUpperCase()}${searchMemory(context).slice(1)}`,
  idXML: () => ' The idXML of this search is too large for the memory that is left.',
  annotate: () => '',
  predict: () => '',
}

/**
 * The message of an OpenMS out-of-memory error (`isOutOfMemoryMessage`; the module lives on, no restart),
 * with what to do about it at the stage it happened, for the search of `context`.
 */
export function outOfMemoryMessage(stage: EngineStage, detail: string, context: SearchContext = {}): string {
  return `OpenMS ran out of memory ${interrupted[stage]} (${detail.trim()}).${outOfMemoryAdvice[stage](context)}`
}

/** What the watchdog says when it ends a search that stopped reporting (an abort on a pthread can hang the module). */
export const UNRESPONSIVE = 'OpenMS stopped responding (likely out of memory); search fewer files at a time.'

/** The advice to reload when OpenMS cannot be started again. */
export const RELOAD = 'Reload the page to start OpenMS again.'

/**
 * A file of this version of the module is no longer on the server (the service worker answered 409:
 * the server has another version's bytes under its URL).
 */
export const NEWER_VERSION = 'A newer version of ProSE was deployed: reload the page.'

/**
 * The message of the calls that a trap ended, by what the worker was doing (for the search of
 * `context`); `restarted`: a new worker is ready (else the page has to be reloaded).
 */
export function trapMessage(stage: EngineStage, detail: string, restarted: boolean, context: SearchContext = {}): string {
  return (
    `OpenMS stopped ${interrupted[stage]} (${detail || 'a WebAssembly trap'})${advice[stage](context)} ` +
    (restarted ? 'OpenMS was restarted.' : RELOAD)
  )
}
