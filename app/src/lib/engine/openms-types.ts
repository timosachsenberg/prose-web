// The data shapes of the part B contract (WebAssembly bindings), declared here until the
// generated `openms.d.ts` of the engine package replaces this file. Only the data shapes: the
// `ProSEResultSet` class, `ProSEAlgorithm.searchFiles` and the `annotatePeaks`/`predictMS2` methods
// are not declared.

export interface ProSEFilesOptions {
  /** default true */
  rescore?: boolean
  /** default true */
  keepSpectra?: boolean
  /** default false = keep decoys */
  removeDecoys?: boolean
}

/** The aggregate modification analysis of a search (`ProSESummary["modificationAnalysis"]`, #10575). */
export type ModificationAnalysis = unknown

export interface ProSEFileSummary {
  path: string
  status: string
  ms2Spectra: number
  targetPSMs: number
  decoyPSMs: number
  percolator: { applied: boolean; skipped: string | null; seconds: number } | null
  peptdeepNce: number | null
  secondsSearch: number
}

export interface ProSEMultiSummary {
  files: ProSEFileSummary[]
  proteinFdrApplied: boolean
  psmFdr: number
  proteinFdr: number
  decoyString: string
  openSearch: boolean
  /** the aggregate, same shape as today */
  modificationAnalysis: ModificationAnalysis
}

export interface ResultTables {
  files: string[]
  psms: {
    count: number
    file: Uint16Array
    nativeId: string[]
    rt: Float64Array
    mz: Float64Array
    charge: Int8Array
    peptide: Uint32Array
    score: Float64Array
    qValue: Float64Array
    pep: Float64Array
    precursorErrorPpm: Float64Array
    isotopeError: Int8Array
    deltaMass: Float64Array
    decoy: Uint8Array
    featureNames: string[]
    features: Float64Array
  }
  peptides: {
    count: number
    /** OpenMS AASequence strings, e.g. `AVM(Oxidation)DDFAAFVEK`, `.(Acetyl)DAHKSEVAHR` */
    openms: string[]
    /** ProForma strings, e.g. `AVM[Oxidation]DDFAAFVEK`, `[Acetyl]-DAHKSEVAHR` */
    proforma: string[]
    /** plain residues */
    sequence: string[]
    decoy: Uint8Array
    /** the modifications of peptide k are `modOffsets[k] .. modOffsets[k + 1]` of the mod* arrays */
    modOffsets: Uint32Array
    /** -1 = N-terminus, `sequence.length` = C-terminus, else the 0-based residue index */
    modPosition: Int16Array
    /** Unimod/OpenMS name, e.g. "Oxidation", "Acetyl", "Carbamidomethyl" */
    modName: string[]
    modUnimod: Int32Array
    /** delta mass */
    modMass: Float64Array
    proteinOffsets: Uint32Array
    protein: Uint32Array
    start: Uint32Array
    end: Uint32Array
  }
  proteins: {
    count: number
    accession: string[]
    description: string[]
    sequence: string[]
    score: Float64Array
    qValue: Float64Array
    decoy: Uint8Array
    group: Int32Array
  }
}

export interface StoredSpectra {
  /** per PSM row: spectrum index or -1 */
  psmSpectrum: Int32Array
  /** n + 1 */
  offsets: Uint32Array
  mz: Float32Array
  intensity: Float32Array
  precursorMz: Float64Array
  /** NaN unknown */
  collisionEnergy: Float32Array
}

export interface PeakMatch {
  peak: number
  /** "b3", "y5++", "y7-H2O" */
  ion: string
  type: string
  ordinal: number
  charge: number
  loss: string
  theoreticalMz: number
  errorPpm: number
}

export interface PeakAnnotationResult {
  matches: PeakMatch[]
  theoretical: { ion: string; type: string; ordinal: number; charge: number; mz: number }[]
}

export interface PredictedIon {
  ion: string
  type: 'b' | 'y'
  ordinal: number
  charge: 1 | 2
  mz: number
  intensity: number
}
