// The results model: the engine's `ResultTables` aggregated per sample, for the three levels of the
// results view (proteins, peptides, PSMs). Everything is a typed array indexed by the row of its table
// (protein, peptide or PSM index); no per-row objects. `filters.ts` filters and sorts such indices,
// `csv.ts` writes them.

import type { DesignResolution, Sample } from '../design/model'
import type { ResultTables } from '../engine/openms-types'
import { markCovered } from './protein'

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

/** The PSM counts of the peptides at one q-value cutoff. */
export type PeptideCounts = {
  /** Per peptide: its PSMs at or below the cutoff. */
  psms: Uint32Array
  /** `count × samples.length`: `psms` per column. */
  perSample: Uint32Array
  /** Per peptide: the biological samples (Condition + Replicate) with at least one of those PSMs. */
  foundIn: Uint16Array
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
   * samples stay one column. A column belongs to a condition through `condition`. Splitting the
   * technical replicates only changes the count columns: "found in" always counts biological samples.
   */
  samples: ResultSample[]
  showTechReplicates: boolean
  /** The search rescored its PSMs with Percolator: `psms.score` is Percolator's, else ln(hyperscore). */
  rescored: boolean
  /**
   * The search's cutoffs. PSMs above `psmFdr` are no evidence: they are not counted anywhere, and
   * the filters can only tighten both values.
   */
  psmFdr: number
  proteinFdr: number
  conditionColumns: ConditionColumns[]
  /** Per PSM row: its column in `samples`. */
  psmSample: Uint16Array
  /**
   * The peptide (peptidoform) rows. `psms`, `perSample` and `foundIn` count the PSMs within `psmFdr`;
   * the Peptides table shows the counts at its own cutoff, which `peptideCounts` gives.
   */
  peptide: PeptideCounts & {
    /** Per peptide: the lowest q-value of any of its PSMs (NaN: none has one). The peptide level's FDR. */
    bestQ: Float64Array
    /** Per peptide: the proteins it maps to (views of `tables.peptides.protein`). */
    proteins: Uint32Array[]
    /** Per peptide: 1 if it maps only to contaminants (`CON__` accessions). */
    contaminant: Uint8Array
  }
  /** All protein counts are at the search's `psmFdr`: the protein filter is the protein q-value. */
  protein: {
    /** 0–1: the share of the protein's residues that the peptides with PSMs cover. */
    coverage: Float64Array
    /**
     * Its peptides with PSMs, counted by plain sequence: a sequence and its modified forms are one
     * peptide here (the Peptides table lists them as separate rows).
     */
    peptides: Uint32Array
    /** Their PSMs (a peptide shared by proteins counts for each of them). */
    psms: Uint32Array
    /** `count × samples.length`. */
    perSample: Uint32Array
    contaminant: Uint8Array
    /** The biological samples (Condition + Replicate) with at least one PSM. */
    foundIn: Uint16Array
    /**
     * The peptide references of each protein (also those without PSMs within `psmFdr`):
     * `peptide[offsets[p] .. offsets[p + 1]]` are its peptides and `ref` the matching indices into
     * `tables.peptides.protein/start/end` (the location in the protein).
     */
    members: { offsets: Uint32Array; peptide: Uint32Array; ref: Uint32Array }
  }
  /** Per column of `samples`: its design sample (the columns of one sample are adjacent). */
  columnSample: Uint16Array
}

/** Contaminants of the cRAP database carry this accession prefix. */
export const contaminantPrefix = 'CON__'

/** The q-value limit that applies: `maxQ`, but never above the search's cutoff (NaN or missing: the cutoff). */
export function qLimit(maxQ: number, cutoff: number): number {
  return maxQ <= cutoff ? maxQ : cutoff // false for NaN, too
}

/** The biological samples with a count in the row `base / nS`: columns of one sample are adjacent. */
function samplesFound(counts: Uint32Array, base: number, nS: number, columnSample: Uint16Array): number {
  let found = 0
  let last = -1
  for (let s = 0; s < nS; s++) {
    if (counts[base + s] > 0 && columnSample[s] !== last) {
      found++
      last = columnSample[s]
    }
  }
  return found
}

/** The peptides' PSMs at q ≤ `limit` (a missing q-value counts), in total, per column and as samples found. */
function countPsms(t: ResultTables, psmSample: Uint16Array, columnSample: Uint16Array, limit: number): PeptideCounts {
  const nPep = t.peptides.count
  const nS = columnSample.length
  const psms = new Uint32Array(nPep)
  const perSample = new Uint32Array(nPep * nS)
  const { peptide, qValue } = t.psms
  for (let i = 0; i < t.psms.count; i++) {
    if (qValue[i] > limit) continue
    const k = peptide[i]
    psms[k]++
    perSample[k * nS + psmSample[i]]++
  }
  const foundIn = new Uint16Array(nPep)
  for (let k = 0; k < nPep; k++) foundIn[k] = samplesFound(perSample, k * nS, nS, columnSample)
  return { psms, perSample, foundIn }
}

const countsCache = new WeakMap<ResultModel, Map<number, PeptideCounts>>()
const cachedCutoffs = 8

/**
 * The peptides' PSM counts for a Peptides table whose "best PSM q-value" filter is `maxQ`: the PSMs
 * counted are those with q ≤ min(`maxQ`, `psmFdr`), so the numbers agree with the PSM table behind
 * the same cutoff. At or above `psmFdr` (and for NaN) this is `m.peptide`; other cutoffs are counted
 * once (one pass over the PSMs) and the last few are kept. Use these arrays for the peptide columns
 * (`psms`, `sample:<n>`, `foundIn`) of that table, its sorting and its CSV.
 */
