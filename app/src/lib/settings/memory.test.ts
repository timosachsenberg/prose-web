import { describe, expect, it } from 'vitest'
import { MAX_FILE_BYTES, MAX_FILE_BYTES_64 } from '../engine/protocol'
import { chooseEngine } from '../engine/variant'
import { estimateMemory, GB, growthOf, growthPerFile, indexModifications, MODULES, type MemoryInput } from './memory'

const MiB = 2 ** 20

// The calibration of both modules (OpenMS PR #10659; wasm-logs/wasm64/packages/calibration.md): Chromium
// 141, a Web Worker on an isolated page, searchFiles file by file as the app runs it (provideFile,
// 16 MiB pieces), rescore on, keepSpectra on, a fresh module per search; the TMT settings of
// prose-bench/bench.sh (one variable modification, Oxidation (M); "3 mods" = Oxidation (M), Deamidated
// (N), Deamidated (Q)). The chunks of 5000 and 6000 ran in Node 24 with the same module.
const SPECTRA = { erwinia: 78149584, big: 768833771 } // erwinia_tmt.mzML (6,103 MS2), big733.mzML (48,824)
// residues: the letters of their sequences (human's proteins are 1.7 times as long: 555 against 324)
const DATABASES = {
  erwinia: { proteins: 4499, residues: 1455924, bytes: 1648617 },
  human: { proteins: 20652, residues: 11456418, bytes: 13735313 },
}

type Search = {
  name: string
  db: keyof typeof DATABASES
  spectra?: keyof typeof SPECTRA
  files?: number
  semi?: boolean
  /** Non-specific (`peptide:enzyme_specificity` none). */
  none?: boolean
  mods?: number
  peptdeep?: boolean
  chunk?: number
}

// fix round 2: the human proteome, non-specific (measured as above, 16 threads)
const HUMAN_NONE_C250 = { name: 'human, non-specific, chunks of 250', db: 'human', none: true, chunk: 250, wasm32: { 4: 2937, 16: 2989 }, wasm64: { 16: 4144 } } as const
const HUMAN_NONE_C500 = { name: 'human, non-specific, chunks of 500', db: 'human', none: true, chunk: 500, wasm64: { 4: 6911, 16: 7493 } } as const
const HUMAN_NONE_C1000 = { name: 'human, non-specific, chunks of 1000', db: 'human', none: true, chunk: 1000, wasm64: { 16: 13490 } } as const

