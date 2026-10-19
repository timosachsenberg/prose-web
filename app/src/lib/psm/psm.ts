// The PSM view's logic, without the page: which fragment ions show (the ion, charge and loss
// toggles), the search settings the view takes (fragment tolerance, PeptDeep instrument and NCE), the
// peaks of a PSM's spectrum, the labels of the annotated peaks, the fragment ladder, the ion table and
// the numbers of the mass error plot and the features.
//
// The engine (`annotatePeaks`, `predictMS2`, see the OpenMS module's README) names ions "b3", "y5++",
// "y7-H2O", "[M+2H]++"; in ppm several ions can share a peak, so labels are grouped per peak.

import type {
  AnnotationOptions,
  PeakAnnotationResult,
  PeakMatch,
  ProSEFileSummary,
  ResultTables,
  StoredSpectra,
} from '../engine/openms-types'
import { peptideView } from '../format/peptide'
import { scanNumber } from '../results/display'

export type IonType = 'a' | 'b' | 'c' | 'x' | 'y' | 'z'
export const ION_TYPES: readonly IonType[] = ['a', 'b', 'c', 'x', 'y', 'z']
const N_TERMINAL = new Set(['a', 'b', 'c'])
export const isNTerminal = (type: string) => N_TERMINAL.has(type)

/**
 * The colours of the ion series: b and y as validated with the palette (b #2a78d6, y #eb6834); the
 * other series (a, c, x, z, the precursor) share a dark neutral, so that the chart keeps two hues and
 * their labels tell them apart; unmatched peaks are a light grey.
 */
export const COLORS = {
  b: '#2a78d6',
  y: '#eb6834',
  other: '#52525b',
  unmatched: '#a1a1aa',
  mod: '#1baf7a',
} as const

export function ionColor(type: string): string {
  return type === 'b' ? COLORS.b : type === 'y' ? COLORS.y : COLORS.other
}

/** The lower half of the mirror: PeptDeep's prediction or the theoretical spectrum. */
export type Bottom = 'peptdeep' | 'theoretical'

/**
 * The user's choices (kept by the view for all PSMs). `null` is automatic: 2+ fragments for precursors
 * of 3+, the neutral losses of the peptide's modifications, PeptDeep when the module has ONNX Runtime.
 */
export type PsmOptionState = {
  ions: IonType[]
  charges: number[] | null
  losses: string[] | null
  precursor: boolean
  bottom: Bottom | null
}

/** The choices for one PSM. `losses` holds formulas, and 'other' for the losses of no toggle of their own. */
export type PsmOptions = {
  ions: IonType[]
  charges: number[]
  losses: string[]
  precursor: boolean
  bottom: Bottom
}

export type Tolerance = { value: number; unit: 'ppm' | 'Da' }

const PROSE_DEFAULTS: Record<string, unknown> = {
  'fragment:mass_tolerance': 20,
  'fragment:mass_tolerance_unit': 'ppm',
  'peptdeep:instrument': 'QE',
}

/** A search parameter: the search's value, else the module's default, else ProSE's (as of 3.7). */
function parameter(name: string, parameters: Record<string, unknown>, defaults: Record<string, unknown> = {}): unknown {
  if (name in parameters) return parameters[name]
  if (name in defaults) return defaults[name]
  return PROSE_DEFAULTS[name]
}

/** The fragment tolerance of the search, which the annotation uses too (`fragment:mass_tolerance[_unit]`). */
export function fragmentTolerance(parameters: Record<string, unknown>, defaults?: Record<string, unknown>): Tolerance {
  const value = Number(parameter('fragment:mass_tolerance', parameters, defaults))
  const unit = parameter('fragment:mass_tolerance_unit', parameters, defaults) === 'Da' ? 'Da' : 'ppm'
  return { value: value > 0 ? value : 20, unit }
}

/** The PeptDeep instrument of the search (`peptdeep:instrument`), else "QE". */
export function instrumentOf(parameters: Record<string, unknown>, defaults?: Record<string, unknown>): string {
  const value = parameter('peptdeep:instrument', parameters, defaults)
  return typeof value === 'string' && value !== '' ? value : 'QE'
}

