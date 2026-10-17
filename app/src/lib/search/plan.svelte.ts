// What the New search form amounts to: the one-line plan, the memory estimate and its advice, why the
// search cannot start yet, and starting it.

import { engineState } from '../engine/app-engine.svelte'
import type { EngineInfo, SearchRequest } from '../engine/client'
import { formatBytes } from '../format/bytes'
import { navigate } from '../route.svelte'
import { estimateMemory, formatMemory, INPUT_BUDGET, type Specificity } from '../settings/memory'
import { unknownModifications } from '../settings/modifications'
import { requestParameters } from '../settings/parameters'
import { CRAP_PROTEINS, searchForm as form } from './form.svelte'
import { runSearch, searchRun } from './session.svelte'

function unknownMessage(names: string[]): string {
  return (
    `${names.length === 1 ? 'Unknown modification' : 'Unknown modifications'}: ${names.join(', ')}. ` +
    'OpenMS does not know this name; choose one from the list.'
  )
}

class SearchPlan {
  /** PeptDeep features need Percolator and ONNX Runtime (the app's package has it; unknown while OpenMS loads). */
  peptdeep = $derived(form.rescore && form.peptdeep && (engineState.info?.onnx ?? true))

  estimate = $derived.by(() => {
    if (form.files.length === 0) return null
    const sizes = form.files.map((r) => r.file.size)
    const enzyme = String(form.value('enzyme'))
    const specificity =
      enzyme === 'unspecific cleavage' ? 'none' : ((form.value('peptide:enzyme_specificity') ?? 'full') as Specificity)
    return estimateMemory({
      largestMzmlBytes: Math.max(...sizes),
      inputBytes: sizes.reduce((a, b) => a + b, 0) + (form.database?.file.size ?? 0),
      proteins: (form.database?.proteins ?? 0) + (form.contaminants ? CRAP_PROTEINS : 0),
      specificity,
      variableMods: (form.value<string[]>('modifications:variable') ?? []).length,
      peptdeep: this.peptdeep,
      storage: 'memory',
      chunkSize: Number(form.value('database:chunk_size') ?? 0),
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
      if (this.estimate) parts.push(`estimated memory ${formatMemory(this.estimate.bytes)} of 4 GB`)
    } else {
      parts.push('no database yet')
    }
    return parts.join(' · ')
  })

  /** What the estimate advises, by its cause: the database's index or the input files. */
  advice = $derived.by(() => {
    const estimate = this.estimate
    if (!estimate || !form.database || estimate.level === 'ok') return null
    const over = estimate.level === 'over'
    let text: string
    if (estimate.inputsOverBudget) {
      const total = form.files.reduce((a, r) => a + r.file.size, 0) + form.database.file.size
      text =
        `The files total ${formatBytes(total)}; the browser engine holds about ${formatBytes(INPUT_BUDGET)} of ` +
        'input at once: search fewer files at a time.'
    } else if (estimate.cause === 'inputs') {
      const limit = over ? 'More than the 4 GB a browser search can use' : 'Close to the 4 GB limit'
      text = `${limit}, mostly for the files: search fewer files at once.`
    } else if (over) {
      text =
        'More than the 4 GB a browser search can use: set database:chunk_size (e.g. 2000) under All parameters, ' +
        'or use fewer variable modifications or a narrower specificity.'
    } else if (estimate.uncertain) {
      text =
        'A chunked semi- or non-specific search can need much more than the estimate (a human semi-tryptic ' +
        'search in chunks of 2000 needed 3.8 GB): it may stop for lack of memory.'
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
      settings: { parameters, rescore: form.rescore, peptdeep, contaminants: form.contaminants, presetId: form.presetId },
    },
    check,
  )
  if (id !== null) navigate({ view: 'results', id })
}
