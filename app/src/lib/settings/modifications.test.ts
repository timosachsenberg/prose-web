import { describe, expect, it } from 'vitest'
import type { ParamEntry } from '../engine/protocol'
import { expandModification, groupModifications, parseModification, unknownModifications } from './modifications'

describe('modifications', () => {
  it('reads the name and the site', () => {
    expect(parseModification('Oxidation (M)')).toEqual({ name: 'Oxidation', residues: 'M', term: null })
    expect(parseModification('Phospho (STY)')).toEqual({ name: 'Phospho', residues: 'STY', term: null })
    expect(parseModification('Deamidated (NQ)')).toEqual({ name: 'Deamidated', residues: 'NQ', term: null })
    expect(parseModification('Acetyl (Protein N-term)')).toEqual({ name: 'Acetyl', residues: '', term: 'Protein N-term' })
    expect(parseModification('Gln->pyro-Glu (N-term Q)')).toEqual({ name: 'Gln->pyro-Glu', residues: 'Q', term: 'N-term' })
    expect(parseModification('Label:13C(6)15N(2) (K)')).toEqual({ name: 'Label:13C(6)15N(2)', residues: 'K', term: null })
    expect(parseModification('Amidated (C-term)')).toEqual({ name: 'Amidated', residues: '', term: 'C-term' })
    expect(parseModification('weird')).toBeNull()
  })

  it('expands several residues into one modification per residue, as ProSE names them', () => {
    expect(expandModification('Phospho (STY)')).toEqual(['Phospho (S)', 'Phospho (T)', 'Phospho (Y)'])
    expect(expandModification('Deamidated (NQ)')).toEqual(['Deamidated (N)', 'Deamidated (Q)'])
    expect(expandModification('Oxidation (M)')).toEqual(['Oxidation (M)'])
    expect(expandModification('Acetyl (Protein N-term)')).toEqual(['Acetyl (Protein N-term)'])
    expect(expandModification('Gln->pyro-Glu (N-term Q)')).toEqual(['Gln->pyro-Glu (N-term Q)'])
    expect(expandModification('  Phospho  (ST) ')).toEqual(['Phospho (S)', 'Phospho (T)'])
  })

  it('shows the residues of one modification together', () => {
    const groups = groupModifications([
      'Oxidation (M)',
      'Phospho (S)',
      'Acetyl (Protein N-term)',
      'Phospho (T)',
      'Deamidated (N)',
      'Phospho (Y)',
      'Deamidated (Q)',
    ])
    expect(groups).toEqual([
      { label: 'Oxidation (M)', specs: ['Oxidation (M)'] },
      { label: 'Phospho (STY)', specs: ['Phospho (S)', 'Phospho (T)', 'Phospho (Y)'] },
      { label: 'Acetyl (Protein N-term)', specs: ['Acetyl (Protein N-term)'] },
      { label: 'Deamidated (NQ)', specs: ['Deamidated (N)', 'Deamidated (Q)'] },
    ])
  })

  it('keeps terminal modifications apart from residue ones', () => {
    expect(groupModifications(['Acetyl (K)', 'Acetyl (N-term)', 'Acetyl (S)']).map((g) => g.label)).toEqual([
      'Acetyl (KS)',
      'Acetyl (N-term)',
    ])
    expect(groupModifications(['Gln->pyro-Glu (N-term Q)', 'Glu->pyro-Glu (N-term E)']).map((g) => g.label)).toEqual([
      'Gln->pyro-Glu (N-term Q)',
      'Glu->pyro-Glu (N-term E)',
    ])
  })
})

describe('unknownModifications', () => {
  it('lists the fixed and variable modifications that are not among ProSE\'s names', () => {
    const valid = ['Carbamidomethyl (C)', 'Oxidation (M)', 'Phospho (S)']
    const entries: ParamEntry[] = ['modifications:fixed', 'modifications:variable'].map((name) => ({
      name,
      value: [],
      type: 'string[]',
      description: '',
      tags: [],
      validStrings: valid,
    }))
    const values = {
      'modifications:fixed': ['Carbamidomethyl (C)'],
      'modifications:variable': ['Oxidation (M)', 'Phosho (S)', 'Foo (X)'],
    }
    expect(unknownModifications(values, entries)).toEqual(['Phosho (S)', 'Foo (X)'])
    expect(unknownModifications({ 'modifications:fixed': ['Carbamidomethyl (C)'] }, entries)).toEqual([])
    // without the definitions nothing can be checked
    expect(unknownModifications(values, [])).toEqual([])
  })
})
