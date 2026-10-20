import { describe, expect, it } from 'vitest'
import { describeFailure } from './failure'

const files = ['good.mzML', 'broken.mzML']
const stalled = 10_000
const parseError =
  'Parse Error: - due to that error of type Parse Error in: /src/openms/source/FORMAT/HANDLERS/XMLHandler.cpp@68-' +
  'void OpenMS::Internal::XMLHandler::fatalError(ActionMode, const std::string &, UInt, UInt) const'

describe('describeFailure', () => {
  it('names the file and stage of the last progress report and keeps the raw text as detail', () => {
    const f = describeFailure({ label: 'Filtering spectra...', file: 1, files, silentMs: 10 }, parseError)
    expect(f.context).toBe('While searching file 2 of 2 (broken.mzML)')
    expect(f.summary).toBe('Parse Error. The file may be incomplete or not valid mzML.')
    expect(f.detail).toBe(parseError)
  })

  it('says only the file for a one-file search', () => {
    const f = describeFailure({ label: 'Post-processing PSMs...', file: 0, files: ['run.mzML'], silentMs: 0 }, 'x')
    expect(f.context).toBe('While searching run.mzML')
  })

  it('names the steps outside the files', () => {
    const stage = (label: string) => describeFailure({ label, file: -1, files, silentMs: 0 }, 'x').context
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
      'a search can use at most the 4 GB of the standard 32-bit engine. OpenMS was restarted.'
    const f = describeFailure({ label: 'Scoring peptide models against spectra...', file: 0, files, silentMs: 0 }, trap)
    expect(f.summary).toBe(trap)
    expect(f.detail).toBeNull()
  })

  it('shortens OpenMS exceptions to their message', () => {
    const invalid =
      'InvalidValue: the value of FDR:PSM is out of range - due to that error of type InvalidValue in: /a.cpp@1-f()'
    const f = describeFailure({ label: 'Reading the files...', file: -1, files, silentMs: 0 }, invalid)
    expect(f.summary).toBe('InvalidValue: the value of FDR:PSM is out of range.')
    expect(f.detail).toBe(invalid)
  })

  it('does not blame a file for the check after all files: partial rescoring by Percolator', () => {
    // reproduced: small.mzML (12 spectra) then good.mzML; Percolator reports no progress, and the check
    // comes after the step of the last file ended
    const partial =
      'Percolator could rescore only some of the files, and their scores cannot be pooled with the others ' +
      '(not rescored: small.mzML (Only 3 PSMs, Percolator rescoring needs at least 100.)). Switch Percolator off, ' +
      'or leave out the files it could not rescore.'
    const stage = { label: 'Searching good.mzML (2 of 2)...', file: 1, files: ['small.mzML', 'good.mzML'], silentMs: 0 }
    const f = describeFailure(stage, partial)
    expect(f.context).toBe('While rescoring with Percolator')
    expect(f.summary).toBe(partial)
    expect(f.context).not.toContain('good.mzML')
  })

  it('names the file whose step ended last: its end report comes before its own error', () => {
    // reproduced: good.mzML then broken.mzML; ProSE ends the step of broken.mzML (0.95), then throws
    const f = describeFailure({ label: 'Searching broken.mzML (2 of 2)...', file: 1, files, silentMs: 0 }, parseError)
    expect(f.context).toBe('While searching file 2 of 2 (broken.mzML)')
  })

  it('does not name a stage for a step without progress reports (Percolator), only its file', () => {
    const f = describeFailure({ label: 'Post-processing PSMs...', file: 1, files, silentMs: stalled }, 'x')
    expect(f.context).toBe('While searching file 2 of 2 (broken.mzML), in a step without progress reports (e.g. Percolator)')
  })

  it('cleans up OpenMS exceptions without a location', () => {
    const fasta = 'Parse Error: Error while parsing FASTA file! The first entry could not be read! Please check the file! in: '
    const f = describeFailure({ label: 'Generate decoys...', file: 0, files, silentMs: 0 }, fasta)
    expect(f.summary).toBe('Parse Error: Error while parsing FASTA file! The first entry could not be read! Please check the file!')
    expect(f.summary).not.toMatch(/in:/)
    expect(f.detail).toBe(fasta)
    // an ordinary "in:" inside a message stays
    expect(describeFailure({ label: '', file: -1, files, silentMs: 0 }, 'No PSMs in: the run').summary).toBe('No PSMs in: the run')
  })
})
