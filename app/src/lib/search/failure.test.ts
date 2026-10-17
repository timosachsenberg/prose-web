import { describe, expect, it } from 'vitest'
import { describeFailure } from './failure'

const files = ['good.mzML', 'broken.mzML']
const parseError =
  'Parse Error: - due to that error of type Parse Error in: /src/openms/source/FORMAT/HANDLERS/XMLHandler.cpp@68-' +
  'void OpenMS::Internal::XMLHandler::fatalError(ActionMode, const std::string &, UInt, UInt) const'

describe('describeFailure', () => {
  it('names the file and stage of the last progress report and keeps the raw text as detail', () => {
    const f = describeFailure({ label: 'Searching broken.mzML (2 of 2)...', file: 1, files }, parseError)
    expect(f.context).toBe('While searching file 2 of 2 (broken.mzML)')
    expect(f.summary).toBe('Parse Error. The file may be incomplete or not valid mzML.')
    expect(f.detail).toBe(parseError)
  })

  it('says only the file for a one-file search', () => {
    const f = describeFailure({ label: 'Post-processing PSMs...', file: 0, files: ['run.mzML'] }, 'x')
    expect(f.context).toBe('While searching run.mzML')
  })

  it('names the steps outside the files', () => {
    const stage = (label: string) => describeFailure({ label, file: -1, files }, 'x').context
    expect(stage('Reading the files...')).toBe('While reading the files')
    expect(stage('Starting OpenMS...')).toBe('While starting OpenMS')
    expect(stage('Loading the PeptDeep models...')).toBe('While loading the PeptDeep models')
    expect(stage('Reading the spectra of the PSMs...')).toBe('While reading the spectra of the PSMs')
    expect(stage('Building fragment index...')).toBe('During “Building fragment index”')
    expect(stage('')).toBe('During the search')
  })

  it('keeps the app\'s own messages whole', () => {
    const trap =
      'OpenMS stopped while searching (RuntimeError: memory access out of bounds), most likely out of memory: ' +
      'a search can use at most the 4 GB a WebAssembly module can address. OpenMS was restarted.'
    const f = describeFailure({ label: 'Scoring peptide models against spectra...', file: 0, files }, trap)
    expect(f.summary).toBe(trap)
    expect(f.detail).toBeNull()
  })

  it('shortens OpenMS exceptions to their message', () => {
    const invalid =
      'InvalidValue: the value of FDR:PSM is out of range - due to that error of type InvalidValue in: /a.cpp@1-f()'
    const f = describeFailure({ label: 'Reading the files...', file: -1, files }, invalid)
    expect(f.summary).toBe('InvalidValue: the value of FDR:PSM is out of range.')
    expect(f.detail).toBe(invalid)
  })
})
