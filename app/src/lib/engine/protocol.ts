// The boundary between the page and the engine worker: what `EngineClient` offers (EngineInfo,
// SearchRequest, SearchProgress, SearchOutcome) and the messages it exchanges with `worker.ts`.

import type {
  AnnotationOptions,
  ParamEntry,
  PeakAnnotationResult,
  PredictedIon,
  ProSEMultiSummary,
  ResultTables,
  StoredSpectra,
} from './openms-types'

export type { ParamEntry }

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
}

export interface SearchProgress {
  /** The step, as ProSE reports it, e.g. "Searching run.mzML (1 of 2)...". */
  label: string
  /** The input file of the step (its index in `SearchRequest.files`); -1 outside the files. */
  file: number
  /** 0–1 overall, monotone: the files take [0, 0.95], reading the spectra [0.95, 1]. */
  fraction: number
}

export interface SearchOutcome {
  summary: ProSEMultiSummary
  tables: ResultTables
  spectra: StoredSpectra
  /** The time of the search proper (without loading the files and the models). */
  seconds: number
}

/** The requests of the page to the worker: their arguments and results. */
export interface EngineCalls {
  init: { args: { threads: number; baseUrl: string }; result: EngineInfo }
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
  | { id: number; type: 'progress'; progress: SearchProgress }
  | { id: number; type: 'stage'; stage: EngineStage }

/**
 * Whether an error message is that of a WebAssembly trap or an Emscripten abort, after which the module
 * cannot go on: `RuntimeError: unreachable`, `RuntimeError: memory access out of bounds`,
 * `Aborted(OOM)`, "out of memory". OpenMS' own exceptions (`InvalidValue: …`, also `OutOfMemory: …`,
 * after which the module lives on) are not.
 */
export function isTrapMessage(message: string): boolean {
  return /RuntimeError|unreachable|out of memory|Aborted\(/i.test(message)
}

const interrupted: Record<EngineStage, string> = {
  loading: 'while loading',
  reading: 'while reading the files',
  searching: 'while searching',
  idXML: 'while writing the idXML',
  annotate: 'while annotating the spectrum',
  predict: 'while predicting the spectrum',
}

const advice: Record<EngineStage, string> = {
  loading: '.',
  reading: ', most likely out of memory: search fewer or smaller files at a time.',
  searching:
    ', most likely out of memory: a search can use at most the 4 GB a WebAssembly module can address. Set ' +
    'database:chunk_size (e.g. 2000) under All parameters to build and search the index in parts, or use fewer ' +
    'variable modifications or a narrower enzyme specificity.',
  idXML: ', most likely out of memory. The idXML of this search is no longer available.',
  annotate: '.',
  predict: '.',
}

/** The advice to reload when OpenMS cannot be started again. */
export const RELOAD = 'Reload the page to start OpenMS again.'

/**
 * The message of the calls that a trap ended, by what the worker was doing; `restarted`: a new worker
 * is ready (else the page has to be reloaded).
 */
export function trapMessage(stage: EngineStage, detail: string, restarted: boolean): string {
  return (
    `OpenMS stopped ${interrupted[stage]} (${detail || 'a WebAssembly trap'})${advice[stage]} ` +
    (restarted ? 'OpenMS was restarted.' : RELOAD)
  )
}