export function peptideCounts(m: ResultModel, maxQ: number): PeptideCounts {
  const limit = qLimit(maxQ, m.psmFdr)
  if (limit >= m.psmFdr) return m.peptide
  let cache = countsCache.get(m)
  if (!cache) countsCache.set(m, (cache = new Map()))
  let counts = cache.get(limit)
  if (!counts) {
    counts = countPsms(m.tables, m.psmSample, m.columnSample, limit)
    if (cache.size >= cachedCutoffs) cache.delete(cache.keys().next().value!)
    cache.set(limit, counts)
  }
  return counts
}

export const baseName = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)

/**
 * `rescored`: the search rescored the PSMs with Percolator (it names the score columns; default false).
 * `psmFdr` and `proteinFdr` are the cutoffs of the search that made `t` (0 < q ≤ 1); they are required
 * because the counts depend on them. The design must be that of the searched files: the same number
 * of rows, in the same order, each file named as the row says (`tables.files[i]` may carry
 * directories, e.g. `/input/<i>/<fileName>`).
 */
export function buildModel(
  t: ResultTables,
  d: DesignResolution,
  opts: { showTechReplicates: boolean; psmFdr: number; proteinFdr: number; rescored?: boolean },
): ResultModel {
  const { showTechReplicates, psmFdr, proteinFdr } = opts
  const rescored = opts.rescored ?? false
  for (const [name, value] of [['psmFdr', psmFdr], ['proteinFdr', proteinFdr]] as const) {
    if (!(value > 0 && value <= 1)) throw new Error(`${name} must be a q-value above 0 and at most 1, not ${value}`)
  }

  // The columns: the design rows are in the order of the searched files.
  const nFiles = t.files.length
  if (d.rows.length !== nFiles) {
    throw new Error(`The design has ${d.rows.length} rows but ${nFiles} files were searched`)
  }
  for (let i = 0; i < nFiles; i++) {
    if (baseName(t.files[i]) !== baseName(d.rows[i].fileName)) {
      throw new Error(`The design does not match the searched files: file ${i + 1} is "${t.files[i]}" but the design row says "${d.rows[i].fileName}"`)
    }
  }
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
  const columnSample = Uint16Array.from(samples, (s) => s.designSample)

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

  // PSMs -> columns, and the peptides' counts and best q-values
  const psmSample = new Uint16Array(ps.count)
  for (let i = 0; i < ps.count; i++) psmSample[i] = fileColumn[ps.file[i]]
  const nPep = pt.count
  const bestQ = new Float64Array(nPep).fill(NaN)
  for (let i = 0; i < ps.count; i++) {
    const k = ps.peptide[i]
    const q = ps.qValue[i]
    if (q === q && !(q >= bestQ[k])) bestQ[k] = q // the first q-value replaces NaN
  }
  // a PSM above the search's cutoff is no evidence
  const { psms: pepPsms, perSample: pepPer, foundIn: pepFoundIn } = countPsms(t, psmSample, columnSample, psmFdr)

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

  // The proteins' counts. A peptide's PSMs count once for each of its proteins, even when it lists a
  // protein twice; the peptides are counted by plain sequence.
  const sequenceId = new Uint32Array(nPep)
  const ids = new Map<string, number>()
  for (let k = 0; k < nPep; k++) {
    let id = ids.get(pt.sequence[k])
    if (id === undefined) ids.set(pt.sequence[k], (id = ids.size))
    sequenceId[k] = id
  }
  const seenSequence = new Int32Array(ids.size).fill(-1) // the last protein that counted the sequence
  const seenPeptide = new Int32Array(nPep).fill(-1)
  const proPeptides = new Uint32Array(nProt)
  const proPsms = new Uint32Array(nProt)
  const proPer = new Uint32Array(nProt * nS)
  const proFoundIn = new Uint16Array(nProt)
  for (let p = 0; p < nProt; p++) {
    for (let m = memberOffsets[p]; m < memberOffsets[p + 1]; m++) {
      const k = memberPeptide[m]
      if (pepPsms[k] === 0 || seenPeptide[k] === p) continue
      seenPeptide[k] = p
      proPsms[p] += pepPsms[k]
      for (let s = 0; s < nS; s++) proPer[p * nS + s] += pepPer[k * nS + s]
      if (seenSequence[sequenceId[k]] !== p) {
        seenSequence[sequenceId[k]] = p
        proPeptides[p]++
      }
    }
    proFoundIn[p] = samplesFound(proPer, p * nS, nS, columnSample)
  }

  // coverage: the union of the peptides' stretches, marked in a scratch strip (the protein panel
  // uses the same `markCovered`)
  let longest = 0
  for (let p = 0; p < nProt; p++) longest = Math.max(longest, pr.sequence[p].length)
  const strip = new Uint8Array(longest)
  const members = { offsets: memberOffsets, peptide: memberPeptide, ref: memberRef }
  const coverage = new Float64Array(nProt)
  for (let p = 0; p < nProt; p++) {
    const length = pr.sequence[p].length
    if (length > 0) coverage[p] = markCovered(strip, length, members, p, pepPsms, pt.start, pt.end) / length
  }

  return {
    tables: t,
    design: d,
    samples,
    showTechReplicates,
    rescored,
    psmFdr,
    proteinFdr,
    conditionColumns,
    psmSample,
    peptide: {
      bestQ,
      psms: pepPsms,
      perSample: pepPer,
      foundIn: pepFoundIn,
      proteins: pepProteins,
      contaminant: pepContaminant,
    },
    protein: {
      coverage,
      peptides: proPeptides,
      psms: proPsms,
      perSample: proPer,
      contaminant: proContaminant,
      foundIn: proFoundIn,
      members,
    },
    columnSample,
  }
}
