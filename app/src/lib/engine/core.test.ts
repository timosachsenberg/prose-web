import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import {
  annotate,
  CHUNK_SIZE,
  CONTAMINANT_PREFIX,
  engineInfo,
  idXML,
  loadModels,
  MODELS_DIR,
  predict,
  POOLING,
  progressMapper,
  readFile,
  runSearch,
  searchError,
  searchSettings,
  transferList,
  withContaminants,
  writeBlob,
  type CoreInput,
  type CoreSearchOutcome,
  type CoreSearchRequest,
  type ModuleProgress,
  type SearchHooks,
} from './core'
import type { MainModule, OpenMSFactory } from './openms-types'
import { fileTooLargeMessage, isTooLarge, MAX_FILE_BYTES, type SearchProgress } from './protocol'

// The real threaded module (public/openms) in Node.js, on the example data of the app. The files are
// read through the module (public/ mounted at /public), so that the test needs no Node.js typings.

const publicDir = new URL('../../../public/', import.meta.url)
const decoder = new TextDecoder()

let OpenMS: MainModule
let mzML: Blob
let database: CoreInput
let crap: string
const read = (path: string) => readFile(OpenMS, `/public/${path}`)

// Node.js cannot read a Blob synchronously (the worker uses FileReaderSync): the test's Blobs are made
// from bytes it keeps, and its reader slices those
const bytesOf = new Map<Blob, Uint8Array>()
function blobOf(bytes: Uint8Array): Blob {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>])
  bytesOf.set(blob, bytes)
  return blob
}
/** The reads of the search (blob, offset, length), and what to do on each. */
let reads: { blob: Blob; offset: number; length: number }[] = []
let onRead: (blob: Blob, offset: number) => void = () => {}
const readSync: SearchHooks['readSync'] = (blob, offset, length) => {
  reads.push({ blob, offset, length })
  onRead(blob, offset)
  const bytes = bytesOf.get(blob)
  if (!bytes) throw new Error('readSync: a Blob the test did not make')
  return bytes.subarray(offset, offset + length)
}
const hooks = (more: Partial<SearchHooks> = {}): SearchHooks => ({ onProgress: () => {}, readSync, ...more })

/** Records the calls of OpenMS.allocateFile (an overloaded Embind function: its dispatcher looks up its overloads on the property). */
function spyAllocations() {
  const allocateFile = OpenMS.allocateFile as typeof OpenMS.allocateFile & { overloadTable: unknown }
  const calls: unknown[][] = []
  const spy = function (this: unknown, ...args: unknown[]) {
    calls.push(args)
    return (allocateFile as (...a: unknown[]) => void).apply(this, args)
  }
  OpenMS.allocateFile = Object.assign(spy, { overloadTable: allocateFile.overloadTable }) as unknown as typeof OpenMS.allocateFile
  return { calls, restore: () => (OpenMS.allocateFile = allocateFile) }
}
const exists = (path: string) => {
  try {
    OpenMS.FS.stat(path)
    return true
  } catch {
    return false
  }
}

beforeAll(async () => {
  const url = new URL('openms/openms.mjs', publicDir).href
  const { default: createOpenMS } = (await import(/* @vite-ignore */ url)) as { default: OpenMSFactory }
  const numThreads = Math.min(8, navigator.hardwareConcurrency || 1)
  OpenMS = await createOpenMS({ numThreads, print: () => {}, printErr: () => {} })
  OpenMS.setLogEnabled('info', false)
  OpenMS.mountHostDirectory('/public', decodeURIComponent(publicDir.pathname))
  mzML = blobOf(read('example/DatabaseSuitability_in_spec.mzML'))
  database = { name: 'DatabaseSuitability_database.fasta', data: new Blob([read('example/DatabaseSuitability_database.fasta')]) }
  crap = decoder.decode(read('fasta/crap.fasta'))
}, 60_000)

beforeEach(() => {
  reads = []
  onRead = () => {}
})

function request(names: string[], more: Partial<CoreSearchRequest> = {}): CoreSearchRequest {
  return {
    files: names.map((name) => ({ name, data: mzML })),
    database,
    contaminants: null,
    parameters: {},
    rescore: false,
    peptdeep: false,
    ...more,
  }
}

