import { describe, expect, it } from 'vitest'
import { estimateMemory, GB, INPUT_BUDGET } from './memory'

const MB = 1e6

describe('estimateMemory', () => {
  // The searches measured in README-openms-wasm.md: a 78 MB Orbitrap mzML against Erwinia and human.
  const erwinia = { largestMzmlBytes: 78 * MB, proteins: 4499, specificity: 'full', variableMods: 1, peptdeep: false } as const
  const human = { ...erwinia, proteins: 20652 }

  it('matches the measured searches', () => {
    for (const storage of ['memory', 'opfs'] as const) {
      const small = estimateMemory({ ...erwinia, storage })
      expect(small.bytes / GB).toBeGreaterThanOrEqual(0.7)
      expect(small.bytes / GB).toBeLessThanOrEqual(1.0)
      expect(small.level).toBe('ok')

      const large = estimateMemory({ ...human, storage })
      expect(large.bytes / GB).toBeGreaterThanOrEqual(1.8)
      expect(large.bytes / GB).toBeLessThanOrEqual(2.4)

      const semi = estimateMemory({ ...human, specificity: 'semi', storage })
      expect(semi.level).toBe('over')
      expect(semi.cause).toBe('database')
    }
  })

  it('defaults to the memory storage mode', () => {
    expect(estimateMemory(human)).toEqual(estimateMemory({ ...human, storage: 'memory' }))
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

  it('counts every input file in memory mode', () => {
    // six 300 MB files and a 25 MB FASTA against human: all inputs stay in the module during the search
    const six = { ...human, largestMzmlBytes: 300 * MB, inputBytes: 6 * 300 * MB + 25 * MB }
    const memory = estimateMemory({ ...six, storage: 'memory' })
    const opfs = estimateMemory({ ...six, storage: 'opfs' })
    // memory: the inputs plus one file being read; opfs: two times the largest file
    expect(memory.inputs).toBeCloseTo(six.inputBytes + 300 * MB, -3)
    expect(opfs.inputs).toBeCloseTo(2 * 300 * MB, -3)
    expect(memory.bytes - opfs.bytes).toBeCloseTo(memory.inputs - opfs.inputs, -3)
    expect(memory.level).toBe('warn')
    expect(memory.cause).toBe('inputs')
    expect(opfs.level).toBe('ok')
  })

  it('is over when the inputs exceed what the engine accepts, as EngineClient refuses them', () => {
    const tooMany = { ...erwinia, largestMzmlBytes: 300 * MB, inputBytes: INPUT_BUDGET + 1 }
    const estimate = estimateMemory(tooMany)
    expect(estimate.inputsOverBudget).toBe(true)
    expect(estimate.level).toBe('over')
    expect(estimate.cause).toBe('inputs')
    // OPFS keeps the inputs out of the module's memory
    expect(estimateMemory({ ...tooMany, storage: 'opfs' }).inputsOverBudget).toBe(false)
  })

  it('builds the index of a chunked database one chunk at a time', () => {
    const semi = { ...human, specificity: 'semi' } as const
    const chunked = estimateMemory({ ...semi, chunkSize: 2000 })
    expect(chunked.database / estimateMemory(semi).database).toBeCloseTo(2000 / 20652)
    expect(chunked.level).toBe('ok')
    // a chunk larger than the database changes nothing
    expect(estimateMemory({ ...semi, chunkSize: 50000 }).bytes).toBe(estimateMemory(semi).bytes)
  })

  it('treats a non-specific search as 30 times a tryptic one', () => {
    const none = estimateMemory({ ...erwinia, specificity: 'none', largestMzmlBytes: 0 })
    const full = estimateMemory({ ...erwinia, largestMzmlBytes: 0 })
    expect(none.database / full.database).toBeCloseTo(30)
  })
})
