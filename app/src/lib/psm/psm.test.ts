import { describe, expect, it } from 'vitest'
import type { PeakMatch, ProSEFileSummary, StoredSpectra } from '../engine/openms-types'
import { sampleTables } from '../results/fixtures'
import { makeTables } from '../results/synthetic'
import {
  annotationOptions,
  errorStats,
  featureValue,
  fragmentCharges,
  fragmentTolerance,
  groupByPeak,
  instrumentOf,
  ionLabel,
  ionTable,
  ladderCuts,
  lossOptions,
  matchSummary,
  matchedByReference,
  modificationList,
  nceFor,
  precursorOptions,
  resolveOptions,
  similarityText,
  spectrumPeaks,
  svgFileName,
  visibleMatches,
  visibleTheoretical,
  withPrecursor,
  type PsmOptionState,
  type TheoreticalIon,
} from './psm'

function match(peak: number, ion: string, more: Partial<PeakMatch> = {}): PeakMatch {
  const parsed = /^([a-z])(\d+)(?:-([A-Za-z0-9]+))?(\+*)$/.exec(ion)
  return {
    peak,
    ion,
    type: parsed ? parsed[1] : 'precursor',
    ordinal: parsed ? Number(parsed[2]) : 0,
    charge: parsed ? Math.max(1, parsed[4].length) : 2,
    loss: parsed?.[3] ?? '',
    theoreticalMz: 100 + peak,
    errorPpm: 0,
    ...more,
  }
}

const theo = (ion: string, mz: number): TheoreticalIon => {
  const m = match(0, ion)
  return { ion, type: m.type, ordinal: m.ordinal, charge: m.charge, mz }
}

const user: PsmOptionState = { ions: ['b', 'y'], charges: null, losses: null, precursor: false, bottom: null }

describe('search settings of the view', () => {
  it('takes the fragment tolerance from the search, else from ProSE’s defaults', () => {
    expect(fragmentTolerance({ 'fragment:mass_tolerance': 0.02, 'fragment:mass_tolerance_unit': 'Da' })).toEqual({ value: 0.02, unit: 'Da' })
    expect(fragmentTolerance({}, { 'fragment:mass_tolerance': 15, 'fragment:mass_tolerance_unit': 'ppm' })).toEqual({ value: 15, unit: 'ppm' })
    expect(fragmentTolerance({ 'fragment:mass_tolerance': 40 })).toEqual({ value: 40, unit: 'ppm' })
    expect(fragmentTolerance({})).toEqual({ value: 20, unit: 'ppm' }) // ProSE's own default
  })

  it("takes the instrument from the search's peptdeep:instrument, else QE", () => {
    expect(instrumentOf({ 'peptdeep:instrument': 'timsTOF' })).toBe('timsTOF')
    expect(instrumentOf({}, { 'peptdeep:instrument': 'Lumos' })).toBe('Lumos')
    expect(instrumentOf({})).toBe('QE')
  })

  it("takes the NCE the search used for the PSM's file, else the spectrum's, else 30, and says which", () => {
    const file = (peptdeepNce: number | null) => ({ peptdeepNce }) as ProSEFileSummary
    expect(nceFor(file(36), NaN, {})).toEqual({ nce: 36, source: 'calibrated', label: 'NCE 36 (calibrated)' })
    expect(nceFor(file(28), 35, { 'peptdeep:nce': 28 })).toEqual({ nce: 28, source: 'search', label: 'NCE 28 (search setting)' })
    expect(nceFor(file(null), 35, {})).toEqual({ nce: 35, source: 'spectrum', label: 'NCE 35 (from the spectrum)' })
    expect(nceFor(file(null), 27.5, {}).label).toBe('NCE 27.5 (from the spectrum)')
    expect(nceFor(file(null), NaN, {})).toEqual({ nce: 30, source: 'default', label: 'NCE 30 (default)' })
    expect(nceFor(undefined, NaN, {}).nce).toBe(30)
  })
})

