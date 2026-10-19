// Synthetic result tables for tests and for the debug hook (`?debug=large|small`): `makeTables` lays out a
// small hand-written result as the engine does, `makeLargeTables` generates a big, consistent one.
// Only the tests and the debug results (`?debug=large|small`, debug-result.ts) use them.

import { resolveDesign, type DesignInput, type DesignResolution } from '../design/model'
import type { ProSEMultiSummary, ResultTables } from '../engine/openms-types'

export type ProteinSpec = {
  accession: string
  description?: string
  sequence: string
  decoy?: boolean
  /** default 1 */
  score?: number
  /** default 0.001; NaN = absent */
  qValue?: number
  /** default: the protein's own index */
  group?: number
}

export type ModSpec = { position: number; name: string; unimod?: number; mass?: number }

export type PeptideSpec = {
  /** plain residues */
  sequence: string
  /** default: `sequence` */
  proforma?: string
  /** default: `proforma` */
  openms?: string
  decoy?: boolean
  mods?: ModSpec[]
  /** The proteins it maps to: an index (the peptide is looked up in the protein's sequence) or the index with its 0-based start. */
  proteins: (number | { protein: number; start: number })[]
}

export type PsmSpec = {
  peptide: number
  /** index into `files`, default 0 */
  file?: number
  /** default `scan=<row + 1>` */
  nativeId?: string
  rt?: number
  mz?: number
  /** default 2 */
  charge?: number
  /** default 10 */
  score?: number
  /** default 0.001; NaN = absent */
  qValue?: number
  /** default: the peptide's */
  decoy?: boolean
}

export type TablesSpec = { files: string[]; proteins: ProteinSpec[]; peptides: PeptideSpec[]; psms: PsmSpec[] }

/** Result tables of a hand-written spec, in the layout of the engine (PSMs in the order given). */
export function makeTables(spec: TablesSpec): ResultTables {
  const { proteins, peptides, psms } = spec

  const modList = peptides.map((p) => p.mods ?? [])
  const modOffsets = new Uint32Array(peptides.length + 1)
  modList.forEach((mods, k) => (modOffsets[k + 1] = modOffsets[k] + mods.length))
  const mods = modList.flat()

  const refs = peptides.map((p) =>
    p.proteins.map((ref) => {
      const protein = typeof ref === 'number' ? ref : ref.protein
      const start = typeof ref === 'number' ? proteins[protein].sequence.indexOf(p.sequence) : ref.start
      if (start < 0) throw new Error(`peptide ${p.sequence} is not in protein ${proteins[protein].accession}`)
      return { protein, start, end: start + p.sequence.length }
    }),
  )
  const proteinOffsets = new Uint32Array(peptides.length + 1)
  refs.forEach((r, k) => (proteinOffsets[k + 1] = proteinOffsets[k] + r.length))
  const flat = refs.flat()

  const psm = {
    count: psms.length,
    file: Uint16Array.from(psms, (p) => p.file ?? 0),
    nativeId: psms.map((p, i) => p.nativeId ?? `scan=${i + 1}`),
    rt: Float64Array.from(psms, (p, i) => p.rt ?? 60 + i),
    mz: Float64Array.from(psms, (p) => p.mz ?? 500),
    charge: Int8Array.from(psms, (p) => p.charge ?? 2),
    peptide: Uint32Array.from(psms, (p) => p.peptide),
    score: Float64Array.from(psms, (p) => p.score ?? 10),
    qValue: Float64Array.from(psms, (p) => p.qValue ?? 0.001),
    pep: new Float64Array(psms.length),
    precursorErrorPpm: new Float64Array(psms.length),
    isotopeError: new Int8Array(psms.length),
    deltaMass: new Float64Array(psms.length),
    decoy: Uint8Array.from(psms, (p) => (p.decoy ?? peptides[p.peptide].decoy ?? false) ? 1 : 0),
    featureNames: [] as string[],
    features: new Float64Array(0),
  }

  return {
    files: spec.files,
    psms: psm,
    peptides: {
      count: peptides.length,
      openms: peptides.map((p) => p.openms ?? p.proforma ?? p.sequence),
      proforma: peptides.map((p) => p.proforma ?? p.sequence),
      sequence: peptides.map((p) => p.sequence),
      decoy: Uint8Array.from(peptides, (p) => (p.decoy ? 1 : 0)),
      modOffsets,
      modPosition: Int16Array.from(mods, (m) => m.position),
      modName: mods.map((m) => m.name),
      modUnimod: Int32Array.from(mods, (m) => m.unimod ?? 0),
      modMass: Float64Array.from(mods, (m) => m.mass ?? 0),
      proteinOffsets,
      protein: Uint32Array.from(flat, (r) => r.protein),
      start: Uint32Array.from(flat, (r) => r.start),
      end: Uint32Array.from(flat, (r) => r.end),
    },
    proteins: {
      count: proteins.length,
      accession: proteins.map((p) => p.accession),
      description: proteins.map((p) => p.description ?? ''),
      sequence: proteins.map((p) => p.sequence),
      score: Float64Array.from(proteins, (p) => p.score ?? 1),
      qValue: Float64Array.from(proteins, (p) => p.qValue ?? 0.001),
      decoy: Uint8Array.from(proteins, (p) => (p.decoy ? 1 : 0)),
      group: Int32Array.from(proteins, (p, i) => p.group ?? i),
    },
  }
}

