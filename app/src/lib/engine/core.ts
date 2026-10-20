// The engine's work on the OpenMS module, without the worker around it: used by `worker.ts` and run
// against the real module by `core.test.ts` (Node.js). Follows the README of the module ("Several files
// and the ProSE app"): the database and the PeptDeep models are written to the module's file system
// (WasmFS, in memory, read directly by every thread), and the mzML files are searched file by file
// (`searchFiles` with provideFile/releaseFile): each is written when its turn comes and removed after
// its search, so that only the file being searched is in the module's memory (at most 4 GB in wasm32,
// 16 GB in wasm64, shared with the search). Both modules have one API: this file serves either.
//
// Memory: every file goes in and out in bounded chunks (`allocateFile` at its final size, then
// `writeFileChunk`; `readFileChunk`), so that JavaScript never holds a whole file next to the module's
// copy. A file can be at most what the module's file system holds (`getMemoryInfo().maxFileSize`: 2 GiB −
// 64 MiB in wasm32, 16 GiB − 64 MiB in wasm64): larger ones are refused before the search.
//
// After a fatal error (`isFatal`: a trap, an abort, a C++ exception the module did not catch) the module
// is not called again, not even to clean up (README "What is not guarded"): the worker is replaced.

import type {
  AnnotationOptions,
  MainModule,
  ParamValue,
  PeakAnnotationResult,
  PredictedIon,
  ProSEFilesOptions,
  ProSEMultiSummary,
  ProSEResultSet,
  ResultTables,
  StoredSpectra,
} from './openms-types'
import { fileTooLargeMessage, isFatal, type EngineInfo, type EngineVariant, type SearchProgress } from './protocol'

/** The accession prefix of the contaminants the app appends (the results model reads it). */
export const CONTAMINANT_PREFIX = 'CON__'

/** Where the PeptDeep models go in the module's file system. */
export const MODELS_DIR = '/models'

/** The PeptDeep models of the package (`openms/models/`) and the ProSE parameters that name them. */
export const MODELS = [
  { parameter: 'peptdeep:ms2_model', file: 'peptdeep_ms2_dynamic.onnx' },
  { parameter: 'peptdeep:rt_model', file: 'peptdeep_rt_dynamic.onnx' },
] as const

/** The MS2 model, which `predictMS2` uses. */
export const MS2_MODEL_FILE = MODELS[0].file
const MS2_MODEL = `${MODELS_DIR}/${MS2_MODEL_FILE}`

/** The size of the pieces in which files go into and out of the module's file system. */
export const CHUNK_SIZE = 16 * 2 ** 20

/** A file for the search: its name and its contents (a File, or any Blob). */
export interface CoreInput {
  name: string
  data: Blob
}

export interface CoreSearchRequest {
  /** The mzML files, written to `/input/<index>/<name>` one at a time, while each is searched. */
  files: CoreInput[]
  /** The FASTA file, written to `/input/db/<name>`. */
  database: CoreInput
  /** The contaminant FASTA (cRAP) to append to the database with `CON__` accessions; `null`: none. */
  contaminants: string | null
  /** ProSE parameters by name. */
  parameters: Record<string, unknown>
  /** Percolator rescoring: ProSE's `rescore`, for the call. */
  rescore: boolean
  /** PeptDeep features: `peptdeep:enable` with the models in /models (`loadModels()` first). */
  peptdeep: boolean
}

export interface CoreSearchOutcome {
  summary: ProSEMultiSummary
  tables: ResultTables
  spectra: StoredSpectra
  seconds: number
  /** The results in the module, for idXML: kept until the module ends (or `delete()`). */
  results: ProSEResultSet
}

/**
 * Reads `length` bytes of `blob` from `offset` (fewer at its end), synchronously: the search asks for
 * each file from within (`provideFile`), so a worker reads it with FileReaderSync.
 */
export type ReadSync = (blob: Blob, offset: number, length: number) => Uint8Array

/** What a search reports and asks while it runs. */
export interface SearchHooks {
  onProgress: (p: SearchProgress) => void
  /**
   * What the search is doing, for the advice of an error: writing the database or a file (`reading`),
   * searching (`searching`; again after each file is written).
   */
  onStage?: (stage: 'reading' | 'searching') => void
  /** Reads the mzML files (each when its turn comes). */
  readSync: ReadSync
}

