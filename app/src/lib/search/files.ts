// What the New search page shows about its input files before the search: the spectrum count of an
// mzML (from its header) and the protein count of a FASTA. Neither reads a whole file into memory.

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

/** The entries of a FASTA file: the lines starting with ">". Read in chunks. */
export async function countProteins(file: Blob, chunkSize = CHUNK): Promise<number> {
  let count = 0
  let lineStart = true
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const bytes = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer())
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]
      if (lineStart && b === 0x3e) count++
      lineStart = b === 0x0a || b === 0x0d
    }
  }
  return count
}

/** Sizes for people, in decimal units: "312 MB", "1.9 GB", "6.5 MB". */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'kB', 'MB', 'GB', 'TB']
  const e = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3))
  const value = bytes / 1000 ** e
  return `${value < 10 && e > 1 ? value.toFixed(1) : Math.round(value)} ${units[e]}`
}
