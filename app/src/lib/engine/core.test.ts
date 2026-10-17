import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type createOpenMSType from '../../../public/openms/openms'
import {
  annotate,
  CONTAMINANT_PREFIX,
  engineInfo,
  idXML,
  loadModels,
  MODELS_DIR,
  predict,
  progressMapper,
  runSearch,
  searchSettings,
  transferList,
  withContaminants,
  type CoreInput,
  type CoreSearchOutcome,
  type CoreSearchRequest,
  type ModuleProgress,
} from './core'
import type { MainModule } from './openms-types'
import type { SearchProgress } from './protocol'

// The real threaded module (public/openms) in Node.js, on the example data of the app. The files are
// read through the module (public/ mounted at /public), so that the test needs no Node.js typings.

const publicDir = new URL('../../../public/', import.meta.url)
const decoder = new TextDecoder()

let OpenMS: MainModule
let mzML: Uint8Array
let database: CoreInput
let crap: string
const read = (path: string): Uint8Array => OpenMS.FS.readFile(`/public/${path}`).slice()

beforeAll(async () => {
  const url = new URL('openms/openms.mjs', publicDir).href
  const { default: createOpenMS } = (await import(/* @vite-ignore */ url)) as { default: typeof createOpenMSType }
  const numThreads = Math.min(8, navigator.hardwareConcurrency || 1)
  OpenMS = await createOpenMS({ numThreads, print: () => {}, printErr: () => {} })
  OpenMS.setLogEnabled('info', false)
  OpenMS.mountHostDirectory('/public', decodeURIComponent(publicDir.pathname))
  mzML = read('example/DatabaseSuitability_in_spec.mzML')
  database = { name: 'DatabaseSuitability_database.fasta', bytes: read('example/DatabaseSuitability_database.fasta') }
  crap = decoder.decode(read('fasta/crap.fasta'))
}, 60_000)

function request(names: string[], more: Partial<CoreSearchRequest> = {}): CoreSearchRequest {
  return {
    files: names.map((name) => ({ name, bytes: mzML })),
    database,
    contaminants: null,
    parameters: {},
    rescore: false,
    peptdeep: false,
    ...more,
  }
}

describe('withContaminants', () => {
  test('appends cRAP with CON__ accessions after the user entries', () => {
    const user = new TextEncoder().encode('>sp|P1|A_HUMAN first\nPEPTIDEK') // no final newline
    const fasta = decoder.decode(withContaminants(user, crap))
    expect(fasta.startsWith('>sp|P1|A_HUMAN first\nPEPTIDEK\n>CON__sp|ALBU_BOVIN|\n')).toBe(true)
    expect(fasta.match(/^>/gm)).toHaveLength(1 + 116)
    expect(fasta.match(/^>CON__/gm)).toHaveLength(116)
    expect(fasta).not.toMatch(/^>CON__CON__/m)
  })

  test('keeps an existing CON__ prefix and does not deduplicate', () => {
    const user = new TextEncoder().encode('>sp|ALBU_BOVIN|\nMKWV\n')
    const fasta = decoder.decode(withContaminants(user, '>CON__P00761 trypsin\nIVGG\r\n>sp|ALBU_BOVIN|\nMKWV\n'))
    expect(fasta).toBe('>sp|ALBU_BOVIN|\nMKWV\n>CON__P00761 trypsin\nIVGG\r\n>CON__sp|ALBU_BOVIN|\nMKWV\n')
  })
})

describe('searchSettings', () => {
  test('maps rescore to the search option and peptdeep to its parameters', () => {
    const plain = searchSettings({ parameters: { 'FDR:PSM': 0.01 }, rescore: false, peptdeep: false })
    expect(plain.options).toEqual({ rescore: false, keepSpectra: true })
    expect(plain.parameters).toEqual({ 'FDR:PSM': 0.01, 'peptdeep:enable': false })

    const deep = searchSettings({ parameters: { 'peptdeep:enable': false }, rescore: true, peptdeep: true })
    expect(deep.options).toEqual({ rescore: true, keepSpectra: true })
    expect(deep.parameters).toEqual({
      'peptdeep:enable': true,
      'peptdeep:ms2_model': `${MODELS_DIR}/peptdeep_ms2_dynamic.onnx`,
      'peptdeep:rt_model': `${MODELS_DIR}/peptdeep_rt_dynamic.onnx`,
    })
  })
})

