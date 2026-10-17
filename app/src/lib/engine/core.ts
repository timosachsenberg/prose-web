// The engine's work on the OpenMS module, without the worker around it: used by `worker.ts` and run
// against the real module by `core.test.ts` (Node.js). Follows the ProSE example of the module
// (`examples/prose/worker.mjs`): the inputs are written to the module's file system (WasmFS, in memory,
// read directly by every thread), the PeptDeep models to /models.
//
// Memory: WasmFS keeps its files in the module's heap (at most 4 GB, shared with the search). The inputs
// are therefore checked against a budget first, and every file goes in and out in bounded chunks
// (`FS.write`/`FS.read`): `FS.writeFile` and `FS.readFile` hold a second, full-size copy in the heap,
// and the allocation of `writeFile` is not checked.

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
import { formatBytes } from '../format/bytes'
import type { EngineInfo, SearchProgress } from './protocol'

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

/**
 * What the heap has to keep free beside the inputs: the fragment index, the spectra, the PSMs and their
 * features, Percolator, the result tables and the peaks for the viewer. 1.5 GB is conservative for the
 * searches the README measured (a human tryptic search: 2.0 GB in all with a 78 MB mzML); a larger search
 * needs `database:chunk_size` anyway.
 */
export const SEARCH_RESERVE = 1.5 * 2 ** 30

/** The size of the pieces in which files go into and out of the module's file system. */
export const CHUNK_SIZE = 16 * 2 ** 20

/** A file for the search: its name and its contents (a File, or any Blob). */
export interface CoreInput {
  name: string
  data: Blob
}