/** A progress report of `ProSEAlgorithm.setProgressCallback()`. */
export interface ModuleProgress {
  event: 'start' | 'progress' | 'end'
  label: string
  depth: number
  begin: number
  end: number
  value: number
  /** The input file of the step; -1 outside the files. */
  file: number
}

type FileSystem = MainModule['FS']

/** Emscripten's default mode of a new directory (the declarations of FS.mkdir want one). */
const DIRECTORY_MODE = 0o777

const encoder = new TextEncoder()

/**
 * The database with contaminants: the user's FASTA, then the entries of `crap` with `CON__` before
 * their accession (unless it is there already). Not deduplicated against the user's entries. A Blob of
 * the parts: the user's file is not read here.
 */
export async function withContaminants(fasta: Blob, crap: string): Promise<Blob> {
  const unprefixed = new RegExp(`^>(?!${CONTAMINANT_PREFIX})`, 'gm')
  const contaminants = encoder.encode(crap.replace(unprefixed, `>${CONTAMINANT_PREFIX}`))
  const last = fasta.size > 0 ? new Uint8Array(await fasta.slice(fasta.size - 1).arrayBuffer())[0] : 0x0a
  return new Blob(last === 0x0a ? [fasta, contaminants] : [fasta, '\n', contaminants])
}

/**
 * The ProSE parameters and the options of `searchFiles()` for a request: `rescore` is the search
 * option (it sets ProSE's `rescore` for the call), `peptdeep` sets `peptdeep:enable` and, if on, the
 * models in /models. The spectra of the PSMs are kept for the spectrum views, and decoys stay.
 */
export function searchSettings(req: Pick<CoreSearchRequest, 'parameters' | 'rescore' | 'peptdeep'>): {
  parameters: Record<string, unknown>
  options: NonNullable<ProSEFilesOptions>
} {
  const parameters: Record<string, unknown> = { ...req.parameters, 'peptdeep:enable': req.peptdeep }
  if (req.peptdeep) for (const m of MODELS) parameters[m.parameter] = `${MODELS_DIR}/${m.file}`
  return { parameters, options: { rescore: req.rescore, keepSpectra: true } }
}

function exists(FS: FileSystem, path: string): boolean {
  try {
    FS.stat(path)
    return true
  } catch {
    return false
  }
}

/** Removes a file or a directory with everything in it. */
function remove(FS: FileSystem, path: string): void {
  if (!exists(FS, path)) return
  let entries: string[]
  try {
    entries = FS.readdir(path)
  } catch {
    FS.unlink(path)
    return
  }
  for (const name of entries) if (name !== '.' && name !== '..') remove(FS, `${path}/${name}`)
  FS.rmdir(path)
}

/**
 * Removes `path` like `remove`, but never throws: cleanup in a `catch` or `finally` must not replace the
 * error that got there (after a trap the file system may fail as well).
 */
function tryRemove(FS: FileSystem, path: string): void {
  try {
    remove(FS, path)
  } catch {
    // the error that matters is the one being handled
  }
}

/** Deletes an object of the module, never throwing (as `tryRemove`). */
function tryDelete(object: { delete(): void }): void {
  try {
    object.delete()
  } catch {
    // the error that matters is the one being handled
  }
}

/**
 * Writes `data` to `path` (anew) in pieces of CHUNK_SIZE: the file is allocated at its size first, so
 * that WasmFS holds it in one block (growing it piece by piece would reallocate and copy it), and one
 * piece at a time is in JavaScript. Asynchronous reads: for what is written before the search (the
 * database, the PeptDeep models).
 */
export async function writeBlob(OpenMS: MainModule, path: string, data: Blob, chunkSize = CHUNK_SIZE): Promise<void> {
  OpenMS.allocateFile(path, data.size, data.size)
  for (let offset = 0; offset < data.size; offset += chunkSize) {
    OpenMS.writeFileChunk(path, new Uint8Array(await data.slice(offset, offset + chunkSize).arrayBuffer()), offset)
  }
}

/**
 * Writes `data` to `path` as `writeBlob`, synchronously (`read`), in a block of `capacity` bytes: files
 * that come one after the other, each removed before the next, then reuse one block instead of growing
 * the heap with every larger file (README "Files one after the other").
 */
