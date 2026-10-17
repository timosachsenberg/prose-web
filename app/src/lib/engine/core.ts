// The engine's work on the OpenMS module, without the worker around it: used by `worker.ts` and run
// against the real module by `core.test.ts` (Node.js). Follows the ProSE example of the module
// (`examples/prose/worker.mjs`): the inputs are written to the module's file system (WasmFS, in memory,
// read directly by every thread), the PeptDeep models to /models.

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

/** A file for the search: its name and its contents. */
export interface CoreInput {
  name: string
  bytes: Uint8Array
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

/**
 * The database with contaminants: the user's FASTA, then the entries of `crap` with `CON__` before
 * their accession (unless it is there already). Not deduplicated against the user's entries.
 */
export function withContaminants(fasta: Uint8Array, crap: string): Uint8Array {
  const unprefixed = new RegExp(`^>(?!${CONTAMINANT_PREFIX})`, 'gm')
  const contaminants = encoder.encode(crap.replace(unprefixed, `>${CONTAMINANT_PREFIX}`))
  const newline = fasta.length > 0 && fasta[fasta.length - 1] !== 0x0a ? 1 : 0
  const out = new Uint8Array(fasta.length + newline + contaminants.length)
  out.set(fasta)
  if (newline) out[fasta.length] = 0x0a
  out.set(contaminants, fasta.length + newline)
  return out
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
 * Writes the PeptDeep models to /models, those that are not there yet (once per module).
 * `fetchModel` returns a model file of the package by name.
 */
export async function loadModels(
  OpenMS: MainModule,
  fetchModel: (file: string) => Promise<Uint8Array>,
  files: readonly string[] = MODELS.map((m) => m.file),
): Promise<void> {
  const { FS } = OpenMS
  if (!exists(FS, MODELS_DIR)) FS.mkdir(MODELS_DIR, DIRECTORY_MODE)
  for (const file of files) {
    const path = `${MODELS_DIR}/${file}`
    if (!exists(FS, path)) FS.writeFile(path, await fetchModel(file))
  }
}

const SPECTRA_STEP = 'Reading the spectra of the PSMs'
const FILES_SHARE = 0.95

/**
 * Maps ProSE's progress reports of a search of `fileCount` files to one monotone fraction:
 *
 * - The steps of file i ("Searching <name> (i + 1 of n)...", `file` = i, and the steps nested in it)
 *   take [i, i + 1] / n of [0, 0.95]. Within it, the file's own step and the progress events of the
 *   nested steps (value within begin..end) advance the fraction; the start and end of a nested step
 *   change the label only (how many steps a file has is not known in advance).
 * - "Reading the spectra of the PSMs..." (`file` -1) takes [0.95, 1].
 * - Other steps outside the files (a chunked search has no per-file steps) change the label only.
 *
 * The fraction never goes back, and between reports (Percolator sends none) it holds.
 */
export function progressMapper(fileCount: number): (p: ModuleProgress) => SearchProgress {
  let fraction = 0
  const share = FILES_SHARE / Math.max(1, fileCount)
  return (p) => {
    const label = p.label.trim()
    const range = p.end - p.begin
    const within = range > 0 ? Math.min(1, Math.max(0, (p.value - p.begin) / range)) : p.event === 'end' ? 1 : 0
    let next = fraction
    if (p.file >= 0 && p.file < fileCount) {
      if (p.depth === 0 || p.event === 'progress') next = (p.file + within) * share
    } else if (label.startsWith(SPECTRA_STEP)) {
      next = FILES_SHARE + (1 - FILES_SHARE) * within
    }
    fraction = Math.min(1, Math.max(fraction, next))
    return { label, file: p.file, fraction }
  }
}

/**
 * Searches the files of `req` against its database with ProSE (`searchFiles`): writes the inputs to
 * /input (replacing earlier ones), searches, and removes the inputs again (the results hold what they
 * need, the peaks included). The result set stays in the module for idXML; the caller deletes it.
 */
export function runSearch(
  OpenMS: MainModule,
  req: CoreSearchRequest,
  onProgress: (p: SearchProgress) => void,
): CoreSearchOutcome {
  const { FS } = OpenMS
  const { parameters, options } = searchSettings(req)
  if (req.peptdeep) {
    if (!OpenMS.hasONNXRuntime()) throw new Error('PeptDeep needs an OpenMS module with ONNX Runtime.')
    for (const m of MODELS) {
      if (!exists(FS, `${MODELS_DIR}/${m.file}`)) throw new Error(`The PeptDeep model ${m.file} is not loaded.`)
    }
  }

  remove(FS, '/input')
  const paths = req.files.map((f, i) => `/input/${i}/${f.name}`)
  const database = `/input/db/${req.database.name}`
  const prose = new OpenMS.ProSEAlgorithm()
  try {
    req.files.forEach((f, i) => {
      FS.mkdirTree(`/input/${i}`, DIRECTORY_MODE)
      FS.writeFile(paths[i], f.bytes)
    })
    FS.mkdirTree('/input/db', DIRECTORY_MODE)
    const fasta = req.database.bytes
    FS.writeFile(database, req.contaminants === null ? fasta : withContaminants(fasta, req.contaminants))

    prose.setParameterValues(parameters as Record<string, ParamValue>)
    const map = progressMapper(req.files.length)
    prose.setProgressCallback((p) => onProgress(map(p)))
    const started = performance.now()
    const results = prose.searchFiles(paths, database, options)
    const seconds = (performance.now() - started) / 1000
    try {
      return { summary: results.summary(), tables: results.tables(), spectra: results.spectra(), seconds, results }
    } catch (e) {
      results.delete()
      throw e
    }
  } finally {
    prose.delete()
    remove(FS, '/input')
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

/** The results as idXML. */
export function idXML(OpenMS: MainModule, results: ProSEResultSet): Uint8Array {
  const { FS } = OpenMS
  const path = '/output/results.idXML'
  if (!exists(FS, '/output')) FS.mkdir('/output', DIRECTORY_MODE)
  results.storeIdXML(path)
  try {
    return FS.readFile(path) as Uint8Array
  } finally {
    FS.unlink(path)
  }
}