export interface CoreSearchRequest {
  /** The mzML files, written to `/input/<index>/<name>`. */
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

/** The paths of the staged inputs. */
export interface StagedInputs {
  files: string[]
  database: string
}

/** A progress report of `ProSEAlgorithm.setProgressCallback()`. */
export interface ModuleProgress {
  event: 'start' | 'progress' | 'end'
  label: string
  depth: number
  begin: number
  end: number
  value: number
  /** The input file of the step; -1 outside the files (and throughout a chunked search). */
  file: number
}

type FileSystem = MainModule['FS']

/** Emscripten's default mode of a new directory (the declarations of FS.mkdir want one). */
const DIRECTORY_MODE = 0o777

const encoder = new TextEncoder()

/** Bytes for people: "7.8 GB", "850 MB" (binary units, as everywhere in the app). */
export const formatSize = formatBytes

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
function remove(FS: FileSystem, path: string) {
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
 * Writes `data` to `path` in pieces of CHUNK_SIZE: one piece at a time in JavaScript and in the heap.
 * The file is sized first, so that WasmFS allocates it once (growing it piece by piece would reallocate
 * and copy it, with up to twice its size).
 */
export async function writeBlob(FS: FileSystem, path: string, data: Blob, chunkSize = CHUNK_SIZE): Promise<void> {
  const stream = FS.open(path, 'w')
  try {
    FS.ftruncate(stream.fd, data.size)
    for (let offset = 0; offset < data.size; offset += chunkSize) {
      const piece = new Uint8Array(await data.slice(offset, offset + chunkSize).arrayBuffer())
      const written = FS.write(stream, piece, 0, piece.length, offset, false)
      if (written !== piece.length) throw new Error(`${path}: wrote ${written} of ${piece.length} bytes.`)
    }
  } finally {
    FS.close(stream)
  }
}

/** Reads the file at `path` in pieces (CHUNK_SIZE) into one JavaScript array (outside the heap). */
export function readFile(FS: FileSystem, path: string, chunkSize = CHUNK_SIZE): Uint8Array<ArrayBuffer> {
  const size = Number(FS.stat(path).size)
  const out = new Uint8Array(size)
  const stream = FS.open(path, 'r')
  try {
    for (let offset = 0; offset < size; ) {
      const read = FS.read(stream, out, offset, Math.min(chunkSize, size - offset), offset)
      if (read <= 0) throw new Error(`${path}: read ${offset} of ${size} bytes.`)
      offset += read
    }
  } finally {
    FS.close(stream)
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
    if (!exists(FS, path)) await writeBlob(FS, path, await fetchModel(file))
  }
}

/**
 * How many bytes of input the module can hold beside a search: what the heap can still grow to,
 * less SEARCH_RESERVE. The whole current heap counts as used (conservative; in a fresh module it is
 * the module itself, about 170 MB).
 */
export function inputBudget(OpenMS: MainModule): number {
  const { heapSize, heapMax } = OpenMS.getMemoryInfo()
  return Math.max(0, heapMax - heapSize - SEARCH_RESERVE)
}

/**
 * Writes the inputs to /input (replacing earlier ones), one file at a time and in pieces: the mzML
 * files to `/input/<index>/<name>`, the database (with the contaminants) to `/input/db/<name>`. Refuses
 * before writing anything if they exceed `inputBudget()`.
 */
export async function stageInputs(
  OpenMS: MainModule,
  req: Pick<CoreSearchRequest, 'files' | 'database' | 'contaminants'>,
): Promise<StagedInputs> {
  const { FS } = OpenMS
  const database =
    req.contaminants === null ? req.database.data : await withContaminants(req.database.data, req.contaminants)
  const total = req.files.reduce((sum, f) => sum + f.data.size, database.size)
  const budget = inputBudget(OpenMS)
  if (total > budget) {
    throw new Error(
      `The files total ${formatSize(total)}; this browser engine can hold about ${formatSize(budget)} at once: ` +
        'search fewer files at a time.',
    )
  }

  remove(FS, '/input')
  const staged: StagedInputs = {
    files: req.files.map((f, i) => `/input/${i}/${f.name}`),
    database: `/input/db/${req.database.name}`,
  }
  try {
    for (const [i, f] of req.files.entries()) {
      FS.mkdirTree(`/input/${i}`, DIRECTORY_MODE)
      await writeBlob(FS, staged.files[i], f.data)
    }
    FS.mkdirTree('/input/db', DIRECTORY_MODE)
    await writeBlob(FS, staged.database, database)
  } catch (e) {
    remove(FS, '/input')
    throw e
  }
  return staged
}

const FILES_SHARE = 0.95

/**
 * Maps ProSE's progress reports of a search of `fileCount` files to one monotone fraction:
 *
 * - The steps of file i ("Searching <name> (i + 1 of n)...", `file` = i, and the steps nested in it)
 *   take [i, i + 1] / n of [0, 0.95]. Within it, the file's own step and the progress events of the
 *   nested steps (value within begin..end) advance the fraction; the start and end of a nested step
 *   change the label only (how many steps a file has is not known in advance).
 * - The step that follows the last file's (`file` -1: "Reading the spectra of the PSMs...") takes
 *   [0.95, 1].
 * - Steps outside the files before that (a chunked search has no per-file steps at all) change the
 *   label only.
 *
 * The fraction never goes back, and between reports (Percolator sends none) it holds.
 */
export function progressMapper(fileCount: number): (p: ModuleProgress) => SearchProgress {
  let fraction = 0
  let lastFileSeen = false
  const share = FILES_SHARE / Math.max(1, fileCount)
  return (p) => {
    const label = p.label.trim()
    const range = p.end - p.begin
    const within = range > 0 ? Math.min(1, Math.max(0, (p.value - p.begin) / range)) : p.event === 'end' ? 1 : 0
    let next = fraction
    if (p.file >= 0 && p.file < fileCount) {
      if (p.file === fileCount - 1) lastFileSeen = true
      if (p.depth === 0 || p.event === 'progress') next = (p.file + within) * share
    } else if (p.file === -1 && lastFileSeen) {
      next = FILES_SHARE + (1 - FILES_SHARE) * within
    }
    fraction = Math.min(1, Math.max(fraction, next))
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
 * Searches staged inputs with ProSE (`searchFiles`) and removes them afterwards (the results hold what
 * they need, the peaks included). The result set stays in the module for idXML; the caller deletes it.
 */
export function searchStaged(
  OpenMS: MainModule,
  staged: StagedInputs,
  req: Pick<CoreSearchRequest, 'parameters' | 'rescore' | 'peptdeep'>,
  onProgress: (p: SearchProgress) => void,
): CoreSearchOutcome {
  const { parameters, options } = searchSettings(req)
  const prose = new OpenMS.ProSEAlgorithm()
  try {
    prose.setParameterValues(parameters as Record<string, ParamValue>)
    const map = progressMapper(staged.files.length)
    prose.setProgressCallback((p) => onProgress(map(p)))
    const started = performance.now()
    let results: ProSEResultSet
    try {
      results = prose.searchFiles(staged.files, staged.database, options)
    } catch (e) {
      throw searchError(e)
    }
    const seconds = (performance.now() - started) / 1000
    try {
      return { summary: results.summary(), tables: results.tables(), spectra: results.spectra(), seconds, results }
    } catch (e) {
      results.delete()
      throw e
    }
  } finally {
    prose.delete()
    remove(OpenMS.FS, '/input')
  }
}

/**
 * Searches the files of `req` against its database: stages them (`stageInputs`), then searches
 * (`searchStaged`). `onStage` hears when the reading ends and the search begins.
 */
export async function runSearch(
  OpenMS: MainModule,
  req: CoreSearchRequest,
  onProgress: (p: SearchProgress) => void,
  onStage: (stage: 'reading' | 'searching') => void = () => {},
): Promise<CoreSearchOutcome> {
  if (req.peptdeep) {
    if (!OpenMS.hasONNXRuntime()) throw new Error('PeptDeep needs an OpenMS module with ONNX Runtime.')
    for (const m of MODELS) {
      if (!exists(OpenMS.FS, `${MODELS_DIR}/${m.file}`)) throw new Error(`The PeptDeep model ${m.file} is not loaded.`)
    }
  }
  onStage('reading')
  const staged = await stageInputs(OpenMS, req)
  onStage('searching')
  return searchStaged(OpenMS, staged, req, onProgress)
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

/** What the page needs to know of the module. */
export function engineInfo(OpenMS: MainModule, isolated: boolean): EngineInfo {
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
    }
  } finally {
    defaults.delete()
    prose.delete()
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

/** The results as idXML, read back in pieces (`readFile`). */
export function idXML(OpenMS: MainModule, results: ProSEResultSet): Uint8Array<ArrayBuffer> {
  const { FS } = OpenMS
  const path = '/output/results.idXML'
  if (!exists(FS, '/output')) FS.mkdir('/output', DIRECTORY_MODE)
  results.storeIdXML(path)
  try {
    return readFile(FS, path)
  } finally {
    FS.unlink(path)
  }
}
