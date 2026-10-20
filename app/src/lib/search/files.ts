// What the New search page shows about its input files before the search: the spectrum count of an
// mzML (from its header) and the proteins and residues of a FASTA. Neither reads a whole file into memory.

/** The part of an mzML read for its spectrum list; the header before it is usually a few kB. */
const MZML_HEAD = 1 << 20
const CHUNK = 16 << 20

export const isMzML = (name: string) => /\.mzml$/i.test(name)
export const isFasta = (name: string) => /\.(fasta|fas|fa|faa)$/i.test(name)

/** The `count` of the mzML's `<spectrumList>` (all spectra, MS1 included), or null if it is not near the start. */
export async function countSpectra(file: Blob): Promise<number | null> {
  const head = await file.slice(0, MZML_HEAD).text()
  const match = /<spectrumList\b[^>]*?\bcount="(\d+)"/.exec(head)
  return match ? Number(match[1]) : null
}

/** What a FASTA holds: its entries and their residues. */
export type FastaCount = { proteins: number; residues: number }

/**
 * The entries of a FASTA file (the lines starting with ">") and their residues (the letters of the
 * other lines: a non-specific search's index grows with them). Read in chunks.
 */
export async function countFasta(file: Blob, chunkSize = CHUNK): Promise<FastaCount> {
  let proteins = 0
  let residues = 0
  let lineStart = true
  let header = false
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const bytes = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer())
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]
      if (lineStart && b === 0x3e) {
        proteins++
        header = true
      } else if (!header && ((b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a))) {
        residues++
      }
      lineStart = b === 0x0a || b === 0x0d
      if (lineStart) header = false
    }
  }
  return { proteins, residues }
}
