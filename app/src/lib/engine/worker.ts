// The engine worker: OpenMS (the threaded module of `public/openms`, or the 64-bit one of
// `public/openms64` for a search that needs more than 4 GB, see variant.ts) in a module Web Worker, so
// that the page never waits for it. `EngineClient` (client.ts) starts two kinds: a search worker (a new one
// for every search; it keeps the results for idXML) and a viewer worker (annotate, predict). The page
// sends requests {id, type, ...arguments}; the worker answers {id, type: "result" | "error"}, and during
// a search sends {id, type: "progress"} (with the module's heap) and {id, type: "stage"} (writing the
// database or a file: reading; searching). Errors say what the worker was doing (`stage`) and whether
// the module is done for (`trap`: anything thrown that is not an Error, a RuntimeError). Requests are
// handled one after the other. A cancelled search ends with the worker (the page terminates it).
//
// The search reads the user's files from within (file by file, `provideFile`), synchronously: with
// FileReaderSync, which only a worker has.

import { annotate, engineInfo, idXML, loadModels, MS2_MODEL_FILE, predict, runSearch, transferList } from './core'
import type { MainModule, OpenMSFactory, ProSEResultSet } from './openms-types'
import {
  NEWER_VERSION,
  isFatal,
  thrownMessage,
  type EngineCall,
  type EngineCalls,
  type EngineRequest,
  type EngineResponse,
  type EngineStage,
  type EngineVariant,
  type SearchProgress,
} from './protocol'

interface WorkerScope {
  onmessage: ((event: MessageEvent<EngineRequest>) => void) | null
  postMessage(message: EngineResponse, options?: StructuredSerializeOptions): void
  crossOriginIsolated?: boolean
  /** Workers only (the DOM declarations lack it). */
  FileReaderSync: new () => { readAsArrayBuffer(blob: Blob): ArrayBuffer }
}

const scope = self as unknown as WorkerScope

let OpenMS: MainModule | null = null
/** The build of the module this worker loads (init). */
let variant: EngineVariant = 'wasm32'
/** Where the app's files are (the base URL of the build): `openms/`, `openms64/`, `fasta/`. */
let baseUrl = ''
/** The results of the search of this worker. */
let results: ProSEResultSet | null = null
let contaminants: string | null = null
/** What the worker is doing, for the errors. */
let stage: EngineStage = 'loading'

async function fetchAsset(path: string): Promise<Response> {
  let response: Response
  try {
    response = await fetch(new URL(path, baseUrl))
  } catch {
    throw new Error(`${path} is not stored on this computer, and there is no connection.`)
  }
  if (!response.ok) throw new Error(`${path} could not be loaded (${response.status} ${response.statusText}).`)
  return response
}

/** The packages of the two builds: their directories and ids (the content hashes the build stamps). */
const PACKAGES: Record<EngineVariant, { dir: string; id: string; name: string }> = {
  wasm32: { dir: 'openms/', id: __OPENMS_ID__, name: 'OpenMS' },
  wasm64: { dir: 'openms64/', id: __OPENMS64_ID__, name: 'The 64-bit engine' },
}

/**
 * A file of a module package (`openms/`, `openms64/`), always with that package's id: the service
 * worker stores only files of its own module versions, and a module never meets another version's wasm.
 */
function packageFile(path: string, of: EngineVariant): string {
  const { dir, id } = PACKAGES[of]
  return new URL(`${dir}${path}?v=${id}`, baseUrl).href
}

/** A file of this worker's module. */
const moduleFile = (path: string) => packageFile(path, variant)

/**
 * Why this worker's module could not be loaded, where the service worker or the network says more than
 * the import's "Failed to fetch dynamically imported module": another version on the server (409), or
 * no connection with the module not stored. Null otherwise.
 */
async function whyNotLoaded(): Promise<string | null> {
  for (const file of ['openms.mjs', 'openms.wasm']) {
    let status: number
    try {
      const response = await fetch(moduleFile(file))
      void response.body?.cancel()
      status = response.status
    } catch {
      return `${PACKAGES[variant].dir}${file} is not stored on this computer, and there is no connection.`
    }
    if (status === 409) return `${PACKAGES[variant].name} of this version is no longer on the server. ${NEWER_VERSION}`
  }
  return null
}

/** A PeptDeep model of the package (`openms/models/`: both builds use the same files). */
async function fetchModel(file: string): Promise<Blob> {
  const response = await fetch(packageFile(`models/${file}`, 'wasm32'))
  // 409: the service worker found another version's bytes on the server (public/sw.js)
  if (response.status === 409) throw new Error(`The PeptDeep model ${file} of this version is no longer on the server. ${NEWER_VERSION}`)
  if (!response.ok) throw new Error(`openms/models/${file} could not be loaded (${response.status} ${response.statusText}).`)
  return response.blob()
}

