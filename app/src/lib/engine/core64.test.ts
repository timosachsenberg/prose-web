import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  engineInfo,
  idXML,
  loadModels,
  predict,
  readFile,
  runSearch,
  type CoreSearchOutcome,
  type CoreSearchRequest,
  type SearchHooks,
} from './core'
import type { MainModule, OpenMSFactory } from './openms-types'
import { MAX_FILE_BYTES, MAX_FILE_BYTES_64 } from './protocol'

// The 64-bit module (public/openms64, Memory64) in Node.js 24, with the app's engine code: one API for
// both modules, so core.ts serves either; the same search gives the same results in both. The PeptDeep
// models are the 32-bit package's (public/openms/models), which the 64-bit one shares.

const publicDir = new URL('../../../public/', import.meta.url)

async function load(dir: string): Promise<MainModule> {
  const { default: create } = (await import(/* @vite-ignore */ new URL(`${dir}/openms.mjs`, publicDir).href)) as { default: OpenMSFactory }
  const module = await create({ numThreads: Math.min(4, navigator.hardwareConcurrency || 1), print: () => {}, printErr: () => {} })
  module.setLogEnabled('info', false)
  module.mountHostDirectory('/public', decodeURIComponent(publicDir.pathname))
  return module
}

let w32: MainModule
let w64: MainModule
const outcomes: CoreSearchOutcome[] = []

beforeAll(async () => {
  ;[w32, w64] = await Promise.all([load('openms'), load('openms64')])
}, 90_000)

afterAll(() => {
  for (const o of outcomes) o.results.delete()
})

// Node.js cannot read a Blob synchronously: the search's reads come from the bytes kept here
const bytesOf = new Map<Blob, Uint8Array>()
const readSync: SearchHooks['readSync'] = (blob, offset, length) => bytesOf.get(blob)!.subarray(offset, offset + length)

function request(OpenMS: MainModule, more: Partial<CoreSearchRequest> = {}): CoreSearchRequest {
  const bytes = readFile(OpenMS, '/public/example/DatabaseSuitability_in_spec.mzML')
  const mzML = new Blob([bytes])
  bytesOf.set(mzML, bytes)
  const fasta = new Blob([readFile(OpenMS, '/public/example/DatabaseSuitability_database.fasta')])
  return {
    files: [
      { name: 'a.mzML', data: mzML },
      { name: 'b.mzML', data: mzML },
    ],
    database: { name: 'db.fasta', data: fasta },
    contaminants: null,
    parameters: {},
    rescore: false,
    peptdeep: false,
    ...more,
  }
}

async function search(OpenMS: MainModule, more: Partial<CoreSearchRequest> = {}): Promise<CoreSearchOutcome> {
  const outcome = await runSearch(OpenMS, request(OpenMS, more), { onProgress: () => {}, readSync })
  outcomes.push(outcome)
  return outcome
}

describe('the 64-bit module', () => {
  test('reports the engine: 16 GB of memory, files up to 16 GiB − 64 MiB', () => {
    const info = engineInfo(w64, false, 'wasm64')
    expect(info).toMatchObject({ variant: 'wasm64', maxFileBytes: MAX_FILE_BYTES_64, threaded: true, onnx: true })
    expect(info.version).toBe(engineInfo(w32, false, 'wasm32').version)
    expect(w64.getMemoryInfo().heapMax).toBe(16 * 2 ** 30)
    expect(w32.getMemoryInfo()).toMatchObject({ heapMax: 4 * 2 ** 30 - 65536, maxFileSize: MAX_FILE_BYTES })
    // the same parameters (the order of some lists of allowed values differs between the builds)
    const sorted = (entries: typeof info.parameters) =>
      entries.map((e) => ({ ...e, validStrings: [...(e.validStrings ?? [])].sort() }))
    expect(sorted(info.parameters)).toEqual(sorted(engineInfo(w32, false, 'wasm32').parameters))
  })

  test('refuses a file larger than it holds, with its own limit', async () => {
    const huge = { name: 'huge.mzML', data: { size: MAX_FILE_BYTES_64 + 1 } as Blob }
    const req = { ...request(w64), files: [huge] }
    await expect(runSearch(w64, req, { onProgress: () => {}, readSync })).rejects.toThrow(
      'huge.mzML is too large (15.94 GiB); a file can be at most 15.93 GiB.',
    )
  })

  test('searches as the 32-bit module does: the same PSMs, peptides and proteins', async () => {
    const [a, b] = [await search(w32), await search(w64)]
    expect(b.summary.files.map((f) => f.targetPSMs)).toEqual(a.summary.files.map((f) => f.targetPSMs))
    expect(b.tables.psms.count).toBe(a.tables.psms.count)
    expect(b.tables.psms.count).toBeGreaterThan(1500)
    expect([...b.tables.psms.score]).toEqual([...a.tables.psms.score])
    expect([...b.tables.psms.qValue]).toEqual([...a.tables.psms.qValue])
    expect(b.tables.peptides.openms).toEqual(a.tables.peptides.openms)
    // (the proteins in another order: the order of hashed containers differs between the builds)
    expect([...b.tables.proteins.accession].sort()).toEqual([...a.tables.proteins.accession].sort())
    expect([...b.spectra.mz]).toEqual([...a.spectra.mz])
    // and its idXML (read back in pieces)
    const xml = new TextDecoder().decode(idXML(w64, b.results))
    expect(xml.startsWith('<?xml')).toBe(true)
    expect(xml.trimEnd().endsWith('</IdXML>')).toBe(true)
  })

  test('PeptDeep with the shared models', async () => {
    const model = async (file: string) => new Blob([readFile(w64, `/public/openms/models/${file}`)])
    await loadModels(w64, model)
    await loadModels(w32, model)
    const ions = predict(w64, 'PEPTIDEK', 2, 30, 'QE')
    expect(ions.length).toBeGreaterThan(5)
    expect(ions).toEqual(predict(w32, 'PEPTIDEK', 2, 30, 'QE'))
  })
})
