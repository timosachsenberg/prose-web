// The open search's mass shifts, as the engine's modification analysis reports them: the delta-mass
// peaks (bars of the histogram, and a table of them) and the shifts it could map to known
// modifications (the mapped-PTM table).

import type { ModificationAnalysis } from '../engine/openms-types'
import { signedNumber } from '../format/number'

type Analysis = NonNullable<ModificationAnalysis>

/** What labels a shift: the modification it matches, else its mass ("−57.02"). */
export function deltaMassLabel(deltaMass: number, modification: string): string {
  return modification !== '' ? modification : signedNumber(deltaMass, 2)
}

export type ShiftBar = {
  /** Δ mass (Da). */
  x: number
  count: number
  known: boolean
  label: string
  modification: string | null
  /** Percent of the shifted PSMs. */
  percentage: number
}

/** The mass shifts for the histogram, by ascending mass. */
export function massShiftBars(a: Analysis): ShiftBar[] {
  return a.deltaMasses.entries
    .map((e) => ({
      x: e.deltaMass,
      count: e.count,
      known: e.known,
      label: deltaMassLabel(e.deltaMass, e.modification),
      modification: e.modification !== '' ? e.modification : null,
      percentage: e.percentage,
    }))
    .sort((p, q) => p.x - q.x)
}

export type ShiftRow = { mass: string; psms: number; share: string; modification: string | null; known: boolean }

const percent = (p: number) => `${p.toFixed(1)} %`

/** The mass shifts for the table, the most frequent first. */
export function massShiftRows(a: Analysis): ShiftRow[] {
  return [...a.deltaMasses.entries]
    .sort((p, q) => q.count - p.count || p.deltaMass - q.deltaMass)
    .map((e) => ({
      mass: signedNumber(e.deltaMass, 4),
      psms: e.count,
      share: percent(e.percentage),
      modification: e.modification !== '' ? e.modification : null,
      known: e.known,
    }))
}

export type PtmRow = {
  name: string
  theoretical: string
  observed: string
  /** observed − theoretical, in mDa. */
  deviation: string
  psms: number
  peptides: number
  share: string
  /** The residues the modification can sit on (Unimod). */
  residues: string
}

/** The shifts mapped to known modifications. (The engine's `residueCounts` count every residue of the peptides, so they are not shown.) */
export function ptmRows(a: Analysis): PtmRow[] {
  return a.ptms.entries.map((e) => ({
    name: e.name,
    theoretical: signedNumber(e.theoreticalMass, 4),
    observed: signedNumber(e.observedMass, 4),
    deviation: signedNumber(e.massDeviation * 1000, 3, { plus: false }),
    psms: e.count,
    peptides: e.uniquePeptides,
    share: percent(e.percentage),
    residues: e.targetResidues,
  }))
}

export type ShiftSummary = {
  total: number
  shifted: number
  unmodified: number
  shareShifted: number
  /** Shifted PSMs whose shift no known modification explains. */
  unassigned: number
  /** Shifted PSMs mapped to known modifications. */
  mapped: number
}

export function shiftSummary(a: Analysis): ShiftSummary {
  const { totalPSMs, modifiedPSMs, unmodifiedPSMs } = a.deltaMasses
  return {
    total: totalPSMs,
    shifted: modifiedPSMs,
    unmodified: unmodifiedPSMs,
    shareShifted: totalPSMs > 0 ? modifiedPSMs / totalPSMs : 0,
    unassigned: a.ptms.unknownModificationPSMs,
    mapped: a.ptms.totalModifiedPSMs,
  }
}
