// The New search form: files with their design fields, the database, the settings and the rescoring
// switches. Kept outside the view so that it survives a visit to another view.

import { resolveDesign, type DesignInput } from '../design/model'
import type { DesignFields, DesignUpdate } from '../design/paste'
import { engineState } from '../engine/app-engine.svelte'
import type { ParamEntry } from '../engine/protocol'
import { changedParameters, copyValue, copyValues, defaultsOf, sameValue } from '../settings/parameters'
import { BUILTIN_PRESETS, DEFAULT_PRESET_ID, loadPresets, savePreset, type Preset } from '../settings/presets'
import { formatBytes } from '../format/bytes'
import { countProteins, countSpectra, isFasta, isMzML } from './files'

export type FileRow = DesignFields & {
  id: string
  file: File
  /** From the mzML header; null while counting or if the header does not say. */
  spectra: number | null
}

export type DatabaseChoice = { file: File; proteins: number | null }

/** The entries of the bundled cRAP FASTA (`public/fasta/crap.fasta`). */
export const CRAP_PROTEINS = 116

/**
 * The example: one mzML searched twice as two replicates of condition "example", with its FASTA. Its
 * database is small (49 proteins): with a decoy ranked first, no protein q-value goes below 1/49, so
 * the example is searched at a protein FDR of 5 %.
 */
export const EXAMPLE = {
  mzML: 'example/DatabaseSuitability_in_spec.mzML',
  fasta: 'example/DatabaseSuitability_database.fasta',
  names: ['DatabaseSuitability_1.mzML', 'DatabaseSuitability_2.mzML'],
  condition: 'example',
  proteinFdr: 0.05,
} as const

let nextId = 0

function toInput(row: FileRow): DesignInput {
  return {
    id: row.id,
    fileName: row.file.name,
    fileSize: row.file.size,
    condition: row.condition,
    replicate: row.replicate,
    fraction: row.fraction,
    techReplicate: row.techReplicate,
  }
}

class SearchForm {
  files = $state<FileRow[]>([])
  database = $state<DatabaseChoice | null>(null)
  contaminants = $state(true)
  presets = $state<Preset[]>(loadPresets())
  presetId = $state(DEFAULT_PRESET_ID)
  /** The parameters set by the preset and the user, on top of ProSE's defaults. */
  overrides = $state<Record<string, unknown>>(
    copyValues(BUILTIN_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!.parameters),
  )
  rescore = $state(true)
  peptdeep = $state(false)
  /** The design table shows Tech. replicate, Fraction group and Sample. */
  advanced = $state(false)
  /** What adding, pasting or loading could not use. */
  notices = $state<string[]>([])
  exampleLoading = $state(false)

  /** ProSE's parameters by name (once OpenMS is loaded). */
  entries = $derived(new Map((engineState.info?.parameters ?? []).map((e) => [e.name, e])))
  defaults = $derived(engineState.info ? defaultsOf(engineState.info.parameters) : {})
  values = $derived<Record<string, unknown>>({ ...this.defaults, ...this.overrides })
  design = $derived(resolveDesign(this.files.map(toInput)))
  /** The files and the database are the bundled example's. */
  isExample = $derived(
    this.files.length === EXAMPLE.names.length &&
      this.files.every((r, i) => r.file.name === EXAMPLE.names[i]) &&
      this.database?.file.name === EXAMPLE.fasta.split('/').pop(),
  )
  preset = $derived(this.presets.find((p) => p.id === this.presetId) ?? null)
  /** The settings differ from the preset's. */
  modified = $derived.by(() => {
    const preset = this.preset?.parameters ?? {}
    return Object.keys({ ...preset, ...this.overrides }).some(
      (name) => !sameValue(this.values[name], name in preset ? preset[name] : this.defaults[name]),
    )
  })

  entry(name: string): ParamEntry | undefined {
    return this.entries.get(name)
  }

  value<T = unknown>(name: string): T {
    return this.values[name] as T
  }

  setParam(name: string, value: unknown) {
    this.overrides[name] = copyValue(value)
  }

  choosePreset(id: string) {
    const preset = this.presets.find((p) => p.id === id)
    if (!preset) return
    this.presetId = id
    this.overrides = copyValues(preset.parameters)
  }

  /** Saves the settings that differ from ProSE's defaults as a user preset and selects it. */
  saveAsPreset(name: string): Preset {
    const preset = savePreset(name, changedParameters($state.snapshot(this.values), this.defaults))
    this.presets = loadPresets()
    this.presetId = preset.id
    this.overrides = copyValues(preset.parameters)
    return preset
  }

  /** Adds mzML files to the table; a FASTA becomes the database; anything else is reported. */
  addFiles(list: Iterable<File>) {
    const skipped: string[] = []
    for (const file of list) {
      if (isMzML(file.name)) this.#addRow(file, {})
      else if (isFasta(file.name)) this.setDatabase(file)
      else skipped.push(file.name)
    }
    if (skipped.length > 0) {
      this.notices.push(
        `Not an mzML file: ${skipped.join(', ')}. Convert vendor files to mzML first, e.g. with ProteoWizard msconvert.`,
      )
    }
  }

  #addRow(file: File, fields: DesignFields) {
    const id = `f${++nextId}`
    this.files.push({ id, file, spectra: null, ...fields })
    void countSpectra(file).then((n) => {
      const row = this.files.find((r) => r.id === id)
      if (row) row.spectra = n
    })
  }

  removeFile(id: string) {
    this.files = this.files.filter((r) => r.id !== id)
  }

  setField<K extends keyof DesignFields>(id: string, field: K, value: DesignFields[K]) {
    const row: DesignFields | undefined = this.files.find((r) => r.id === id)
    if (row) row[field] = value
  }

  /** Pasted or loaded design fields for rows of the table. */
  applyUpdates(updates: DesignUpdate[]) {
    for (const { index, fields } of updates) {
      const row = this.files[index]
      if (row) Object.assign(row, fields)
    }
  }

  setDatabase(file: File) {
    this.database = { file, proteins: null }
    void countProteins(file).then((n) => {
      if (this.database?.file === file) this.database.proteins = n
    })
  }

  /** Loads the example (two replicates of one file and its FASTA) in place of the current files. */
  async loadExample() {
    if (this.exampleLoading) return
    this.exampleLoading = true
    try {
      const fetchBlob = async (path: string) => {
        const response = await fetch(new URL(path, new URL(import.meta.env.BASE_URL, document.baseURI)))
        if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`)
        return response.blob()
      }
      const [mzML, fasta] = await Promise.all([fetchBlob(EXAMPLE.mzML), fetchBlob(EXAMPLE.fasta)])
      this.files = []
      this.notices = []
      for (const name of EXAMPLE.names) this.#addRow(new File([mzML], name), { condition: EXAMPLE.condition })
      this.setDatabase(new File([fasta], EXAMPLE.fasta.split('/').pop()!))
      this.setParam('FDR:protein', EXAMPLE.proteinFdr)
    } catch (e) {
      this.notices.push(`The example could not be loaded (${String((e as Error)?.message ?? e)}).`)
    } finally {
      this.exampleLoading = false
    }
  }

  /** "6 files · 1.9 GB" */
  get filesLine(): string {
    const bytes = this.files.reduce((sum, r) => sum + r.file.size, 0)
    return `${this.files.length} ${this.files.length === 1 ? 'file' : 'files'} · ${formatBytes(bytes)}`
  }
}

export const searchForm = new SearchForm()