export type NceChoice = { nce: number; source: 'calibrated' | 'search' | 'spectrum' | 'default'; label: string }

/** The default NCE of the prediction when neither the search nor the spectrum has one. */
export const DEFAULT_NCE = 30

/**
 * The NCE of the prediction: what PeptDeep used for the PSM's file in the search (calibrated when
 * `peptdeep:nce` was automatic, the default -1), else the spectrum's collision energy, else 30.
 */
export function nceFor(file: ProSEFileSummary | undefined, collisionEnergy: number, parameters: Record<string, unknown>): NceChoice {
  const label = (nce: number, what: string) => `NCE ${Number(nce.toFixed(1))} (${what})`
  const searched = file?.peptdeepNce
  if (typeof searched === 'number' && Number.isFinite(searched) && searched > 0) {
    const set = Number(parameters['peptdeep:nce'])
    return Number.isFinite(set) && set > 0
      ? { nce: searched, source: 'search', label: label(searched, 'search setting') }
      : { nce: searched, source: 'calibrated', label: label(searched, 'calibrated') }
  }
  if (Number.isFinite(collisionEnergy) && collisionEnergy > 0) {
    return { nce: collisionEnergy, source: 'spectrum', label: label(collisionEnergy, 'from the spectrum') }
  }
  return { nce: DEFAULT_NCE, source: 'default', label: label(DEFAULT_NCE, 'default') }
}

/** What PeptDeep's predictMS2 takes (the module refuses other values with InvalidValue). */
export const PEPTDEEP_RANGE = { nce: [10, 60], charge: [1, 6] } as const

/**
 * Why PeptDeep cannot predict at this NCE and charge ("NCE 75 is outside PeptDeep's range 10–60"), or
 * null. A search can record or use an NCE outside the range (the file's collision energy).
 */
export function predictionRange(nce: number, charge: number): string | null {
  const [lowNce, highNce] = PEPTDEEP_RANGE.nce
  const [lowCharge, highCharge] = PEPTDEEP_RANGE.charge
  if (!(nce >= lowNce && nce <= highNce)) return `NCE ${Number(nce.toFixed(1))} is outside PeptDeep's range ${lowNce}–${highNce}`
  if (!(charge >= lowCharge && charge <= highCharge)) return `Charge ${charge} is outside PeptDeep's range ${lowCharge}–${highCharge}`
  return null
}

export type Peaks = {
  /** The spectrum's index in `StoredSpectra`. */
  index: number
  /** Views of the stored arrays (sorted by m/z). */
  mz: Float32Array
  intensity: Float32Array
  collisionEnergy: number
}

/** The peaks of the spectrum of PSM `row`, or null when the search did not keep them. */
export function spectrumPeaks(spectra: StoredSpectra, row: number): Peaks | null {
  const index = spectra.psmSpectrum?.[row] ?? -1
  if (!(index >= 0) || index + 1 >= spectra.offsets.length) return null
  const [from, to] = [spectra.offsets[index], spectra.offsets[index + 1]]
  return {
    index,
    mz: spectra.mz.subarray(from, to),
    intensity: spectra.intensity.subarray(from, to),
    collisionEnergy: spectra.collisionEnergy[index] ?? NaN,
  }
}

export type LossOption = { formula: string; label: string; note?: string; auto: boolean }

/** The neutral losses of modifications, by Unimod name and residue: on by default when the peptide has one. */
const MOD_LOSSES: { name: string; residues: string; formula: string; label: string; note: string; auto: boolean }[] = [
  { name: 'Oxidation', residues: 'M', formula: 'CH4OS', label: 'CH₄SO', note: 'oxidised M', auto: true },
  { name: 'Phospho', residues: 'STY', formula: 'H3PO4', label: 'H₃PO₄', note: 'phospho', auto: true },
  { name: 'Phospho', residues: 'STY', formula: 'HPO3', label: 'HPO₃', note: 'phospho', auto: false },
]

