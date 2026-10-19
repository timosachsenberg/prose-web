import { describe, expect, it } from 'vitest'
import { MAX_FILE_BYTES } from '../engine/protocol'
import { estimateMemory, GB, growthPerFile, isUncertain, threadFactor, UNCERTAIN_BYTES } from './memory'

const MB = 1e6
const MiB = 2 ** 20

describe('estimateMemory', () => {
  // The searches measured in README-openms-wasm.md: a 78 MB Orbitrap mzML against Erwinia and human.
  const erwinia = { largestMzmlBytes: 78 * MB, proteins: 4499, specificity: 'full', variableMods: 1, peptdeep: false } as const
  const human = { ...erwinia, proteins: 20652 }

  it('matches the measured searches', () => {
    const small = estimateMemory(erwinia)
    expect(small.bytes / GB).toBeGreaterThanOrEqual(0.7)
    expect(small.bytes / GB).toBeLessThanOrEqual(1.0)
    expect(small.level).toBe('ok')

    const large = estimateMemory(human)
    expect(large.bytes / GB).toBeGreaterThanOrEqual(1.8)
    expect(large.bytes / GB).toBeLessThanOrEqual(2.4)

    const semi = estimateMemory({ ...human, specificity: 'semi' })
    expect(semi.level).toBe('over')
    expect(semi.cause).toBe('database')
  })

  it('defaults to one file at 4 threads', () => {
    expect(estimateMemory(human)).toEqual(estimateMemory({ ...human, files: 1, threads: 4, mzmlBytes: human.largestMzmlBytes }))
    expect(estimateMemory(human).growth).toBe(0)
  })

  it('warns above 3 GB and is over above 4 GB', () => {
    // 0.25 + 0.08 × 20 × 1.5 = 2.65 GB of database with two variable modifications, plus the file
    expect(estimateMemory({ ...human, proteins: 20000, variableMods: 2, largestMzmlBytes: 0 }).level).toBe('ok')
    expect(estimateMemory({ ...human, proteins: 20000, variableMods: 2, peptdeep: true, largestMzmlBytes: 0 }).level).toBe('warn')
    expect(estimateMemory({ ...human, proteins: 40000, variableMods: 1, largestMzmlBytes: 0 }).level).toBe('warn')
    expect(estimateMemory({ ...human, proteins: 60000, variableMods: 1, largestMzmlBytes: 0 }).level).toBe('over')
  })

  it('adds 0.6 GB for PeptDeep and grows 1.5 times per further variable modification', () => {
    const base = estimateMemory(human)
    expect(estimateMemory({ ...human, peptdeep: true }).bytes - base.bytes).toBeCloseTo(0.6 * GB, -3)
    const three = estimateMemory({ ...human, variableMods: 3, largestMzmlBytes: 0 })
    const one = estimateMemory({ ...human, variableMods: 1, largestMzmlBytes: 0 })
    expect(three.database / one.database).toBeCloseTo(2.25)
    // no variable modification costs as much as one
    expect(estimateMemory({ ...human, variableMods: 0 }).bytes).toBe(base.bytes)
  })

  it('holds one file at a time: the inputs do not add up', () => {
    // six 300 MB files and a 25 MB FASTA against human: only the file being searched is in the module
    const files = { ...human, largestMzmlBytes: 300 * MB, databaseBytes: 25 * MB }
    const one = estimateMemory(files)
    const six = estimateMemory({ ...files, files: 6, mzmlBytes: 6 * 300 * MB })
    // the file (in a block of its size) and its spectra, and the database
    expect(one.inputs).toBeCloseTo(2 * 300 * MB + 25 * MB, -3)
    // five more files add the heap growth of five searches, not their size
    expect(six.growth).toBeCloseTo(5 * growthPerFile(300 * MB), -3)
    expect(six.inputs - one.inputs).toBeCloseTo(six.growth, -3)
    expect(six.growth).toBeLessThan(5 * 300 * MB)
    expect(six.level).toBe('warn')
  })

  it('lets the growth per file follow the threads and the size of the files', () => {
    // mimalloc grows the heap per file only with several threads; more threads, more growth
    expect(threadFactor(1)).toBe(0)
    expect(threadFactor(4)).toBe(1)
    expect(threadFactor(2)).toBeCloseTo(1 / 3)
    expect(threadFactor(8)).toBeCloseTo(1.14)
    expect(threadFactor(16)).toBeCloseTo(1.42)
    // at 4 threads: 0.2 GB per file of 75 MB or less, 0.09 GB from 733 MB on, linear between
    expect(growthPerFile(10 * MiB)).toBeCloseTo(0.2 * GB, -3)
    expect(growthPerFile(75 * MiB)).toBeCloseTo(0.2 * GB, -3)
    expect(growthPerFile(404 * MiB)).toBeCloseTo(0.145 * GB, -3)
    expect(growthPerFile(733 * MiB)).toBeCloseTo(0.09 * GB, -3)
    expect(growthPerFile(1.5 * GB)).toBeCloseTo(0.09 * GB, -3)
    // the mean size counts: one large file among small ones grows the heap as small ones do
    const mixed = estimateMemory({ ...erwinia, largestMzmlBytes: 733 * MiB, files: 4, mzmlBytes: 733 * MiB + 3 * 75 * MiB })
    expect(mixed.growth).toBeCloseTo(3 * growthPerFile((733 * MiB + 3 * 75 * MiB) / 4), -3)
    // one thread: no growth
    expect(estimateMemory({ ...erwinia, files: 12, threads: 1 }).growth).toBe(0)
  })

  // Part B's measurements (Chromium, file by file, a closed search with Percolator against Erwinia):
  // copies of erwinia_tmt (74.5 MiB, README) and of big733 (733 MiB, README and the final review);
  // the heap after the search in MiB
  const measured = [
    { files: 1, size: 733, threads: 4, peptdeep: false, heap: 2153 },
    { files: 2, size: 733, threads: 4, peptdeep: false, heap: 2269 },
    { files: 4, size: 733, threads: 4, peptdeep: false, heap: 2485 },
    { files: 12, size: 733, threads: 4, peptdeep: false, heap: 2969 },
    { files: 6, size: 733, threads: 8, peptdeep: false, heap: 2725 },
    { files: 12, size: 733, threads: 8, peptdeep: false, heap: 3101 },
    { files: 12, size: 733, threads: 16, peptdeep: false, heap: 3305 },
    { files: 1, size: 74.5, threads: 4, peptdeep: false, heap: 715 },
    { files: 12, size: 74.5, threads: 4, peptdeep: false, heap: 2959 },
    { files: 12, size: 74.5, threads: 8, peptdeep: false, heap: 3007 },
    { files: 12, size: 74.5, threads: 16, peptdeep: false, heap: 3971 },
    { files: 12, size: 74.5, threads: 4, peptdeep: true, heap: 3263 },
    { files: 12, size: 74.5, threads: 8, peptdeep: true, heap: 4079 },
  ]
  const run = (m: { files: number; size: number; threads: number; peptdeep: boolean }) =>
    estimateMemory({ ...erwinia, largestMzmlBytes: m.size * MiB, files: m.files, threads: m.threads, peptdeep: m.peptdeep })

  it('is calibrated on the measured searches of many files', () => {
    for (const m of measured) {
      const ratio = run(m).bytes / MiB / m.heap
      expect(ratio, JSON.stringify(m)).toBeGreaterThan(0.92)
      expect(ratio, JSON.stringify(m)).toBeLessThan(1.13)
    }
    // 12 small files with PeptDeep at 16 threads hit the 4 GB limit
    expect(run({ files: 12, size: 74.5, threads: 16, peptdeep: true }).level).toBe('over')
  })

  it('many small files: the growth per file dominates, and fewer threads keep it lower', () => {
    const twelve = { ...erwinia, largestMzmlBytes: 75 * MiB, files: 12 }
    expect(estimateMemory({ ...twelve, threads: 4 }).level).toBe('ok')
    expect(estimateMemory({ ...twelve, threads: 16 }).level).toBe('warn')
    expect(estimateMemory({ ...twelve, threads: 4, peptdeep: true }).level).toBe('warn')
    expect(estimateMemory({ ...twelve, threads: 16, peptdeep: true }).level).toBe('over')
    // 24 fractions of 100 MB against human: too many for one search, because of the files
    const fractions = estimateMemory({ ...human, largestMzmlBytes: 100 * MB, files: 24, threads: 4 })
    expect(fractions.level).toBe('over')
    expect(fractions.cause).toBe('inputs')
    expect(fractions.growth).toBeGreaterThan(fractions.database)
  })

  it('many large files: 6 to 12 files of 1 GB fit, close to the limit', () => {
    const gigabyte = { ...erwinia, largestMzmlBytes: 1 * GB, threads: 4 }
    const six = estimateMemory({ ...gigabyte, files: 6 })
    const twelve = estimateMemory({ ...gigabyte, files: 12 })
    expect(six.level).toBe('warn')
    expect(twelve.level).toBe('warn')
    expect(twelve.bytes).toBeLessThan(4 * GB)
    expect(twelve.bytes - six.bytes).toBeCloseTo(6 * growthPerFile(1 * GB), -3)
    // against human, one such file is already close to the limit, and six are over
    expect(estimateMemory({ ...gigabyte, proteins: 20652, files: 6 }).level).toBe('over')
  })

  it('is over when a file is too large for the module (above 2 GiB − 64 MiB)', () => {
    const tooLarge = estimateMemory({ ...erwinia, largestMzmlBytes: MAX_FILE_BYTES + 1 })
    expect(tooLarge.fileTooLarge).toBe(true)
    expect(tooLarge.level).toBe('over')
    expect(tooLarge.cause).toBe('inputs')
    expect(estimateMemory({ ...erwinia, largestMzmlBytes: MAX_FILE_BYTES }).fileTooLarge).toBe(false)
    expect(estimateMemory({ ...erwinia, databaseBytes: MAX_FILE_BYTES + 1 }).fileTooLarge).toBe(true)
  })

  it('builds the index of a chunked database one chunk at a time', () => {
    const semi = { ...human, specificity: 'semi' } as const
    const chunked = estimateMemory({ ...semi, chunkSize: 2000 })
    expect(chunked.database / estimateMemory(semi).database).toBeCloseTo(2000 / 20652)
    // a chunk larger than the database changes nothing
    expect(estimateMemory({ ...semi, chunkSize: 50000 }).bytes).toBe(estimateMemory(semi).bytes)
    expect(estimateMemory({ ...semi, chunkSize: 50000 }).uncertain).toBe(false)
  })

  it('shows what chunked semi- and non-specific searches measured, and is over for three files', () => {
    // human semi-tryptic in chunks of 2000, 78 MB, Chromium, 4 threads, file by file: 2.3 to 3.7 GB for
    // one file, 3.8 GB for three; the formula gives 1.4 and 1.8 GB
    for (const [specificity, chunkSize] of [['semi', 2000], ['none', 200]] as const) {
      const chunked = { ...human, specificity, chunkSize }
      expect(isUncertain(chunked)).toBe(true)
      const one = estimateMemory(chunked)
      expect(one.uncertain).toBe(true)
      expect(one.bytes).toBe(UNCERTAIN_BYTES)
      expect(one.level).toBe('warn')
      expect(one.cause).toBe('database')
      expect(estimateMemory({ ...chunked, files: 2 }).level).toBe('warn')
      expect(estimateMemory({ ...chunked, files: 3 })).toMatchObject({ level: 'over', bytes: UNCERTAIN_BYTES, cause: 'database' })
    }
    // the formula still counts where it gives more: non-specific in chunks of 2000 (4.8 GB of index)
    const large = estimateMemory({ ...human, specificity: 'none', chunkSize: 2000 })
    expect(large.bytes).toBeGreaterThan(4 * GB)
    expect(large.level).toBe('over')
    // a chunked tryptic search, and a chunk larger than the database, stay as estimated
    expect(estimateMemory({ ...human, chunkSize: 2000 })).toMatchObject({ level: 'ok', uncertain: false })
    expect(isUncertain({ ...human, specificity: 'semi', chunkSize: 30000 })).toBe(false)
    expect(isUncertain({ ...human, specificity: 'semi', chunkSize: 0 })).toBe(false)
    // proteins not counted yet: a chunk size counts as chunking
    expect(isUncertain({ ...human, proteins: null, specificity: 'semi', chunkSize: 2000 })).toBe(true)
    expect(isUncertain({ ...human, proteins: null, specificity: 'full', chunkSize: 2000 })).toBe(false)
  })

  it('treats a non-specific search as 30 times a tryptic one', () => {
    const none = estimateMemory({ ...erwinia, specificity: 'none', largestMzmlBytes: 0 })
    const full = estimateMemory({ ...erwinia, largestMzmlBytes: 0 })
    expect(none.database / full.database).toBeCloseTo(30)
  })
})