// mulberry32: a small seeded generator, so that the large result is the same in every run
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// the residues, K and R twice as often as the others (tryptic-looking peptides end in K or R)
const residues = 'ACDEFGHIKLMNPQRSTVWYKR'

/**
 * A large, consistent result: `nPsms` best hits on `nPeptides` peptides of `nProteins` proteins in
 * `nFiles` files (named `control_1.mzML` ... `EGF_n.mzML`, see `syntheticDesign`). About 5 % of the
 * proteins are decoys, 1 % of the targets are contaminants (`CON__`), a tenth of the peptides are
 * shared by two proteins, and each peptide's sequence is the stretch of its protein that `start`/`end`
 * name. PSMs favour the first peptides, so that the counts differ a lot. The q-values are made up
 * (about half of the PSMs are at q ≤ 0.01), and not derived from the scores.
 */
export function makeLargeTables(nPsms: number, nPeptides: number, nProteins: number, nFiles = 6): ResultTables {
  const rand = random(20261016)
  const int = (n: number) => Math.floor(rand() * n)
  const residue = () => residues[int(residues.length)]
  const run = (n: number) => Array.from({ length: n }, residue).join('')

  const nDecoyProteins = Math.floor(nProteins * 0.05)
  const nTargetProteins = nProteins - nDecoyProteins
  const isDecoyProtein = (p: number) => p >= nTargetProteins
  const isContaminant = (p: number) => p < Math.floor(nTargetProteins * 0.01)

  // Peptides first. A peptide belongs to a random protein (of its kind) and, one in ten, to a second one.
  const sequence: string[] = new Array(nPeptides)
  const decoy = new Uint8Array(nPeptides)
  const owners: number[][] = Array.from({ length: nProteins }, () => [])
  const ownerOf: [number, number][] = new Array(nPeptides) // protein A and protein B (-1 = none)
  for (let k = 0; k < nPeptides; k++) {
    sequence[k] = run(6 + int(18)) + (rand() < 0.5 ? 'K' : 'R')
    decoy[k] = rand() < 0.05 ? 1 : 0
    const pick = () => (decoy[k] && nDecoyProteins > 0 ? nTargetProteins + int(nDecoyProteins) : int(nTargetProteins))
    const a = pick()
    let b = -1
    if (rand() < 0.1) {
      b = pick()
      if (b === a) b = -1
    }
    ownerOf[k] = [a, b]
    owners[a].push(k)
    if (b >= 0) owners[b].push(k)
  }

  // Proteins are their peptides in a row, with filler residues between and after them.
  const proteinSequence: string[] = new Array(nProteins)
  const startIn = new Map<number, number>() // peptide * nProteins + protein -> start
  for (let p = 0; p < nProteins; p++) {
    const parts: string[] = []
    let length = 0
    for (const k of owners[p]) {
      const filler = run(int(40))
      parts.push(filler, sequence[k])
      startIn.set(k * nProteins + p, length + filler.length)
      length += filler.length + sequence[k].length
    }
    parts.push(run(30 + int(200)))
    proteinSequence[p] = parts.join('')
  }

  // the peptide table
  const modOffsets = new Uint32Array(nPeptides + 1)
  const modPosition: number[] = []
  const modName: string[] = []
  const modUnimod: number[] = []
  const modMass: number[] = []
  const proforma: string[] = new Array(nPeptides)
  const openms: string[] = new Array(nPeptides)
  const proteinOffsets = new Uint32Array(nPeptides + 1)
  const refProtein: number[] = []
  const refStart: number[] = []
  const refEnd: number[] = []
  for (let k = 0; k < nPeptides; k++) {
    const seq = sequence[k]
    let pf = ''
    let om = ''
    let count = 0
    for (let i = 0; i < seq.length; i++) {
      pf += seq[i]
      om += seq[i]
      const mod =
        seq[i] === 'C'
          ? { name: 'Carbamidomethyl', unimod: 4, mass: 57.021464 }
          : seq[i] === 'M' && rand() < 0.15
            ? { name: 'Oxidation', unimod: 35, mass: 15.994915 }
            : null
      if (!mod) continue
      pf += `[${mod.name}]`
      om += `(${mod.name})`
      modPosition.push(i)
      modName.push(mod.name)
      modUnimod.push(mod.unimod)
      modMass.push(mod.mass)
      count++
    }
    proforma[k] = pf
    openms[k] = om
    modOffsets[k + 1] = modOffsets[k] + count
    const [a, b] = ownerOf[k]
    for (const p of b >= 0 ? [a, b] : [a]) {
      const start = startIn.get(k * nProteins + p)!
      refProtein.push(p)
      refStart.push(start)
      refEnd.push(start + seq.length)
    }
    proteinOffsets[k + 1] = refProtein.length
  }

  // the PSMs
  const file = new Uint16Array(nPsms)
  const nativeId: string[] = new Array(nPsms)
  const rt = new Float64Array(nPsms)
  const mz = new Float64Array(nPsms)
  const charge = new Int8Array(nPsms)
  const peptide = new Uint32Array(nPsms)
  const score = new Float64Array(nPsms)
  const qValue = new Float64Array(nPsms)
  const pep = new Float64Array(nPsms)
  const error = new Float64Array(nPsms)
  const isotope = new Int8Array(nPsms)
  const delta = new Float64Array(nPsms)
  const psmDecoy = new Uint8Array(nPsms)
  for (let i = 0; i < nPsms; i++) {
    const u = rand()
    const k = Math.min(nPeptides - 1, Math.floor(nPeptides * u * u))
    peptide[i] = k
    file[i] = int(nFiles)
    nativeId[i] = `controllerType=0 controllerNumber=1 scan=${i + 1}`
    rt[i] = 60 + 3540 * rand()
    charge[i] = 2 + int(3)
    mz[i] = 400 + 800 * rand()
    psmDecoy[i] = decoy[k]
    const q = psmDecoy[i] ? 0.02 + 0.3 * rand() : 0.1 * rand() ** 3
    qValue[i] = q
    pep[i] = Math.min(1, q * 3)
    score[i] = 60 - 300 * q + 8 * (rand() - 0.5)
    error[i] = 10 * (rand() + rand() - 1)
    isotope[i] = rand() < 0.03 ? 1 : 0
    delta[i] = (error[i] * mz[i] * charge[i]) / 1e6
  }

  // the proteins
  const accession: string[] = new Array(nProteins)
  const description: string[] = new Array(nProteins)
  const pScore = new Float64Array(nProteins)
  const pQ = new Float64Array(nProteins)
  const pDecoy = new Uint8Array(nProteins)
  const group = new Int32Array(nProteins)
  for (let p = 0; p < nProteins; p++) {
    const id = String(p).padStart(5, '0')
    pDecoy[p] = isDecoyProtein(p) ? 1 : 0
    accession[p] = pDecoy[p] ? `DECOY_sp|P${id}|PROT${p}_HUMAN` : isContaminant(p) ? `CON__P${id}` : `sp|P${id}|PROT${p}_HUMAN`
    description[p] = isContaminant(p) ? `Contaminant ${p}` : `Synthetic protein ${p}, family ${p % 97}`
    const q = pDecoy[p] ? 0.02 + 0.3 * rand() : 0.05 * rand() ** 3
    pQ[p] = q
    pScore[p] = 100 - 500 * q
    group[p] = p
  }

  const files = Array.from({ length: nFiles }, (_, i) => {
    const half = Math.ceil(nFiles / 2)
    return i < half ? `control_${i + 1}.mzML` : `EGF_${i - half + 1}.mzML`
  })

  return {
    files,
    psms: {
      count: nPsms,
      file,
      nativeId,
      rt,
      mz,
      charge,
      peptide,
      score,
      qValue,
      pep,
      precursorErrorPpm: error,
      isotopeError: isotope,
      deltaMass: delta,
      decoy: psmDecoy,
      featureNames: [],
      features: new Float64Array(0),
    },
    peptides: {
      count: nPeptides,
      openms,
      proforma,
      sequence,
      decoy,
      modOffsets,
      modPosition: Int16Array.from(modPosition),
      modName,
      modUnimod: Int32Array.from(modUnimod),
      modMass: Float64Array.from(modMass),
      proteinOffsets,
      protein: Uint32Array.from(refProtein),
      start: Uint32Array.from(refStart),
      end: Uint32Array.from(refEnd),
    },
    proteins: { count: nProteins, accession, description, sequence: proteinSequence, score: pScore, qValue: pQ, decoy: pDecoy, group },
  }
}