describe('spectrumPeaks', () => {
  const spectra = {
    psmSpectrum: Int32Array.of(1, -1, 0),
    offsets: Uint32Array.of(0, 2, 5),
    mz: Float32Array.of(100, 200, 150, 250, 350),
    intensity: Float32Array.of(1, 2, 3, 4, 5),
    precursorMz: Float64Array.of(500, 600),
    collisionEnergy: Float32Array.of(NaN, 30),
  } as StoredSpectra

  it('gives the peaks of the spectrum of a PSM as views of the stored arrays', () => {
    const p = spectrumPeaks(spectra, 0)!
    expect(p.index).toBe(1)
    expect(Array.from(p.mz)).toEqual([150, 250, 350])
    expect(Array.from(p.intensity)).toEqual([3, 4, 5])
    expect(p.mz.buffer).toBe(spectra.mz.buffer)
    expect(p.collisionEnergy).toBe(30)
    expect(Array.from(spectrumPeaks(spectra, 2)!.mz)).toEqual([100, 200])
  })

  it('is null for a PSM whose spectrum was not stored', () => {
    expect(spectrumPeaks(spectra, 1)).toBeNull()
    expect(spectrumPeaks(spectra, 99)).toBeNull()
  })
})

describe('options', () => {
  it('offers H2O, NH3, the losses of the modifications and the rest; those of the modifications are on', () => {
    const plain = lossOptions([])
    expect(plain.map((l) => l.formula)).toEqual(['H2O', 'NH3', 'other'])
    expect(plain.every((l) => !l.auto)).toBe(true)
    const ox = lossOptions([{ name: 'Oxidation', residue: 'M' }])
    expect(ox.find((l) => l.formula === 'CH4OS')).toEqual({ formula: 'CH4OS', label: 'CH₄SO', note: 'oxidised M', auto: true })
    const ph = lossOptions([{ name: 'Phospho', residue: 'S' }, { name: 'Phospho', residue: 'T' }])
    expect(ph.filter((l) => l.formula === 'H3PO4')).toHaveLength(1)
    expect(ph.find((l) => l.formula === 'H3PO4')!.auto).toBe(true)
    expect(lossOptions([{ name: 'Oxidation', residue: 'W' }]).map((l) => l.formula)).toEqual(['H2O', 'NH3', 'other'])
  })

  it('resolves the automatic choices: 2+ fragments for precursors of 3+, the losses of the modifications, PeptDeep with ONNX', () => {
    const losses = lossOptions([{ name: 'Oxidation', residue: 'M' }])
    expect(resolveOptions(user, { charge: 2, losses, onnx: true })).toEqual({
      ions: ['b', 'y'],
      charges: [1],
      losses: ['CH4OS'],
      precursor: false,
      bottom: 'peptdeep',
    })
    expect(resolveOptions(user, { charge: 3, losses, onnx: false }).charges).toEqual([1, 2])
    expect(resolveOptions(user, { charge: 3, losses, onnx: false }).bottom).toBe('theoretical')
    // what the user chose stays, but PeptDeep needs ONNX Runtime
    const chosen: PsmOptionState = { ...user, charges: [2], losses: ['H2O'], bottom: 'peptdeep' }
    expect(resolveOptions(chosen, { charge: 2, losses, onnx: false })).toMatchObject({ charges: [2], losses: ['H2O'], bottom: 'theoretical' })
  })

  it('offers 2+ fragments only for precursors of 2+ or more', () => {
    expect(fragmentCharges(1)).toEqual([1])
    expect(fragmentCharges(2)).toEqual([1, 2])
    expect(fragmentCharges(4)).toEqual([1, 2])
    const losses = lossOptions([])
    // a 1+ precursor: no 2+ fragments, also when the user chose them for other PSMs
    expect(resolveOptions({ ...user, charges: [1, 2] }, { charge: 1, losses, onnx: true }).charges).toEqual([1])
    expect(resolveOptions({ ...user, charges: [2] }, { charge: 1, losses, onnx: true }).charges).toEqual([1])
    expect(resolveOptions({ ...user, charges: [2] }, { charge: 2, losses, onnx: true }).charges).toEqual([2])
    // all charges switched off stays so
    expect(resolveOptions({ ...user, charges: [] }, { charge: 2, losses, onnx: true }).charges).toEqual([])
  })

  it('asks the engine for the fragments shown: the tolerance of the search, 2+ when shown, no precursor', () => {
    const o = resolveOptions({ ...user, ions: ['a', 'y'], precursor: true }, { charge: 2, losses: lossOptions([]), onnx: true })
    expect(annotationOptions(o, { value: 20, unit: 'ppm' })).toEqual({
      tolerance: 20,
      unit: 'ppm',
      maxCharge: 1,
      ions: ['a', 'y'],
      losses: false,
      precursor: false,
    })
    const two = { ...o, charges: [1, 2], losses: ['NH3'] }
    expect(annotationOptions(two, { value: 0.02, unit: 'Da' })).toMatchObject({ unit: 'Da', maxCharge: 2, losses: true })
    // no ion type: no fragment ions
    expect(annotationOptions({ ...o, ions: [] }, { value: 20, unit: 'ppm' }).ions).toEqual([])
  })

  it('asks for the precursor apart, at its own charge (the engine makes precursor peaks at maxCharge only)', () => {
    expect(precursorOptions({ value: 20, unit: 'ppm' }, 2)).toEqual({
      tolerance: 20,
      unit: 'ppm',
      maxCharge: 2,
      ions: [],
      losses: true,
      precursor: true,
    })
    // a 3+ PSM: [M+3H]+++
    expect(precursorOptions({ value: 0.02, unit: 'Da' }, 3)).toMatchObject({ unit: 'Da', maxCharge: 3, ions: [], precursor: true })
  })

  it('adds the precursor annotation to the fragment annotation', () => {
    const fragments = {
      matches: [match(0, 'b2', { theoreticalMz: 200 }), match(2, 'y3', { theoreticalMz: 700 })],
      theoretical: [theo('b2', 200), theo('y3', 700)],
    }
    const precursor = {
      matches: [match(1, '[M+3H]+++', { theoreticalMz: 512.97, charge: 3 })],
      theoretical: [
        { ion: '[M+3H-H2O]+++', type: 'precursor', ordinal: 0, charge: 3, mz: 506.96 },
        { ion: '[M+3H]+++', type: 'precursor', ordinal: 0, charge: 3, mz: 512.97 },
      ],
    }
    const merged = withPrecursor(fragments, precursor)
    expect(merged.matches.map((m) => m.ion)).toEqual(['b2', '[M+3H]+++', 'y3'])
    expect(merged.theoretical.map((t) => t.ion)).toEqual(['b2', '[M+3H-H2O]+++', '[M+3H]+++', 'y3'])
    expect(withPrecursor(fragments, null)).toBe(fragments)
    // shown with the precursor toggle, whatever the fragment charges; its losses with the loss toggles
    const o = { ions: ['b', 'y'] as ('b' | 'y')[], charges: [1], losses: [] as string[], precursor: true, bottom: 'theoretical' as const }
    expect(visibleMatches(merged.matches, o).map((m) => m.ion)).toEqual(['b2', '[M+3H]+++', 'y3'])
    expect(visibleTheoretical(merged.theoretical, o).map((t) => t.ion)).toEqual(['b2', '[M+3H]+++', 'y3'])
    expect(visibleTheoretical(merged.theoretical, { ...o, losses: ['H2O'] }).map((t) => t.ion)).toContain('[M+3H-H2O]+++')
    expect(visibleMatches(merged.matches, { ...o, precursor: false }).map((m) => m.ion)).toEqual(['b2', 'y3'])
  })
})

