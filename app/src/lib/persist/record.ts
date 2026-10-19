// The record of a finished search, as History keeps it and as a `.prose` project file holds it: the
// settings, the design, the summary and the result tables with the stored spectra. Pure functions, no
// browser APIs.
//
// A record is split in two for storage: a manifest (plain JSON: everything but the arrays, with a marker
// where an array was) and the arrays themselves, each one a run of bytes with a name (`tables.psms.score.bin`).
// IndexedDB and OPFS keep the manifest and the bytes apart; the project file is a zip with one entry for
// the manifest and one per array.

import type { DesignResolution } from '../design/model'
import type { ProSEMultiSummary, ResultTables, StoredSpectra } from '../engine/openms-types'
import type { OpenResult } from '../search/session.svelte'
// (only the version: a named import of a JSON module leaves the rest of package.json out of the bundle)
import { version } from '../../../package.json'

/** The version of the record and of the project file. A newer file is refused, not guessed at. */
export const SCHEMA_VERSION = 1

/** The marker of `manifest.json`, so that a zip of something else is not taken for a project. */
export const PROJECT_FORMAT = 'prose-project'

/** The version of this app (package.json), written to the records it saves. */
export const APP_VERSION: string = version

export type RecordSettings = {
  /** The parameters that differ from ProSE's defaults. */
  parameters: Record<string, unknown>
  rescore: boolean
  peptdeep: boolean
  contaminants: boolean
  presetId?: string
  /** The fixed modifications of the search (OpenMS names), which the tables do not mark. */
  fixedMods: string[]
  /** The FASTA's file name. */
  database: string
}

export type SearchRecord = {
  schema: typeof SCHEMA_VERSION
  id: string
  name: string
  /** ISO 8601, when the search finished. */
  createdAt: string
  /** The version of the app that saved it. */
  appVersion: string
  /** OpenMS' version (`EngineInfo.version`), the module that searched. */
  moduleVersion: string
  design: DesignResolution
  settings: RecordSettings
  /** The search's cutoffs (q-values). */
  psmFdr: number
  proteinFdr: number
  /** The time of the search proper, in seconds. */
  seconds: number
  summary: ProSEMultiSummary
  tables: ResultTables
  spectra: StoredSpectra
}

/** What History lists of a search. */
export type HistoryEntry = Pick<SearchRecord, 'id' | 'name' | 'createdAt' | 'summary'> & {
  /** The names of the searched files, in the order of the design. */
  files: string[]
  /** Target PSMs within the search's PSM FDR: the key figure. */
  psms: number
  /** What it takes in the browser's storage. */
  bytes: number
}

/** A project file or a stored record that cannot be read. The message says what is wrong with it. */
export class ProjectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectError'
  }
}

/** What a record is to the user: a project file, or a search of History. */
export type RecordKind = 'project' | 'search'

/** The project (or stored search) was saved by a newer version of ProSE than this one. */
export class ProjectVersionError extends ProjectError {
  readonly schema: number
  constructor(schema: number, kind: RecordKind = 'project') {
    super(
      `This ${kind} was saved by a newer version of ProSE (schema ${schema}) and cannot be opened by this one ` +
        `(it reads schema ${SCHEMA_VERSION}). Open it with the latest version of ProSE.`,
    )
    this.name = 'ProjectVersionError'
    this.schema = schema
  }
}

// ---------------------------------------------------------------------------------------------------
// The record of a result

/**
 * A record of `result` under `name`: a search of this session, or a stored one (which keeps the versions
 * that made it). `moduleVersion` (OpenMS' version) is that of a search of this session.
 */
export function recordFromResult(result: OpenResult, name: string, moduleVersion: string): SearchRecord {
  const s = result.settings
  return {
    schema: SCHEMA_VERSION,
    id: result.id,
    name,
    createdAt: result.createdAt,
    appVersion: result.stored?.appVersion ?? APP_VERSION,
    moduleVersion: result.stored?.moduleVersion ?? moduleVersion,
    design: result.design,
    settings: {
      parameters: s.parameters,
      rescore: s.rescore,
      peptdeep: s.peptdeep,
      contaminants: s.contaminants,
      ...(s.presetId !== undefined ? { presetId: s.presetId } : {}),
      fixedMods: s.fixedMods,
      database: s.database,
    },
    psmFdr: result.psmFdr,
    proteinFdr: result.proteinFdr,
    seconds: result.outcome.seconds,
    summary: result.outcome.summary,
    tables: result.outcome.tables,
    spectra: result.outcome.spectra,
  }
}

