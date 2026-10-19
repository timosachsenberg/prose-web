/// <reference types="node" />
// (Node for the test that runs Python's zipfile and unzip on a written project)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { crc32 } from './crc32'
import { makeTables } from '../results/synthetic'
import { bytesEqual, indexOfBytes, largeRecord, recordOfTables, smallRecord } from './fixtures'
import { compression, DEFLATE_GAIN, projectFileName, readProject, writeProject, writeProjectBlob } from './project'
import { packRecord, ProjectError, ProjectVersionError, type SearchRecord } from './record'

/** Every array of a record as bytes, by name: two records are equal when these are. */
function arraysOf(record: SearchRecord): Map<string, Uint8Array> {
  return new Map(packRecord(record).arrays.map((a) => [a.name, a.bytes.slice()]))
}

function expectSameArrays(actual: SearchRecord, expected: SearchRecord) {
  const a = arraysOf(actual)
  const e = arraysOf(expected)
  expect([...a.keys()]).toEqual([...e.keys()])
  for (const [name, bytes] of e) expect(bytesEqual(a.get(name)!, bytes), name).toBe(true)
}

/** The project as a zip with the manifest changed. */
function withManifest(bytes: Uint8Array, change: (manifest: Record<string, unknown>) => void): Uint8Array {
  const files = unzipSync(bytes)
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']))
  change(manifest)
  files['manifest.json'] = strToU8(JSON.stringify(manifest))
  return zipSync(files)
}

/** The compression method of each entry, from the zip's central directory. */
function methodsOf(zip: Uint8Array): Map<string, number> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  let eocd = zip.length - 22
  while (view.getUint32(eocd, true) !== 0x06054b50) eocd--
  const out = new Map<string, number>()
  let at = view.getUint32(eocd + 16, true)
  for (let i = 0; i < view.getUint16(eocd + 10, true); i++) {
    const nameLength = view.getUint16(at + 28, true)
    out.set(new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength)), view.getUint16(at + 10, true))
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  return out
}

/** Runs `check` with `compression` changed, and restores it. */
async function withCompression(change: Partial<typeof compression>, check: () => unknown): Promise<void> {
  const saved = { ...compression }
  Object.assign(compression, change)
  try {
    await check()
  } finally {
    Object.assign(compression, saved)
  }
}

