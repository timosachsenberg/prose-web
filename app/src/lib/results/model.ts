// The results model: the engine's `ResultTables` aggregated per sample, for the three levels of the
// results view (proteins, peptides, PSMs). Everything is a typed array indexed by the row of its table
// (protein, peptide or PSM index); no per-row objects. `filters.ts` filters and sorts such indices,
// `csv.ts` writes them.

import type { DesignResolution, Sample } from '../design/model'
import type { ResultTables } from '../engine/openms-types'

export type Level = 'proteins' | 'peptides' | 'psms'

/**
 * One column of the per-sample counts. `index` is the column's position in `ResultModel.samples` (the
 * `Sample.index` of the design is `designSample`), so `perSample[row * samples.length + index]` is the
 * count of the column.
 */
export type ResultSample = Sample & {
  /** The biological sample of the design (`DesignResolution.samples[designSample]`). */
  designSample: number
  /** Which measurement of the sample this column is (1, 2, ...); `null` when the column is the whole sample. */
  techReplicate: number | null
}

/** The columns of one condition, as `ResultModel.samples` indices, grouped by biological sample. */
export type ConditionColumns = {
  /** `null`: the samples without a condition, which count as one group. */
  name: string | null
  /** One entry per biological sample: its column (merged) or its columns (one per technical replicate). */
  samples: number[][]
}

export type ResultModel = {
  tables: ResultTables
  design: DesignResolution
  /**
   * The columns of the per-sample counts, in the order of the design. Without `showTechReplicates`
   * this is one column per biological sample of the searched files (the fractions and the technical
   * replicates of a sample are summed, and the sample counts as found if any of them found it).
   * With it, a sample that was measured more than once has one column per technical replicate
   * ("EGF 1 · TR1", "EGF 1 · TR2"; the fractions of one measurement are still summed), and the other
   * samples stay one column. A column belongs to a condition through `condition`.
   */
  samples: ResultSample[]
  showTechReplicates: boolean
  /** The search's cutoffs: PSMs above `psmFdr` are no evidence; the filters can only tighten both. 1 = not known. */
  psmFdr: number
  proteinFdr: number
  conditionColumns: ConditionColumns[]
  /** Per PSM row: its column in `samples`. */
  psmSample: Uint16Array
  peptide: {
    /** Per peptide: the lowest q-value of any of its PSMs (NaN: none has one). The peptide level's FDR. */
    bestQ: Float64Array
    /** Per peptide: the PSMs within `psmFdr`. */
    psms: Uint32Array
    /** `count × samples.length`: `psms` per column. */
    perSample: Uint32Array
    /** Per peptide: the proteins it maps to (views of `tables.peptides.protein`). */
    proteins: Uint32Array[]
    /** Per peptide: 1 if it maps only to contaminants (`CON__` accessions). */
    contaminant: Uint8Array
  }
  protein: {
    /** 0–1: the share of the protein's residues that the peptides with PSMs cover. */
    coverage: Float64Array
    /** The peptides with PSMs within `psmFdr`. */
    peptides: Uint32Array
    /** Their PSMs (a peptide shared by proteins counts for each of them). */
    psms: Uint32Array
    /** `count × samples.length`. */
    perSample: Uint32Array
    contaminant: Uint8Array
    /** The columns of `samples` with at least one PSM. */
    foundIn: Uint16Array
    /**
     * The peptide references of each protein (also those without PSMs within `psmFdr`):
     * `peptide[offsets[p] .. offsets[p + 1]]` are its peptides and `ref` the matching indices into
     * `tables.peptides.protein/start/end` (the location in the protein).
     */
    members: { offsets: Uint32Array; peptide: Uint32Array; ref: Uint32Array }
  }
}

/** Contaminants of the cRAP database carry this accession prefix. */
export const contaminantPrefix = 'CON__'

