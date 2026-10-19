import { describe, expect, it } from 'vitest'
import type { ModificationAnalysis } from '../engine/openms-types'
import { deltaMassLabel, massShiftBars, massShiftRows, ptmRows, shiftSummary } from './delta-mass'

const analysis: NonNullable<ModificationAnalysis> = {
  deltaMasses: {
    totalPSMs: 1000,
    modifiedPSMs: 200,
    unmodifiedPSMs: 800,
    meanDeltaMass: 10,
    medianDeltaMass: 15.9949,
    entries: [
      { deltaMass: 15.9949, count: 120, uniquePeptides: 90, chargeStates: 3, percentage: 60, modification: 'Oxidation', known: true },
      { deltaMass: -57.0215, count: 60, uniquePeptides: 50, chargeStates: 2, percentage: 30, modification: '', known: false },
      { deltaMass: 79.9663, count: 20, uniquePeptides: 18, chargeStates: 2, percentage: 10, modification: 'Phospho', known: true },
    ],
  },
  ptms: {
    totalModifiedPSMs: 140,
    unknownModificationPSMs: 60,
    uniqueModifications: 2,
    entries: [
      {
        name: 'Oxidation',
        theoreticalMass: 15.994915,
        observedMass: 15.9949,
        massDeviation: -0.000015,
        count: 120,
        uniquePeptides: 90,
        chargeStates: 3,
        percentage: 85.7,
        targetResidues: 'M',
        residueCounts: { M: 110, W: 10 },
      },
      {
        name: 'Phospho',
        theoreticalMass: 79.966331,
        observedMass: 79.9663,
        massDeviation: 0,
        count: 20,
        uniquePeptides: 18,
        chargeStates: 2,
        percentage: 14.3,
        targetResidues: 'STY',
        residueCounts: {},
      },
    ],
  },
}

describe('deltaMassLabel', () => {
  it('names a known modification and writes an unknown shift as a signed mass with a real minus', () => {
    expect(deltaMassLabel(15.9949, 'Oxidation')).toBe('Oxidation')
    expect(deltaMassLabel(-57.0215, '')).toBe('−57.02')
    expect(deltaMassLabel(42.01, '')).toBe('+42.01')
  })
})

describe('massShiftBars', () => {
  it('orders the shifts by mass and marks the known ones', () => {
    const bars = massShiftBars(analysis)
    expect(bars.map((b) => b.x)).toEqual([-57.0215, 15.9949, 79.9663])
    expect(bars.map((b) => b.count)).toEqual([60, 120, 20])
    expect(bars.map((b) => b.known)).toEqual([false, true, true])
    expect(bars.map((b) => b.label)).toEqual(['−57.02', 'Oxidation', 'Phospho'])
  })
})

describe('massShiftRows', () => {
  it('lists the shifts by PSMs, with their share of the shifted PSMs', () => {
    const rows = massShiftRows(analysis)
    expect(rows.map((r) => r.mass)).toEqual(['+15.9949', '−57.0215', '+79.9663'])
    expect(rows.map((r) => r.psms)).toEqual([120, 60, 20])
    expect(rows.map((r) => r.share)).toEqual(['60.0 %', '30.0 %', '10.0 %'])
    expect(rows.map((r) => r.modification)).toEqual(['Oxidation', null, 'Phospho'])
  })
})

describe('ptmRows', () => {
  it('lists the mapped modifications with their theoretical and observed masses and the residues they can sit on', () => {
    const rows = ptmRows(analysis)
    expect(rows.map((r) => r.name)).toEqual(['Oxidation', 'Phospho'])
    expect(rows[0]).toMatchObject({ theoretical: '+15.9949', observed: '+15.9949', psms: 120, peptides: 90, share: '85.7 %' })
    expect(rows[0].deviation).toBe('−0.015') // mDa
    // the residues the modification can sit on (Unimod), not the residue counts of the peptides: those count every residue
    expect(rows[0].residues).toBe('M')
    expect(rows[1].residues).toBe('STY')
    expect(rows[1].deviation).toBe('0.000')
  })
})

describe('shiftSummary', () => {
  it('says how many PSMs carry a shift and how many are unmodified', () => {
    expect(shiftSummary(analysis)).toEqual({ total: 1000, shifted: 200, unmodified: 800, shareShifted: 0.2, unassigned: 60, mapped: 140 })
  })
})