/**
 * The design of files named `<condition>_<replicate>.mzML` (as `makeLargeTables` names them); a file
 * of any other name has neither condition nor replicate.
 */
export function syntheticDesign(files: string[]): DesignResolution {
  const inputs: DesignInput[] = files.map((fileName, i) => {
    const match = /^(.+)_(\d+)\.mzML$/.exec(fileName)
    return {
      id: `synthetic-${i}`,
      fileName,
      fileSize: 1_000_000,
      ...(match ? { condition: match[1], replicate: Number(match[2]) } : {}),
    }
  })
  return resolveDesign(inputs)
}

/** The cutoffs of the debug results: every PSM counts (PSM FDR 100 %), proteins at 1 %. */
export const debugCutoffs = { psmFdr: 1, proteinFdr: 0.01 } as const

/**
 * A summary of the search that could have made `t`: per file its PSMs and about 2.2 MS2 spectra
 * per PSM, all rescored by Percolator, a closed search with protein FDR.
 */
export function syntheticSummary(t: ResultTables, cutoffs: { psmFdr: number; proteinFdr: number }): ProSEMultiSummary {
  const targets = new Uint32Array(t.files.length)
  const decoys = new Uint32Array(t.files.length)
  for (let i = 0; i < t.psms.count; i++) (t.psms.decoy[i] ? decoys : targets)[t.psms.file[i]]++
  return {
    files: t.files.map((path, f) => ({
      path,
      status: 'EXECUTION_OK',
      ms2Spectra: Math.round((targets[f] + decoys[f]) * 2.2) + 1,
      targetPSMs: targets[f],
      decoyPSMs: decoys[f],
      percolator: { applied: true, skipped: null, warning: null },
      peptdeepNce: null,
      secondsSearch: 10,
    })),
    proteinFdrApplied: true,
    psmFdr: cutoffs.psmFdr,
    proteinFdr: cutoffs.proteinFdr,
    decoyString: 'DECOY_',
    openSearch: false,
    modificationAnalysis: null,
  }
}