describe('matches', () => {
  const o = { ions: ['b', 'y'] as const, charges: [1], losses: ['NH3'], precursor: false, bottom: 'theoretical' as const }

  it('shows the matches of the chosen types, charges and losses', () => {
    const all = [
      match(0, 'b2'),
      match(1, 'a2'),
      match(2, 'y3++'),
      match(3, 'y4-NH3'),
      match(4, 'y5-H2O'),
      match(5, 'b6-CH2NO'),
      match(6, '[M+2H]++'),
    ]
    expect(visibleMatches(all, { ...o, ions: [...o.ions] }).map((m) => m.ion)).toEqual(['b2', 'y4-NH3'])
    const more = { ...o, ions: ['a', 'b', 'y'] as ('a' | 'b' | 'y')[], charges: [1, 2], losses: ['NH3', 'other'], precursor: true }
    expect(visibleMatches(all, more).map((m) => m.ion)).toEqual(['b2', 'a2', 'y3++', 'y4-NH3', 'b6-CH2NO', '[M+2H]++'])
  })

  it('filters the theoretical ions the same way (their loss is in the name)', () => {
    const t = [theo('b2', 200), theo('y1-NH3', 130), theo('y1-H2O', 129), theo('b2++', 100.5), theo('a2', 172)]
    expect(visibleTheoretical(t, { ...o, ions: ['b', 'y'] }).map((x) => x.ion)).toEqual(['b2', 'y1-NH3'])
  })

  it('groups the ions that share a peak under one label, by m/z', () => {
    const mz = Float32Array.of(100, 147.11, 175.12, 200)
    const intensity = Float32Array.of(5, 50, 20, 1)
    const groups = groupByPeak([match(2, 'b2'), match(1, 'z1++'), match(1, 'y1-NH3++'), match(1, 'y1')], mz, intensity)
    expect(groups.map((g) => g.peak)).toEqual([1, 2])
    expect(groups[0]).toMatchObject({ mz: mz[1], intensity: 50, label: 'y1 / y1-NH₃++ / z1++', type: 'y' })
    expect(groups[0].matches).toHaveLength(3)
    expect(groups[1]).toMatchObject({ label: 'b2', type: 'b' })
    expect(groupByPeak([match(0, 'a2'), match(0, 'c1')], mz, intensity)[0].type).toBe('a')
  })

  it('writes losses with subscripts', () => {
    expect(ionLabel('y7-H2O++')).toBe('y7-H₂O++')
    expect(ionLabel('b5-CH4OS')).toBe('b5-CH₄SO')
    expect(ionLabel('y3-H3PO4')).toBe('y3-H₃PO₄')
    expect(ionLabel('[M+2H]++')).toBe('[M+2H]++')
  })
})

