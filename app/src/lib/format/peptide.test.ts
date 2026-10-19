import { describe, expect, it } from 'vitest'
import type { ResultTables } from '../engine/openms-types'
import { massShift, modTitle, peptideView, psmProforma, shortModLabel } from './peptide'

type Mod = { position: number; name: string; unimod: number; mass: number }
type PeptideSpec = { openms: string; proforma: string; sequence: string; mods: Mod[] }

/** A peptides table of the given peptides, laid out as the engine writes it. */
function table(...specs: PeptideSpec[]): ResultTables['peptides'] {
  const mods = specs.flatMap((s) => s.mods)
  const modOffsets = [0]
  for (const s of specs) modOffsets.push(modOffsets[modOffsets.length - 1] + s.mods.length)
  return {
    count: specs.length,
    openms: specs.map((s) => s.openms),
    proforma: specs.map((s) => s.proforma),
    sequence: specs.map((s) => s.sequence),
    decoy: new Uint8Array(specs.length),
    modOffsets: Uint32Array.from(modOffsets),
    modPosition: Int16Array.from(mods.map((m) => m.position)),
    modName: mods.map((m) => m.name),
    modUnimod: Int32Array.from(mods.map((m) => m.unimod)),
    modMass: Float64Array.from(mods.map((m) => m.mass)),
    proteinOffsets: new Uint32Array(specs.length + 1),
    protein: new Uint32Array(0),
    start: new Uint32Array(specs.length),
    end: new Uint32Array(specs.length),
  }
}

const oxidation: Mod = { position: 2, name: 'Oxidation', unimod: 35, mass: 15.9949 }
const carbamidomethyl = (position: number): Mod => ({ position, name: 'Carbamidomethyl', unimod: 4, mass: 57.0215 })

const met = { openms: 'AVM(Oxidation)DDFAAFVEK', proforma: 'AVM[Oxidation]DDFAAFVEK', sequence: 'AVMDDFAAFVEK', mods: [oxidation] }
const acetyl = {
  openms: '.(Acetyl)DAHKSEVAHR',
  proforma: '[Acetyl]-DAHKSEVAHR',
  sequence: 'DAHKSEVAHR',
  mods: [{ position: -1, name: 'Acetyl', unimod: 1, mass: 42.0106 }],
}
const cys = {
  openms: 'AC(Carbamidomethyl)DEFM(Oxidation)K',
  proforma: 'AC[Carbamidomethyl]DEFM[Oxidation]K',
  sequence: 'ACDEFMK',
  mods: [carbamidomethyl(1), { ...oxidation, position: 5 }],
}

describe('shortModLabel', () => {
  it('uses the fixed table and falls back to three letters', () => {
    expect(shortModLabel('Oxidation')).toBe('ox')
    expect(shortModLabel('Phospho')).toBe('ph')
    expect(shortModLabel('Gln->pyro-Glu')).toBe('pg')
    expect(shortModLabel('Hex')).toBe('hex')
  })

  it('knows the other common modifications', () => {
    const expected: Record<string, string> = {
      Acetyl: 'ac',
      Deamidated: 'de',
      Methyl: 'me',
      Dimethyl: 'dm',
      GlyGly: 'gg',
      Carbamyl: 'cm',
      'Glu->pyro-Glu': 'pe',
      TMT6plex: 'tmt',
    }
    for (const [name, label] of Object.entries(expected)) expect(shortModLabel(name)).toBe(label)
  })

  it('lower-cases the first three letters of the rest', () => {
    expect(shortModLabel('Carbamidomethyl')).toBe('car')
    expect(shortModLabel('Na')).toBe('na')
  })
})