/** The searches of the calibration: the measured peak heaps in MiB (the largest of the runs), by module and threads; `failed`: wasm32 ran out of memory or aborted. */
const CALIBRATION: (Search & { wasm32?: Record<number, number | 'failed'>; wasm64?: Record<number, number> })[] = [
  { name: 'Erwinia, tryptic', db: 'erwinia', wasm32: { 4: 467.8, 16: 678.1 }, wasm64: { 4: 634.3, 16: 1040.5 } },
  { name: 'Erwinia, 3 files', db: 'erwinia', files: 3, wasm32: { 4: 570.1, 16: 890.2 }, wasm64: { 4: 761.1, 16: 1152.6 } },
  { name: 'Erwinia, 6 files', db: 'erwinia', files: 6, wasm32: { 4: 684.2, 16: 815.1 }, wasm64: { 4: 761.1, 16: 1144.6 } },
  { name: 'Erwinia, 12 files', db: 'erwinia', files: 12, wasm32: { 4: 679.4, 8: 673.6, 16: 820.8 }, wasm64: { 4: 796.1 } },
  { name: 'human, tryptic', db: 'human', wasm32: { 4: 937.8, 16: 937.8 }, wasm64: { 4: 999.3, 16: 1457.1 } },
  { name: 'Erwinia, 3 variable modifications', db: 'erwinia', mods: 3, wasm32: { 4: 838.4 }, wasm64: { 4: 927.7 } },
  { name: 'human, 3 variable modifications', db: 'human', mods: 3, wasm32: { 4: 1770.6 }, wasm64: { 4: 1984.3 } },
  { name: 'big (733 MB), 1 file', db: 'erwinia', spectra: 'big', wasm32: { 4: 1671.8 }, wasm64: { 4: 1814.9 } },
  { name: 'big, 2 files', db: 'erwinia', spectra: 'big', files: 2, wasm32: { 4: 1856.1 }, wasm64: { 4: 1991.3 } },
  { name: 'big, 4 files', db: 'erwinia', spectra: 'big', files: 4, wasm32: { 4: 2064.3 }, wasm64: { 4: 2303.6 } },
  { name: 'big, 12 files', db: 'erwinia', spectra: 'big', files: 12, wasm32: { 4: 2480.5 } },
  { name: 'PeptDeep, 1 file', db: 'erwinia', peptdeep: true, wasm32: { 4: 521.6 }, wasm64: { 4: 777.8, 16: 1267.2 } },
  { name: 'PeptDeep, 3 files', db: 'erwinia', peptdeep: true, files: 3, wasm32: { 4: 840.4 }, wasm64: { 4: 889.9 } },
  { name: 'PeptDeep, 12 files', db: 'erwinia', peptdeep: true, files: 12, wasm32: { 4: 860.4, 8: 868.4, 16: 1152.6 }, wasm64: { 4: 984.3 } },
  { name: 'Erwinia, semi-tryptic', db: 'erwinia', semi: true, wasm32: { 4: 1562.8 }, wasm64: { 4: 1796.4 } },
  { name: 'human, semi, chunks of 2000', db: 'human', semi: true, chunk: 2000, wasm32: { 4: 1534.7, 16: 1690.8 }, wasm64: { 4: 2184.4, 16: 1840.9 } },
  { name: 'human, semi, chunks of 2000, 3 files', db: 'human', semi: true, chunk: 2000, files: 3, wasm32: { 4: 1366.8 }, wasm64: { 4: 2176.3 } },
  { name: 'human, semi, chunks of 4000', db: 'human', semi: true, chunk: 4000, wasm32: { 4: 2262.8 }, wasm64: { 4: 3608.6 } },
  { name: 'human, semi, chunks of 5000 (Node)', db: 'human', semi: true, chunk: 5000, wasm32: { 4: 2659.0 } },
  { name: 'human, semi, chunks of 6000 (Node)', db: 'human', semi: true, chunk: 6000, wasm32: { 4: 3107.0 } },
  { name: 'human, semi, chunks of 7000 (Node)', db: 'human', semi: true, chunk: 7000, wasm32: { 4: 'failed' } },
  { name: 'human, semi, chunks of 8000', db: 'human', semi: true, chunk: 8000, wasm32: { 4: 'failed' }, wasm64: { 4: 6584.9, 16: 7251.0 } },
  { name: 'human, semi-tryptic, not chunked', db: 'human', semi: true, wasm32: { 4: 'failed' }, wasm64: { 4: 8081.2, 16: 8861.0 } },
  // measured for the app (W64 fix round 1, the same runner and settings): non-specific in chunks
  { name: 'Erwinia, non-specific, chunks of 250', db: 'erwinia', none: true, chunk: 250, wasm32: { 16: 1977 }, wasm64: { 16: 2847 } },
  { name: 'Erwinia, non-specific, chunks of 500', db: 'erwinia', none: true, chunk: 500, wasm32: { 4: 2937, 16: 2922 }, wasm64: { 4: 4495, 16: 4848 } },
  { name: 'Erwinia, non-specific, chunks of 1000', db: 'erwinia', none: true, chunk: 1000, wasm32: { 16: 'failed' }, wasm64: { 4: 8343, 16: 8849 } },
  { name: 'Erwinia, non-specific, not chunked', db: 'erwinia', none: true, wasm32: { 16: 'failed' }, wasm64: { 16: 15017 } },
  // fix round 2: the human proteome, non-specific (its index follows the residues, not the proteins)
  HUMAN_NONE_C250,
  { name: 'human, non-specific, chunks of 400', db: 'human', none: true, chunk: 400, wasm32: { 16: 'failed' } },
  HUMAN_NONE_C500,
  HUMAN_NONE_C1000,
]