/**
 * The loss toggles of a peptide: water and ammonia, the losses of its modifications (`mods`: name
 * and residue), and "other" for any further loss the engine finds (e.g. of arginine's side chain).
 */
export function lossOptions(mods: { name: string; residue: string }[]): LossOption[] {
  const out: LossOption[] = [
    { formula: 'H2O', label: 'H₂O', auto: false },
    { formula: 'NH3', label: 'NH₃', auto: false },
  ]
  for (const loss of MOD_LOSSES) {
    if (out.some((o) => o.formula === loss.formula)) continue
    if (mods.some((m) => m.name === loss.name && loss.residues.includes(m.residue))) {
      out.push({ formula: loss.formula, label: loss.label, note: loss.note, auto: loss.auto })
    }
  }
  out.push({ formula: 'other', label: 'other', auto: false })
  return out
}

/**
 * The fragment charges a PSM of precursor `charge` can have in the view: 1+, and 2+ for precursors of
 * 2+ or more (as PeptDeep predicts them).
 */
export function fragmentCharges(charge: number): number[] {
  return charge >= 2 ? [1, 2] : [1]
}

/** The choices for a PSM of precursor `charge`, with its loss toggles, in a module with or without ONNX Runtime. */
export function resolveOptions(user: PsmOptionState, ctx: { charge: number; losses: LossOption[]; onnx: boolean }): PsmOptions {
  const offered = new Set(ctx.losses.map((l) => l.formula))
  const possible = fragmentCharges(ctx.charge)
  const charges = (user.charges ?? (ctx.charge >= 3 ? [1, 2] : [1])).filter((c) => possible.includes(c))
  return {
    ions: [...user.ions],
    charges: charges.length > 0 || user.charges?.length === 0 ? charges : [1],
    losses: user.losses ? user.losses.filter((l) => offered.has(l)) : ctx.losses.filter((l) => l.auto).map((l) => l.formula),
    precursor: user.precursor,
    bottom: ctx.onnx ? (user.bottom ?? 'peptdeep') : 'theoretical',
  }
}

/**
 * What the engine is asked for, for the fragment ions: the ion types shown, fragments up to 2+ when 2+
 * shows (as PeptDeep's prediction has them), losses when any loss shows, the search's tolerance. The
 * precursor is asked for apart (`precursorOptions`): the engine makes precursor peaks at `maxCharge` only.
 */
export function annotationOptions(o: PsmOptions, tolerance: Tolerance): NonNullable<AnnotationOptions> {
  return {
    tolerance: tolerance.value,
    unit: tolerance.unit,
    maxCharge: Math.max(1, ...o.charges.filter((c) => c <= 2)),
    ions: ION_TYPES.filter((t) => o.ions.includes(t)),
    losses: o.losses.length > 0,
    precursor: false,
  }
}

/** What the engine is asked for, for the precursor peaks: no fragment ions, the precursor at its own charge. */
export function precursorOptions(tolerance: Tolerance, charge: number): NonNullable<AnnotationOptions> {
  return { tolerance: tolerance.value, unit: tolerance.unit, maxCharge: Math.max(1, charge), ions: [], losses: true, precursor: true }
}

/** The fragment annotation with the precursor's matches and ions (of the separate precursor annotation) added. */
export function withPrecursor(fragments: PeakAnnotationResult, precursor: PeakAnnotationResult | null): PeakAnnotationResult {
  if (!precursor) return fragments
  const isPrecursor = (x: { type: string }) => x.type === 'precursor'
  const byMz = (p: { mz: number }, q: { mz: number }) => p.mz - q.mz
  return {
    matches: [...fragments.matches.filter((m) => !isPrecursor(m)), ...precursor.matches.filter(isPrecursor)].sort(
      (p, q) => p.theoreticalMz - q.theoreticalMz,
    ),
    theoretical: [...fragments.theoretical.filter((t) => !isPrecursor(t)), ...precursor.theoretical.filter(isPrecursor)].sort(byMz),
  }
}

const KNOWN_LOSSES = new Set(['H2O', 'NH3', ...MOD_LOSSES.map((l) => l.formula)])