export type DebugResult = {
  tables: ResultTables
  design: DesignResolution
  summary: ProSEMultiSummary
  psmFdr: number
  proteinFdr: number
}

/**
 * The result that the debug hook shows (see `debug.ts`): `large` is 150,000 PSMs of a closed search
 * rescored by Percolator, at a PSM FDR of 100 % (every PSM counts); `large1` the same at 1 %; `small` 3,000 PSMs of an open search without Percolator and without
 * protein FDR (the protein q-values are NaN), in which every fifth PSM has a mass shift of
 * +15.9949 Da and every seventh one of -17.0265 Da.
 */
export function loadDebugResult(which: 'large' | 'large1' | 'small'): DebugResult {
  const tables = which === 'small' ? makeLargeTables(3000, 600, 120) : makeLargeTables(150000, 20000, 4000)
  const cutoffs = which === 'large1' ? { psmFdr: 0.01, proteinFdr: 0.01 } : debugCutoffs
  const summary = syntheticSummary(tables, cutoffs)
  if (which === 'small') {
    tables.proteins.qValue.fill(NaN)
    const delta = tables.psms.deltaMass
    for (let i = 0; i < delta.length; i++) delta[i] = i % 5 === 0 ? 15.994915 : i % 7 === 0 ? -17.026549 : 0.002 * ((i % 11) - 5)
    summary.proteinFdrApplied = false
    summary.openSearch = true
    for (const f of summary.files) f.percolator = null
  }
  return { tables, design: syntheticDesign(tables.files), summary, ...cutoffs }
}
