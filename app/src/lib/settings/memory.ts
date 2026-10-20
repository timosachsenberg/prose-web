// The memory estimate of the New search page. A search runs in one WebAssembly module: the 32-bit one
// (wasm32) addresses 4 GB, the 64-bit one (wasm64, Memory64; see engine/variant.ts) 16 GB; a search
// that needs more stops it. The engine searches the files one at a time (file by file): only the file
// being searched is in the module, in a block of the largest file's size.
//
// The formula and its constants are the calibration of both modules with OpenMS' allocator
// (openms-mimalloc; OpenMS PR #10659, wasm-logs/wasm64/packages/calibration.md): Chromium, file by
// file as the app searches, 1–12 files of 75 and 733 MB, Erwinia and human, 4 to 16 threads, with and
// without PeptDeep, tryptic, semi-tryptic and in chunks; non-specific (Erwinia, in chunks of 250–1000
// and unchunked) measured for the app afterwards. The estimate is at or above every measured peak (by
// 0.03–1.1 GB).
//
//   bytes = MODULE
//         + INDEX per 1,000 proteins × SPECIFICITY × MOD^max(0, variable modifications − 1)
//                                                       (not counting protein-terminal ones)
//         + 2 × the largest mzML + the FASTA            (the file being searched, and its spectra)
//         + growth(files, the mean mzML size)           (each further file; it levels off)
//         + THREAD × max(0, threads − 4)                (once, not per file)
//         + (PeptDeep ? PEPTDEEP : 0)                   (its models and sessions, whatever the files)
//
// A chunked search (database:chunk_size below the proteins) builds the index of one chunk at a time.
// A chunk costs about twice the unchunked index per protein (every chunk builds its index again, and
// the memory is not handed back between chunks), and at most what the unchunked index costs:
// INDEX × min(chunk size × CHUNKED, proteins × SPECIFICITY) × MOD^…. With OpenMS' allocator such a
// search no longer scatters (Emscripten's took 1.9–3.8 GB for the same search), and more files add
// nothing to it, so the formula holds for it too.

import { MAX_FILE_BYTES, MAX_FILE_BYTES_64, type EngineVariant } from '../engine/protocol'
import { GB, MB } from '../format/bytes'

export { GB }

export type Specificity = 'full' | 'semi' | 'none'

/** The constants of the formula, of one module. */
export interface ModuleConstants {
  /** What the module can address. */
  limit: number
  /** Above this the footer warns: close to the limit. */
  warn: number
  /** The module itself: code, static data, the first heap. */
  module: number
  /** The fragment index per 1,000 proteins of a tryptic search with one variable modification. */
  index: number
  /** The unchunked index relative to a tryptic one. */
  specificity: Record<Specificity, number>
  /** The index per protein of a chunk, relative to INDEX (semi and none measured; full: twice). */
  chunked: Record<Specificity, number>
  /** Each further variable modification (ProSE's single-residue entries) multiplies the index by this. */
  mod: number
  /** The heap growth of a further file of 75 MiB or less, and of 733 MiB or more (linear between). */
  growthSmall: number
  growthLarge: number
  /** Each thread above 4, once. */
  thread: number
  /** PeptDeep's models and sessions. */
  peptdeep: number
  /** The largest file the module's file system holds. */
  maxFile: number
}

export const MODULES: Record<EngineVariant, ModuleConstants> = {
  wasm32: {
    limit: 4 * GB,
    warn: 3 * GB,
    module: 0.2 * GB,
    index: 0.03 * GB, // fit: 28.4 MB
    // none: not measurable unchunked (Erwinia aborts); above both proportions of wasm64's 125 (310 × 180,
    // 125 × 10 / 15)
    specificity: { full: 1, semi: 10, none: 85 },
    // none: Erwinia in chunks of 250 and 500, 4 and 16 threads (147–171 needed)
    chunked: { full: 2, semi: 20, none: 180 },
    mod: 2,
    growthSmall: 0.05 * GB,
    growthLarge: 0.15 * GB,
    thread: 0.025 * GB,
    peptdeep: 0.35 * GB,
    maxFile: MAX_FILE_BYTES,
  },
  wasm64: {
    limit: 16 * GB,
    warn: 14 * GB,
    module: 0.4 * GB,
    index: 0.025 * GB, // fit: 21.9 MB
    // none: Erwinia unchunked, 16 threads (122 needed)
    specificity: { full: 1, semi: 15, none: 125 },
    // none: Erwinia in chunks of 250, 500 and 1000, 4 and 16 threads (290–307 needed)
    chunked: { full: 32 / 15, semi: 32, none: 310 },
    mod: 2,
    growthSmall: 0.06 * GB,
    growthLarge: 0.15 * GB,
    thread: 0.035 * GB,
    peptdeep: 0.25 * GB,
    maxFile: MAX_FILE_BYTES_64,
  },
}