describe('crc32', () => {
  it('is the zip checksum', () => {
    expect(crc32(strToU8('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array(0))).toBe(0)
    const data = Uint8Array.from({ length: 1001 }, (_, i) => (i * 31) & 0xff)
    expect(crc32(data.subarray(500), crc32(data.subarray(0, 500)))).toBe(crc32(data))
  })
})

describe('writeProject / readProject', () => {
  it('round-trips every typed array of the record, byte for byte', () => {
    const record = smallRecord()
    const back = readProject(writeProject(record))
    expectSameArrays(back, record)
    expect(back.summary).toEqual(record.summary)
    expect(back.summary.files[0].secondsSearch).toBeNaN()
    expect(back.design).toEqual(record.design)
    expect(back.settings).toEqual(record.settings)
    expect({ id: back.id, name: back.name, createdAt: back.createdAt, schema: back.schema }).toEqual({
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      schema: 1,
    })
    expect(back.appVersion).toBe(record.appVersion)
    expect(back.moduleVersion).toBe('3.6.0-pre-prose')
    expect({ psmFdr: back.psmFdr, proteinFdr: back.proteinFdr, seconds: back.seconds }).toEqual({
      psmFdr: 0.01,
      proteinFdr: 0.05,
      seconds: 12.5,
    })
  })

  it('is a zip of manifest.json and one .bin per array that any zip tool reads', () => {
    const record = smallRecord()
    const files = unzipSync(writeProject(record))
    const names = Object.keys(files)
    expect(names[0]).toBe('manifest.json')
    expect(names.slice(1)).toEqual([...arraysOf(record).keys()])
    expect(names.slice(1).every((n) => n.endsWith('.bin'))).toBe(true)
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']))
    expect(manifest).toMatchObject({ format: 'prose-project', schema: 1, appVersion: record.appVersion, moduleVersion: '3.6.0-pre-prose' })
    const score = record.tables.psms.score
    expect(bytesEqual(files['tables.psms.score.bin'], new Uint8Array(score.buffer, score.byteOffset, score.byteLength))).toBe(true)
  })

  it('handles a record without spectra', () => {
    const record = smallRecord()
    record.spectra = {
      psmSpectrum: new Int32Array(record.tables.psms.count).fill(-1),
      offsets: new Uint32Array(1),
      mz: new Float32Array(0),
      intensity: new Float32Array(0),
      precursorMz: new Float64Array(0),
      collisionEnergy: new Float32Array(0),
    }
    expectSameArrays(readProject(writeProject(record)), record)
  })

  it('reads a Blob and a File, as a promise', async () => {
    const record = smallRecord()
    const bytes = writeProject(record)
    const fromBlob = readProject(new Blob([bytes as BlobPart]))
    expect(fromBlob).toBeInstanceOf(Promise)
    expectSameArrays(await fromBlob, record)
    expectSameArrays(await readProject(new File([bytes as BlobPart], 'run.prose')), record)
  })

  it('writes a Blob that is the same project, and reports its progress', async () => {
    const record = largeRecord(3000, 40)
    const seen: number[] = []
    const blob = await writeProjectBlob(record, { onProgress: (f) => seen.push(f) })
    expect(blob.type).toBe('application/zip')
    expect(seen.at(-1)).toBe(1)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
    expectSameArrays(await readProject(blob), record)
  })

  it('writes the same project without CompressionStream (browsers that lack it) and with it', async () => {
    const record = largeRecord(3000, 40)
    const before = arraysOf(record)
    const native = compression.native
    try {
      for (const useNative of [true, false]) {
        compression.native = useNative
        const blob = await writeProjectBlob(record)
        expectSameArrays(await readProject(blob), record)
      }
    } finally {
      compression.native = native
    }
    // writing does not touch (or detach) the record's own arrays
    for (const [name, bytes] of before) expect(bytesEqual(arraysOf(record).get(name)!, bytes), name).toBe(true)
  })

  it('writes a project that standard zip tools read: sizes, names and checksums in order', async () => {
    const record = smallRecord()
    const blob = await writeProjectBlob(record)
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(Object.keys(files)[0]).toBe('manifest.json')
    expect(Object.keys(files).slice(1)).toEqual([...arraysOf(record).keys()])
    for (const [name, bytes] of arraysOf(record)) expect(bytesEqual(files[name], bytes), name).toBe(true)
  })

  it('survives a column that begins with zeros (fflate\'s streaming Deflate writes an invalid stream for this one)', async () => {
    const tables = makeTables({
      files: ['a.mzML'],
      proteins: [{ accession: 'P1', sequence: 'AAAAAKCCCCCK' }],
      peptides: [{ sequence: 'AAAAAK', proteins: [0] }],
      psms: Array.from({ length: 12 }, () => ({ peptide: 0 })),
    })
    tables.psms.isotopeError.set([0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0])
    const record = recordOfTables(tables)
    expectSameArrays(readProject(writeProject(record)), record)
    expectSameArrays(await readProject(await writeProjectBlob(record)), record)
    expect(Array.from(readProject(writeProject(record)).tables.psms.isotopeError)).toEqual([0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0])
  })

  it('compresses: the project is smaller than its arrays', () => {
    const record = largeRecord(3000, 40)
    const total = [...arraysOf(record).values()].reduce((n, b) => n + b.length, 0)
    expect(writeProject(record).length).toBeLessThan(total)
  })

  // 12,000 PSMs with about 125 peaks each: 6 MB of float32 m/z and as much intensity
  const peaksRecord = () => largeRecord(12_000, 125)

  it('stores the arrays that deflate barely shrinks (the float32 peaks) and deflates the others', async () => {
    const record = peaksRecord()
    for (const bytes of [writeProject(record), new Uint8Array(await (await writeProjectBlob(record)).arrayBuffer())]) {
      const methods = methodsOf(bytes)
      expect(methods.get('spectra.mz.bin')).toBe(0)
      expect(methods.get('spectra.intensity.bin')).toBe(0)
      expect(methods.get('manifest.json')).toBe(8)
      expect(methods.get('tables.psms.charge.bin')).toBe(8)
      expect(methods.get('tables.psms.nativeId.bin')).toBe(8)
      // (the rule: deflated only to DEFLATE_GAIN of the size or less)
      const files = unzipSync(bytes)
      const mz = files['spectra.mz.bin']
      expect(zipSync({ x: mz }, { level: 1 }).length).toBeGreaterThan(DEFLATE_GAIN * mz.length * 0.95)
      expectSameArrays(readProject(bytes), record)
    }
  })

  it('reads stored and deflated entries piece by piece, with and without DecompressionStream', async () => {
    const record = peaksRecord()
    const blob = await writeProjectBlob(record)
    for (const nativeInflate of [true, false]) {
      // every deflated entry in slices, not only the large ones
      await withCompression({ nativeInflate, inflateAtOnce: 0 }, async () => {
        const seen: number[] = []
        expectSameArrays(await readProject(blob, { onProgress: (f) => seen.push(f) }), record)
        expect(seen.at(-1)).toBe(1)
        expect(seen).toEqual([...seen].sort((a, b) => a - b))
      })
    }
  })

  it('writes projects that Python\'s zipfile and unzip -t accept, stored entries included', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prose-zip-'))
    try {
      const record = peaksRecord()
      for (const [name, bytes] of [
        ['sync.prose', writeProject(record)],
        ['blob.prose', new Uint8Array(await (await writeProjectBlob(record)).arrayBuffer())],
      ] as const) {
        const path = join(dir, name)
        writeFileSync(path, bytes)
        const python = 'import sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nprint(z.testzip(), len(z.namelist()), sorted({i.compress_type for i in z.infolist()}))'
        expect(execFileSync('python3', ['-I', '-c', python, path], { encoding: 'utf8' }).trim()).toBe(`None ${methodsOf(bytes).size} [0, 8]`)
        expect(execFileSync('unzip', ['-t', path], { encoding: 'utf8' })).toMatch(/No errors detected/)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('readProject refuses', () => {
  const good = () => writeProject(smallRecord())

  it('a project of a newer schema, with a message that says so', async () => {
    const newer = withManifest(good(), (m) => (m.schema = 2))
    expect(() => readProject(newer)).toThrow(ProjectVersionError)
    expect(() => readProject(newer)).toThrow(/^This project was saved by a newer version of ProSE \(schema 2\)/)
    await expect(readProject(new Blob([newer as BlobPart]))).rejects.toThrow(ProjectVersionError)
  })

  it('a project of a schema that does not exist', () => {
    expect(() => readProject(withManifest(good(), (m) => (m.schema = 0)))).toThrow(/no valid schema version/)
  })

  it.each([
    ['text', () => strToU8('this is not a project file at all, just text of some length')],
    ['nothing', () => new Uint8Array(0)],
    ['a few bytes', () => new Uint8Array([80, 75, 3, 4])],
    ['a cut-off zip', () => good().subarray(0, 2000)],
  ])('%s, as not a zip archive', async (_name, make) => {
    expect(() => readProject(make())).toThrow(/zip archive/)
    await expect(readProject(new Blob([make() as BlobPart]))).rejects.toThrow(/zip archive/)
  })

  it('a zip without a manifest', () => {
    expect(() => readProject(zipSync({ 'a.txt': strToU8('hello') }))).toThrow(/no manifest\.json/)
  })

  it('a zip of something else', () => {
    expect(() => readProject(zipSync({ 'manifest.json': strToU8('{"hello": 1}') }))).toThrow(/not a ProSE project/)
    expect(() => readProject(zipSync({ 'manifest.json': strToU8('not json') }))).toThrow(/not valid JSON/)
  })

  it('a project with an array missing, naming it', () => {
    const files = unzipSync(good())
    delete files['tables.psms.score.bin']
    expect(() => readProject(zipSync(files))).toThrow(/tables\.psms\.score\.bin is missing/)
  })

  it('a project whose array has the wrong size, naming it', () => {
    const files = unzipSync(good())
    files['tables.psms.score.bin'] = new Uint8Array(16)
    expect(() => readProject(zipSync(files))).toThrow(/tables\.psms\.score\.bin has 16 bytes/)
  })

  it('a project with a damaged array, by its checksum', async () => {
    const files = unzipSync(good())
    // stored (not compressed) entries, so that a flipped byte is still a valid archive
    const damaged = zipSync(files, { level: 0 })
    const at = indexOfBytes(damaged, files['tables.psms.qValue.bin'])
    expect(at).toBeGreaterThan(0)
    damaged[at + 3] ^= 0x40
    expect(() => readProject(damaged)).toThrow(/tables\.psms\.qValue\.bin is damaged: its checksum does not match/)
    await expect(readProject(new Blob([damaged as BlobPart]))).rejects.toThrow(/checksum/)
  })

  it('a project with damaged compressed data, read at once or in slices', async () => {
    const bytes = good()
    const name = 'tables.psms.score.bin'
    const at = indexOfBytes(bytes, strToU8(name)) + name.length
    const damaged = Uint8Array.from(bytes)
    for (let i = 0; i < 40; i++) damaged[at + i] ^= 0xff
    expect(() => readProject(damaged)).toThrow(ProjectError)
    for (const nativeInflate of [true, false]) {
      await withCompression({ nativeInflate, inflateAtOnce: 0 }, async () => {
        await expect(readProject(new Blob([damaged as BlobPart])), `native: ${nativeInflate}`).rejects.toThrow(ProjectError)
      })
    }
  })

  it('always with a ProjectError, never a crash of another kind', () => {
    const bytes = good()
    for (let cut = 0; cut < bytes.length; cut += Math.ceil(bytes.length / 60)) {
      expect(() => readProject(bytes.subarray(0, cut)), `cut at ${cut}`).toThrow(ProjectError)
    }
  })
})

describe('projectFileName', () => {
  it('is the name with ".prose", fit for a file system', () => {
    expect(projectFileName('DatabaseSuitability')).toBe('DatabaseSuitability.prose')
    expect(projectFileName('EGF / 30 min: "run" 2')).toBe('EGF _ 30 min_ _run_ 2.prose')
    expect(projectFileName('  ..  ')).toBe('prose-results.prose')
    expect(projectFileName('x'.repeat(300)).length).toBe(120 + '.prose'.length)
  })
})