export function writeBlobSync(OpenMS: MainModule, path: string, data: Blob, read: ReadSync, capacity: number, chunkSize = CHUNK_SIZE): void {
  OpenMS.allocateFile(path, data.size, capacity)
  for (let offset = 0; offset < data.size; offset += chunkSize) {
    OpenMS.writeFileChunk(path, read(data, offset, Math.min(chunkSize, data.size - offset)), offset)
  }
}

/** Reads the file at `path` in pieces (CHUNK_SIZE, `readFileChunk`) into one JavaScript array (outside the heap). */
export function readFile(OpenMS: MainModule, path: string, chunkSize = CHUNK_SIZE): Uint8Array<ArrayBuffer> {
  const size = Number(OpenMS.FS.stat(path).size)
  const out = new Uint8Array(size)
  for (let offset = 0; offset < size; ) {
    const piece = OpenMS.readFileChunk(path, offset, Math.min(chunkSize, size - offset))
    if (piece.length === 0) throw new Error(`${path}: read ${offset} of ${size} bytes.`)
    out.set(piece, offset)
    offset += piece.length
  }
  return out
}

/**
 * Writes the PeptDeep models to /models, those that are not there yet (once per module).
 * `fetchModel` returns a model file of the package by name.
 */
export async function loadModels(
  OpenMS: MainModule,
  fetchModel: (file: string) => Promise<Blob>,
  files: readonly string[] = MODELS.map((m) => m.file),
): Promise<void> {
  const { FS } = OpenMS
  if (!exists(FS, MODELS_DIR)) FS.mkdir(MODELS_DIR, DIRECTORY_MODE)
  for (const file of files) {
    const path = `${MODELS_DIR}/${file}`
    if (exists(FS, path)) continue
    const model = await fetchModel(file)
    try {
      await writeBlob(OpenMS, path, model)
    } catch (e) {
      if (!isFatal(e)) tryRemove(FS, path) // not half a model, which would count as loaded
      throw e
    }
  }
}

/** Refuses a file the module's file system cannot hold (`maxFileSize`), before anything is written. */
function checkSizes(OpenMS: MainModule, files: { name: string; size: number }[]): void {
  const max = OpenMS.getMemoryInfo().maxFileSize
  const tooLarge = files.find((f) => f.size > max)
  if (tooLarge) throw new Error(fileTooLargeMessage(tooLarge.name, tooLarge.size, max))
}

const FILES_SHARE = 0.95

/** The step of a database chunk ("  file 1 chunk 3": each file is searched on its own, so always file 1). */
const CHUNK_STEP = /^\s*file \d+ chunk (\d+)\s*$/

/** The step of a file of a search of several: "Searching run.mzML (2 of 3)...". */
const FILE_STEP = /^Searching .* \(\d+ of \d+\)\.\.\.$/

/** The label once the last file's step has ended (the pooling of the files reports nothing). */
export const POOLING = 'Pooling the files...'

/**
 * Maps ProSE's progress reports of a search of `fileCount` files, searched file by file, to one
 * monotone fraction:
 *
 * - The steps of file i ("Searching <name> (i + 1 of n)...", `file` = i, and the steps nested in it,
 *   writing the file and reading the spectra of its PSMs included) take [i, i + 1] / n of [0, 0.95].
 *   Within it, the file's own step and the progress events of the nested steps (value within
 *   begin..end) advance the fraction; the start and end of a nested step change the label only (how
 *   many steps a file has is not known in advance).
 * - When the last file's step ends (of several files), the label becomes "Pooling the files..." (file
 *   -1): the pooling reports nothing, and the fraction holds at 0.95 until the result.
 * - Steps outside the files change the label only.
 * - The chunks of a chunked search within a file's step ("  file 1 chunk 3": the file is searched on its
 *   own) are named by the database: "Searching database chunk 3...".
 *
 * The fraction never goes back, and between reports (Percolator sends none) it holds.
 */
export function progressMapper(fileCount: number): (p: ModuleProgress) => SearchProgress {
  let fraction = 0
  const share = FILES_SHARE / Math.max(1, fileCount)
  return (p) => {
    // within a file's step (file by file) the chunk's "file 1" is the file on its own
    const chunk = p.file >= 0 ? CHUNK_STEP.exec(p.label) : null
    const label = chunk ? `Searching database chunk ${chunk[1]}...` : p.label.trim()
    const range = p.end - p.begin
    const within = range > 0 ? Math.min(1, Math.max(0, (p.value - p.begin) / range)) : p.event === 'end' ? 1 : 0
    if (p.file >= 0 && p.file < fileCount && (p.depth === 0 || p.event === 'progress')) {
      fraction = Math.min(1, Math.max(fraction, (p.file + within) * share))
    }
    if (fileCount > 1 && p.event === 'end' && p.file === fileCount - 1 && FILE_STEP.test(label)) {
      return { label: POOLING, file: -1, fraction }
    }
    return { label, file: p.file, fraction }
  }
}

