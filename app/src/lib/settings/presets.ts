// Presets of the search settings: the built-in ones and those the user saved ("Save as preset", kept
// in localStorage). A preset holds only the parameters it sets; everything else is ProSE's default.

import { copyValues, SWITCH_PARAMETERS } from './parameters'

export type Preset = { id: string; name: string; parameters: Record<string, unknown>; builtin: boolean }

/** Where the user presets are kept. */
export const PRESETS_KEY = 'prose.presets'

/** What the presets need of localStorage (an in-memory one in the tests). */
export type PresetStorage = Pick<Storage, 'getItem' | 'setItem'>

/** The settings every built-in preset defines, so that switching presets leaves nothing behind. */
const tryptic = {
  enzyme: 'Trypsin/P',
  'peptide:enzyme_specificity': 'full',
  'peptide:missed_cleavages': 2,
  'modifications:fixed': ['Carbamidomethyl (C)'],
  'modifications:variable': ['Oxidation (M)', 'Acetyl (Protein N-term)'],
  'FDR:PSM': 0.01,
  'FDR:protein': 0.01,
  'precursor:min_charge': 2,
  'precursor:max_charge': 5,
  'peptide:min_size': 7,
  'peptide:max_size': 40,
}

export const BUILTIN_PRESETS: Preset[] = [
  {
    id: 'orbitrap-hcd-tryptic',
    name: 'Orbitrap HCD · tryptic',
    builtin: true,
    parameters: {
      ...tryptic,
      'precursor:mass_tolerance_lower': 10,
      'precursor:mass_tolerance_upper': 10,
      'precursor:mass_tolerance_unit': 'ppm',
      'fragment:mass_tolerance': 20,
      'fragment:mass_tolerance_unit': 'ppm',
      'peptdeep:instrument': 'QE',
    },
  },
  {
    id: 'timstof-tryptic',
    name: 'timsTOF · tryptic',
    builtin: true,
    parameters: {
      ...tryptic,
      'precursor:mass_tolerance_lower': 20,
      'precursor:mass_tolerance_upper': 20,
      'precursor:mass_tolerance_unit': 'ppm',
      'fragment:mass_tolerance': 40,
      'fragment:mass_tolerance_unit': 'ppm',
      'precursor:max_charge': 4,
      'peptdeep:instrument': 'timsTOF',
    },
  },
  {
    // a wide precursor window: unknown modifications show up as delta masses (README: ±500 Da)
    id: 'open-search',
    name: 'Open search · ±500 Da',
    builtin: true,
    parameters: {
      ...tryptic,
      'modifications:variable': [],
      'precursor:mass_tolerance_lower': 500,
      'precursor:mass_tolerance_upper': 500,
      'precursor:mass_tolerance_unit': 'Da',
      'precursor:isotope_error_min': 0,
      'precursor:isotope_error_max': 0,
      'fragment:mass_tolerance': 20,
      'fragment:mass_tolerance_unit': 'ppm',
      'peptdeep:instrument': 'QE',
    },
  },
]

export const DEFAULT_PRESET_ID = 'orbitrap-hcd-tryptic'

function browserStorage(): PresetStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null // blocked storage
  }
}

function isUserPreset(value: unknown): value is Preset {
  const p = value as Preset
  return (
    typeof p === 'object' &&
    p !== null &&
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.parameters === 'object' &&
    p.parameters !== null &&
    !Array.isArray(p.parameters)
  )
}

function readUserPresets(storage: PresetStorage | null): Preset[] {
  if (!storage) return []
  try {
    const list: unknown = JSON.parse(storage.getItem(PRESETS_KEY) ?? '[]')
    if (!Array.isArray(list) || !list.every(isUserPreset)) return []
    return list.map((p) => ({ ...p, builtin: false }))
  } catch {
    return []
  }
}

/** The built-in presets, then the user's. */
export function loadPresets(storage: PresetStorage | null = browserStorage()): Preset[] {
  return [...BUILTIN_PRESETS, ...readUserPresets(storage)]
}

/**
 * Saves `parameters` (the values that differ from ProSE's defaults) as a user preset. A user preset of
 * the same name is replaced. The switch parameters are left out: they are not preset settings.
 */
export function savePreset(
  name: string,
  parameters: Record<string, unknown>,
  storage: PresetStorage | null = browserStorage(),
): Preset {
  const values = copyValues(parameters)
  for (const s of SWITCH_PARAMETERS) delete values[s]
  const users = readUserPresets(storage)
  const existing = users.find((p) => p.name === name.trim())
  const preset: Preset = {
    id: existing?.id ?? `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(),
    parameters: values,
    builtin: false,
  }
  const next = existing ? users.map((p) => (p.id === preset.id ? preset : p)) : [...users, preset]
  storage?.setItem(PRESETS_KEY, JSON.stringify(next.map(({ builtin: _b, ...p }) => p)))
  return preset
}

/** The values of a preset: ProSE's defaults with the preset's parameters on top (copies). */
export function applyPreset(preset: Preset, defaults: Record<string, unknown>): Record<string, unknown> {
  return copyValues({ ...defaults, ...preset.parameters })
}