/** The result a record opens as (see `openStoredResult`). */
export function resultFromRecord(r: SearchRecord): Omit<OpenResult, 'id' | 'createdAt' | 'engineResult'> {
  const s = r.settings
  return {
    stored: { name: r.name, appVersion: r.appVersion, moduleVersion: r.moduleVersion },
    outcome: { summary: r.summary, tables: r.tables, spectra: r.spectra, seconds: r.seconds },
    design: r.design,
    psmFdr: r.psmFdr,
    proteinFdr: r.proteinFdr,
    settings: {
      parameters: s.parameters,
      fixedMods: s.fixedMods,
      database: s.database,
      rescore: s.rescore,
      peptdeep: s.peptdeep,
      contaminants: s.contaminants,
      ...(s.presetId !== undefined ? { presetId: s.presetId } : {}),
    },
  }
}

/** Target PSMs within the PSM FDR (a PSM without q-value counts): the "PSMs" key figure. */
export function countPsms(tables: ResultTables, psmFdr: number): number {
  const { count, decoy, qValue } = tables.psms
  let n = 0
  for (let i = 0; i < count; i++) if (!decoy[i] && !(qValue[i] > psmFdr)) n++
  return n
}

/** What History lists of `record`. */
export function entryOf(record: SearchRecord, bytes: number): HistoryEntry {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    summary: record.summary,
    files: record.design.rows.map((row) => row.fileName),
    psms: countPsms(record.tables, record.psmFdr),
    bytes,
  }
}

// ---------------------------------------------------------------------------------------------------
// Arrays

const ARRAY_TYPES = {
  Float64Array,
  Float32Array,
  Int32Array,
  Uint32Array,
  Int16Array,
  Uint16Array,
  Int8Array,
  Uint8Array,
} as const

export type ArrayTypeName = keyof typeof ARRAY_TYPES
type TypedArray = InstanceType<(typeof ARRAY_TYPES)[ArrayTypeName]>

/** Where the manifest has a typed array: its entry, element type and length. */
type ArrayRef = { $array: string; type: ArrayTypeName; length: number }
/** Where the manifest has a list of strings: UTF-8, each one preceded by its byte length (see `encodeStrings`). */
type StringsRef = { $strings: string; length: number; bytes: number }

/** The manifest: the record without its arrays. */
export type Manifest = Omit<SearchRecord, 'tables' | 'spectra'> & {
  format: typeof PROJECT_FORMAT
  /** The arrays are little-endian. */
  byteOrder: 'little'
  tables: unknown
  spectra: unknown
}

/** An array of a record as bytes. */
export type PackedArray = { name: string; bytes: Uint8Array }

const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

const typeNameOf = (value: ArrayBufferView): ArrayTypeName | null => {
  for (const name of Object.keys(ARRAY_TYPES) as ArrayTypeName[]) if (value instanceof ARRAY_TYPES[name]) return name
  return null
}

const isRef = (value: unknown): value is ArrayRef | StringsRef =>
  typeof value === 'object' && value !== null && ('$array' in value || '$strings' in value)

/** Text is encoded and decoded in runs of this many strings, between which the sliced variants pause. */
const STRING_RUN = 8192

/** Runs the steps of a generator to its end, at once. */
function runAtOnce<T>(steps: Generator<void, T>): T {
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}

/** Runs the steps of a generator to its end, with `breathe` between them. */
async function runSliced<T>(steps: Generator<void, T>, breathe: () => Promise<void>): Promise<T> {
  let next = steps.next()
  while (!next.done) {
    await breathe()
    next = steps.next()
  }
  return next.value
}

/**
 * A list of strings as one run of bytes: for each string its UTF-8 length (u32) and then all the bytes.
 * (Written with `encodeInto` into one buffer: 150,000 native IDs take 30 ms, `encode` per string 200 ms.)
 */
function* encodeSteps(strings: readonly string[]): Generator<void, Uint8Array> {
  const encoder = new TextEncoder()
  let chars = 0
  for (const s of strings) chars += s.length
  // a UTF-16 unit takes at most 3 bytes in UTF-8
  const out = new Uint8Array(4 * strings.length + 3 * chars)
  const view = new DataView(out.buffer)
  let at = 4 * strings.length
  for (let i = 0; i < strings.length; i++) {
    if (i > 0 && i % STRING_RUN === 0) yield
    const { written } = encoder.encodeInto(strings[i], out.subarray(at))
    view.setUint32(4 * i, written, true)
    at += written
  }
  return out.slice(0, at)
}

