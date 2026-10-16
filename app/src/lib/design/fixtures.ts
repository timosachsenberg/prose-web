import type { DesignInput } from './model'

// Shared by the design tests; not part of the app.
let counter = 0
/** A design row with an id and a size; only the fields under test need to be given. */
export function input(fileName: string, rest: Partial<DesignInput> = {}): DesignInput {
  counter += 1
  return { id: `f${counter}`, fileName, fileSize: 1000, ...rest }
}

/** The design of the mockup (1-new-search): ctrl a/b x F1/F2, plus EGF and its re-injection. */
export function mockupDesign(): DesignInput[] {
  return [
    input('ctrl_a_F1.mzML', { condition: 'control', replicate: 1, fraction: 1 }),
    input('ctrl_a_F2.mzML', { condition: 'control', replicate: 1, fraction: 2 }),
    input('ctrl_b_F1.mzML', { condition: 'control', replicate: 2, fraction: 1 }),
    input('ctrl_b_F2.mzML', { condition: 'control', replicate: 2, fraction: 2 }),
    input('egf_30min.mzML', { condition: 'EGF' }),
    input('egf_30min_reinject.mzML', { condition: 'EGF', replicate: 1 }),
  ]
}
