// What the New search form amounts to: the one-line plan, the memory estimate and its advice, why the
// search cannot start yet, and starting it.

import { engineState, searchThreads } from '../engine/app-engine.svelte'
import type { EngineInfo, SearchRequest } from '../engine/client'
import { fileTooLargeMessage, isTooLarge, threadsForSearch } from '../engine/protocol'
import { formatPercent } from '../format/fdr'
import { navigate } from '../route.svelte'
import {
  estimateMemory,
  formatMemory,
  isUncertain,
  UNCERTAIN_MEASURED,
  UNCERTAIN_OVER_FILES,
  type Specificity,
} from '../settings/memory'
import { unknownModifications } from '../settings/modifications'
import { copyValues, requestParameters } from '../settings/parameters'
import { CRAP_PROTEINS, searchForm as form } from './form.svelte'
import { runSearch, searchRun, type OpenResult } from './session.svelte'

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
   * A chunked semi- or non-specific search: the memory estimate cannot bound it, and it runs with fewer
   * threads. While the proteins are being counted, a chunk size counts as chunking (a search started
   * then gets the cap too).
   */
  uncertainMemory = $derived(
    isUncertain({ ...this.index, proteins: form.database?.proteins == null ? null : this.index.proteins }),
  )

  /**
   * The threads the search will use: all of the engine's, at most 4 for many files or an uncertain
   * memory estimate (the memory grows per file).
   */
  threads = $derived(
    threadsForSearch(engineState.info?.threads ?? searchThreads(), form.files.length, this.peptdeep, this.uncertainMemory),
  )

  estimate = $derived.by(() => {
    if (form.files.length === 0) return null
    const sizes = form.files.map((r) => r.file.size)
    return estimateMemory({
      ...this.index,
      largestMzmlBytes: Math.max(...sizes),
      files: sizes.length,
      mzmlBytes: sizes.reduce((a, b) => a + b, 0),
      databaseBytes: form.database?.file.size ?? 0,
      threads: this.threads.threads,
      variableMods: (form.value<string[]>('modifications:variable') ?? []).length,
      peptdeep: this.peptdeep,
    })
  })

  /** "6 files in 3 samples · 20,652 proteins + 116 cRAP + decoys · estimated memory 2.6 GB of 4 GB" */
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
      if (this.estimate?.uncertain) {
        parts.push(`estimated memory about ${formatMemory(this.estimate.bytes)} of 4 GB (${UNCERTAIN_MEASURED})`)
      } else if (this.estimate) {
        parts.push(`estimated memory ${formatMemory(this.estimate.bytes)} of 4 GB`)
      }
    } else {
      parts.push('no database yet')
    }
    if (form.isExample) parts.push(`example: ${formatPercent(Number(form.value('FDR:protein')))} protein FDR, small database`)
    return parts.join(' · ')
  })

  /** What the estimate advises, by its cause: the database's index or the input files. */
  advice = $derived.by(() => {
    const estimate = this.estimate
    if (!estimate || !form.database || estimate.level === 'ok') return null
    const over = estimate.level === 'over'
    let text: string
    if (estimate.fileTooLarge) {
      const file = [...form.files.map((r) => r.file), form.database.file].find((f) => isTooLarge(f.size))!
      text = fileTooLargeMessage(file.name, file.size)
    } else if (estimate.uncertain) {
      // the chunk index is built again for every file: the chunk size does not bound the memory
      const needs = 'A chunked semi- or non-specific search needs about 3.8 GB of the 4 GB'
      const files = form.files.length
      if (over && files >= UNCERTAIN_OVER_FILES) {
        text =
          `${needs}, more with every file (a human semi-tryptic search in chunks of 2000 measured 2.3–3.7 GB ` +
          `for one file, 3.8 GB for three): with ${files} files it will likely stop for lack of memory. ` +
          'Search fewer files at a time.'
      } else if (over) {
        text =
          'More than the 4 GB a browser search can use: use smaller chunks (database:chunk_size), fewer ' +
          'variable modifications or a narrower specificity.'
      } else {
        text = `${needs} (a human semi-tryptic search in chunks of 2000 ${UNCERTAIN_MEASURED}): it may stop for lack of memory.`
      }
    } else if (estimate.cause === 'inputs') {
      const limit = over ? 'More than the 4 GB a browser search can use' : 'Close to the 4 GB limit'
      text = `${limit}, mostly for the files: search fewer files at once.`
    } else if (over) {
      text =
        'More than the 4 GB a browser search can use: set database:chunk_size (e.g. 2000) under All parameters, ' +
        'or use fewer variable modifications or a narrower specificity.'
    } else {
      text = 'Close to the 4 GB limit: consider database:chunk_size (e.g. 2000) under All parameters.'
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
    uncertainMemory: searchPlan.uncertainMemory,
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