export function encodeStrings(strings: readonly string[]): Uint8Array {
  return runAtOnce(encodeSteps(strings))
}

/** The strings of `encodeStrings`' bytes (`count` of them). */
function* decodeSteps(bytes: Uint8Array, count: number): Generator<void, string[]> {
  if (bytes.length < 4 * count) throw new ProjectError('A list of text is shorter than its length says.')
  const decoder = new TextDecoder()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Array<string>(count)
  let at = 4 * count
  for (let i = 0; i < count; i++) {
    if (i > 0 && i % STRING_RUN === 0) yield
    const length = view.getUint32(4 * i, true)
    if (at + length > bytes.length) throw new ProjectError('A list of text is shorter than its lengths say.')
    out[i] = decoder.decode(bytes.subarray(at, at + length))
    at += length
  }
  return out
}

export function decodeStrings(bytes: Uint8Array, count: number): string[] {
  return runAtOnce(decodeSteps(bytes, count))
}

/** The text of the string lists, encoded ahead (see `packRecordSliced`). */
type Encoded = Map<readonly string[], Uint8Array>

/** Replaces the arrays below `value` with markers, and collects them (named by their path). */
function packTree(value: unknown, path: string, arrays: PackedArray[], encoded?: Encoded): unknown {
  if (ArrayBuffer.isView(value)) {
    const type = typeNameOf(value)
    if (type === null) throw new Error(`${path}: cannot store a ${value.constructor.name}`)
    arrays.push({ name: `${path}.bin`, bytes: new Uint8Array(value.buffer, value.byteOffset, value.byteLength) })
    const ref: ArrayRef = { $array: `${path}.bin`, type, length: (value as TypedArray).length }
    return ref
  }
  if (Array.isArray(value)) {
    if (!value.every((v) => typeof v === 'string')) throw new Error(`${path}: cannot store a list that is not text`)
    const bytes = encoded?.get(value) ?? encodeStrings(value)
    arrays.push({ name: `${path}.bin`, bytes })
    const ref: StringsRef = { $strings: `${path}.bin`, length: value.length, bytes: bytes.length }
    return ref
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) out[key] = packTree(v, path === '' ? key : `${path}.${key}`, arrays, encoded)
    return out
  }
  return value
}

/** The manifest of `record` and its arrays (views on the record's own memory: nothing is copied but text). */
export function packRecord(record: SearchRecord, encoded?: Encoded): { manifest: Manifest; arrays: PackedArray[] } {
  if (!littleEndian) throw new Error('Saving needs a little-endian computer')
  const arrays: PackedArray[] = []
  const { tables, spectra, ...rest } = record
  const manifest: Manifest = {
    format: PROJECT_FORMAT,
    byteOrder: 'little',
    ...rest,
    tables: packTree(tables, 'tables', arrays, encoded),
    spectra: packTree(spectra, 'spectra', arrays, encoded),
  }
  return { manifest, arrays }
}

/** The string lists below `value`. */
function stringLists(value: unknown, out: string[][] = []): string[][] {
  if (Array.isArray(value)) out.push(value)
  else if (typeof value === 'object' && value !== null && !ArrayBuffer.isView(value)) {
    for (const v of Object.values(value)) stringLists(v, out)
  }
  return out
}

/**
 * `packRecord` with the text encoded in runs and `breathe` between them (150,000 native IDs and the
 * peptides' text take 200 ms at once).
 */
export async function packRecordSliced(
  record: SearchRecord,
  breathe: () => Promise<void>,
): Promise<{ manifest: Manifest; arrays: PackedArray[] }> {
  const encoded: Encoded = new Map()
  for (const list of [...stringLists(record.tables), ...stringLists(record.spectra)]) {
    encoded.set(list, await runSliced(encodeSteps(list), breathe))
    await breathe()
  }
  return packRecord(record, encoded)
}