/**
 * Where the threads decide: human non-specific in chunks of 250 switches at 16 threads (3.22 GB in
 * wasm32), not at 4 (2.92 GB; it took 2.92 and 2.87 GiB in wasm32).
 */
const SWITCH_AT_16_ONLY = ['human, non-specific, chunks of 250']

/** The searches the calibration says switch to wasm64 (estimate in wasm32 above 3 GB). */
const SWITCH = [
  'Erwinia, non-specific, chunks of 500',
  'Erwinia, non-specific, chunks of 1000',
  'Erwinia, non-specific, not chunked',
  'human, non-specific, chunks of 250',
  'human, non-specific, chunks of 400',
  'human, non-specific, chunks of 500',
  'human, non-specific, chunks of 1000',
  'human, semi, chunks of 5000 (Node)',
  'human, semi, chunks of 6000 (Node)',
  'human, semi, chunks of 7000 (Node)',
  'human, semi, chunks of 8000',
  'human, semi-tryptic, not chunked',
]

function input(s: Search, threads: number, variant: 'wasm32' | 'wasm64'): MemoryInput {
  const files = s.files ?? 1
  const size = SPECTRA[s.spectra ?? 'erwinia']
  const db = DATABASES[s.db]
  return {
    variant,
    largestMzmlBytes: size,
    files,
    mzmlBytes: files * size,
    databaseBytes: db.bytes,
    threads,
    proteins: db.proteins,
    residues: db.residues,
    specificity: s.none ? 'none' : s.semi ? 'semi' : 'full',
    variableMods: s.mods ?? 1,
    peptdeep: s.peptdeep ?? false,
    chunkSize: s.chunk ?? 0,
  }
}

describe('estimateMemory: the calibration', () => {
  it('is at or above every measured peak, in both modules', () => {
    let checked = 0
    for (const s of CALIBRATION) {
      for (const variant of ['wasm32', 'wasm64'] as const) {
        for (const [threads, heap] of Object.entries(s[variant] ?? {})) {
          if (heap === 'failed') continue
          const estimate = estimateMemory(input(s, Number(threads), variant))
          expect(estimate.bytes / MiB, `${s.name}, ${variant}, ${threads} threads`).toBeGreaterThanOrEqual(heap)
          // and not far above (at most 1.5 GB: human non-specific in chunks of 1000 in wasm64, whose
          // per-residue constant also covers Erwinia's; human with 3 modifications in wasm32, 1.1 GB)
          expect(estimate.bytes - heap * MiB, `${s.name}, ${variant}, ${threads} threads`).toBeLessThan(1.5 * GB)
          checked++
        }
      }
    }
    expect(checked).toBe(71)
  })

  it('is above 4 GB for every wasm32 search that failed', () => {
    let failed = 0
    for (const s of CALIBRATION) {
      for (const [threads, heap] of Object.entries(s.wasm32 ?? {})) {
        if (heap !== 'failed') continue
        const estimate = estimateMemory(input(s, Number(threads), 'wasm32'))
        expect(estimate.bytes, s.name).toBeGreaterThan(4 * GB)
        expect(estimate.level, s.name).toBe('over')
        failed++
      }
    }
    expect(failed).toBe(6)
  })

  it('crosses 3 GB in wasm32 exactly for the searches that switch to wasm64', () => {
    for (const s of CALIBRATION) {
      for (const threads of Object.keys(s.wasm32 ?? {}).map(Number)) {
        const estimate32 = estimateMemory(input(s, threads, 'wasm32'))
        const switches = SWITCH.includes(s.name) && (threads === 16 || !SWITCH_AT_16_ONLY.includes(s.name))
        expect(estimate32.bytes > 3 * GB, `${s.name}, ${threads} threads: ${(estimate32.bytes / GB).toFixed(2)} GB`).toBe(switches)
        expect(chooseEngine({ estimate32: estimate32.bytes, memory64: true }), s.name).toBe(switches ? 'wasm64' : 'wasm32')
      }
    }
    // the largest of those that stay: 12 × 733 MB and human with 3 variable modifications
    const stays = (name: string) => estimateMemory(input(CALIBRATION.find((s) => s.name === name)!, 4, 'wasm32')).bytes / GB
    expect(stays('big, 12 files')).toBeCloseTo(2.63, 2)
    expect(stays('human, 3 variable modifications')).toBeCloseTo(2.84, 2)
    expect(stays('human, semi, chunks of 5000 (Node)')).toBeCloseTo(3.36, 2)
    expect(stays('human, semi-tryptic, not chunked')).toBeCloseTo(6.55, 2)
  })

  it('counts no protein-terminal modification (measured in the app: Acetyl (Protein N-term) added nothing)', () => {
    // human semi-tryptic, not chunked, TMT settings, 16 threads, from New search in Chromium (W64):
    // Oxidation (M) alone 8.66 GiB, with Acetyl (Protein N-term) 8.56 GiB
    expect(indexModifications(['Oxidation (M)', 'Acetyl (Protein N-term)'])).toBe(1)
    expect(indexModifications(['Oxidation (M)', 'Amidated (Protein C-term)'])).toBe(1)
    // peptide-terminal and residue modifications count
    expect(indexModifications(['Oxidation (M)', 'Acetyl (N-term)', 'Deamidated (N)', 'Deamidated (Q)'])).toBe(4)
    expect(indexModifications([])).toBe(0)
    const app = { ...input(CALIBRATION.find((s) => s.name === 'human, semi-tryptic, not chunked')!, 16, 'wasm64'), proteins: 20652 + 116 }
    const mods = indexModifications(['Oxidation (M)', 'Acetyl (Protein N-term)'])
    const estimate = estimateMemory({ ...app, variableMods: mods })
    expect(estimate.bytes / MiB).toBeGreaterThanOrEqual(8.66 * 1024)
    expect(estimate.level).toBe('ok')
  })

  it('in wasm64, the searches that switch fit below 16 GB', () => {
    for (const name of SWITCH) {
      const estimate = estimateMemory(input(CALIBRATION.find((s) => s.name === name)!, 16, 'wasm64'))
      expect(estimate.level, name).not.toBe('over')
    }
  })
})

