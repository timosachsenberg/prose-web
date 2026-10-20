// What the New search form amounts to: the one-line plan, the memory estimate and its advice, the module
// the search runs in (wasm32, or wasm64 for one that needs more than 3 GB, where the browser has
// Memory64), why the search cannot start yet, and starting it.

import { debugFlag } from '../debug'
import { engineState, searchThreads } from '../engine/app-engine.svelte'
import type { EngineInfo, SearchRequest } from '../engine/client'
import { fileTooLargeMessage, maxFileBytes, threadsForSearch } from '../engine/protocol'
import { chooseEngine, supportsMemory64 } from '../engine/variant'
import { formatPercent } from '../format/fdr'
import { navigate } from '../route.svelte'
import { estimateMemory, formatMemory, indexModifications, type MemoryInput, type Specificity } from '../settings/memory'
import { unknownModifications } from '../settings/modifications'
import { copyValues, requestParameters } from '../settings/parameters'
import { CRAP_PROTEINS, searchForm as form } from './form.svelte'
import { runSearch, searchRun, type OpenResult } from './session.svelte'

/** What to do instead where the browser has no Memory64 (Safari) and a search needs more than 4 GB. */
const NO_MEMORY64 =
  'This browser cannot run the 64-bit engine, which a search above 4 GB needs: use a Chromium-based browser (Chrome, ' +
  'Edge) or Firefox, smaller chunks (database:chunk_size under All parameters) or fewer files at once.'

function unknownMessage(names: string[]): string {
  return (
    `${names.length === 1 ? 'Unknown modification' : 'Unknown modifications'}: ${names.join(', ')}. ` +
    'OpenMS does not know this name; choose one from the list.'
  )
}

class SearchPlan {
  /** PeptDeep features need Percolator and ONNX Runtime (the app's package has it; unknown while OpenMS loads). */
  peptdeep = $derived(form.rescore && form.peptdeep && (engineState.info?.onnx ?? true))

  /** What the size of the search's index depends on: the proteins, the specificity, the chunks. */
  index = $derived.by(() => {
    const enzyme = String(form.value('enzyme'))
    const specificity: Specificity =
      enzyme === 'unspecific cleavage' ? 'none' : ((form.value('peptide:enzyme_specificity') ?? 'full') as Specificity)
    return {
      proteins: (form.database?.proteins ?? 0) + (form.contaminants ? CRAP_PROTEINS : 0),
      specificity,
      chunkSize: Number(form.value('database:chunk_size') ?? 0),
    }
  })

  /**
   * A semi- or non-specific search: building its index is a long step without progress reports, for
   * which the engine's watchdog waits longer.
   */
  slowSteps = $derived(this.index.specificity !== 'full')

  /** The threads the search will use: all of the engine's, at most 4 for many files (the memory grows per file). */
  threads = $derived(threadsForSearch(engineState.info?.threads ?? searchThreads(), form.files.length, this.peptdeep))

  /** The browser runs the 64-bit module (Memory64). Settable for the tests. */
  memory64 = $state(supportsMemory64())

  /** `?debug=wasm64`: every search runs in the 64-bit module (where the browser has it). */
  forceWasm64 = $state(typeof location !== 'undefined' && debugFlag(location.search) === 'wasm64')

