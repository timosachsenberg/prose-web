import { input } from '../design/fixtures'
import { resolveDesign, type DesignResolution } from '../design/model'
import type { ResultTables } from '../engine/openms-types'
import { makeTables } from './synthetic'

// Shared by the results tests; not part of the app.

/** The cutoffs of a search that did not limit anything: every PSM and protein counts. */
export const cutoffs = { psmFdr: 1, proteinFdr: 1 }

/** Two files: control 1 and EGF 1. */
export function sampleDesign(): DesignResolution {
  return resolveDesign([
    input('ctrl_a.mzML', { condition: 'control', replicate: 1 }),
    input('egf_a.mzML', { condition: 'EGF', replicate: 1 }),
  ])
}

const albumin = 'MKWVTFISLLFLFSSAYSRG' // 20 residues
const antitrypsin = 'GDAHKSEVAHRFKDLGEENFKALVLIAFAQYLQQCPFEDH' // 40 residues
const trypsin = 'IVGGYTCGANTVPYQVSLNS'
const decoyProtein = 'RSLVQYPVTNAGCTVYQSLN'

/**
 * Four proteins, five peptides, nine PSMs in the two files of `sampleDesign`:
 *
 * - 0 ALBU (comma in its description), peptides 0 (MKWVTF, oxidised M, [0, 6)) and 1 (TFISLL, [4, 10)),
 *   which overlap: coverage 10 / 20
 * - 1 A1AT, peptide 2 (GDAHKSEVAH, [0, 10)): coverage 10 / 40
 * - 2 CON__ trypsin (a contaminant), peptide 3 (IVGGYT)
 * - 3 DECOY_, peptide 4 (RSLVQY)
 *
 * PSM q-values: 0.004 0.001 0.02 0.003 0.005 0.006 0.007 0.002 0.03 (files 0 0 1 0 1 1 1 1 0).
 */
export function sampleTables(): ResultTables {
  return makeTables({
    files: ['ctrl_a.mzML', 'egf_a.mzML'],
    proteins: [
      { accession: 'sp|P02768|ALBU_HUMAN', description: 'Serum albumin, mature chain', sequence: albumin, score: 100, qValue: 0.001 },
      { accession: 'sp|P01009|A1AT_HUMAN', description: 'Alpha-1-antitrypsin', sequence: antitrypsin, score: 80, qValue: 0.004 },
      { accession: 'CON__P00761', description: 'Trypsin', sequence: trypsin, score: 90, qValue: 0.002 },
      { accession: 'DECOY_sp|P99999|X_HUMAN', description: 'decoy', sequence: decoyProtein, decoy: true, score: 10, qValue: 0.03 },
    ],
    peptides: [
      {
        sequence: 'MKWVTF',
        proforma: 'M[Oxidation]KWVTF',
        openms: 'M(Oxidation)KWVTF',
        mods: [{ position: 0, name: 'Oxidation', unimod: 35, mass: 15.9949 }],
        proteins: [0],
      },
      { sequence: 'TFISLL', proteins: [0] },
      { sequence: 'GDAHKSEVAH', proteins: [1] },
      { sequence: 'IVGGYT', proteins: [2] },
      { sequence: 'RSLVQY', decoy: true, proteins: [3] },
    ],
    psms: [
      { peptide: 0, file: 0, qValue: 0.004, score: 40 },
      { peptide: 0, file: 0, qValue: 0.001, score: 50 },
      { peptide: 0, file: 1, qValue: 0.02, score: 30 },
      { peptide: 1, file: 0, qValue: 0.003, score: 45 },
      { peptide: 2, file: 1, qValue: 0.005, score: 42 },
      { peptide: 2, file: 1, qValue: 0.006, score: 41 },
      { peptide: 2, file: 1, qValue: 0.007, score: 40 },
      { peptide: 3, file: 1, qValue: 0.002, score: 48 },
      { peptide: 4, file: 0, qValue: 0.03, score: 20 },
    ],
  })
}