/**
 * The variable modifications that enlarge the index (MOD per further one): ProSE's single-residue and
 * peptide-terminal entries, not those at a protein terminus, which only the first or last peptide of a
 * protein carries. Measured in the app (human semi-tryptic, not chunked, wasm64, 16 threads): Oxidation
 * (M) alone 8.66 GiB, with Acetyl (Protein N-term), the default preset's second entry, 8.56 GiB.
 */
export function indexModifications(names: readonly string[]): number {
  return names.filter((name) => !/\(Protein [NC]-term\)$/.test(name)).length
}

/** The file sizes between which the growth per file goes from `growthSmall` to `growthLarge`. */
const SMALL_FILE = 75 * MB
const LARGE_FILE = 733 * MB

/** The heap growth of a further file of `fileBytes` (growthSmall to growthLarge). */
export function growthPerFile(fileBytes: number, c: ModuleConstants = MODULES.wasm32): number {
  const at = Math.min(1, Math.max(0, (fileBytes - SMALL_FILE) / (LARGE_FILE - SMALL_FILE)))
  return c.growthSmall + (c.growthLarge - c.growthSmall) * at
}

/**
 * The heap growth of `files` files of a mean size of `meanBytes`: the 2nd to 5th file add the growth
 * per file each, every further one a quarter of it (the growth levels off: 12 files of 75 MB took no
 * more than 6).
 */
export function growthOf(files: number, meanBytes: number, c: ModuleConstants = MODULES.wasm32): number {
  const g = growthPerFile(meanBytes, c)
  return g * Math.min(Math.max(0, files - 1), 4) + (g / 4) * Math.max(0, files - 5)
}

export type MemoryInput = {
  /** The module (default wasm32). */
  variant?: EngineVariant
  /** The largest mzML file: the file being searched is in a block of its size, and its spectra are read. */
  largestMzmlBytes: number
  /** How many mzML files (default 1). */
  files?: number
  /** All mzML files together (default: the largest × files): their mean size sets the growth per file. */
  mzmlBytes?: number
  /** The FASTA file, in the module for the whole search (default 0). */
  databaseBytes?: number
  /** The threads of the search (default 4; see `threadsForSearch`). */
  threads?: number
  /** Target proteins of the database (contaminants included, decoys not). */
  proteins: number
  specificity: Specificity
  /** The variable modifications that enlarge the index (`indexModifications`). */
  variableMods: number
  peptdeep: boolean
  /** `database:chunk_size`: the index is built for at most this many proteins at a time; 0 = not chunked. */
  chunkSize?: number
}

export type MemoryLevel = 'ok' | 'warn' | 'over'

export type MemoryEstimate = {
  /** The module it is for. */
  variant: EngineVariant
  bytes: number
  /** ok; warn: above `warn` (close to the limit); over: above the limit, or a file too large. */
  level: MemoryLevel
  /** The fragment index of the database. */
  database: number
  /** The input files: the one being searched (with its spectra), the FASTA, and `growth`. */
  inputs: number
  /** The heap growth of the files after the first. */
  growth: number
  /** What dominates, and so what to change: the database (`database:chunk_size`) or the files (fewer at once). */
  cause: 'database' | 'inputs'
  /** A file is too large for the module's file system: the engine refuses the search. */
  fileTooLarge: boolean
}

/** The memory a search needs in the module `i.variant` (default wasm32); see the formula above. */
export function estimateMemory(i: MemoryInput): MemoryEstimate {
  const variant = i.variant ?? 'wasm32'
  const c = MODULES[variant]
  const files = Math.max(1, i.files ?? 1)
  const threads = Math.max(1, i.threads ?? 4)
  const mzmlBytes = i.mzmlBytes ?? i.largestMzmlBytes * files
  const databaseBytes = i.databaseBytes ?? 0
  const perProtein = (c.index / 1000) * c.mod ** Math.max(0, i.variableMods - 1)
  const whole = perProtein * i.proteins * c.specificity[i.specificity]
  const chunk = i.chunkSize ?? 0
  const database = chunk > 0 && chunk < i.proteins ? Math.min(perProtein * chunk * c.chunked[i.specificity], whole) : whole
  const growth = growthOf(files, mzmlBytes / files, c)
  const inputs = 2 * i.largestMzmlBytes + databaseBytes + growth
  const bytes = c.module + database + inputs + c.thread * Math.max(0, threads - 4) + (i.peptdeep ? c.peptdeep : 0)
  const fileTooLarge = i.largestMzmlBytes > c.maxFile || databaseBytes > c.maxFile
  const level: MemoryLevel = bytes > c.limit || fileTooLarge ? 'over' : bytes > c.warn ? 'warn' : 'ok'
  const cause = fileTooLarge || inputs > database ? 'inputs' : 'database'
  return { variant, bytes, level, database, inputs, growth, cause, fileTooLarge }
}

/** Memory for people, in the module's gigabytes: "2.6 GB", "0.8 GB". */
export function formatMemory(bytes: number): string {
  return `${(bytes / GB).toFixed(1)} GB`
}