describe('ladder and ion table', () => {
  it('marks a cleavage by the ions that explain it, b and y first', () => {
    // PEPTK (5 residues): cleavage i lies between residue i and i + 1
    const cuts = ladderCuts([match(0, 'b2'), match(1, 'a3'), match(2, 'y1'), match(3, 'c2'), match(4, 'z4')], 5)
    expect(cuts.n).toEqual([null, 'b', 'a', null])
    expect(cuts.c).toEqual(['z', null, null, 'y'])
  })

  it('lists the theoretical ions per residue, the matched ones marked', () => {
    // a peptide of three residues: b1 b2, y1 y2
    const t = [theo('b1', 100), theo('b2', 200), theo('y1', 150), theo('y2', 250), theo('b2-H2O', 182), theo('b2++', 100.6)]
    const o = { ions: ['b', 'y'] as ('b' | 'y')[], charges: [1], losses: [], precursor: false, bottom: 'theoretical' as const }
    const table = ionTable(t, [match(0, 'b2'), match(1, 'y2-H2O')], 3, o)
    expect(table.n).toEqual([{ type: 'b', charge: 1, header: 'b⁺' }])
    expect(table.c).toEqual([{ type: 'y', charge: 1, header: 'y⁺' }])
    expect(table.rows.map((r) => r.n[0]?.mz ?? null)).toEqual([100, 200, null])
    expect(table.rows.map((r) => r.c[0]?.mz ?? null)).toEqual([null, 250, 150])
    expect(table.rows.map((r) => r.n[0]?.matched ?? null)).toEqual([false, true, null])
    // a match with a loss does not mark the plain ion
    expect(table.rows[1].c[0]).toEqual({ ion: 'y2', mz: 250, matched: false })
    const two = ionTable(t, [], 3, { ...o, ions: ['b'], charges: [1, 2] })
    expect(two.n.map((c) => c.header)).toEqual(['b⁺', 'b²⁺'])
    expect(two.c).toEqual([])
    expect(two.rows[1].n[1]).toEqual({ ion: 'b2++', mz: 100.6, matched: false })
  })
})