/**
 * The error of `searchFiles()` for people. Percolator's partial rescoring ("Percolator rescored only
 * some of the input files…", with the files it could not rescore) says what to do about it; other
 * errors stay as they are.
 */
export function searchError(e: unknown): unknown {
  const message = String((e as Error)?.message ?? e)
  if (!message.includes('Percolator rescored only some of the input files')) return e
  const files = /\(not rescored: (.*)\)\. Search the files/s.exec(message)?.[1].replace(/\/input\/\d+\//g, '')
  return new Error(
    'Percolator could rescore only some of the files, and their scores cannot be pooled with the others' +
      (files ? ` (not rescored: ${files})` : '') +
      '. Switch Percolator off, or leave out the files it could not rescore.',
  )
}

/**
 * Searches the files of `req` against its database with ProSE, file by file:
 *
 * 1. refuses a file larger than the module holds (`maxFileSize`; the database too) before anything is
 *    written;
 * 2. writes the database (with the contaminants) to `/input/db/<name>` (`reading`);
 * 3. searches (`searching`) with `searchFiles(…, { provideFile, releaseFile })`: provideFile(i) writes
 *    file i to `/input/<i>/<name>` (`reading` while it does: `allocateFile` with the size of the largest
 *    file as capacity, then `writeFileChunk` of pieces read by `hooks.readSync`), releaseFile(i) removes it.
 *
 * `/input` is cleaned before and removed after, unless the module failed fatally (`isFatal`: then it is
 * not called again). The result set stays in the module for idXML (it holds the peaks already); the
 * caller deletes it.
 */
export async function runSearch(OpenMS: MainModule, req: CoreSearchRequest, hooks: SearchHooks): Promise<CoreSearchOutcome> {
  const { FS } = OpenMS
  if (req.peptdeep) {
    if (!OpenMS.hasONNXRuntime()) throw new Error('PeptDeep needs an OpenMS module with ONNX Runtime.')
    for (const m of MODELS) {
      if (!exists(FS, `${MODELS_DIR}/${m.file}`)) throw new Error(`The PeptDeep model ${m.file} is not loaded.`)
    }
  }
  const database =
    req.contaminants === null ? req.database.data : await withContaminants(req.database.data, req.contaminants)
  checkSizes(OpenMS, [...req.files.map((f) => ({ name: f.name, size: f.data.size })), { name: req.database.name, size: database.size }])

  const paths = req.files.map((f, i) => `/input/${i}/${f.name}`)
  const databasePath = `/input/db/${req.database.name}`
  // one block of the largest file's size for every file (computed once)
  const capacity = Math.max(0, ...req.files.map((f) => f.data.size))
  const { parameters, options } = searchSettings(req)
  /** The module failed fatally: it is not called again, not even to clean up. */
  let fatal = false
  /** What provideFile threw, if fatal: searchFiles() rethrows only its message, which may not say so. */
  let fatalInFile: unknown = null
  const failed = (e: unknown) => {
    if (isFatal(e)) fatal = true
    return e
  }
  const prose = new OpenMS.ProSEAlgorithm()
  try {
    hooks.onStage?.('reading')
    remove(FS, '/input')
    FS.mkdirTree('/input/db', DIRECTORY_MODE)
    await writeBlob(OpenMS, databasePath, database)

    prose.setParameterValues(parameters as Record<string, ParamValue>)
    const map = progressMapper(paths.length)
    prose.setProgressCallback((p) => hooks.onProgress(map(p)))
    hooks.onStage?.('searching')
    const started = performance.now()
    let results: ProSEResultSet
    try {
      results = prose.searchFiles(paths, databasePath, {
        ...options,
        provideFile: (i, path) => {
          hooks.onStage?.('reading')
          try {
            FS.mkdirTree(path.slice(0, path.lastIndexOf('/')), DIRECTORY_MODE)
            writeBlobSync(OpenMS, path, req.files[i].data, hooks.readSync, capacity)
          } catch (e) {
            if (isFatal(failed(e))) fatalInFile = e
            throw e
          }
          hooks.onStage?.('searching')
        },
        // also called for a file whose writing or search failed: it may not be there
        releaseFile: (_i, path) => {
          if (!fatal) tryRemove(FS, path)
        },
      })
    } catch (e) {
      // what provideFile threw comes back wrapped ("searchFiles(): provideFile(1, …) threw: <its message>")
      if (fatalInFile !== null) throw fatalInFile
      throw searchError(failed(e))
    }
    const seconds = (performance.now() - started) / 1000
    try {
      return { summary: results.summary(), tables: results.tables(), spectra: results.spectra(), seconds, results }
    } catch (e) {
      failed(e)
      if (!fatal) tryDelete(results)
      throw e
    }
  } catch (e) {
    throw failed(e)
  } finally {
    if (!fatal) {
      tryDelete(prose)
      tryRemove(FS, '/input')
    }
  }
}

/**
 * The buffers of the typed arrays in `values` (searched through nested objects), each once, for
 * `postMessage(…, transfer)`. The module returns plain ArrayBuffers. A view of shared memory (the
 * module's heap) cannot be transferred: `strict` (development) throws, else it is replaced by a copy.
 */
export function transferList(values: object[], strict: boolean): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  const visit = (object: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(object)) {
      if (ArrayBuffer.isView(value)) {
        let view = value
        if (!(view.buffer instanceof ArrayBuffer)) {
          if (strict) throw new Error(`transferList: ${key} is a view of shared memory, not a plain ArrayBuffer.`)
          view = (value as unknown as Uint8Array).slice()
          object[key] = view
        }
        buffers.add(view.buffer as ArrayBuffer)
      } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        visit(value as Record<string, unknown>)
      }
    }
  }
  for (const value of values) visit(value as Record<string, unknown>)
  return [...buffers]
}

