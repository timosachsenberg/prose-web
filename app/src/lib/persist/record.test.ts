import { describe, expect, it } from 'vitest'
import { bytesEqual, smallRecord } from './fixtures'
import {
  arrayRefs,
  checkManifest,
  countPsms,
  decodeStrings,
  encodeStrings,
  entryOf,
  manifestFromJson,
  manifestToJson,
  packRecord,
  ProjectError,
  ProjectVersionError,
  SCHEMA_VERSION,
  unpackRecord,
  validateRecord,
} from './record'

/** Pack and unpack through JSON text and a table of the bytes, as the project file does. */
function roundTrip(record = smallRecord()) {
  const { manifest, arrays } = packRecord(record)
  const bytes = new Map(arrays.map((a) => [a.name, a.bytes.slice()]))
  const parsed = checkManifest(manifestFromJson(manifestToJson(manifest)))
  return unpackRecord(parsed, (name) => bytes.get(name)!)
}

describe('strings', () => {
  it('survive the byte encoding, empty ones and non-ASCII text included', () => {
    const strings = ['', 'sp|P02768|ALBU_HUMAN', 'Ünïcode · Δ+15.995', '', 'x'.repeat(5000)]
    expect(decodeStrings(encodeStrings(strings), strings.length)).toEqual(strings)
    expect(decodeStrings(encodeStrings([]), 0)).toEqual([])
  })

  it('are refused when the bytes are shorter than the lengths say', () => {
    const bytes = encodeStrings(['abc', 'def'])
    expect(() => decodeStrings(bytes.subarray(0, bytes.length - 1), 2)).toThrow(ProjectError)
    expect(() => decodeStrings(new Uint8Array(3), 2)).toThrow(ProjectError)
  })
})

describe('packRecord', () => {
  it('names one array per column of the tables and the spectra', () => {
    const { manifest, arrays } = packRecord(smallRecord())
    const names = arrays.map((a) => a.name)
    expect(names).toContain('tables.psms.score.bin')
    expect(names).toContain('tables.psms.nativeId.bin')
    expect(names).toContain('tables.files.bin')
    expect(names).toContain('tables.psms.features.bin')
    expect(names).toContain('spectra.mz.bin')
    expect(new Set(names).size).toBe(names.length)
    // the manifest sizes its arrays: what unpacking will ask the file for
    const sizes = new Map(arrayRefs(manifest).map((r) => [r.name, r.byteLength]))
    expect(sizes.size).toBe(arrays.length)
    for (const a of arrays) expect(sizes.get(a.name)).toBe(a.bytes.length)
  })

  it("shares the record's memory instead of copying the typed arrays", () => {
    const record = smallRecord()
    const { arrays } = packRecord(record)
    const score = arrays.find((a) => a.name === 'tables.psms.score.bin')!
    expect(score.bytes.buffer).toBe(record.tables.psms.score.buffer)
  })

  it('keeps no array in the manifest text', () => {
    const json = manifestToJson(packRecord(smallRecord()).manifest)
    expect(json).toContain('"$array":"tables.psms.score.bin"')
    expect(json).not.toContain('0.004')
  })
})

