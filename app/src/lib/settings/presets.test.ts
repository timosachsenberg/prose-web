import { describe, expect, it } from 'vitest'
import { changedParameters, SWITCH_PARAMETERS } from './parameters'
import { applyPreset, BUILTIN_PRESETS, DEFAULT_PRESET_ID, loadPresets, PRESETS_KEY, savePreset, type PresetStorage } from './presets'

/** localStorage in memory. */
function memoryStorage(initial: Record<string, string> = {}): PresetStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  }
}

// a few of ProSE's defaults (getDefaults().getEntries())
const defaults: Record<string, unknown> = {
  enzyme: 'Trypsin',
  'peptide:missed_cleavages': 1,
  'precursor:mass_tolerance_lower': 10,
  'precursor:mass_tolerance_upper': 10,
  'precursor:mass_tolerance_unit': 'ppm',
  'precursor:isotope_error_min': -1,
  'precursor:isotope_error_max': 1,
  'fragment:mass_tolerance': 20,
  'modifications:fixed': ['Carbamidomethyl (C)'],
  'modifications:variable': ['Oxidation (M)'],
  'FDR:PSM': 0,
  'FDR:protein': 0,
  'calibration:enabled': false,
}

describe('presets', () => {
  it('has the three built-in presets, Orbitrap HCD first', () => {
    expect(BUILTIN_PRESETS.map((p) => p.id)).toEqual(['orbitrap-hcd-tryptic', 'timstof-tryptic', 'open-search'])
    expect(DEFAULT_PRESET_ID).toBe('orbitrap-hcd-tryptic')
    for (const p of BUILTIN_PRESETS) expect(p.builtin).toBe(true)
  })

  it('presets set only their parameters', () => {
    const open = BUILTIN_PRESETS.find((p) => p.id === 'open-search')!
    const orbitrap = BUILTIN_PRESETS.find((p) => p.id === 'orbitrap-hcd-tryptic')!

    // on top of the defaults: every parameter a preset does not set keeps its default
    const values = applyPreset(open, defaults)
    for (const [name, value] of Object.entries(values)) {
      expect(value).toEqual(name in open.parameters ? open.parameters[name] : defaults[name])
    }
    expect(values['precursor:mass_tolerance_unit']).toBe('Da')
    expect(values['calibration:enabled']).toBe(false)

    // switching presets carries nothing over from the one before
    expect(applyPreset(orbitrap, defaults)).toEqual({ ...defaults, ...orbitrap.parameters })
    expect(applyPreset(orbitrap, defaults)['precursor:mass_tolerance_unit']).toBe('ppm')

    // the switches of the Rescoring card are no preset parameters
    for (const p of BUILTIN_PRESETS) {
      for (const name of SWITCH_PARAMETERS) expect(p.parameters).not.toHaveProperty(name)
    }

    // the FDR cutoffs of the presets are 1 %, never "no filter"
    for (const p of BUILTIN_PRESETS) {
      expect(p.parameters['FDR:PSM']).toBe(0.01)
      expect(p.parameters['FDR:protein']).toBe(0.01)
    }

    // a value is copied: editing the result leaves the preset as it was
    const copy = applyPreset(orbitrap, defaults)
    ;(copy['modifications:variable'] as string[]).push('Phospho (S)')
    expect(orbitrap.parameters['modifications:variable']).not.toContain('Phospho (S)')
  })

  it('saves only the parameters that differ from the defaults', () => {
    const storage = memoryStorage()
    const values = { ...defaults, enzyme: 'Lys-C', 'modifications:variable': ['Oxidation (M)'] }
    const changed = changedParameters(values, defaults)
    expect(changed).toEqual({ enzyme: 'Lys-C' })

    const saved = savePreset('Lys-C', changed, storage)
    expect(saved).toMatchObject({ name: 'Lys-C', parameters: { enzyme: 'Lys-C' }, builtin: false })
    expect(loadPresets(storage).map((p) => p.name)).toEqual([...BUILTIN_PRESETS.map((p) => p.name), 'Lys-C'])
    expect(JSON.parse(storage.data.get(PRESETS_KEY)!)).toHaveLength(1)

    // the same name again replaces the preset (and keeps its id)
    const again = savePreset('Lys-C', { enzyme: 'Lys-C', 'peptide:missed_cleavages': 3 }, storage)
    expect(again.id).toBe(saved.id)
    const users = loadPresets(storage).filter((p) => !p.builtin)
    expect(users).toHaveLength(1)
    expect(users[0].parameters).toEqual({ enzyme: 'Lys-C', 'peptide:missed_cleavages': 3 })
  })

  it('ignores user presets it cannot read', () => {
    expect(loadPresets(memoryStorage({ [PRESETS_KEY]: 'not json' }))).toEqual(BUILTIN_PRESETS)
    expect(loadPresets(memoryStorage({ [PRESETS_KEY]: '[{"name": 3}]' }))).toEqual(BUILTIN_PRESETS)
    expect(loadPresets(null)).toEqual(BUILTIN_PRESETS)
  })

  it('never stores the switch parameters in a user preset', () => {
    const storage = memoryStorage()
    const saved = savePreset('mine', { enzyme: 'Lys-C', rescore: false, 'peptdeep:enable': true }, storage)
    expect(saved.parameters).toEqual({ enzyme: 'Lys-C' })
  })
})