function lossShown(loss: string, o: PsmOptions): boolean {
  if (loss === '') return true
  return o.losses.includes(KNOWN_LOSSES.has(loss) ? loss : 'other')
}

/** The matches the toggles show. */
export function visibleMatches(matches: PeakMatch[], o: PsmOptions): PeakMatch[] {
  return matches.filter((m) => {
    if (m.type === 'precursor') return o.precursor && lossShown(m.loss, o)
    return (o.ions as string[]).includes(m.type) && o.charges.includes(m.charge) && lossShown(m.loss, o)
  })
}

export type TheoreticalIon = { ion: string; type: string; ordinal: number; charge: number; mz: number }

/** The loss of a theoretical ion, from its name ("y7-H2O++" → "H2O"). */
export function lossOf(ion: string): string {
  if (ion.startsWith('[')) return /-([A-Za-z0-9]+)\]/.exec(ion)?.[1] ?? ''
  return /-([A-Za-z0-9]+)\+*$/.exec(ion)?.[1] ?? ''
}

/** The theoretical ions the toggles show. */
export function visibleTheoretical(ions: TheoreticalIon[], o: PsmOptions): TheoreticalIon[] {
  return ions.filter((t) => {
    if (t.type === 'precursor') return o.precursor && lossShown(lossOf(t.ion), o)
    return (o.ions as string[]).includes(t.type) && o.charges.includes(t.charge) && lossShown(lossOf(t.ion), o)
  })
}

const SUBSCRIPT: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' }
/** How a loss formula reads: subscripts, and CH₄SO as the loss of oxidised methionine is usually written. */
export function formulaLabel(formula: string): string {
  if (formula === 'CH4OS') return 'CH₄SO'
  return formula.replace(/\d/g, (d) => SUBSCRIPT[d])
}

/** An ion's label: its name with the loss in subscripts ("y7-H₂O++"). */
export function ionLabel(ion: string): string {
  if (ion.startsWith('[')) return ion
  return ion.replace(/-([A-Za-z0-9]+)(\+*)$/, (_, f: string, plus: string) => `-${formulaLabel(f)}${plus}`)
}

const TYPE_ORDER: Record<string, number> = { b: 0, y: 1, a: 2, c: 3, x: 4, z: 5, precursor: 6 }

function byImportance(p: PeakMatch, q: PeakMatch): number {
  return (
    (TYPE_ORDER[p.type] ?? 9) - (TYPE_ORDER[q.type] ?? 9) ||
    p.ordinal - q.ordinal ||
    p.charge - q.charge ||
    (p.loss === '' ? 0 : 1) - (q.loss === '' ? 0 : 1) ||
    p.ion.localeCompare(q.ion)
  )
}

/** The ions of one peak. */
export type PeakGroup = {
  peak: number
  mz: number
  intensity: number
  /** b, y first; the group's colour is that of its first ion. */
  matches: PeakMatch[]
  /** "y1 / y1-NH₃++ / z1++" */
  label: string
  type: string
}

/** The matches grouped by peak, by m/z: one label per peak (several ions can share one in ppm). */
export function groupByPeak(matches: PeakMatch[], mz: ArrayLike<number>, intensity: ArrayLike<number>): PeakGroup[] {
  const byPeak = new Map<number, PeakMatch[]>()
  for (const m of matches) {
    const list = byPeak.get(m.peak)
    if (list) list.push(m)
    else byPeak.set(m.peak, [m])
  }
  const groups: PeakGroup[] = []
  for (const [peak, list] of byPeak) {
    list.sort(byImportance)
    groups.push({
      peak,
      mz: mz[peak],
      intensity: intensity[peak],
      matches: list,
      label: list.map((m) => ionLabel(m.ion)).join(' / '),
      type: list[0].type,
    })
  }
  return groups.sort((p, q) => p.mz - q.mz || p.peak - q.peak)
}

/**
 * The fragment ladder: per cleavage (between residue i and i + 1), the series that explains it from
 * the N-terminus (`n`: b if matched, else a or c) and from the C-terminus (`c`: y, else x or z), or null.
 */