/** The arrays that the manifest refers to, with their sizes in bytes. */
export function arrayRefs(manifest: Manifest): { name: string; byteLength: number }[] {
  const out: { name: string; byteLength: number }[] = []
  const walk = (node: unknown) => {
    if (isRef(node)) {
      if ('$array' in node) out.push({ name: node.$array, byteLength: node.length * ARRAY_TYPES[node.type].BYTES_PER_ELEMENT })
      else out.push({ name: node.$strings, byteLength: node.bytes })
    } else if (typeof node === 'object' && node !== null) {
      for (const v of Object.values(node)) walk(v)
    }
  }
  walk(manifest.tables)
  walk(manifest.spectra)
  return out
}

/** `bytes` as `type`: a view if it is aligned (a fresh buffer is), else a copy. */
function typed(name: string, type: ArrayTypeName, length: number, bytes: Uint8Array): TypedArray {
  const ctor = ARRAY_TYPES[type]
  if (bytes.length !== length * ctor.BYTES_PER_ELEMENT) {
    throw new ProjectError(`${name} has ${bytes.length} bytes, but ${length} ${type} elements need ${length * ctor.BYTES_PER_ELEMENT}.`)
  }
  const aligned = bytes.byteOffset % ctor.BYTES_PER_ELEMENT === 0
  const source = aligned ? bytes : bytes.slice()
  return new ctor(source.buffer as ArrayBuffer, source.byteOffset, length)
}

/** The text of the string lists by entry name, decoded ahead (see `unpackRecordSliced`). */
type Decoded = Map<string, string[]>

function unpackTree(node: unknown, bytesOf: (name: string) => Uint8Array, decoded?: Decoded): unknown {
  if (isRef(node)) {
    if ('$array' in node) {
      if (!(node.type in ARRAY_TYPES) || !Number.isInteger(node.length) || node.length < 0) {
        throw new ProjectError(`The manifest describes ${node.$array} wrongly (${node.type}, length ${node.length}).`)
      }
      return typed(node.$array, node.type, node.length, bytesOf(node.$array))
    }
    if (!Number.isInteger(node.length) || node.length < 0) throw new ProjectError(`The manifest describes ${node.$strings} wrongly.`)
    return decoded?.get(node.$strings) ?? decodeStrings(bytesOf(node.$strings), node.length)
  }
  if (typeof node === 'object' && node !== null) {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(node)) out[key] = unpackTree(v, bytesOf, decoded)
    return out
  }
  return node
}

// ---------------------------------------------------------------------------------------------------
// The manifest as text

/** JSON has no NaN and no infinities (summaries have both): they are written as `{"$num": "NaN"}`. */
export function manifestToJson(manifest: Manifest): string {
  return JSON.stringify(manifest, (_key, value) =>
    typeof value === 'number' && !Number.isFinite(value) ? { $num: String(value) } : value,
  )
}

const NON_FINITE: Record<string, number> = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity }

