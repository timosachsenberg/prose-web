import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CRAP_PROTEINS, CRAP_RESIDUES } from './form.svelte'
import { countFasta, countSpectra, isFasta, isMzML } from './files'

describe('files', () => {
  it('reads the spectrum count from the spectrum list of an mzML', async () => {
    const mzml = '<?xml version="1.0"?>\n<indexedmzML><mzML><run id="r">\n<spectrumList count="2789" defaultDataProcessingRef="dp">'
    expect(await countSpectra(new Blob([mzml, '<spectrum/>'.repeat(10)]))).toBe(2789)
    expect(await countSpectra(new Blob(['<mzML><run/></mzML>']))).toBeNull()
  })

  it('counts the entries of a FASTA and their residues, across chunk boundaries', async () => {
    // the residues: the letters of the sequence lines (not of the headers, not ">" inside a line)
    const fasta = '>sp|P1|A first\nPEPTIDEK\n>sp|P2|B\nAAAA>notanentry\n\n>sp|P3|C\nK\n'
    expect(await countFasta(new Blob([fasta]))).toEqual({ proteins: 3, residues: 8 + 4 + 10 + 1 })
    for (const chunk of [1, 2, 3, 7]) expect(await countFasta(new Blob([fasta]), chunk)).toEqual({ proteins: 3, residues: 23 })
    expect(await countFasta(new Blob(['\r\n>a\r\nK\r\n>b\r\nKR']))).toEqual({ proteins: 2, residues: 3 })
    expect(await countFasta(new Blob([]))).toEqual({ proteins: 0, residues: 0 })
  })

  it('knows the bundled cRAP database', async () => {
    const crap = readFileSync(new URL('../../../public/fasta/crap.fasta', import.meta.url))
    expect(await countFasta(new Blob([crap]))).toEqual({ proteins: CRAP_PROTEINS, residues: CRAP_RESIDUES })
  })

  it('recognises the file types by extension', () => {
    expect(isMzML('run.mzML')).toBe(true)
    expect(isMzML('RUN.MZML')).toBe(true)
    expect(isMzML('run.raw')).toBe(false)
    expect(isFasta('db.fasta')).toBe(true)
    expect(isFasta('db.fa')).toBe(true)
    expect(isFasta('db.faa')).toBe(true)
    expect(isFasta('db.txt')).toBe(false)
  })
})