describe('numbers', () => {
  it('gives the mean and the standard deviation of the errors', () => {
    const s = errorStats([match(0, 'b2', { errorPpm: 1 }), match(1, 'b3', { errorPpm: -1 }), match(2, 'b4', { errorPpm: 3 })])
    expect(s.mean).toBeCloseTo(1)
    expect(s.sd).toBeCloseTo(2)
    expect(errorStats([match(0, 'b2', { errorPpm: 2 })]).sd).toBeNaN()
    expect(errorStats([]).mean).toBeNaN()
  })

  it('counts the matched ions and the intensity their peaks explain', () => {
    const intensity = Float32Array.of(10, 30, 60)
    const t = [theo('b2', 1), theo('b3', 2), theo('y1', 3), theo('y2', 4)]
    const s = matchSummary([match(1, 'b2'), match(1, 'y1'), match(2, 'y2')], t, intensity)
    expect(s).toEqual({ matched: 3, total: 4, intensityFraction: 0.9 })
  })

  it('lists the modifications with their sites, the fixed ones last', () => {
    const t = sampleTables().peptides
    expect(modificationList(t, 0, [])).toEqual(['Oxidation (M1)'])
    expect(modificationList(t, 0, ['Oxidation (M)'])).toEqual(['Oxidation (M1, fixed)'])
    expect(modificationList(t, 1, [])).toEqual([])
    const terminal = makeTables({
      files: ['a.mzML'],
      proteins: [{ accession: 'P1', sequence: 'ACDK' }],
      peptides: [
        {
          sequence: 'ACDK',
          mods: [
            { position: 1, name: 'Carbamidomethyl' },
            { position: -1, name: 'Acetyl' },
          ],
          proteins: [0],
        },
      ],
      psms: [{ peptide: 0, file: 0 }],
    }).peptides
    expect(modificationList(terminal, 0, ['Carbamidomethyl (C)'])).toEqual(['Acetyl (N-term)', 'Carbamidomethyl (C2, fixed)'])
  })

  it('reads a feature of a PSM by name; NaN when the search has none', () => {
    const names = ['ln(hyperscore)', 'ms2_cosine']
    const features = Float64Array.of(1, 0.5, 2, 0.9)
    expect(featureValue(names, features, 1, 'ms2_cosine')).toBe(0.9)
    expect(featureValue(names, features, 0, 'ms2_spectral_angle')).toBeNaN()
  })

  it("says the search's similarity to PeptDeep's prediction, when the search has it", () => {
    const names = ['ln(hyperscore)', 'ms2_cosine', 'ms2_spectral_angle']
    expect(similarityText(names, Float64Array.of(1, 0.9312, 0.7624), 0)).toBe('cosine 0.931 · spectral angle 0.762 (search)')
    expect(similarityText(['ln(hyperscore)'], Float64Array.of(1), 0)).toBeNull()
    expect(similarityText(names, Float64Array.of(1, NaN, NaN), 0)).toBeNull()
  })

  it('scales the observed half to the strongest matched b or y peak of the types shown', () => {
    const o = { ions: ['b', 'y'] as ('a' | 'b' | 'y')[], charges: [1], losses: [] as string[], precursor: true, bottom: 'peptdeep' as const }
    const groups = [
      { intensity: 90, matches: [match(0, '[M+2H]++')] }, // the precursor: no reference
      { intensity: 40, matches: [match(1, 'b2')] },
      { intensity: 70, matches: [match(2, 'a3')] }, // an a ion: no reference
      { intensity: 60, matches: [match(3, 'y4'), match(3, 'a5')] },
    ]
    expect(matchedByReference(groups, o)).toBe(60)
    expect(matchedByReference(groups, { ...o, ions: ['b'] })).toBe(40)
    expect(matchedByReference(groups.slice(0, 1), o)).toBeNull()
  })

  it("takes a b or y ion without a loss as the reference, as PeptDeep's prediction has none", () => {
    const o = { ions: ['b', 'y'] as ('a' | 'b' | 'y')[], charges: [1], losses: ['H2O'], precursor: false, bottom: 'peptdeep' as const }
    const groups = [
      { intensity: 90, matches: [match(0, 'y5-H2O')] }, // only a loss ion: not PeptDeep's kind of peak
      { intensity: 40, matches: [match(1, 'b3')] },
      { intensity: 70, matches: [match(2, 'b4-NH3'), match(2, 'a4')] },
    ]
    expect(matchedByReference(groups, o)).toBe(40)
    // a peak that has an ion without a loss among its matches still counts
    expect(matchedByReference([{ intensity: 80, matches: [match(3, 'y2-H2O'), match(3, 'y2')] }, ...groups], o)).toBe(80)
    // only loss ions matched: no reference (the base peak is used instead)
    expect(matchedByReference(groups.slice(0, 1), o)).toBeNull()
  })

  it('names an exported spectrum after its peptide and scan', () => {
    expect(svgFileName('AVM[Oxidation]DDFAAFVEK', 'controllerType=0 controllerNumber=1 scan=21507')).toBe(
      'AVM_Oxidation_DDFAAFVEK_scan21507.svg',
    )
    expect(svgFileName('[+15.9949]?PEPTIDEK', 'index=12')).toBe('15.9949_PEPTIDEK_scan12.svg')
    expect(svgFileName('PEPTIDEK', 'frame=5 scan=3 extra')).toBe('PEPTIDEK_scan3.svg')
    expect(svgFileName('PEPTIDEK', 'some id/with:chars')).toBe('PEPTIDEK_some_id_with_chars.svg')
  })
})