  /** What the estimate needs of the form, whatever the module. */
  #memoryInput = $derived.by((): Omit<MemoryInput, 'variant'> | null => {
    if (form.files.length === 0) return null
    const sizes = form.files.map((r) => r.file.size)
    return {
      ...this.index,
      largestMzmlBytes: Math.max(...sizes),
      files: sizes.length,
      mzmlBytes: sizes.reduce((a, b) => a + b, 0),
      databaseBytes: form.database?.file.size ?? 0,
      threads: this.threads.threads,
      variableMods: indexModifications(form.value<string[]>('modifications:variable') ?? []),
      peptdeep: this.peptdeep,
    }
  })

  /** The estimate in wasm32, which decides the module. */
  estimate32 = $derived(this.#memoryInput && estimateMemory({ ...this.#memoryInput, variant: 'wasm32' }))

  /** The module the search runs in (`chooseEngine`). */
  engine = $derived(
    this.estimate32 === null
      ? 'wasm32'
      : chooseEngine({
          estimate32: this.estimate32.bytes,
          fileTooLarge32: this.estimate32.fileTooLarge,
          memory64: this.memory64,
          force: this.forceWasm64,
        }),
  )

  /** The estimate in the module the search runs in. */
  estimate = $derived(
    this.engine === 'wasm64' && this.#memoryInput ? estimateMemory({ ...this.#memoryInput, variant: 'wasm64' }) : this.estimate32,
  )

  /**
   * "6 files in 3 samples · 20,652 proteins + 116 cRAP + decoys · estimated memory 2.6 GB of 4 GB", or
   * "… · estimated memory 8.3 GB · 64-bit engine (up to 16 GB)"
   */
  line = $derived.by(() => {
    const n = form.files.length
    if (n === 0) return 'No spectra yet'
    const samples = form.design.samples.length
    const parts = [`${n} ${n === 1 ? 'file' : 'files'}${n > 1 ? ` in ${samples} ${samples === 1 ? 'sample' : 'samples'}` : ''}`]
    if (form.database) {
      const proteins = form.database.proteins
      const decoys = form.value('decoys') === 'ignore' ? '' : ' + decoys'
      const crap = form.contaminants ? ` + ${CRAP_PROTEINS} cRAP` : ''
      parts.push(proteins === null ? 'counting proteins…' : `${proteins.toLocaleString('en-US')} proteins${crap}${decoys}`)
      if (this.estimate?.variant === 'wasm64') {
        parts.push(`estimated memory ${formatMemory(this.estimate.bytes)}`, '64-bit engine (up to 16 GB)')
      } else if (this.estimate) {
        parts.push(`estimated memory ${formatMemory(this.estimate.bytes)} of 4 GB`)
      }
    } else {
      parts.push('no database yet')
    }
    if (form.isExample) parts.push(`example: ${formatPercent(Number(form.value('FDR:protein')))} protein FDR, small database`)
    return parts.join(' · ')
  })

  /** What the estimate advises, by its module and cause: the database's index or the input files. */
  advice = $derived.by(() => {
    const estimate = this.estimate
    if (!estimate || !form.database || estimate.level === 'ok') return null
    const over = estimate.level === 'over'
    const wide = estimate.variant === 'wasm64'
    let text: string
    if (estimate.fileTooLarge) {
      const max = maxFileBytes(estimate.variant)
      const file = [...form.files.map((r) => r.file), form.database.file].find((f) => f.size > max)!
      text = fileTooLargeMessage(file.name, file.size, max)
      if (!wide && !this.memory64) text += ` ${NO_MEMORY64}`
    } else if (over && !wide && !this.memory64) {
      text = NO_MEMORY64
    } else {
      const more = wide ? 'More than the 16 GB the 64-bit engine can use' : 'More than the 4 GB a browser search can use'
      const close = wide ? 'Close to the 16 GB limit of the 64-bit engine' : 'Close to the 4 GB limit'
      if (estimate.cause === 'inputs') {
        text = `${over ? more : close}, mostly for the files: search fewer files at once.`
      } else if (over) {
        text = `${more}: set database:chunk_size (e.g. 2000) under All parameters, or use fewer variable modifications or a narrower specificity.`
      } else {
        text = `${close}: ${wide ? 'set' : 'consider'} database:chunk_size (e.g. 2000) under All parameters.`
      }
    }
    return { text, over }
  })

  /** Modification names OpenMS does not know (once it is loaded). */
  unknownMods = $derived(engineState.info ? unknownModifications(form.values, engineState.info.parameters) : [])

  /** Why the search cannot start yet. */
  problem = $derived.by(() => {
    if (form.files.length === 0) return 'Add mzML files to start.'
    if (!form.database) return 'Choose a FASTA database to start.'
    if (!(Number(form.value('FDR:PSM')) > 0)) return 'Set a PSM FDR above 0 %.'
    if (!(Number(form.value('FDR:protein')) > 0)) return 'Set a protein FDR above 0 %.'
    if (this.unknownMods.length > 0) return unknownMessage(this.unknownMods)
    return null
  })

  /** The problem is shown in the footer (with files; without, the plan line says "No spectra yet"). */
  problemShown = $derived(this.problem !== null && form.files.length > 0)

  canStart = $derived(this.problem === null && searchRun.status !== 'running')
}

export const searchPlan = new SearchPlan()

/** Starts the search of the form; on success, opens its result. */
export async function startSearch(): Promise<void> {
  if (!searchPlan.canStart || !form.database) return
  const values = $state.snapshot(form.values) as Record<string, unknown>
  const parameters = requestParameters(values, form.defaults)
  const peptdeep = searchPlan.peptdeep
  const request: SearchRequest = {
    files: form.files.map((r) => ({ id: r.id, file: r.file })),
    database: form.database.file,
    contaminants: form.contaminants,
    parameters,
    rescore: form.rescore,
    peptdeep,
    engine: searchPlan.engine,
    slowSteps: searchPlan.slowSteps,
  }
  // typed before OpenMS was loaded, modification names are checked once it is
  const check = (info: EngineInfo) => {
    const unknown = unknownModifications(values, info.parameters)
    return unknown.length > 0 ? unknownMessage(unknown) : null
  }
  const id = await runSearch(
    request,
    {
      design: $state.snapshot(form.design),
      psmFdr: Number(values['FDR:PSM']),
      proteinFdr: Number(values['FDR:protein']),
      settings: {
        parameters,
        fixedMods: (values['modifications:fixed'] as string[] | undefined) ?? [],
        database: form.database.file.name,
        rescore: form.rescore,
        peptdeep,
        contaminants: form.contaminants,
        presetId: form.presetId,
      },
    },
    check,
  )
  if (id !== null) navigate({ view: 'results', id })
}

/**
 * New search still holds the inputs of `result`: the same files, by name and order, and the same
 * database. It can then search them again with other settings. A result from History or a project
 * file has no files of its own, so it qualifies only when New search holds them again.
 */
export function canSearchAgain(result: OpenResult): boolean {
  const rows = result.design.rows
  return (
    form.database?.file.name === result.settings.database &&
    form.files.length === rows.length &&
    form.files.every((r, i) => r.file.name === rows[i].fileName)
  )
}

/**
 * Back to New search with the inputs and settings of `result`, changed by `changes` (parameters,
 * e.g. { 'FDR:protein': 0.05 }). The user starts the search there.
 */
export function searchAgain(result: OpenResult, changes: Record<string, unknown>): void {
  const s = result.settings
  if (s.presetId !== undefined && form.presets.some((p) => p.id === s.presetId)) form.presetId = s.presetId
  form.overrides = copyValues({ ...s.parameters, ...changes })
  form.rescore = s.rescore
  form.peptdeep = s.peptdeep
  form.contaminants = s.contaminants
  navigate({ view: 'search' })
}