describe('unpackRecord', () => {
  it('gives back the record: every typed array, every list of text, the plain fields', () => {
    const original = smallRecord()
    const back = roundTrip(original)
    const cols = (r: typeof original) => [
      ...Object.entries(r.tables.psms),
      ...Object.entries(r.tables.peptides),
      ...Object.entries(r.tables.proteins),
      ...Object.entries(r.spectra),
    ]
    expect(cols(back).map(([k]) => k)).toEqual(cols(original).map(([k]) => k))
    for (const [i, [key, value]] of cols(original).entries()) {
      const other = cols(back)[i][1]
      if (ArrayBuffer.isView(value)) {
        const o = other as ArrayBufferView
        expect(o, key).toBeInstanceOf(value.constructor)
        expect(bytesEqual(new Uint8Array(o.buffer, o.byteOffset, o.byteLength), new Uint8Array(value.buffer, value.byteOffset, value.byteLength)), key).toBe(true)
      } else expect(other, key).toEqual(value)
    }
    expect(back.tables.files).toEqual(original.tables.files)
    expect(back.design).toEqual(original.design)
    expect(back.settings).toEqual(original.settings)
    expect(back.name).toBe('Ünïcode run · 2 files')
    expect(back.createdAt).toBe(original.createdAt)
  })

  it('keeps NaN and the infinities of the summary, which JSON has no way to write', () => {
    const back = roundTrip()
    expect(back.summary.files[0].secondsSearch).toBeNaN()
    expect(back.summary.files[1].secondsSearch).toBe(Infinity)
    expect(back.summary).toEqual(smallRecord().summary)
  })

  it('reads an array that does not start at a multiple of its element size', () => {
    const { manifest, arrays } = packRecord(smallRecord())
    const bytes = new Map(
      arrays.map((a) => {
        const shifted = new Uint8Array(a.bytes.length + 3)
        shifted.set(a.bytes, 3)
        return [a.name, shifted.subarray(3)] as const
      }),
    )
    const back = unpackRecord(checkManifest(manifestFromJson(manifestToJson(manifest))), (n) => bytes.get(n)!)
    expect(Array.from(back.tables.psms.qValue)).toEqual(Array.from(smallRecord().tables.psms.qValue))
  })

  it('names the array whose size does not match the manifest', () => {
    const { manifest, arrays } = packRecord(smallRecord())
    const bytes = new Map(arrays.map((a) => [a.name, a.bytes]))
    bytes.set('tables.psms.score.bin', new Uint8Array(5))
    expect(() => unpackRecord(manifest, (n) => bytes.get(n)!)).toThrow(/tables\.psms\.score\.bin has 5 bytes/)
  })
})

describe('checkManifest', () => {
  const base = () => JSON.parse(manifestToJson(packRecord(smallRecord()).manifest))

  it('accepts a manifest of this version', () => {
    expect(checkManifest(base()).schema).toBe(SCHEMA_VERSION)
  })

  it('refuses a newer schema with the version in the message', () => {
    const m = { ...base(), schema: 2 }
    expect(() => checkManifest(m)).toThrow(ProjectVersionError)
    expect(() => checkManifest(m)).toThrow(/^This project was saved by a newer version of ProSE \(schema 2\)/)
  })

  it.each([
    [{ format: 'other' }, /not a ProSE project/],
    [{ schema: 0 }, /no valid schema version/],
    [{ schema: 'one' }, /no valid schema version/],
    [{ schema: 1.5 }, /no valid schema version/],
    [{ id: undefined }, /no "id"/],
    [{ design: null }, /no design/],
    [{ summary: { files: 3 } }, /no summary/],
    [{ tables: [] }, /no result tables/],
    [{ summary: { files: [null] } }, /no summary/],
  ])('refuses a manifest that is changed by %j with a plain message', (change, message) => {
    expect(() => checkManifest({ ...base(), ...change })).toThrow(message)
    expect(() => checkManifest({ ...base(), ...change })).not.toThrow(ProjectVersionError)
  })

  it('refuses settings and a design that the views could not read (a foreign or hand-made file)', () => {
    const settings = (change: Record<string, unknown>) => {
      const m = base()
      return { ...m, settings: { ...m.settings, ...change } }
    }
    expect(() => checkManifest(settings({ fixedMods: 'Carbamidomethyl (C)' }))).toThrow(/no settings/)
    expect(() => checkManifest(settings({ fixedMods: [1] }))).toThrow(/no settings/)
    expect(() => checkManifest(settings({ database: undefined }))).toThrow(/no settings/)
    expect(() => checkManifest(settings({ rescore: 'yes' }))).toThrow(/no settings/)
    const design = (change: (d: Record<string, unknown> & { rows: Record<string, unknown>[]; samples: Record<string, unknown>[] }) => void) => {
      const m = base()
      change(m.design)
      return m
    }
    expect(() => checkManifest(design((d) => delete d.rows[0].fileName))).toThrow(/a file without name or sample/)
    expect(() => checkManifest(design((d) => (d.rows[1].sample = 'one')))).toThrow(/a file without name or sample/)
    expect(() => checkManifest(design((d) => (d.samples[0].label = null)))).toThrow(/a sample without label/)
    expect(() => checkManifest(design((d) => delete d.conditions))).toThrow(/no conditions/)
  })

  it('names a stored search of a newer version as a search, a project file as a project', () => {
    const m = { ...base(), schema: 3 }
    expect(() => checkManifest(m, 'search')).toThrow(/^This search was saved by a newer version of ProSE \(schema 3\)/)
    expect(() => checkManifest(m)).toThrow(/^This project was saved/)
  })

  it('refuses what is not an object', () => {
    expect(() => checkManifest(null)).toThrow(ProjectError)
    expect(() => checkManifest('prose')).toThrow(ProjectError)
    expect(() => manifestFromJson('{not json')).toThrow(/manifest\.json is not valid JSON/)
  })
})