export function ladderCuts(matches: PeakMatch[], length: number): { n: (string | null)[]; c: (string | null)[] } {
  const cuts = Math.max(0, length - 1)
  const n: (string | null)[] = new Array(cuts).fill(null)
  const c: (string | null)[] = new Array(cuts).fill(null)
  const better = (old: string | null, type: string, best: string) => (old === best ? old : old === null || type === best ? type : old)
  for (const m of matches) {
    if (m.type === 'precursor') continue
    if (isNTerminal(m.type)) {
      const i = m.ordinal - 1
      if (i >= 0 && i < cuts) n[i] = better(n[i], m.type, 'b')
    } else {
      const i = length - 1 - m.ordinal
      if (i >= 0 && i < cuts) c[i] = better(c[i], m.type, 'y')
    }
  }
  return { n, c }
}

export type IonColumn = { type: IonType; charge: number; header: string }
export type IonCell = { ion: string; mz: number; matched: boolean }
export type IonTable = {
  /** The columns left of the residue (N-terminal ions) and right of it (C-terminal ions). */
  n: IonColumn[]
  c: IonColumn[]
  /** Per residue: the N-terminal ions of number i + 1 and the C-terminal ions of number length - i. */
  rows: { index: number; n: (IonCell | null)[]; c: (IonCell | null)[] }[]
}

const SUPERSCRIPT_CHARGE: Record<number, string> = { 1: '⁺', 2: '²⁺', 3: '³⁺', 4: '⁴⁺' }

/**
 * The ion table: the theoretical ions without losses of the types and charges shown, per residue, with
 * the ones that a match (without a loss) explains marked.
 */
export function ionTable(theoretical: TheoreticalIon[], matches: PeakMatch[], length: number, o: PsmOptions): IonTable {
  const charges = [...o.charges].sort((a, b) => a - b)
  const columns = (types: IonType[]) =>
    charges.flatMap((charge) => types.map((type) => ({ type, charge, header: `${type}${SUPERSCRIPT_CHARGE[charge] ?? `${charge}+`}` })))
  const n = columns(ION_TYPES.filter((t) => isNTerminal(t) && o.ions.includes(t)))
  const c = columns(ION_TYPES.filter((t) => !isNTerminal(t) && o.ions.includes(t)))
  const key = (type: string, ordinal: number, charge: number) => `${type}${ordinal}/${charge}`
  const mzOf = new Map<string, TheoreticalIon>()
  for (const t of theoretical) if (t.type !== 'precursor' && lossOf(t.ion) === '') mzOf.set(key(t.type, t.ordinal, t.charge), t)
  const matched = new Set(matches.filter((m) => m.loss === '').map((m) => key(m.type, m.ordinal, m.charge)))
  const cell = (col: IonColumn, ordinal: number): IonCell | null => {
    const t = mzOf.get(key(col.type, ordinal, col.charge))
    return t ? { ion: t.ion, mz: t.mz, matched: matched.has(key(col.type, ordinal, col.charge)) } : null
  }
  const rows = Array.from({ length }, (_, i) => ({
    index: i,
    n: n.map((col) => (i < length - 1 ? cell(col, i + 1) : null)),
    c: c.map((col) => (i > 0 ? cell(col, length - i) : null)),
  }))
  return { n, c, rows }
}

/** The mean and the (sample) standard deviation of the matches' errors in ppm; NaN where undefined. */
export function errorStats(matches: PeakMatch[]): { mean: number; sd: number; n: number } {
  const n = matches.length
  if (n === 0) return { mean: NaN, sd: NaN, n }
  const mean = matches.reduce((s, m) => s + m.errorPpm, 0) / n
  const sd = n < 2 ? NaN : Math.sqrt(matches.reduce((s, m) => s + (m.errorPpm - mean) ** 2, 0) / (n - 1))
  return { mean, sd, n }
}