describe('progressMapper', () => {
  const event = (label: string, file: number, more: Partial<ModuleProgress> = {}): ModuleProgress => ({
    event: 'start', label, depth: 0, begin: 0, end: 1, value: 0, file, ...more,
  })

  test('maps the files to [0, 0.95] and the spectra to [0.95, 1], monotone', () => {
    const map = progressMapper(2)
    const out = [
      event('Searching a.mzML (1 of 2)...', 0),
      event('Building fragment index...', 0, { depth: 1 }),
      event('Building fragment index...', 0, { depth: 1, event: 'end', value: 1 }),
      event('Scoring peptide models against spectra...', 0, { depth: 1, event: 'progress', end: 100, value: 50 }),
      event('Post-processing PSMs...', 0, { depth: 1 }),
      event('Searching a.mzML (1 of 2)...', 0, { event: 'end', value: 1 }),
      event('Searching b.mzML (2 of 2)...', 1),
      event('Scoring peptide models against spectra...', 1, { depth: 1, event: 'progress', end: 100, value: 10 }),
      event('Searching b.mzML (2 of 2)...', 1, { event: 'end', value: 1 }),
      event('Reading the spectra of the PSMs...', -1, { end: 10 }),
      event('Reading the spectra of the PSMs...', -1, { event: 'progress', end: 10, value: 5 }),
      event('Reading the spectra of the PSMs...', -1, { event: 'end', end: 10, value: 10 }),
    ].map((p) => map(p))
    const expected = [0, 0, 0, 0.2375, 0.2375, 0.475, 0.475, 0.5225, 0.95, 0.95, 0.975, 1]
    out.forEach((p, i) => expect(p.fraction).toBeCloseTo(expected[i], 12))
    expect(out[1]).toEqual({ label: 'Building fragment index...', file: 0, fraction: 0 })
    expect(out[7].file).toBe(1)
    expect(out[11].fraction).toBe(1)
  })

  test('holds the fraction for steps outside the files (chunked search)', () => {
    const map = progressMapper(1)
    expect(map(event('  file 1 chunk 1', -1))).toEqual({ label: 'file 1 chunk 1', file: -1, fraction: 0 })
    expect(map(event('  file 1 chunk 1', -1, { event: 'end', end: 10, value: 10 })).fraction).toBe(0)
    expect(map(event('Reading the spectra of the PSMs...', -1, { event: 'end', value: 1 })).fraction).toBe(1)
  })
})

describe('transferList', () => {
  test('lists each buffer once and refuses shared memory', () => {
    const a = new Float64Array(4)
    const view = new Uint8Array(a.buffer, 8, 8)
    const b = new Int32Array(2)
    expect(transferList([{ a, nested: { view, b, names: ['x'] }, count: 2 }], true)).toEqual([a.buffer, b.buffer])

    const shared = { heap: new Uint8Array(new SharedArrayBuffer(8)) }
    expect(() => transferList([shared], true)).toThrow(/shared memory/)
    const copied = { heap: shared.heap }
    expect(transferList([copied], false)).toEqual([copied.heap.buffer])
    expect(copied.heap.buffer).toBeInstanceOf(ArrayBuffer)
  })
})

