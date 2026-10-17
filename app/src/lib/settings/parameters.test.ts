import { describe, expect, it } from 'vitest'
import type { ParamEntry } from '../engine/protocol'
import {
  changedParameters,
  defaultsOf,
  dialogEntries,
  parameterSections,
  requestParameters,
  sameValue,
} from './parameters'

const entry = (name: string, value: ParamEntry['value'], more: Partial<ParamEntry> = {}): ParamEntry => ({
  name,
  value,
  type: typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'double' : Array.isArray(value) ? 'string[]' : 'string',
  description: '',
  tags: [],
  ...more,
})

const entries: ParamEntry[] = [
  entry('enzyme', 'Trypsin'),
  entry('rescore', true),
  entry('precursor:mass_tolerance_lower', 10),
  entry('precursor:max_charge', 5, { type: 'int' }),
  entry('modifications:fixed', ['Carbamidomethyl (C)']),
  entry('peptdeep:enable', false),
  entry('peptdeep:ms2_model', 'models/peptdeep_ms2_dynamic.onnx'),
  entry('peptdeep:rt_model', 'models/peptdeep_rt_dynamic.onnx'),
  entry('peptdeep:instrument', 'QE'),
  entry('peptdeep:nce', -1),
  entry('peptdeep:batch_size', 500, { type: 'int', tags: ['advanced'] }),
  entry('database:chunk_size', 0, { type: 'int' }),
]

describe('parameters', () => {
  it('leaves the parameters of the Rescoring card out of the dialog', () => {
    expect(dialogEntries(entries).map((e) => e.name)).toEqual([
      'enzyme',
      'precursor:mass_tolerance_lower',
      'precursor:max_charge',
      'modifications:fixed',
      'peptdeep:nce',
      'peptdeep:batch_size',
      'database:chunk_size',
    ])
  })

  it('groups the dialog by section, general first', () => {
    const sections = parameterSections(dialogEntries(entries))
    expect(sections.map((s) => s.name)).toEqual(['general', 'precursor', 'modifications', 'peptdeep', 'database'])
    expect(sections[3].entries.map((e) => e.name)).toEqual(['peptdeep:nce', 'peptdeep:batch_size'])
  })

  it('compares values, arrays by their items', () => {
    expect(sameValue(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameValue(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(sameValue(10, 10)).toBe(true)
    expect(sameValue(10, '10')).toBe(false)
    const defaults = defaultsOf(entries)
    expect(defaults['modifications:fixed']).toEqual(['Carbamidomethyl (C)'])
    expect(changedParameters({ ...defaults, 'modifications:fixed': ['Carbamidomethyl (C)'] }, defaults)).toEqual({})
  })

  it('sends the changed parameters, without those the switches set', () => {
    const defaults = defaultsOf(entries)
    const values = { ...defaults, enzyme: 'Lys-C', rescore: false, 'peptdeep:enable': true, 'peptdeep:instrument': 'timsTOF' }
    expect(requestParameters(values, defaults)).toEqual({ enzyme: 'Lys-C', 'peptdeep:instrument': 'timsTOF' })
  })
})
