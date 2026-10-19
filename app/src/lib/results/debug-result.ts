// ?debug=large|large1|dense|small (see debug.ts): opens a stored synthetic result in Results, as History will
// open a stored search. For the e2e tests and for trying the tables without a search.

import type { DebugResultFlag } from '../debug'
import { navigate } from '../route.svelte'
import { openStoredResult } from '../search/session.svelte'
import { loadDebugResult, syntheticSpectra } from './synthetic'

/** `peaks`: the peaks per spectrum of the stored spectra every PSM gets (0: no spectra). */
export function openDebugResult(flag: DebugResultFlag, peaks = 0): void {
  const { tables, design, summary, psmFdr, proteinFdr } = loadDebugResult(flag)
  const id = openStoredResult({
    outcome: {
      tables,
      summary,
      spectra:
        peaks > 0
          ? syntheticSpectra(tables, peaks)
          : {
              psmSpectrum: new Int32Array(tables.psms.count).fill(-1),
              offsets: new Uint32Array(1),
              mz: new Float32Array(0),
              intensity: new Float32Array(0),
              precursorMz: new Float64Array(0),
              collisionEnergy: new Float32Array(0),
            },
      seconds: 161,
    },
    design,
    psmFdr,
    proteinFdr,
    settings: {
      parameters: {},
      fixedMods: ['Carbamidomethyl (C)'],
      database: 'synthetic.fasta',
      rescore: flag !== 'small',
      peptdeep: false,
      contaminants: true,
    },
  })
  navigate({ view: 'results', id })
}
