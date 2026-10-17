import { describe, expect, it } from 'vitest'
import { countProteins, countSpectra, isFasta, isMzML } from './files'

describe('files', () => {
  it('reads the spectrum count from the spectrum list of an mzML', async () => {
    const mzml = '<?xml version="1.0"?>\n<indexedmzML><mzML><run id="r">\n<spectrumList count="2789" defaultDataProcessingRef="dp">'
    expect(await countSpectra(new Blob([mzml, '<spectrum/>'.repeat(10)]))).toBe(2789)
    expect(await countSpectra(new Blob(['<mzML><run/></mzML>']))).toBeNull()
  })

  it('counts the entries of a FASTA, across chunk boundaries', async () => {
    const fasta = '>sp|P1|A first\nPEPTIDEK\n>sp|P2|B\nAAAA>notanentry\n\n>sp|P3|C\nK\n'
    expect(await countProteins(new Blob([fasta]))).toBe(3)
    for (const chunk of [1, 2, 3, 7]) expect(await countProteins(new Blob([fasta]), chunk)).toBe(3)
    expect(await countProteins(new Blob(['\r\n>a\r\nK\r\n>b\r\nK']))).toBe(2)
    expect(await countProteins(new Blob([]))).toBe(0)
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