describe('withContaminants', () => {
  test('appends cRAP with CON__ accessions after the user entries', async () => {
    const user = new Blob(['>sp|P1|A_HUMAN first\nPEPTIDEK']) // no final newline
    const fasta = await (await withContaminants(user, crap)).text()
    expect(fasta.startsWith('>sp|P1|A_HUMAN first\nPEPTIDEK\n>CON__sp|ALBU_BOVIN|\n')).toBe(true)
    expect(fasta.match(/^>/gm)).toHaveLength(1 + 116)
    expect(fasta.match(/^>CON__/gm)).toHaveLength(116)
    expect(fasta).not.toMatch(/^>CON__CON__/m)
  })

  test('keeps an existing CON__ prefix and does not deduplicate', async () => {
    const user = new Blob(['>sp|ALBU_BOVIN|\nMKWV\n'])
    const fasta = await (await withContaminants(user, '>CON__P00761 trypsin\nIVGG\r\n>sp|ALBU_BOVIN|\nMKWV\n')).text()
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

  test('maps the files to [0, 0.95], monotone, and holds 0.95 while the files are pooled', () => {
    const map = progressMapper(2)
    const out = [
      event('Searching a.mzML (1 of 2)...', 0),
      event('Building fragment index...', 0, { depth: 1 }),
      event('Building fragment index...', 0, { depth: 1, event: 'end', value: 1 }),
      event('Scoring peptide models against spectra...', 0, { depth: 1, event: 'progress', end: 100, value: 50 }),
      event('Reading the spectra of the PSMs...', 0, { depth: 1 }),
      event('Searching a.mzML (1 of 2)...', 0, { event: 'end', value: 1 }),
      event('Searching b.mzML (2 of 2)...', 1),
      event('Scoring peptide models against spectra...', 1, { depth: 1, event: 'progress', end: 100, value: 10 }),
      event('Searching b.mzML (2 of 2)...', 1, { event: 'end', value: 1 }),
    ].map((p) => map(p))
    const expected = [0, 0, 0, 0.2375, 0.2375, 0.475, 0.475, 0.5225, 0.95]
    out.forEach((p, i) => expect(p.fraction).toBeCloseTo(expected[i], 12))
    expect(out[1]).toEqual({ label: 'Building fragment index...', file: 0, fraction: 0 })
    expect(out[5]).toEqual({ label: 'Searching a.mzML (1 of 2)...', file: 0, fraction: 0.475 })
    expect(out[7].file).toBe(1)
    // the end of the last file's step: the pooling of the files, which reports nothing
    expect(out[8]).toEqual({ label: POOLING, file: -1, fraction: 0.95 })
    // a nested step that ends in the last file is not its end
    expect(progressMapper(2)(event('Reading the spectra of the PSMs...', 1, { depth: 1, event: 'end', value: 1 })).label).toBe(
      'Reading the spectra of the PSMs...',
    )
    // one file: nothing to pool
    expect(progressMapper(1)(event('Searching a.mzML (1 of 1)...', 0, { event: 'end', value: 1 }))).toEqual({
      label: 'Searching a.mzML (1 of 1)...',
      file: 0,
      fraction: 0.95,
    })
  })

  test('names the chunks of a chunked search by the database (each file is searched on its own)', () => {
    const map = progressMapper(2)
    expect(map(event('  file 1 chunk 3', 1, { depth: 1 })).label).toBe('Searching database chunk 3...')
    expect(map(event('Building fragment index...', 1, { depth: 1 })).label).toBe('Building fragment index...')
  })

  test('holds the fraction for steps outside the files', () => {
    const map = progressMapper(1)
    expect(map(event('  file 1 chunk 1', -1))).toEqual({ label: 'file 1 chunk 1', file: -1, fraction: 0 })
    expect(map(event('  file 1 chunk 1', -1, { event: 'end', end: 10, value: 10 })).fraction).toBe(0)
    expect(map(event('Reading the spectra of the PSMs...', -1, { event: 'end', value: 1 })).fraction).toBe(0)
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

describe('searchError', () => {
  test('says what to do when Percolator rescored only some files', () => {
    const message =
      'InvalidParameter: Percolator rescored only some of the input files, and their PSMs cannot be pooled with ' +
      'the search engine scores of the others (not rescored: /input/1/small.mzML (Only 0 PSMs, Percolator ' +
      'rescoring needs at least 100.)). Search the files with { rescore: false }, or leave out those that could ' +
      'not be rescored.'
    expect((searchError(new Error(message)) as Error).message).toBe(
      'Percolator could rescore only some of the files, and their scores cannot be pooled with the others ' +
        '(not rescored: small.mzML (Only 0 PSMs, Percolator rescoring needs at least 100.)). Switch Percolator ' +
        'off, or leave out the files it could not rescore.',
    )
    const other = new Error('InvalidValue: the value of FDR:PSM is out of range')
    expect(searchError(other)).toBe(other)
  })
})

describe('the module', () => {
  const outcomes: CoreSearchOutcome[] = []
  afterAll(() => {
    for (const o of outcomes) o.results.delete()
  })

  test('reports the engine', () => {
    const info = engineInfo(OpenMS, false, 'wasm32')
    expect(info.version).toMatch(/^3\.7/)
    expect(info.variant).toBe('wasm32')
    // the largest file of the module's file system (2 GiB − 64 MiB), from the module
    expect(info.maxFileBytes).toBe(MAX_FILE_BYTES)
    expect(info.threaded).toBe(true)
    expect(info.threads).toBeGreaterThan(0)
    expect(info.onnx).toBe(true)
    expect(info.isolated).toBe(false)
    const rescore = info.parameters.find((e) => e.name === 'rescore')
    expect(rescore).toMatchObject({ type: 'bool', value: true })
    expect(info.parameters.find((e) => e.name === 'FDR:PSM')).toMatchObject({ min: 0, max: 1 })
  })

  test('writes and reads files in pieces', async () => {
    const bytes = Uint8Array.from({ length: 2500 }, (_, i) => (i * 7) & 255)
    await writeBlob(OpenMS, '/pieces.bin', new Blob([bytes]), 1000)
    expect(OpenMS.FS.stat('/pieces.bin').size).toBe(2500)
    expect(readFile(OpenMS, '/pieces.bin', 1000)).toEqual(bytes)
    // a file that exists is replaced, not appended to
    await writeBlob(OpenMS, '/pieces.bin', new Blob([bytes.subarray(0, 700)]), 1000)
    expect(readFile(OpenMS, '/pieces.bin', 300)).toEqual(bytes.subarray(0, 700))
    OpenMS.FS.unlink('/pieces.bin')
  })

  test('refuses a file larger than the module holds before the search', async () => {
    // the module holds a file of MAX_FILE_BYTES (2 GiB − 64 MiB), not one byte more
    expect(isTooLarge(MAX_FILE_BYTES)).toBe(false)
    expect(isTooLarge(MAX_FILE_BYTES + 1)).toBe(true)
    const huge = { name: 'huge.mzML', data: { size: MAX_FILE_BYTES + 1 } as Blob }
    const req = { ...request(['run.mzML']), files: [{ name: 'run.mzML', data: mzML }, huge] }
    const stages: string[] = []
    await expect(runSearch(OpenMS, req, hooks({ onStage: (s) => stages.push(s) }))).rejects.toThrow(
      'huge.mzML is too large (1.94 GiB); a file can be at most 1.93 GiB.',
    )
    expect(fileTooLargeMessage('x.mzML', 2.5 * 2 ** 30)).toBe('x.mzML is too large (2.5 GiB); a file can be at most 1.93 GiB.')
    expect(stages).toEqual([])
    expect(reads).toEqual([])
    expect(exists('/input')).toBe(false)
    // the database too
    const bigDatabase = { name: 'huge.fasta', data: { size: 3 * 2 ** 30 } as Blob }
    await expect(runSearch(OpenMS, { ...request(['run.mzML']), database: bigDatabase }, hooks())).rejects.toThrow(
      'huge.fasta is too large (3.0 GiB)',
    )
  })

  test('searches file by file with the same results as with all files written first', async () => {
    // the reference: the files and the database written to /input first, searched without provideFile
    const files = ['/input/0/first.mzML', '/input/1/second.mzML']
    const db = `/input/db/${database.name}`
    for (const path of [...files, db]) {
      OpenMS.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')), 0o777)
      await writeBlob(OpenMS, path, path === db ? database.data : mzML)
    }
    const prose = new OpenMS.ProSEAlgorithm()
    const reference = prose.searchFiles(files, db, { rescore: false, keepSpectra: true })
    const expected = { tables: reference.tables(), spectra: reference.spectra(), summary: reference.summary() }
    reference.delete()
    prose.delete()
    for (const path of [...files, db]) OpenMS.FS.unlink(path)

    // file by file: each file is there while it is searched, in a block of the largest file's size
    const allocations = spyAllocations()
    const present: Record<number, string[]> = {}
    onRead = (blob, offset) => {
      if (offset === 0) present[reads.length] = files.filter(exists)
    }
    try {
      const outcome = await runSearch(OpenMS, request(['first.mzML', 'second.mzML']), hooks())
      outcomes.push(outcome)
      expect(outcome.tables).toEqual(expected.tables)
      expect(outcome.spectra).toEqual(expected.spectra)
      expect(outcome.summary.files.map((f) => f.targetPSMs)).toEqual(expected.summary.files.map((f) => f.targetPSMs))
    } finally {
      allocations.restore()
    }

    // the database once at its size, the files with the size of the largest as capacity
    expect(allocations.calls).toEqual([
      [db, database.data.size, database.data.size],
      [files[0], mzML.size, mzML.size],
      [files[1], mzML.size, mzML.size],
    ])
    // the mzML files are read in bounded pieces, the first file is gone when the second is written
    expect(reads.every((r) => r.blob === mzML && r.length <= CHUNK_SIZE)).toBe(true)
    expect(reads.reduce((sum, r) => sum + Math.min(r.length, mzML.size - r.offset), 0)).toBe(2 * mzML.size)
    expect(Object.values(present)).toEqual([[files[0]], [files[1]]])
    expect(exists('/input')).toBe(false)
  }, 120_000)

  test('gives every file the capacity of the largest', async () => {
    const bytes = bytesOf.get(mzML)!
    const larger = new Uint8Array(bytes.length + 512)
    larger.set(bytes)
    larger.fill(0x0a, bytes.length) // line breaks after the root element: still the same mzML
    const allocations = spyAllocations()
    try {
      const req = { ...request([]), files: [{ name: 'small.mzML', data: mzML }, { name: 'large.mzML', data: blobOf(larger) }] }
      const outcome = await runSearch(OpenMS, req, hooks())
      outcomes.push(outcome)
      expect(outcome.summary.files.map((f) => f.ms2Spectra)).toEqual([2789, 2789])
    } finally {
      allocations.restore()
    }
    expect(allocations.calls.slice(1)).toEqual([
      ['/input/0/small.mzML', bytes.length, larger.length],
      ['/input/1/large.mzML', larger.length, larger.length],
    ])
  }, 60_000)

  test('after a fatal error the module is not called again, not even to clean up', async () => {
    // a trap while the second file is written (simulated: the module itself is fine)
    onRead = () => {
      if (reads.length === 2) throw new WebAssembly.RuntimeError('unreachable')
    }
    const error = await runSearch(OpenMS, request(['first.mzML', 'second.mzML']), hooks()).catch((e: unknown) => e)
    // the error itself, not searchFiles()' wrapping of its message (which would not say that it is fatal)
    expect(error).toBeInstanceOf(WebAssembly.RuntimeError)
    // the first file was released after its search; the second (half written) and /input stay
    expect(exists('/input/0/first.mzML')).toBe(false)
    expect(exists('/input/1/second.mzML')).toBe(true)

    // (the module is fine here: the next search cleans up)
    onRead = () => {}
    const outcome = await runSearch(OpenMS, request(['run.mzML']), hooks())
    outcomes.push(outcome)
    expect(exists('/input')).toBe(false)
  }, 120_000)

  test('a file that cannot be read ends the search with its error, and a failing cleanup does not hide it', async () => {
    const req = request(['first.mzML', 'second.mzML', 'third.mzML'])
    // the second file (one piece each) cannot be read, e.g. it was removed from the disk meanwhile
    onRead = () => {
      if (reads.length === 2) throw new Error('NotReadableError: second.mzML could not be read.')
    }
    const failed = /provideFile\(1, '\/input\/1\/second\.mzML'\) threw: .*NotReadableError: second\.mzML could not be read\./
    await expect(runSearch(OpenMS, req, hooks())).rejects.toThrow(failed)
    expect(reads).toHaveLength(2) // the third file was not read
    expect(exists('/input')).toBe(false)

    // the cleanup fails as well (after a trap the file system may): the error is still the file's
    reads = []
    const rmdir = OpenMS.FS.rmdir
    OpenMS.FS.rmdir = () => {
      throw new Error('rmdir failed')
    }
    try {
      await expect(runSearch(OpenMS, req, hooks())).rejects.toThrow(failed)
    } finally {
      OpenMS.FS.rmdir = rmdir
    }
    // every file was released after its turn, also the one that failed
    expect(['/input/0/first.mzML', '/input/1/second.mzML', '/input/2/third.mzML'].filter(exists)).toEqual([])

    // the module searches on (and cleans up what is left)
    onRead = () => {}
    const outcome = await runSearch(OpenMS, request(['run.mzML']), hooks())
    outcomes.push(outcome)
    expect(outcome.summary.files[0].targetPSMs).toBeGreaterThan(800)
    expect(exists('/input')).toBe(false)
  }, 120_000)

  test('searches two files and returns typed columns', async () => {
    const progress: SearchProgress[] = []
    const stages: string[] = []
    const outcome = await runSearch(
      OpenMS,
      request(['first.mzML', 'second.mzML'], { rescore: true }),
      hooks({ onProgress: (p) => progress.push(p), onStage: (s) => stages.push(s) }),
    )
    outcomes.push(outcome)
    const { summary, tables, spectra } = outcome

    // the database, then each file is written (reading) and searched
    expect(stages).toEqual(['reading', 'searching', 'reading', 'searching', 'reading', 'searching'])
    expect(summary.files).toHaveLength(2)
    expect(summary.files.map((f) => f.percolator?.applied)).toEqual([true, true])
    expect(tables.files).toEqual(['/input/0/first.mzML', '/input/1/second.mzML'])
    expect(exists('/input')).toBe(false) // removed after the search
    expect(tables.psms.count).toBeGreaterThan(1000)
    expect(tables.psms.qValue).toBeInstanceOf(Float64Array)
    expect(tables.psms.file).toBeInstanceOf(Uint16Array)
    expect(new Set(tables.psms.file)).toEqual(new Set([0, 1]))
    expect(spectra.psmSpectrum).toHaveLength(tables.psms.count)
    const kept = spectra.psmSpectrum.filter((s) => s >= 0).length
    expect(kept / tables.psms.count).toBeGreaterThan(0.9)
    expect(outcome.seconds).toBeGreaterThan(0)

    // progress: per file, the spectra of its PSMs in its step; monotone; the files end at 0.95 (the
    // pooling after them reports nothing)
    const fractions = progress.map((p) => p.fraction)
    expect(fractions.every((f, i) => f >= 0 && f <= 1 && (i === 0 || f >= fractions[i - 1]))).toBe(true)
    expect(progress.some((p) => p.file === 0 && p.label === 'Searching first.mzML (1 of 2)...')).toBe(true)
    expect(progress.some((p) => p.file === 1 && p.label === 'Reading the spectra of the PSMs...')).toBe(true)
    expect(progress.some((p) => p.file === 1 && p.fraction >= 0.475)).toBe(true)
    expect(progress.at(-1)).toEqual({ label: 'Pooling the files...', file: -1, fraction: 0.95 })

    // the result set stays for idXML, read back in pieces
    const xml = idXML(OpenMS, outcome.results)
    expect(decoder.decode(xml.subarray(0, 5))).toBe('<?xml')
    expect(decoder.decode(xml.subarray(-20)).trimEnd().endsWith('</IdXML>')).toBe(true)

    // the stored peaks of a PSM annotate with its peptide
    const row = spectra.psmSpectrum.findIndex((s) => s >= 0)
    const s = spectra.psmSpectrum[row]
    const [from, to] = [spectra.offsets[s], spectra.offsets[s + 1]]
    const peptide = tables.peptides.openms[tables.psms.peptide[row]]
    const [mz, intensity] = [spectra.mz.subarray(from, to), spectra.intensity.subarray(from, to)]
    const annotation = annotate(OpenMS, mz, intensity, peptide, tables.psms.charge[row], null)
    expect(annotation.matches.length).toBeGreaterThan(3)

    // the typed arrays go to the page without copies (last: this detaches them here)
    const transfer = transferList([tables, spectra], true)
    expect(new Set(transfer).size).toBe(transfer.length)
    expect(transfer.length).toBeGreaterThan(30)
    const [count, peaks] = [tables.psms.count, spectra.mz.length]
    const copy = structuredClone({ tables, spectra }, { transfer })
    expect(copy.tables.psms.qValue).toHaveLength(count)
    expect(copy.spectra.mz).toHaveLength(peaks)
    expect(tables.psms.qValue.byteLength).toBe(0) // transferred, not copied
    expect(spectra.mz.byteLength).toBe(0)
  }, 120_000)

  test('writes inputs to distinct paths', async () => {
    const outcome = await runSearch(OpenMS, request(['run.mzML', 'run.mzML']), hooks())
    outcomes.push(outcome)
    expect(outcome.summary.files.map((f) => f.path)).toEqual(['/input/0/run.mzML', '/input/1/run.mzML'])
    expect(outcome.summary.files.map((f) => f.ms2Spectra)).toEqual([2789, 2789])
    for (const f of outcome.summary.files) expect(f.targetPSMs).toBeGreaterThan(800)
    expect(outcome.summary.files.map((f) => f.percolator)).toEqual([null, null])
  }, 60_000)

  test('searches the contaminants with CON__ accessions', async () => {
    const outcome = await runSearch(OpenMS, request(['run.mzML'], { contaminants: crap }), hooks())
    outcomes.push(outcome)
    const accessions = outcome.tables.proteins.accession
    expect(accessions.some((a) => a.startsWith(CONTAMINANT_PREFIX))).toBe(true)
    expect(accessions.some((a) => a.startsWith(`${CONTAMINANT_PREFIX}${CONTAMINANT_PREFIX}`))).toBe(false)
  }, 60_000)

  test('explains a partial rescoring', async () => {
    // an mzML without spectra: Percolator cannot rescore it, but it does rescore the example
    const file = new OpenMS.MzMLFile()
    const empty = new OpenMS.MSExperiment()
    file.store('/empty.mzML', empty)
    file.delete()
    empty.delete()
    const emptyFile = { name: 'empty.mzML', data: blobOf(readFile(OpenMS, '/empty.mzML')) }
    OpenMS.FS.unlink('/empty.mzML')
    const req = { ...request(['run.mzML'], { rescore: true }), files: [{ name: 'run.mzML', data: mzML }, emptyFile] }
    await expect(runSearch(OpenMS, req, hooks())).rejects.toThrow(
      /^Percolator could rescore only some of the files.*\(not rescored: empty\.mzML .*Switch Percolator off/,
    )
    expect(exists('/input')).toBe(false)
  }, 120_000)

  test('loads the PeptDeep models once and searches with them', async () => {
    const fetched: string[] = []
    const fetchModel = async (name: string) => {
      fetched.push(name)
      return new Blob([read(`openms/models/${name}`)])
    }
    await loadModels(OpenMS, fetchModel)
    await loadModels(OpenMS, fetchModel)
    expect(fetched).toEqual(['peptdeep_ms2_dynamic.onnx', 'peptdeep_rt_dynamic.onnx'])
    expect(OpenMS.FS.stat(`${MODELS_DIR}/peptdeep_ms2_dynamic.onnx`).size).toBe(16237746)

    const outcome = await runSearch(OpenMS, request(['run.mzML'], { rescore: true, peptdeep: true }), hooks())
    outcomes.push(outcome)
    expect(outcome.summary.files[0].peptdeepNce).not.toBeNull()
    expect(outcome.tables.psms.featureNames).toContain('ms2_cosine')

    const ions = predict(OpenMS, 'AVM(Oxidation)DDFAAFVEK', 2, 30, 'QE')
    expect(ions.length).toBeGreaterThan(5)
    expect(ions[0]).toMatchObject({ type: expect.stringMatching(/^[by]$/), charge: 1 })
  }, 120_000)

  test('refuses PeptDeep without its models', async () => {
    // a fresh /models: the search must not start without the models
    let names: string[] = []
    try {
      names = OpenMS.FS.readdir(MODELS_DIR)
    } catch {
      // no /models
    }
    for (const name of names) if (name !== '.' && name !== '..') OpenMS.FS.unlink(`${MODELS_DIR}/${name}`)
    await expect(runSearch(OpenMS, request(['run.mzML'], { peptdeep: true }), hooks())).rejects.toThrow(/PeptDeep model/)
  })
})