export function buildModel(
  t: ResultTables,
  d: DesignResolution,
  opts: { showTechReplicates: boolean; psmFdr?: number; proteinFdr?: number },
): ResultModel {
  const showTechReplicates = opts.showTechReplicates
  const psmFdr = opts.psmFdr ?? 1
  const proteinFdr = opts.proteinFdr ?? 1

  // The columns: the design rows are in the order of the searched files.
  const nFiles = t.files.length
  if (d.rows.length < nFiles) throw new Error(`The design has ${d.rows.length} rows for ${nFiles} searched files`)
  const measurements = new Map<number, Set<number>>() // design sample -> its technical replicates
  for (let i = 0; i < nFiles; i++) {
    const row = d.rows[i]
    const seen = measurements.get(row.sample)
    if (seen) seen.add(row.techReplicate)
    else measurements.set(row.sample, new Set([row.techReplicate]))
  }
  const samples: ResultSample[] = []
  const columnOf = new Map<string, number>()
  for (const designSample of [...measurements.keys()].sort((a, b) => a - b)) {
    const base = d.samples[designSample]
    const techs = [...measurements.get(designSample)!].sort((a, b) => a - b)
    if (showTechReplicates && techs.length > 1) {
      for (const tech of techs) {
        columnOf.set(`${designSample}\0${tech}`, samples.length)
        samples.push({ ...base, index: samples.length, label: `${base.label} · TR${tech}`, designSample, techReplicate: tech })
      }
    } else {
      for (const tech of techs) columnOf.set(`${designSample}\0${tech}`, samples.length)
      samples.push({ ...base, index: samples.length, designSample, techReplicate: null })
    }
  }
  const fileColumn = new Uint16Array(nFiles)
  for (let i = 0; i < nFiles; i++) fileColumn[i] = columnOf.get(`${d.rows[i].sample}\0${d.rows[i].techReplicate}`)!

  // the columns of each condition, by biological sample (samples are ordered by condition already)
  const byCondition = new Map<string | null, Map<number, number[]>>()
  for (const s of samples) {
    let bySample = byCondition.get(s.condition)
    if (!bySample) byCondition.set(s.condition, (bySample = new Map()))
    const columns = bySample.get(s.designSample)
    if (columns) columns.push(s.index)
    else bySample.set(s.designSample, [s.index])
  }
  const conditionColumns: ConditionColumns[] = [...byCondition].map(([name, bySample]) => ({
    name,
    samples: [...bySample.values()],
  }))

  const nS = samples.length
  const ps = t.psms
  const pt = t.peptides
  const pr = t.proteins

  // PSMs -> columns, and the peptides' counts
  const psmSample = new Uint16Array(ps.count)
  const nPep = pt.count
  const bestQ = new Float64Array(nPep).fill(NaN)
  const pepPsms = new Uint32Array(nPep)
  const pepPer = new Uint32Array(nPep * nS)
  for (let i = 0; i < ps.count; i++) {
    const k = ps.peptide[i]
    const column = fileColumn[ps.file[i]]
    psmSample[i] = column
    const q = ps.qValue[i]
    if (q === q && !(q >= bestQ[k])) bestQ[k] = q // the first q-value replaces NaN
    if (q > psmFdr) continue // a PSM above the search's cutoff is no evidence
    pepPsms[k]++
    pepPer[k * nS + column]++
  }

  const refOffsets = pt.proteinOffsets
  const nRefs = refOffsets[nPep]
  const pepProteins: Uint32Array[] = new Array(nPep)
  const pepContaminant = new Uint8Array(nPep)
  const nProt = pr.count
  const proContaminant = new Uint8Array(nProt)
  for (let p = 0; p < nProt; p++) proContaminant[p] = pr.accession[p].startsWith(contaminantPrefix) ? 1 : 0
  for (let k = 0; k < nPep; k++) {
    const from = refOffsets[k]
    const to = refOffsets[k + 1]
    pepProteins[k] = pt.protein.subarray(from, to)
    let all = to > from
    for (let r = from; r < to && all; r++) all = proContaminant[pt.protein[r]] === 1
    pepContaminant[k] = all ? 1 : 0
  }

  // proteins -> their peptide references (CSR)
  const memberOffsets = new Uint32Array(nProt + 1)
  for (let r = 0; r < nRefs; r++) memberOffsets[pt.protein[r] + 1]++
  for (let p = 0; p < nProt; p++) memberOffsets[p + 1] += memberOffsets[p]
  const memberPeptide = new Uint32Array(nRefs)
  const memberRef = new Uint32Array(nRefs)
  const cursor = memberOffsets.slice(0, nProt)
  for (let k = 0; k < nPep; k++) {
    for (let r = refOffsets[k]; r < refOffsets[k + 1]; r++) {
      const at = cursor[pt.protein[r]]++
      memberPeptide[at] = k
      memberRef[at] = r
    }
  }

  // the proteins' counts: a peptide counts once for each of its proteins
  const proPeptides = new Uint32Array(nProt)
  const proPsms = new Uint32Array(nProt)
  const proPer = new Uint32Array(nProt * nS)
  const lastPeptide = new Int32Array(nProt).fill(-1)
  for (let k = 0; k < nPep; k++) {
    if (pepPsms[k] === 0) continue
    for (let r = refOffsets[k]; r < refOffsets[k + 1]; r++) {
      const p = pt.protein[r]
      if (lastPeptide[p] === k) continue // the peptide lists the protein twice
      lastPeptide[p] = k
      proPeptides[p]++
      proPsms[p] += pepPsms[k]
      for (let s = 0; s < nS; s++) proPer[p * nS + s] += pepPer[k * nS + s]
    }
  }
  const foundIn = new Uint16Array(nProt)
  for (let p = 0; p < nProt; p++) {
    let found = 0
    for (let s = 0; s < nS; s++) if (proPer[p * nS + s] > 0) found++
    foundIn[p] = found
  }

  // coverage: the union of the peptides' stretches, marked in a scratch strip
  let longest = 0
  for (let p = 0; p < nProt; p++) longest = Math.max(longest, pr.sequence[p].length)
  const strip = new Uint8Array(longest)
  const coverage = new Float64Array(nProt)
  for (let p = 0; p < nProt; p++) {
    const length = pr.sequence[p].length
    if (length === 0 || memberOffsets[p] === memberOffsets[p + 1]) continue
    strip.fill(0, 0, length)
    let covered = 0
    for (let m = memberOffsets[p]; m < memberOffsets[p + 1]; m++) {
      if (pepPsms[memberPeptide[m]] === 0) continue
      const end = Math.min(pt.end[memberRef[m]], length)
      for (let j = pt.start[memberRef[m]]; j < end; j++) {
        if (strip[j] === 0) {
          strip[j] = 1
          covered++
        }
      }
    }
    coverage[p] = covered / length
  }

  return {
    tables: t,
    design: d,
    samples,
    showTechReplicates,
    psmFdr,
    proteinFdr,
    conditionColumns,
    psmSample,
    peptide: { bestQ, psms: pepPsms, perSample: pepPer, proteins: pepProteins, contaminant: pepContaminant },
    protein: {
      coverage,
      peptides: proPeptides,
      psms: proPsms,
      perSample: proPer,
      contaminant: proContaminant,
      foundIn,
      members: { offsets: memberOffsets, peptide: memberPeptide, ref: memberRef },
    },
  }
}