describe('peptideView', () => {
  it('marks variable, not fixed, modifications', () => {
    const view = peptideView(table(cys, met), 1, ['Carbamidomethyl (C)'])
    expect(view.residues.map((r) => r.residue).join('')).toBe('AVMDDFAAFVEK')
    expect(view.residues[2].mod).toEqual({ label: 'ox', name: 'Oxidation', unimod: 35, mass: 15.9949 })
    expect(view.residues.filter((r) => r.mod)).toHaveLength(1)
    expect(view.proforma).toBe('AVM[Oxidation]DDFAAFVEK')
    expect(view.nTerm).toBeUndefined()
    expect(view.cTerm).toBeUndefined()

    // peptide 0 has a fixed carbamidomethyl-C next to a variable oxidation
    const withFixed = peptideView(table(cys, met), 0, ['Carbamidomethyl (C)'])
    expect(withFixed.residues[1].mod).toBeUndefined()
    expect(withFixed.residues[5].mod?.label).toBe('ox')
    expect(withFixed.proforma).toBe('AC[Carbamidomethyl]DEFM[Oxidation]K') // verbatim: ProForma keeps fixed mods
  })

  it('marks a modification that is only fixed on another residue', () => {
    const view = peptideView(table(cys), 0, ['Carbamidomethyl (K)'])
    expect(view.residues[1].mod?.label).toBe('car')
  })

  it('marks every modification when nothing is fixed', () => {
    const view = peptideView(table(cys), 0, [])
    expect(view.residues.filter((r) => r.mod).map((r) => r.residue)).toEqual(['C', 'M'])
  })

  it('shows N-terminal acetylation', () => {
    const view = peptideView(table(acetyl), 0, ['Carbamidomethyl (C)'])
    expect(view.nTerm?.label).toBe('ac')
    expect(view.nTerm?.name).toBe('Acetyl')
    expect(view.residues.every((r) => r.mod === undefined)).toBe(true)
    expect(view.cTerm).toBeUndefined()
    expect(view.proforma).toBe('[Acetyl]-DAHKSEVAHR')
  })

  it('shows C-terminal modifications', () => {
    const amidated = {
      openms: 'PEPTIDEK.(Amidated)',
      proforma: 'PEPTIDEK-[Amidated]',
      sequence: 'PEPTIDEK',
      mods: [{ position: 8, name: 'Amidated', unimod: 2, mass: -0.9840 }],
    }
    const view = peptideView(table(amidated), 0, [])
    expect(view.cTerm).toMatchObject({ label: 'ami', unimod: 2 })
    expect(view.nTerm).toBeUndefined()
  })

  it('reads the modifications of the right peptide', () => {
    const t = table(met, acetyl, cys)
    expect(peptideView(t, 0, []).residues[2].mod?.name).toBe('Oxidation')
    expect(peptideView(t, 1, []).nTerm?.name).toBe('Acetyl')
    expect(peptideView(t, 2, []).residues[1].mod?.name).toBe('Carbamidomethyl')
  })

  it('treats fixed terminal modifications as fixed', () => {
    const tmt = {
      openms: '.(TMT6plex)PEPK(TMT6plex)',
      proforma: '[TMT6plex]-PEPK[TMT6plex]',
      sequence: 'PEPK',
      mods: [
        { position: -1, name: 'TMT6plex', unimod: 737, mass: 229.1629 },
        { position: 3, name: 'TMT6plex', unimod: 737, mass: 229.1629 },
      ],
    }
    const fixed = ['TMT6plex (N-term)', 'TMT6plex (K)']
    const view = peptideView(table(tmt), 0, fixed)
    expect(view.nTerm).toBeUndefined()
    expect(view.residues[3].mod).toBeUndefined()
    // only the lysine is fixed: the N-terminal label stays
    expect(peptideView(table(tmt), 0, ['TMT6plex (K)']).nTerm?.label).toBe('tmt')
  })

  it('reads fixed modifications whose names contain parentheses', () => {
    const silac = {
      openms: 'PEPK(Label:13C(6)15N(2))',
      proforma: 'PEPK[Label:13C(6)15N(2)]',
      sequence: 'PEPK',
      mods: [{ position: 3, name: 'Label:13C(6)15N(2)', unimod: 259, mass: 8.0142 }],
    }
    expect(peptideView(table(silac), 0, ['Label:13C(6)15N(2) (K)']).residues[3].mod).toBeUndefined()
    expect(peptideView(table(silac), 0, ['Label:13C(6)15N(2) (R)']).residues[3].mod?.label).toBe('lab')
    // without a site the whole text is the name
    expect(peptideView(table(silac), 0, ['Label:13C(6)15N(2)']).residues[3].mod).toBeUndefined()
  })

  it('treats a protein N-terminal fixed modification as an N-terminal one', () => {
    const view = peptideView(table(acetyl), 0, ['Acetyl (Protein N-term)'])
    expect(view.nTerm).toBeUndefined()
  })

  it('matches a fixed modification without a site on any residue', () => {
    expect(peptideView(table(cys), 0, ['Carbamidomethyl']).residues[1].mod).toBeUndefined()
  })

  it('reads fixed modifications on several residues', () => {
    const deamidated = (position: number): Mod => ({ position, name: 'Deamidated', unimod: 7, mass: 0.984 })
    const nq = {
      openms: 'PN(Deamidated)Q(Deamidated)R',
      proforma: 'PN[Deamidated]Q[Deamidated]R',
      sequence: 'PNQR',
      mods: [deamidated(1), deamidated(2)],
    }
    const view = peptideView(table(nq), 0, ['Deamidated (NQ)'])
    expect(view.residues[1].mod).toBeUndefined()
    expect(view.residues[2].mod).toBeUndefined()
    // only N is fixed: the deamidated Q stays marked
    expect(peptideView(table(nq), 0, ['Deamidated (N)']).residues[2].mod?.label).toBe('de')
    const phospho = {
      openms: 'S(Phospho)T(Phospho)Y(Phospho)K',
      proforma: 'S[Phospho]T[Phospho]Y[Phospho]K',
      sequence: 'STYK',
      mods: [0, 1, 2].map((position) => ({ position, name: 'Phospho', unimod: 21, mass: 79.9663 })),
    }
    const sty = peptideView(table(phospho), 0, ['Phospho (STY)'])
    expect(sty.residues.slice(0, 3).map((r) => r.mod)).toEqual([undefined, undefined, undefined])
    expect(peptideView(table(phospho), 0, ['Phospho (ST)']).residues[2].mod?.label).toBe('ph')
  })
})

describe('modTitle', () => {
  it('reads name, Unimod accession and delta mass', () => {
    expect(modTitle({ label: 'ox', name: 'Oxidation', unimod: 35, mass: 15.9949 })).toBe('Oxidation (Unimod:35) +15.9949')
    expect(modTitle({ label: 'ami', name: 'Amidated', unimod: 2, mass: -0.984016 })).toBe('Amidated (Unimod:2) −0.9840')
  })

  it('leaves the accession out when the modification has none', () => {
    expect(modTitle({ label: 'xyz', name: 'Xyz', unimod: 0, mass: 1 })).toBe('Xyz +1.0000')
  })
})

describe('massShift', () => {
  it('shows a signed shift with four decimals only above 0.05 Da', () => {
    expect(massShift(15.994915)).toBe('+15.9949')
    expect(massShift(-57.021464)).toBe('-57.0215')
    expect(massShift(0.0501)).toBe('+0.0501')
    expect(massShift(0.05)).toBeNull()
    expect(massShift(-0.03)).toBeNull()
    expect(massShift(NaN)).toBeNull()
    expect(psmProforma('PEPM[Oxidation]K', 79.96633)).toBe('[+79.9663]?PEPM[Oxidation]K')
    expect(psmProforma('PEPK', NaN)).toBe('PEPK')
  })
})
