// The engine worker: OpenMS (the threaded module of `public/openms`) in a module Web Worker, so that
// the page never waits for it. `EngineClient` (client.ts) starts two kinds: a search worker (a new one
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
  isFatal,
  thrownMessage,
  type EngineCall,
  type EngineCalls,
  type EngineRequest,
  type EngineResponse,
  type EngineStage,
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
/** Where the app's files are (the base URL of the build): `openms/`, `fasta/`. */
let baseUrl = ''
/** The results of the search of this worker. */
let results: ProSEResultSet | null = null
let contaminants: string | null = null
/** What the worker is doing, for the errors. */
let stage: EngineStage = 'loading'

async function fetchAsset(path: string): Promise<Response> {
  const response = await fetch(new URL(path, baseUrl))
  if (!response.ok) throw new Error(`${path} could not be loaded (${response.status} ${response.statusText}).`)
  return response
}

/** A PeptDeep model of the package (`openms/models/`). */
async function fetchModel(file: string): Promise<Blob> {
  return (await fetchAsset(`openms/models/${file}`)).blob()
}

function loaded(): MainModule {
  if (!OpenMS) throw new Error('OpenMS is not loaded.')
  return OpenMS
}

type RequestOf<K extends EngineCall> = Extract<EngineRequest, { type: K }>
type Reply<K extends EngineCall> = { result: EngineCalls[K]['result']; transfer?: Transferable[] }
type Handlers = { [K in EngineCall]: (request: RequestOf<K>) => Promise<Reply<K>> }

const handlers: Handlers = {
  async init({ threads, baseUrl: url }) {
    stage = 'loading'
    if (!OpenMS) {
      baseUrl = url
      const moduleUrl = new URL('openms/openms.mjs', baseUrl).href
      const { default: createOpenMS } = (await import(/* @vite-ignore */ moduleUrl)) as { default: OpenMSFactory }
      OpenMS = await createOpenMS({ numThreads: threads, print: () => {}, printErr: (line: string) => console.debug(line) })
      OpenMS.setLogEnabled('info', false)
    }
    return { result: engineInfo(OpenMS, scope.crossOriginIsolated === true) }
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
    return { result: { summary, tables, spectra, seconds }, transfer: transferList([tables, spectra], import.meta.env.DEV) }
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