/** What the page needs to know of the module (of build `variant`). */
export function engineInfo(OpenMS: MainModule, isolated: boolean, variant: EngineVariant): EngineInfo {
  const threading = OpenMS.getThreadingInfo()
  const prose = new OpenMS.ProSEAlgorithm()
  const defaults = prose.getDefaults()
  try {
    return {
      version: OpenMS.getVersion(),
      threads: threading.numThreads,
      threaded: threading.threaded,
      isolated,
      onnx: OpenMS.hasONNXRuntime(),
      parameters: defaults.getEntries(),
      variant,
      maxFileBytes: OpenMS.getMemoryInfo().maxFileSize,
    }
  } finally {
    tryDelete(defaults)
    tryDelete(prose)
  }
}

/** The fragment ions of `peptide` matched to the peaks. */
export function annotate(
  OpenMS: MainModule,
  mz: Float32Array,
  intensity: Float32Array,
  peptide: string,
  charge: number,
  options: AnnotationOptions,
): PeakAnnotationResult {
  return OpenMS.annotatePeaks(mz, intensity, peptide, charge, options ?? null)
}

/** PeptDeep's fragment intensities of `peptide` (the MS2 model in /models: `loadModels()` first). */
export function predict(OpenMS: MainModule, peptide: string, charge: number, nce: number, instrument: string): PredictedIon[] {
  return OpenMS.predictMS2(peptide, charge, nce, instrument, MS2_MODEL)
}

/**
 * The results as idXML, read back in pieces (`readFile`, `readFileChunk`). Not guarded (README "What is
 * not guarded"): `storeIdXML` writes into the memory file system through C++ streams, where the file
 * grows by doubling and briefly takes up to three times its size; where the heap cannot hold that, the
 * module aborts (a trap: the worker is restarted, the idXML is lost).
 */
export function idXML(OpenMS: MainModule, results: ProSEResultSet): Uint8Array<ArrayBuffer> {
  const { FS } = OpenMS
  const path = '/output/results.idXML'
  if (!exists(FS, '/output')) FS.mkdir('/output', DIRECTORY_MODE)
  try {
    results.storeIdXML(path)
    const bytes = readFile(OpenMS, path)
    tryRemove(FS, path)
    return bytes
  } catch (e) {
    if (!isFatal(e)) tryRemove(FS, path) // after a fatal error the module is not called again
    throw e
  }
}