describe('estimateMemory: the formula', () => {
  const erwinia = { largestMzmlBytes: 75 * MiB, proteins: 4499, specificity: 'full', variableMods: 1, peptdeep: false } as const
  const human = { ...erwinia, proteins: 20652 }

  it('has the constants of both modules', () => {
    expect(MODULES.wasm32).toMatchObject({ limit: 4 * GB, warn: 3 * GB, module: 0.2 * GB, index: 0.03 * GB, mod: 2, thread: 0.025 * GB, peptdeep: 0.35 * GB, maxFile: MAX_FILE_BYTES })
    expect(MODULES.wasm32.specificity).toEqual({ full: 1, semi: 10 })
    expect(MODULES.wasm32.chunked).toEqual({ full: 2, semi: 20 })
    expect(MODULES.wasm32.none).toEqual({ residues: 7.5, chunkResidues: 18.5 })
    expect(MODULES.wasm64).toMatchObject({ limit: 16 * GB, warn: 14 * GB, module: 0.4 * GB, index: 0.025 * GB, mod: 2, thread: 0.035 * GB, peptdeep: 0.25 * GB, maxFile: MAX_FILE_BYTES_64 })
    expect(MODULES.wasm64.specificity).toEqual({ full: 1, semi: 15 })
    expect(MODULES.wasm64.chunked.semi).toBe(32)
    expect(MODULES.wasm64.none).toEqual({ residues: 9.6, chunkResidues: 24.5 })
    // wasm32 is the default
    expect(estimateMemory(human)).toEqual(estimateMemory({ ...human, variant: 'wasm32' }))
    expect(estimateMemory(human).variant).toBe('wasm32')
  })

  it('defaults to one file at 4 threads', () => {
    expect(estimateMemory(human)).toEqual(estimateMemory({ ...human, files: 1, threads: 4, mzmlBytes: human.largestMzmlBytes }))
    expect(estimateMemory(human).growth).toBe(0)
  })

  it('sums the module, the index, the file and its spectra, the threads above 4 and PeptDeep', () => {
    const one = estimateMemory({ ...human, databaseBytes: 13 * MiB })
    expect(one.database).toBeCloseTo(0.03 * GB * 20.652, -3)
    expect(one.inputs).toBeCloseTo(2 * 75 * MiB + 13 * MiB, -3)
    expect(one.bytes).toBeCloseTo(0.2 * GB + one.database + one.inputs, -3)
    // the threads above 4, once
    expect(estimateMemory({ ...human, threads: 16 }).bytes - estimateMemory(human).bytes).toBeCloseTo(12 * 0.025 * GB, -3)
    expect(estimateMemory({ ...human, threads: 2 }).bytes).toBe(estimateMemory(human).bytes)
    expect(estimateMemory({ ...human, variant: 'wasm64', threads: 16 }).bytes - estimateMemory({ ...human, variant: 'wasm64' }).bytes).toBeCloseTo(
      12 * 0.035 * GB,
      -3,
    )
    // PeptDeep: its models and sessions, whatever the files and threads
    expect(estimateMemory({ ...human, peptdeep: true }).bytes - estimateMemory(human).bytes).toBeCloseTo(0.35 * GB, -3)
    expect(
      estimateMemory({ ...human, peptdeep: true, files: 12, threads: 16 }).bytes - estimateMemory({ ...human, files: 12, threads: 16 }).bytes,
    ).toBeCloseTo(0.35 * GB, -3)
    expect(estimateMemory({ ...human, variant: 'wasm64', peptdeep: true }).bytes - estimateMemory({ ...human, variant: 'wasm64' }).bytes).toBeCloseTo(
      0.25 * GB,
      -3,
    )
  })

  it('doubles the index per further variable modification', () => {
    const three = estimateMemory({ ...human, variableMods: 3 })
    const one = estimateMemory(human)
    expect(three.database / one.database).toBeCloseTo(4)
    // no variable modification costs as much as one
    expect(estimateMemory({ ...human, variableMods: 0 }).bytes).toBe(one.bytes)
  })

  it('scales the index by the specificity', () => {
    const full = estimateMemory(erwinia).database
    expect(estimateMemory({ ...erwinia, specificity: 'semi' }).database / full).toBeCloseTo(10)
    expect(estimateMemory({ ...erwinia, specificity: 'semi' }).database).toBeGreaterThan(full)
    const full64 = estimateMemory({ ...erwinia, variant: 'wasm64' }).database
    expect(estimateMemory({ ...erwinia, variant: 'wasm64', specificity: 'semi' }).database / full64).toBeCloseTo(15)
  })

  it('grows a non-specific index with the residues, not the proteins', () => {
    const MB_RESIDUES = 1e6
    // 7.5 GB (wasm32) and 9.6 GB (wasm64) per million residues
    expect(estimateMemory({ ...erwinia, specificity: 'none', residues: MB_RESIDUES }).database).toBeCloseTo(7.5 * GB, -3)
    expect(estimateMemory({ ...erwinia, variant: 'wasm64', specificity: 'none', residues: MB_RESIDUES }).database).toBeCloseTo(9.6 * GB, -3)
    // the same proteins, twice as long: twice the index
    const short = estimateMemory({ ...erwinia, specificity: 'none', residues: 4499 * 300 }).database
    expect(estimateMemory({ ...erwinia, specificity: 'none', residues: 4499 * 600 }).database / short).toBeCloseTo(2)
    // residues not known: 555 per protein (human's, the longer of the two databases)
    expect(estimateMemory({ ...erwinia, specificity: 'none' }).database).toBeCloseTo(estimateMemory({ ...erwinia, specificity: 'none', residues: 4499 * 555 }).database)
    // a chunk: its proteins × the residues per protein, 18.5 (wasm32) and 24.5 (wasm64) GB per million
    const human = { ...erwinia, proteins: 20652, residues: 11456418, specificity: 'none', chunkSize: 500 } as const
    expect(estimateMemory(human).database).toBeCloseTo(((18.5 * GB) / 1e6) * 500 * (11456418 / 20652), -3)
    expect(estimateMemory({ ...human, variant: 'wasm64' }).database).toBeCloseTo(((24.5 * GB) / 1e6) * 500 * (11456418 / 20652), -3)
    // at most the unchunked index
    expect(estimateMemory({ ...human, chunkSize: 20000 }).database).toBeCloseTo(((7.5 * GB) / 1e6) * 11456418, -3)
  })

  it('builds a chunked index one chunk at a time, at twice the cost per protein, at most the unchunked index', () => {
    const semi = { ...human, specificity: 'semi' } as const
    const whole = estimateMemory(semi).database
    const c2000 = estimateMemory({ ...semi, chunkSize: 2000 }).database
    expect(c2000).toBeCloseTo((0.03 * GB * 2000 * 20) / 1000, -3)
    // a chunk close to the protein count gains nothing: at most the unchunked index
    expect(estimateMemory({ ...semi, chunkSize: 15000 }).database).toBe(whole)
    // a chunk larger than the database changes nothing
    expect(estimateMemory({ ...semi, chunkSize: 50000 })).toEqual(estimateMemory(semi))
    // in wasm64: 32 per protein of a chunk
    expect(estimateMemory({ ...semi, variant: 'wasm64', chunkSize: 2000 }).database).toBeCloseTo((0.025 * GB * 2000 * 32) / 1000, -3)
    // tryptic and non-specific likewise
    expect(estimateMemory({ ...human, chunkSize: 2000 }).database).toBeCloseTo((0.03 * GB * 2000 * 2) / 1000, -3)
    expect(estimateMemory({ ...human, specificity: 'none', residues: 20652 * 555, chunkSize: 200 }).database).toBeCloseTo(((18.5 * GB) / 1e6) * 200 * 555, -3)
  })

  it('grows with each further file: the 2nd to 5th by a quarter as much from the 6th on, more for larger files', () => {
    // 0.05 GB per file up to 75 MiB, 0.15 GB from 733 MiB on, linear between (wasm32)
    expect(growthPerFile(10 * MiB)).toBeCloseTo(0.05 * GB, -3)
    expect(growthPerFile(75 * MiB)).toBeCloseTo(0.05 * GB, -3)
    expect(growthPerFile(404 * MiB)).toBeCloseTo(0.1 * GB, -3)
    expect(growthPerFile(733 * MiB)).toBeCloseTo(0.15 * GB, -3)
    expect(growthPerFile(1.5 * GB)).toBeCloseTo(0.15 * GB, -3)
    expect(growthPerFile(75 * MiB, MODULES.wasm64)).toBeCloseTo(0.06 * GB, -3)
    const g = growthPerFile(75 * MiB)
    expect(growthOf(1, 75 * MiB)).toBe(0)
    expect(growthOf(5, 75 * MiB)).toBeCloseTo(4 * g)
    expect(growthOf(6, 75 * MiB)).toBeCloseTo(4 * g + g / 4)
    expect(growthOf(12, 75 * MiB)).toBeCloseTo(4 * g + (7 * g) / 4)
    // the mean size counts: one large file among small ones grows the heap as small ones do
    const mixed = estimateMemory({ ...erwinia, largestMzmlBytes: 733 * MiB, files: 4, mzmlBytes: 733 * MiB + 3 * 75 * MiB })
    expect(mixed.growth).toBeCloseTo(3 * growthPerFile((733 * MiB + 3 * 75 * MiB) / 4), -3)
    // the threads do not change the growth per file (the thread term is once)
    expect(estimateMemory({ ...erwinia, files: 12, threads: 16 }).growth).toBe(estimateMemory({ ...erwinia, files: 12 }).growth)
  })

  it('holds one file at a time: the inputs do not add up', () => {
    const files = { ...human, largestMzmlBytes: 300 * MiB, databaseBytes: 25 * MiB }
    const one = estimateMemory(files)
    const six = estimateMemory({ ...files, files: 6, mzmlBytes: 6 * 300 * MiB })
    expect(one.inputs).toBeCloseTo(2 * 300 * MiB + 25 * MiB, -3)
    expect(six.inputs - one.inputs).toBeCloseTo(six.growth, -3)
    expect(six.growth).toBeLessThan(5 * 300 * MiB)
  })

  it('wasm32: warns above 3 GB, is over above 4 GB', () => {
    // 0.2 + 0.03 × 40 × 2 = 2.6 GB of index (two variable modifications) + 2 × 75 MiB
    expect(estimateMemory({ ...human, proteins: 40000, variableMods: 2 }).level).toBe('ok')
    expect(estimateMemory({ ...human, proteins: 40000, variableMods: 2, peptdeep: true }).level).toBe('warn')
    expect(estimateMemory({ ...human, proteins: 70000, variableMods: 2 }).level).toBe('over')
    expect(estimateMemory({ ...human, specificity: 'semi' })).toMatchObject({ level: 'over', cause: 'database' })
  })

  it('wasm64: warns above 14 GB, is over above 16 GB', () => {
    const semi = { ...human, specificity: 'semi', variant: 'wasm64' } as const
    // 0.4 + 0.025 × proteins / 1000 × 15 × 2^(mods − 1) + 2 × 75 MiB
    expect(estimateMemory(semi).level).toBe('ok')
    expect(estimateMemory(semi).bytes / GB).toBeCloseTo(8.29, 2)
    expect(estimateMemory({ ...semi, proteins: 38000 })).toMatchObject({ level: 'warn', cause: 'database' })
    // two variable modifications that enlarge the index (e.g. Oxidation (M), Deamidated (N)) double it
    expect(estimateMemory({ ...semi, variableMods: 2 }).bytes / GB).toBeCloseTo(16.0, 1)
    expect(estimateMemory({ ...semi, variableMods: 2 }).level).toBe('over')
    // chunks bring it down
    expect(estimateMemory({ ...semi, variableMods: 2, chunkSize: 4000 }).level).toBe('ok')
  })

  it('many files: the growth levels off', () => {
    const twelve = { ...erwinia, files: 12, mzmlBytes: 12 * 75 * MiB }
    expect(estimateMemory({ ...twelve, threads: 16 }).level).toBe('ok')
    expect(estimateMemory({ ...twelve, threads: 16, peptdeep: true }).level).toBe('ok')
    // 6 to 12 files of 1 GB against Erwinia fit wasm32; 24 fractions of 1 GB against human do not
    const gigabyte = { ...erwinia, largestMzmlBytes: 1 * GB }
    expect(estimateMemory({ ...gigabyte, files: 6 }).level).toBe('ok')
    expect(estimateMemory({ ...gigabyte, files: 12 }).level).toBe('warn')
    const fractions = estimateMemory({ ...gigabyte, proteins: 20652, files: 24 })
    expect(fractions).toMatchObject({ level: 'over', cause: 'inputs' })
    expect(estimateMemory({ ...gigabyte, proteins: 20652, files: 24, variant: 'wasm64' }).level).toBe('ok')
  })

  it('is over when a file is too large for the module: 2 GiB − 64 MiB in wasm32, 16 GiB − 64 MiB in wasm64', () => {
    const tooLarge = estimateMemory({ ...erwinia, largestMzmlBytes: MAX_FILE_BYTES + 1 })
    expect(tooLarge).toMatchObject({ fileTooLarge: true, level: 'over', cause: 'inputs' })
    expect(estimateMemory({ ...erwinia, largestMzmlBytes: MAX_FILE_BYTES }).fileTooLarge).toBe(false)
    expect(estimateMemory({ ...erwinia, databaseBytes: MAX_FILE_BYTES + 1 }).fileTooLarge).toBe(true)
    // wasm64 takes it (2 × 2 GiB of file and spectra: ok)
    expect(estimateMemory({ ...erwinia, largestMzmlBytes: MAX_FILE_BYTES + 1, variant: 'wasm64' })).toMatchObject({ fileTooLarge: false, level: 'ok' })
    expect(estimateMemory({ ...erwinia, largestMzmlBytes: MAX_FILE_BYTES_64 + 1, variant: 'wasm64' })).toMatchObject({ fileTooLarge: true, level: 'over' })
  })
})
