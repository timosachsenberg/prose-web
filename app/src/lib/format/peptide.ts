// Display of peptides and their modifications: a marked residue with a short label (option A of the
// modification-encoding mockup) or, by user setting, ProForma text.

import type { ResultTables } from '../engine/openms-types'

export type ModInfo = { label: string; name: string; unimod: number; mass: number }
export type Segment = { residue: string; mod?: ModInfo }
export type PeptideView = {
  nTerm?: ModInfo
  residues: Segment[]
  cTerm?: ModInfo
  /**
   * The ProForma string of the peptide, verbatim from the table (`peptides.proforma`). It always
   * writes every modification, fixed ones included, whereas `nTerm`, `residues` and `cTerm` leave
   * the fixed modifications unmarked. Exports, copy and the ProForma display mode use this string.
   */
  proforma: string
}

const shortLabels: Readonly<Record<string, string>> = {
  Oxidation: 'ox',
  Phospho: 'ph',
  Acetyl: 'ac',
  Deamidated: 'de',
  Methyl: 'me',
  Dimethyl: 'dm',
  GlyGly: 'gg',
  Carbamyl: 'cm',
  'Gln->pyro-Glu': 'pg',
  'Glu->pyro-Glu': 'pe',
  TMT6plex: 'tmt',
}

/** The short label of a modification ("Oxidation" is "ox"); unlisted ones get their first three letters, lower-cased. */
export function shortModLabel(name: string): string {
  return Object.hasOwn(shortLabels, name) ? shortLabels[name] : name.slice(0, 3).toLowerCase()
}

/** A modification's hover title: "Oxidation (Unimod:35) +15.9949". */
export function modTitle(mod: ModInfo): string {
  const unimod = mod.unimod > 0 ? ` (Unimod:${mod.unimod})` : ''
  const mass = `${mod.mass < 0 ? '-' : '+'}${Math.abs(mod.mass).toFixed(4)}`
  return `${mod.name}${unimod} ${mass}`
}

// A fixed modification as OpenMS names it: "Carbamidomethyl (C)", "TMT6plex (N-term)",
// "Acetyl (Protein N-term)", "Label:13C(6)15N(2) (K)"; without a site it applies anywhere.
// `residue` of a residue site may be several letters: "Phospho (STY)", "Deamidated (NQ)".
type Fixed = { name: string; site: 'any' | 'nTerm' | 'cTerm' | 'residue'; residue?: string }

// the name, then the site: residue letters, or [Protein ]N-term / C-term with an optional residue
const fixedSpec = /^(.*?)\s*\((?:(?:Protein\s+)?([NC])-term(?:\s+([A-Z]))?|([A-Z]+))\)$/

function parseFixed(spec: string): Fixed {
  const match = fixedSpec.exec(spec.trim())
  if (!match) return { name: spec.trim().toLowerCase(), site: 'any' }
  const name = match[1].toLowerCase()
  const [, , term, termResidue, residue] = match
  if (term === undefined) return residue.includes('X') ? { name, site: 'any' } : { name, site: 'residue', residue }
  return { name, site: term === 'N' ? 'nTerm' : 'cTerm', residue: termResidue === 'X' ? undefined : termResidue }
}

function isFixed(fixed: Fixed[], name: string, position: number, sequence: string): boolean {
  const lower = name.toLowerCase()
  const atN = position < 0
  const atC = position >= sequence.length
  return fixed.some((f) => {
    if (f.name !== lower) return false
    switch (f.site) {
      case 'any':
        return true
      case 'nTerm':
        return atN && (f.residue === undefined || sequence[0] === f.residue)
      case 'cTerm':
        return atC && (f.residue === undefined || sequence[sequence.length - 1] === f.residue)
      case 'residue':
        return !atN && !atC && f.residue!.includes(sequence[position])
    }
  })
}

/**
 * The marked-residue view of peptide `k`. Modifications that are fixed (`fixedMods` as the search
 * names them, "Carbamidomethyl (C)") are left unmarked; terminal modifications go to `nTerm`/`cTerm`.
 */
export function peptideView(t: ResultTables['peptides'], k: number, fixedMods: string[]): PeptideView {
  const sequence = t.sequence[k]
  const fixed = fixedMods.map(parseFixed)
  const residues: Segment[] = Array.from(sequence, (residue) => ({ residue }))
  const view: PeptideView = { residues, proforma: t.proforma[k] }
  for (let i = t.modOffsets[k]; i < t.modOffsets[k + 1]; ++i) {
    const position = t.modPosition[i]
    const name = t.modName[i]
    if (isFixed(fixed, name, position, sequence)) continue
    const mod: ModInfo = { label: shortModLabel(name), name, unimod: t.modUnimod[i], mass: t.modMass[i] }
    if (position < 0) view.nTerm = mod
    else if (position >= sequence.length) view.cTerm = mod
    else residues[position].mod = mod
  }
  return view
}