/** The manifest of `manifestToJson`'s text (not yet checked: see `checkManifest`). */
export function manifestFromJson(text: string): unknown {
  try {
    return JSON.parse(text, (_key, value) => {
      if (typeof value === 'object' && value !== null && Object.keys(value).length === 1 && typeof value.$num === 'string') {
        if (value.$num in NON_FINITE) return NON_FINITE[value.$num]
      }
      return value
    })
  } catch {
    throw new ProjectError('manifest.json is not valid JSON.')
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string')

/**
 * Checks what a record cannot do without: the marker, the schema version (a newer one is a
 * `ProjectVersionError`, anything else unknown a `ProjectError`) and the fields the app reads.
 * `kind` names the record in the messages.
 */
export function checkManifest(value: unknown, kind: RecordKind = 'project'): Manifest {
  if (!isObject(value) || value.format !== PROJECT_FORMAT) {
    throw new ProjectError('This is not a ProSE project: its manifest.json does not say so.')
  }
  const schema = value.schema
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) {
    throw new ProjectError(`This project has no valid schema version (${JSON.stringify(schema)}).`)
  }
  if (schema > SCHEMA_VERSION) throw new ProjectVersionError(schema, kind)
  for (const key of ['id', 'name', 'createdAt', 'appVersion', 'moduleVersion'] as const) {
    if (typeof value[key] !== 'string') throw new ProjectError(`The manifest has no "${key}".`)
  }
  for (const key of ['psmFdr', 'proteinFdr', 'seconds'] as const) {
    if (typeof value[key] !== 'number') throw new ProjectError(`The manifest has no "${key}".`)
  }
  const { design, settings, summary } = value
  if (!isObject(design) || !Array.isArray(design.rows) || !Array.isArray(design.samples)) throw new ProjectError('The manifest has no design.')
  if (!design.rows.every((row) => isObject(row) && typeof row.fileName === 'string' && Number.isInteger(row.sample))) {
    throw new ProjectError('The design of the manifest has a file without name or sample.')
  }
  if (!design.samples.every((sample) => isObject(sample) && typeof sample.label === 'string')) {
    throw new ProjectError('The design of the manifest has a sample without label.')
  }
  if (!Array.isArray(design.conditions)) throw new ProjectError('The design of the manifest has no conditions.')
  if (
    !isObject(settings) ||
    !isObject(settings.parameters) ||
    !isStrings(settings.fixedMods) ||
    typeof settings.database !== 'string' ||
    ![settings.rescore, settings.peptdeep, settings.contaminants].every((v) => typeof v === 'boolean')
  ) {
    throw new ProjectError('The manifest has no settings (or not all of them).')
  }
  if (!isObject(summary) || !Array.isArray(summary.files) || !summary.files.every(isObject)) throw new ProjectError('The manifest has no summary.')
  if (!isObject(value.tables) || !isObject(value.spectra)) throw new ProjectError('The manifest has no result tables.')
  return value as unknown as Manifest
}

/** The record of a manifest and its arrays (`bytesOf` throws if one is missing); checks that it hangs together. */
export function unpackRecord(manifest: Manifest, bytesOf: (name: string) => Uint8Array, decoded?: Decoded): SearchRecord {
  const { format: _format, byteOrder: _byteOrder, ...rest } = manifest
  const record = {
    ...rest,
    tables: unpackTree(manifest.tables, bytesOf, decoded),
    spectra: unpackTree(manifest.spectra, bytesOf, decoded),
  } as SearchRecord
  validateRecord(record)
  return record
}

/** `unpackRecord` with the text decoded in runs and `breathe` between them. */
export async function unpackRecordSliced(
  manifest: Manifest,
  bytesOf: (name: string) => Uint8Array,
  breathe: () => Promise<void>,
): Promise<SearchRecord> {
  const decoded: Decoded = new Map()
  const walk = async (node: unknown) => {
    if (isRef(node)) {
      if ('$strings' in node && Number.isInteger(node.length) && node.length >= 0) {
        decoded.set(node.$strings, await runSliced(decodeSteps(bytesOf(node.$strings), node.length), breathe))
        await breathe()
      }
    } else if (typeof node === 'object' && node !== null) {
      for (const v of Object.values(node)) await walk(v)
    }
  }
  await walk(manifest.tables)
  await walk(manifest.spectra)
  return unpackRecord(manifest, bytesOf, decoded)
}

// ---------------------------------------------------------------------------------------------------
// Does it hang together

function need(ok: boolean, what: string): void {
  if (!ok) throw new ProjectError(`The result tables are damaged: ${what}.`)
}

function length(table: Record<string, unknown>, where: string, column: string, expected: number): void {
  const value = table[column] as ArrayLike<unknown> | undefined | null
  if (value === undefined || value === null || typeof value.length !== 'number') need(false, `${where}.${column} is missing`)
  else need(value.length === expected, `${where}.${column} has ${value.length} entries, not ${expected}`)
}

function within(values: ArrayLike<number>, limit: number, what: string): void {
  for (let i = 0; i < values.length; i++) if (!(values[i] >= 0 && values[i] < limit)) need(false, `${what} refers to a row that does not exist`)
}

/** Offsets (count + 1 entries) that start at 0, never decrease and end at the length of what they index. */
function checkOffsets(values: Uint32Array, end: number, what: string): void {
  need(values[0] === 0, `${what} does not start at 0`)
  for (let i = 1; i < values.length; i++) need(values[i - 1] <= values[i], `${what} decreases`)
  need(values[values.length - 1] === end, `${what} does not end at ${end}`)
}

/**
 * The columns of the tables have the lengths their counts say, and the references between the tables
 * and to the spectra point to rows that exist (so that no view reads past an array). Throws a `ProjectError`.
 */
export function validateRecord(record: SearchRecord): void {
  const { tables: t, spectra: s } = record
  need(isObject(t) && isObject(t.psms) && isObject(t.peptides) && isObject(t.proteins) && Array.isArray(t.files), 'a table is missing')
  need(isObject(s), 'the spectra are missing')
  const psms = t.psms as unknown as Record<string, unknown> & { count: number }
  const peptides = t.peptides as unknown as Record<string, unknown> & { count: number }
  const proteins = t.proteins as unknown as Record<string, unknown> & { count: number }
  for (const [name, table] of [['psms', psms], ['peptides', peptides], ['proteins', proteins]] as const) {
    need(Number.isInteger(table.count) && table.count >= 0, `${name}.count is not a count`)
  }
  for (const c of ['file', 'nativeId', 'rt', 'mz', 'charge', 'peptide', 'score', 'qValue', 'pep', 'precursorErrorPpm', 'isotopeError', 'deltaMass', 'decoy']) {
    length(psms, 'psms', c, psms.count)
  }
  need(Array.isArray(psms.featureNames), 'psms.featureNames is missing')
  length(psms, 'psms', 'features', psms.count * (psms.featureNames as string[]).length)
  for (const c of ['openms', 'proforma', 'sequence', 'decoy']) length(peptides, 'peptides', c, peptides.count)
  length(peptides, 'peptides', 'modOffsets', peptides.count + 1)
  length(peptides, 'peptides', 'proteinOffsets', peptides.count + 1)
  const modOffsets = peptides.modOffsets as Uint32Array
  const proteinOffsets = peptides.proteinOffsets as Uint32Array
  const mods = modOffsets[peptides.count]
  for (const c of ['modPosition', 'modName', 'modUnimod', 'modMass']) length(peptides, 'peptides', c, mods)
  for (const c of ['protein', 'start', 'end']) length(peptides, 'peptides', c, proteinOffsets[peptides.count])
  need(modOffsets instanceof Uint32Array && proteinOffsets instanceof Uint32Array, 'the offsets of the peptides are no offsets')
  checkOffsets(modOffsets, (peptides.modPosition as Int16Array).length, 'peptides.modOffsets')
  checkOffsets(proteinOffsets, (peptides.protein as Uint32Array).length, 'peptides.proteinOffsets')
  // a modification sits on a residue of its peptide, or on a terminus (-1, sequence length)
  const sequence = peptides.sequence as string[]
  const modPosition = peptides.modPosition as Int16Array
  for (let k = 0; k < peptides.count; k++) {
    for (let j = modOffsets[k]; j < modOffsets[k + 1]; j++) {
      need(modPosition[j] >= -1 && modPosition[j] <= sequence[k].length, 'peptides.modPosition is outside its peptide')
    }
  }
  for (const c of ['accession', 'description', 'sequence', 'score', 'qValue', 'decoy', 'group']) length(proteins, 'proteins', c, proteins.count)

  // the design has a row for each searched file, each in a sample that exists
  const { rows, samples } = record.design
  need(rows.length === t.files.length, `the design has ${rows.length} files, the tables ${t.files.length}`)
  for (const row of rows) {
    need(Number.isInteger(row.sample) && row.sample >= 0 && row.sample < samples.length, 'the design puts a file in a sample that does not exist')
  }

  // the summary has a file for each searched file
  need(record.summary.files.length === t.files.length, `the summary has ${record.summary.files.length} files, the tables ${t.files.length}`)

  within(psms.file as Uint16Array, t.files.length, 'psms.file')
  within(psms.peptide as Uint32Array, peptides.count, 'psms.peptide')
  within(peptides.protein as Uint32Array, proteins.count, 'peptides.protein')
  const group = proteins.group as Int32Array
  for (let i = 0; i < group.length; i++) need(group[i] >= -1, 'proteins.group is no group')

  const spectra = s as unknown as Record<string, unknown>
  length(spectra, 'spectra', 'psmSpectrum', psms.count)
  need(spectra.offsets instanceof Uint32Array && spectra.offsets.length >= 1, 'spectra.offsets is missing')
  const offsets = spectra.offsets as Uint32Array
  const n = offsets.length - 1
  length(spectra, 'spectra', 'mz', offsets[n])
  length(spectra, 'spectra', 'intensity', offsets[n])
  length(spectra, 'spectra', 'precursorMz', n)
  length(spectra, 'spectra', 'collisionEnergy', n)
  for (let i = 0; i < n; i++) need(offsets[i] <= offsets[i + 1], 'spectra.offsets decreases')
  const psmSpectrum = spectra.psmSpectrum as Int32Array
  for (let i = 0; i < psmSpectrum.length; i++) need(psmSpectrum[i] >= -1 && psmSpectrum[i] < n, 'psmSpectrum refers to a spectrum that does not exist')
}
