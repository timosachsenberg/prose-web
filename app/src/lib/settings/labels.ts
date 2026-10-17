// Labels for people of the allowed values of some ProSE parameters, the same on the page and in the
// "All parameters" dialog.

export const DECOY_LABELS: Readonly<Record<string, string>> = {
  auto: 'Use the database’s, else generate',
  generate: 'Generate',
  ignore: 'None (no FDR)',
}

export const INSTRUMENT_LABELS: Readonly<Record<string, string>> = {
  QE: 'Q Exactive / Orbitrap',
  Lumos: 'Orbitrap Lumos / Fusion',
  timsTOF: 'timsTOF',
  SciexTOF: 'SCIEX TOF',
  ThermoTOF: 'Thermo TOF (Astral)',
}

const LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  decoys: DECOY_LABELS,
  'peptdeep:instrument': INSTRUMENT_LABELS,
}

/** The label of an allowed value of `parameter` (the value itself where there is none). */
export function choiceLabel(parameter: string, value: string): string {
  return LABELS[parameter]?.[value] ?? value
}
