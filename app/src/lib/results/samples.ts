// The Samples tab: samples × (PSMs, peptides, proteins), grouped by condition. Counted as the tables
// count, at the search's cutoffs:
// - PSMs: target PSMs at the PSM FDR (contaminants included, as in the key figures);
// - peptides: distinct plain sequences (a sequence and its modified forms count once, as the protein
//   counts do; the Peptides tab lists modified forms as rows of their own);
// - proteins: protein groups at the protein FDR with a PSM in the sample (proteins that cannot be told
//   apart count once, as in the key figures; a protein without a group is a group of its own).
// A condition's and the total's peptides and proteins are the distinct ones in all its samples, not the sum.
// Technical replicates follow the "Show technical replicates" setting: merged, a sample is one row;
// separate, each measurement has a row.

import { levelRows } from './figures'
import type { ResultModel } from './model'

export type SampleCounts = { psms: number; peptides: number; proteins: number }

export type SampleRow = {
  /** The column of `ResultModel.samples`. */
  column: number
  label: string
  /** The searched files of the sample (its fractions and, merged, its technical replicates). */
  files: number
  counts: SampleCounts
}

export type ConditionGroup = {
  /** `null`: the samples without a condition. */
  name: string | null
  /** The rows: samples, or with technical replicates shown separately their measurements. */
  samples: SampleRow[]
  /** The biological samples of the condition (a sample split into measurements counts once). */
  sampleCount: number
  /** The condition as a whole. */
  counts: SampleCounts
}

export type SamplesTable = {
  groups: ConditionGroup[]
  total: SampleCounts
  /** The design has conditions: the table shows a row for each. */
  grouped: boolean
}

export function sampleTable(m: ResultModel): SamplesTable {
  const nS = m.samples.length
  const nPep = m.tables.peptides.count
  const groupOf = new Uint16Array(nS)
  m.conditionColumns.forEach((g, gi) => {
    for (const columns of g.samples) for (const c of columns) groupOf[c] = gi
  })
  const nG = m.conditionColumns.length

  // PSMs and distinct sequences
  const sequenceId = new Uint32Array(nPep)
  const ids = new Map<string, number>()
  for (let k = 0; k < nPep; k++) {
    const sequence = m.tables.peptides.sequence[k]
    let id = ids.get(sequence)
    if (id === undefined) ids.set(sequence, (id = ids.size))
    sequenceId[k] = id
  }
  const newSets = (n: number) => Array.from({ length: n }, () => new Set<number>())
  const colSequences = newSets(nS)
  const groupSequences = newSets(nG)
  const allSequences = new Set<number>()
  const psms = new Uint32Array(nS)
  const ps = m.tables.psms
  for (const i of levelRows(m, 'psms', false)) {
    const c = m.psmSample[i]
    const id = sequenceId[ps.peptide[i]]
    psms[c]++
    colSequences[c].add(id)
    groupSequences[groupOf[c]].add(id)
    allSequences.add(id)
  }

  // protein groups
  const colProteins = newSets(nS)
  const groupProteins = newSets(nG)
  const allProteins = new Set<number>()
  const pr = m.tables.proteins
  for (const p of levelRows(m, 'proteins', false)) {
    const key = pr.group[p] >= 0 ? pr.group[p] : -1 - p
    let any = false
    for (let c = 0; c < nS; c++) {
      if (m.protein.perSample[p * nS + c] === 0) continue
      colProteins[c].add(key)
      groupProteins[groupOf[c]].add(key)
      any = true
    }
    if (any) allProteins.add(key)
  }

  // the files of each column
  const files = new Uint32Array(nS)
  for (const row of m.design.rows) {
    const column = m.samples.findIndex((s) => s.designSample === row.sample && (s.techReplicate === null || s.techReplicate === row.techReplicate))
    if (column >= 0) files[column]++
  }

  const groups: ConditionGroup[] = m.conditionColumns.map((g, gi) => {
    const columns = g.samples.flat()
    return {
      name: g.name,
      sampleCount: g.samples.length,
      samples: columns.map((c) => ({
        column: c,
        label: m.samples[c].label,
        files: files[c],
        counts: { psms: psms[c], peptides: colSequences[c].size, proteins: colProteins[c].size },
      })),
      counts: {
        psms: columns.reduce((n, c) => n + psms[c], 0),
        peptides: groupSequences[gi].size,
        proteins: groupProteins[gi].size,
      },
    }
  })
  return {
    groups,
    total: { psms: groups.reduce((n, g) => n + g.counts.psms, 0), peptides: allSequences.size, proteins: allProteins.size },
    grouped: m.design.conditions.length > 0,
  }
}