function loaded(): MainModule {
  if (!OpenMS) throw new Error('OpenMS is not loaded.')
  return OpenMS
}

type RequestOf<K extends EngineCall> = Extract<EngineRequest, { type: K }>
type Reply<K extends EngineCall> = { result: EngineCalls[K]['result']; transfer?: Transferable[] }
type Handlers = { [K in EngineCall]: (request: RequestOf<K>) => Promise<Reply<K>> }

const handlers: Handlers = {
  async init({ threads, baseUrl: url, variant: build = 'wasm32' }) {
    stage = 'loading'
    if (!OpenMS) {
      baseUrl = url
      variant = build
      // ?v= on the module and on its wasm (locateFile; the module would ask for openms.wasm without it):
      // the service worker keeps them of one version, and the module's threads, which import it again
      // past the service worker (from a Blob), never meet another version in the HTTP cache
      try {
        const { default: createOpenMS } = (await import(/* @vite-ignore */ moduleFile('openms.mjs'))) as { default: OpenMSFactory }
        OpenMS = await createOpenMS({
          numThreads: threads,
          locateFile: (path: string) => moduleFile(path),
          print: () => {},
          printErr: (line: string) => console.debug(line),
        })
      } catch (e) {
        // a failed import or wasm fetch says only "Failed to fetch dynamically imported module" or
        // "Aborted(NetworkError…)": the service worker's 409 means a newer version was deployed
        const why = await whyNotLoaded()
        if (why !== null) throw new Error(why)
        throw e
      }
      OpenMS.setLogEnabled('info', false)
    }
    return { result: engineInfo(OpenMS, scope.crossOriginIsolated === true, variant) }
  },

  async search({ id, request }) {
    const OpenMS = loaded()
    const enter = (s: 'reading' | 'searching') => {
      if (stage === s) return
      stage = s
      scope.postMessage({ id, type: 'stage', stage: s })
    }
    const progress = (p: SearchProgress) =>
      scope.postMessage({ id, type: 'progress', progress: p, memory: OpenMS.getMemoryInfo() })
    enter('reading')
    results?.delete()
    results = null
    if (request.peptdeep) {
      progress({ label: 'Loading the PeptDeep models...', file: -1, fraction: 0 })
      await loadModels(OpenMS, fetchModel)
    }
    if (request.contaminants && contaminants === null) contaminants = await (await fetchAsset('fasta/crap.fasta')).text()
    progress({ label: 'Reading the files...', file: -1, fraction: 0 })

    const reader = new scope.FileReaderSync()
    const outcome = await runSearch(
      OpenMS,
      {
        files: request.files.map(({ file }) => ({ name: file.name, data: file })),
        database: { name: request.database.name, data: request.database },
        contaminants: request.contaminants ? contaminants : null,
        parameters: request.parameters,
        rescore: request.rescore,
        peptdeep: request.peptdeep,
      },
      {
        onProgress: progress,
        onStage: enter,
        readSync: (blob, offset, length) => new Uint8Array(reader.readAsArrayBuffer(blob.slice(offset, offset + length))),
      },
    )
    results = outcome.results
    const { summary, tables, spectra, seconds } = outcome
    return { result: { summary, tables, spectra, seconds, variant }, transfer: transferList([tables, spectra], import.meta.env.DEV) }
  },

  async annotate({ mz, intensity, peptide, charge, options }) {
    stage = 'annotate'
    return { result: annotate(loaded(), mz, intensity, peptide, charge, options) }
  },

  async predict({ peptide, charge, nce, instrument }) {
    stage = 'predict'
    const OpenMS = loaded()
    if (!OpenMS.hasONNXRuntime()) throw new Error('predictMS2: this OpenMS module was built without ONNX Runtime.')
    await loadModels(OpenMS, fetchModel, [MS2_MODEL_FILE])
    return { result: predict(OpenMS, peptide, charge, nce, instrument) }
  },

  async idXML() {
    stage = 'idXML'
    if (!results) throw new Error('No search results: idXML is available for the open search only.')
    const bytes = idXML(loaded(), results)
    return { result: bytes, transfer: [bytes.buffer] }
  },
}

async function handle(request: EngineRequest) {
  try {
    const handler = handlers[request.type] as (r: EngineRequest) => Promise<Reply<EngineCall>>
    const { result, transfer = [] } = await handler(request)
    scope.postMessage({ id: request.id, type: 'result', result }, { transfer })
  } catch (e) {
    scope.postMessage({ id: request.id, type: 'error', error: thrownMessage(e), trap: isFatal(e), stage })
  }
}

let queue: Promise<void> = Promise.resolve()
scope.onmessage = ({ data }) => {
  queue = queue.then(() => handle(data))
}