describe('the module', () => {
  const outcomes: CoreSearchOutcome[] = []
  afterAll(() => {
    for (const o of outcomes) o.results.delete()
  })

  test('reports the engine', () => {
    const info = engineInfo(OpenMS, false)
    expect(info.version).toMatch(/^3\.7/)
    expect(info.threaded).toBe(true)
    expect(info.threads).toBeGreaterThan(0)
    expect(info.onnx).toBe(true)
    expect(info.isolated).toBe(false)
    const rescore = info.parameters.find((e) => e.name === 'rescore')
    expect(rescore).toMatchObject({ type: 'bool', value: true })
    expect(info.parameters.find((e) => e.name === 'FDR:PSM')).toMatchObject({ min: 0, max: 1 })
  })

  test('searches two files and returns typed columns', () => {
    const progress: SearchProgress[] = []
    const outcome = runSearch(OpenMS, request(['first.mzML', 'second.mzML'], { rescore: true }), (p) => progress.push(p))
    outcomes.push(outcome)
    const { summary, tables, spectra } = outcome

    expect(summary.files).toHaveLength(2)
    expect(summary.files.map((f) => f.percolator?.applied)).toEqual([true, true])
    expect(tables.files).toEqual(['/input/0/first.mzML', '/input/1/second.mzML'])
    expect(tables.psms.count).toBeGreaterThan(1000)
    expect(tables.psms.qValue).toBeInstanceOf(Float64Array)
    expect(tables.psms.file).toBeInstanceOf(Uint16Array)
    expect(new Set(tables.psms.file)).toEqual(new Set([0, 1]))
    expect(spectra.psmSpectrum).toHaveLength(tables.psms.count)
    const kept = spectra.psmSpectrum.filter((s) => s >= 0).length
    expect(kept / tables.psms.count).toBeGreaterThan(0.9)
    expect(outcome.seconds).toBeGreaterThan(0)

    // progress: per file, then the spectra; monotone; ends at 1
    const fractions = progress.map((p) => p.fraction)
    expect(fractions.every((f, i) => f >= 0 && f <= 1 && (i === 0 || f >= fractions[i - 1]))).toBe(true)
    expect(progress.some((p) => p.file === 0 && p.label === 'Searching first.mzML (1 of 2)...')).toBe(true)
    expect(progress.some((p) => p.file === 1 && p.fraction >= 0.475)).toBe(true)
    expect(progress.at(-1)).toEqual({ label: 'Reading the spectra of the PSMs...', file: -1, fraction: 1 })

    // the typed arrays go to the page without copies, and the result set stays for idXML
    const buffers = transferList([tables, spectra], true)
    expect(new Set(buffers).size).toBe(buffers.length)
    expect(buffers.length).toBeGreaterThan(30)
    expect(decoder.decode(idXML(OpenMS, outcome.results).subarray(0, 5))).toBe('<?xml')

    // the stored peaks of a PSM annotate with its peptide
    const row = spectra.psmSpectrum.findIndex((s) => s >= 0)
    const s = spectra.psmSpectrum[row]
    const [from, to] = [spectra.offsets[s], spectra.offsets[s + 1]]
    const peptide = tables.peptides.openms[tables.psms.peptide[row]]
    const [mz, intensity] = [spectra.mz.subarray(from, to), spectra.intensity.subarray(from, to)]
    const annotation = annotate(OpenMS, mz, intensity, peptide, tables.psms.charge[row], null)
    expect(annotation.matches.length).toBeGreaterThan(3)
  }, 120_000)

  test('writes inputs to distinct paths', () => {
    const outcome = runSearch(OpenMS, request(['run.mzML', 'run.mzML']), () => {})
    outcomes.push(outcome)
    expect(outcome.summary.files.map((f) => f.path)).toEqual(['/input/0/run.mzML', '/input/1/run.mzML'])
    expect(outcome.summary.files.map((f) => f.ms2Spectra)).toEqual([2789, 2789])
    for (const f of outcome.summary.files) expect(f.targetPSMs).toBeGreaterThan(800)
    expect(outcome.summary.files.map((f) => f.percolator)).toEqual([null, null])
  }, 60_000)

  test('searches the contaminants with CON__ accessions', () => {
    const outcome = runSearch(OpenMS, request(['run.mzML'], { contaminants: crap }), () => {})
    outcomes.push(outcome)
    const accessions = outcome.tables.proteins.accession
    expect(accessions.some((a) => a.startsWith(CONTAMINANT_PREFIX))).toBe(true)
    expect(accessions.some((a) => a.startsWith(`${CONTAMINANT_PREFIX}${CONTAMINANT_PREFIX}`))).toBe(false)
  }, 60_000)

  test('loads the PeptDeep models once and searches with them', async () => {
    const fetched: string[] = []
    const fetchModel = async (name: string) => {
      fetched.push(name)
      return read(`openms/models/${name}`)
    }
    await loadModels(OpenMS, fetchModel)
    await loadModels(OpenMS, fetchModel)
    expect(fetched).toEqual(['peptdeep_ms2_dynamic.onnx', 'peptdeep_rt_dynamic.onnx'])

    const outcome = runSearch(OpenMS, request(['run.mzML'], { rescore: true, peptdeep: true }), () => {})
    outcomes.push(outcome)
    expect(outcome.summary.files[0].peptdeepNce).not.toBeNull()
    expect(outcome.tables.psms.featureNames).toContain('ms2_cosine')

    const ions = predict(OpenMS, 'AVM(Oxidation)DDFAAFVEK', 2, 30, 'QE')
    expect(ions.length).toBeGreaterThan(5)
    expect(ions[0]).toMatchObject({ type: expect.stringMatching(/^[by]$/), charge: 1 })
  }, 120_000)

  test('refuses PeptDeep without its models', () => {
    // a fresh /models: the search must not start without the models
    let names: string[] = []
    try {
      names = OpenMS.FS.readdir(MODELS_DIR)
    } catch {
      // no /models
    }
    for (const name of names) if (name !== '.' && name !== '..') OpenMS.FS.unlink(`${MODELS_DIR}/${name}`)
    expect(() => runSearch(OpenMS, request(['run.mzML'], { peptdeep: true }), () => {})).toThrow(/PeptDeep model/)
  })
})