describe('validateRecord', () => {
  it('accepts a good record', () => {
    expect(() => validateRecord(smallRecord())).not.toThrow()
  })

  it('refuses a column of the wrong length, naming it', () => {
    const r = smallRecord()
    r.tables.psms.qValue = new Float64Array(3)
    expect(() => validateRecord(r)).toThrow(/psms\.qValue has 3 entries, not 9/)
  })

  it('refuses references to rows that do not exist', () => {
    const peptide = smallRecord()
    peptide.tables.psms.peptide[0] = 99
    expect(() => validateRecord(peptide)).toThrow(/psms\.peptide refers to a row that does not exist/)
    const file = smallRecord()
    file.tables.psms.file[2] = 7
    expect(() => validateRecord(file)).toThrow(/psms\.file refers/)
    const spectrum = smallRecord()
    spectrum.spectra.psmSpectrum[1] = 999
    expect(() => validateRecord(spectrum)).toThrow(/psmSpectrum refers to a spectrum/)
  })

  it('refuses a design that does not fit the tables', () => {
    const rows = smallRecord()
    rows.design = { ...rows.design, rows: rows.design.rows.slice(1) }
    expect(() => validateRecord(rows)).toThrow(/the design has 1 files, the tables 2/)
    const sample = smallRecord()
    sample.design = { ...sample.design, rows: sample.design.rows.map((r) => ({ ...r, sample: 9 })) }
    expect(() => validateRecord(sample)).toThrow(/sample that does not exist/)
  })

  it('refuses a summary of other files than the tables', () => {
    const r = smallRecord()
    r.summary = { ...r.summary, files: r.summary.files.slice(1) }
    expect(() => validateRecord(r)).toThrow(/the summary has 1 files, the tables 2/)
  })

  it('refuses peptide offsets that do not start at 0, decrease or point outside their columns', () => {
    const start = smallRecord()
    start.tables.peptides.proteinOffsets[0] = 1
    expect(() => validateRecord(start)).toThrow(/peptides\.proteinOffsets does not start at 0/)
    const decreasing = smallRecord()
    const { modOffsets } = decreasing.tables.peptides
    modOffsets[1] = modOffsets[modOffsets.length - 1] + 5
    expect(() => validateRecord(decreasing)).toThrow(/peptides\.modOffsets decreases/)
    const position = smallRecord()
    expect(position.tables.peptides.modPosition.length).toBeGreaterThan(0)
    position.tables.peptides.modPosition[0] = 99
    expect(() => validateRecord(position)).toThrow(/peptides\.modPosition is outside its peptide/)
    const terminal = smallRecord()
    terminal.tables.peptides.modPosition[0] = -1 // the N-terminus is fine
    expect(() => validateRecord(terminal)).not.toThrow()
    const group = smallRecord()
    group.tables.proteins.group[0] = -2
    expect(() => validateRecord(group)).toThrow(/proteins\.group is no group/)
  })

  it('refuses spectra whose peaks do not match their offsets', () => {
    const r = smallRecord()
    r.spectra.intensity = r.spectra.intensity.subarray(1)
    expect(() => validateRecord(r)).toThrow(/spectra\.intensity has/)
  })
})

describe('what History lists', () => {
  it("counts the target PSMs within the search's PSM FDR, as the key figure does", () => {
    const r = smallRecord()
    const { decoy, qValue } = r.tables.psms
    let expected = 0
    for (let i = 0; i < r.tables.psms.count; i++) if (!decoy[i] && qValue[i] <= 0.01) expected++
    expect(expected).toBeGreaterThan(0)
    expect(countPsms(r.tables, 0.01)).toBe(expected)
    expect(countPsms(r.tables, 1)).toBe(Array.from(decoy).filter((d) => !d).length)
  })

  it('has the file names of the design, the size and the summary', () => {
    const entry = entryOf(smallRecord(), 1234)
    expect(entry).toMatchObject({ id: 'k5x2j9ab', name: 'Ünïcode run · 2 files', bytes: 1234, files: ['ctrl_a.mzML', 'egf_a.mzML'] })
    expect(entry.summary.files).toHaveLength(2)
  })
})