/** The ions matched of those shown, and the share of the spectrum's intensity that their peaks carry. */
export function matchSummary(
  matches: PeakMatch[],
  theoretical: TheoreticalIon[],
  intensity: ArrayLike<number>,
): { matched: number; total: number; intensityFraction: number } {
  const ions = new Set(theoretical.map((t) => t.ion))
  const matched = new Set(matches.filter((m) => ions.has(m.ion)).map((m) => m.ion)).size
  let total = 0
  for (let i = 0; i < intensity.length; i++) total += intensity[i]
  const peaks = new Set(matches.map((m) => m.peak))
  let explained = 0
  for (const p of peaks) explained += intensity[p] ?? 0
  return { matched, total: ions.size, intensityFraction: total > 0 ? explained / total : NaN }
}

/**
 * The modifications of peptide `k`, with their sites: "Oxidation (M7)", "Acetyl (N-term)"; the fixed
 * ones (those the tables do not mark) after the others: "Carbamidomethyl (C2, fixed)".
 */
export function modificationList(t: ResultTables['peptides'], k: number, fixedMods: string[]): string[] {
  const view = peptideView(t, k, fixedMods)
  const sequence = t.sequence[k]
  const marked: string[] = []
  const fixed: string[] = []
  for (let i = t.modOffsets[k]; i < t.modOffsets[k + 1]; i++) {
    const position = t.modPosition[i]
    const name = t.modName[i]
    const atN = position < 0
    const atC = position >= sequence.length
    const site = atN ? 'N-term' : atC ? 'C-term' : `${sequence[position]}${position + 1}`
    const shown = atN ? view.nTerm?.name === name : atC ? view.cTerm?.name === name : view.residues[position]?.mod?.name === name
    if (shown) marked.push(`${name} (${site})`)
    else fixed.push(`${name} (${site}, fixed)`)
  }
  return [...marked, ...fixed]
}

/**
 * The similarity of the PSM's spectrum to PeptDeep's prediction that the search computed (its
 * features `ms2_cosine` and `ms2_spectral_angle`, over all ions), or null without them.
 */
export function similarityText(names: string[], features: Float64Array, row: number): string | null {
  const cosine = featureValue(names, features, row, 'ms2_cosine')
  const angle = featureValue(names, features, row, 'ms2_spectral_angle')
  const parts = [
    Number.isFinite(cosine) ? `cosine ${cosine.toFixed(3)}` : null,
    Number.isFinite(angle) ? `spectral angle ${angle.toFixed(3)}` : null,
  ].filter((p) => p !== null)
  return parts.length > 0 ? `${parts.join(' · ')} (search)` : null
}

/**
 * The 100 % of the observed half when it is compared with PeptDeep's prediction: the most intense
 * peak with a matched b or y ion of the types shown and without a neutral loss (PeptDeep predicts b
 * and y ions without losses and scales them to the strongest one), or null when there is none.
 */
export function matchedByReference(groups: { intensity: number; matches: PeakMatch[] }[], o: PsmOptions): number | null {
  let best = 0
  for (const g of groups) {
    const by = g.matches.some((m) => (m.type === 'b' || m.type === 'y') && m.loss === '' && (o.ions as string[]).includes(m.type))
    if (by && g.intensity > best) best = g.intensity
  }
  return best > 0 ? best : null
}

/** A feature of PSM `row` by name (`psms.featureNames`), or NaN if the search has none of that name. */
export function featureValue(names: string[], features: Float64Array, row: number, name: string): number {
  const j = names.indexOf(name)
  return j < 0 ? NaN : features[row * names.length + j]
}

/** The file name of an exported spectrum: the peptide and the scan ("AVM_Oxidation_DDFAAFVEK_scan21507.svg"). */
export function svgFileName(peptide: string, nativeId: string): string {
  const clean = (text: string) => text.replace(/[^A-Za-z0-9.-]+/g, '_').replace(/^[_.]+|[_.]+$/g, '')
  const scan = scanNumber(nativeId)
  const spectrum = scan === null ? clean(nativeId) : `scan${scan}`
  return `${clean(peptide) || 'spectrum'}_${spectrum || 'spectrum'}.svg`
}
