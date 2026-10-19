import { readFileSync } from 'node:fs'

// A small mzML of synthetic MS2 spectra of tryptic peptides of the example database, for the PSM
// view's tests: the example's spectra carry only b and y ions, so an `a` toggle could never show
// anything on them. These carry a, b and y ions (1+), and some carry noise peaks.

const residue: Record<string, number> = {
  G: 57.021464, A: 71.037114, S: 87.032028, P: 97.052764, V: 99.068414, T: 101.047679,
  C: 103.009185 + 57.021464, // carbamidomethyl, the fixed modification of the presets
  L: 113.084064, I: 113.084064, N: 114.042927, D: 115.026943, Q: 128.058578, K: 128.094963,
  E: 129.042593, M: 131.040485, H: 137.058912, F: 147.068414, R: 156.101111, Y: 163.063329, W: 186.079313,
}
const PROTON = 1.007276
const WATER = 18.010565
const CO = 27.994915
export const OXIDATION = 15.994915

export type SyntheticSpectrum = {
  sequence: string
  /** Extra mass by 0-based residue (e.g. { 0: OXIDATION }). */
  mods?: Record<number, number>
  charge: number
  /** Noise peaks to add (deterministic). */
  noise?: number
}

/** A pseudo-random number generator with a seed (the files are the same in every run). */
function random(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function residueMasses(spec: SyntheticSpectrum): number[] {
  return Array.from(spec.sequence, (aa, i) => {
    const m = residue[aa]
    if (m === undefined) throw new Error(`no mass for ${aa}`)
    return m + (spec.mods?.[i] ?? 0)
  })
}

/** The precursor m/z of a spectrum. */
export function precursorMz(spec: SyntheticSpectrum): number {
  const mass = residueMasses(spec).reduce((a, b) => a + b, 0) + WATER
  return (mass + spec.charge * PROTON) / spec.charge
}

/** The peaks of a spectrum: b2.., y1.., a2.. (1+), and the noise. Sorted by m/z. */
export function peaks(spec: SyntheticSpectrum, seed: number): { mz: number[]; intensity: number[] } {
  const masses = residueMasses(spec)
  const n = masses.length
  const rnd = random(seed)
  const out: [number, number][] = []
  let b = PROTON
  for (let i = 0; i < n - 1; i++) {
    b += masses[i]
    if (i >= 1) {
      out.push([b, 2000 + 5000 * rnd()])
      out.push([b - CO, 800 + 800 * rnd()]) // a ion
    }
  }
  let y = WATER + PROTON
  for (let i = n - 1; i > 0; i--) {
    y += masses[i]
    out.push([y, 4000 + 8000 * rnd()])
  }
  const top = precursorMz(spec) * spec.charge
  for (let k = 0; k < (spec.noise ?? 0); k++) out.push([100 + rnd() * (top - 100), 30 + 300 * rnd()])
  out.sort((p, q) => p[0] - q[0])
  return { mz: out.map((p) => p[0]), intensity: out.map((p) => p[1]) }
}

function base64(values: number[], type: 'f64' | 'f32'): string {
  const array = type === 'f64' ? new Float64Array(values) : new Float32Array(values)
  return Buffer.from(array.buffer).toString('base64')
}

/** The scan number of the spectrum at `index` in the file. */
export const scanOf = (index: number) => 1001 + index

function spectrumXml(spec: SyntheticSpectrum, index: number): string {
  const { mz, intensity } = peaks(spec, index + 1)
  const pmz = precursorMz(spec).toFixed(6)
  const m = base64(mz, 'f64')
  const i = base64(intensity, 'f32')
  return `<spectrum id="controllerType=0 controllerNumber=1 scan=${scanOf(index)}" index="${index}" defaultArrayLength="${mz.length}">
<cvParam cvRef="MS" accession="MS:1000127" name="centroid spectrum" />
<cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="2" />
<scanList count="1"><cvParam cvRef="MS" accession="MS:1000795" name="no combination" /><scan>
<cvParam cvRef="MS" accession="MS:1000016" name="scan start time" value="${(60 + index * 12).toFixed(1)}" unitAccession="UO:0000010" unitName="second" unitCvRef="UO" />
</scan></scanList>
<precursorList count="1"><precursor>
<isolationWindow><cvParam cvRef="MS" accession="MS:1000827" name="isolation window target m/z" value="${pmz}" unitAccession="MS:1000040" unitName="m/z" unitCvRef="MS" /></isolationWindow>
<selectedIonList count="1"><selectedIon>
<cvParam cvRef="MS" accession="MS:1000744" name="selected ion m/z" value="${pmz}" unitAccession="MS:1000040" unitName="m/z" unitCvRef="MS" />
<cvParam cvRef="MS" accession="MS:1000041" name="charge state" value="${spec.charge}" />
</selectedIon></selectedIonList>
<activation><cvParam cvRef="MS" accession="MS:1000422" name="beam-type collision-induced dissociation" /></activation>
</precursor></precursorList>
<binaryDataArrayList count="2">
<binaryDataArray encodedLength="${m.length}"><cvParam cvRef="MS" accession="MS:1000514" name="m/z array" unitAccession="MS:1000040" unitName="m/z" unitCvRef="MS" /><cvParam cvRef="MS" accession="MS:1000523" name="64-bit float" /><cvParam cvRef="MS" accession="MS:1000576" name="no compression" /><binary>${m}</binary></binaryDataArray>
<binaryDataArray encodedLength="${i.length}"><cvParam cvRef="MS" accession="MS:1000515" name="intensity array" unitAccession="MS:1000131" unitName="number of detector counts" unitCvRef="MS"/><cvParam cvRef="MS" accession="MS:1000521" name="32-bit float" /><cvParam cvRef="MS" accession="MS:1000576" name="no compression" /><binary>${i}</binary></binaryDataArray>
</binaryDataArrayList>
</spectrum>`
}

/** An mzML of the spectra, in order (spectrum k has scan `scanOf(k)`). */
export function syntheticMzML(spectra: SyntheticSpectrum[]): Buffer {
  const head = `<?xml version="1.0" encoding="ISO-8859-1"?>
<mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0">
<cvList count="2">
<cv id="MS" fullName="Proteomics Standards Initiative Mass Spectrometry Ontology" URI="https://raw.githubusercontent.com/HUPO-PSI/psi-ms-CV/master/psi-ms.obo"/>
<cv id="UO" fullName="Unit Ontology" URI="http://ontologies.berkeleybop.org/uo.obo"/>
</cvList>
<fileDescription><fileContent><cvParam cvRef="MS" accession="MS:1000580" name="MSn spectrum" /></fileContent></fileDescription>
<softwareList count="1"><software id="so" version=""><cvParam cvRef="MS" accession="MS:1000799" name="custom unreleased software tool" value="" /></software></softwareList>
<instrumentConfigurationList count="1"><instrumentConfiguration id="ic"><cvParam cvRef="MS" accession="MS:1000031" name="instrument model" /></instrumentConfiguration></instrumentConfigurationList>
<dataProcessingList count="1"><dataProcessing id="dp"><processingMethod order="0" softwareRef="so"><cvParam cvRef="MS" accession="MS:1000544" name="Conversion to mzML" /></processingMethod></dataProcessing></dataProcessingList>
<run id="synthetic" defaultInstrumentConfigurationRef="ic">
<spectrumList count="${spectra.length}" defaultDataProcessingRef="dp">
`
  return Buffer.from(`${head}${spectra.map(spectrumXml).join('\n')}\n</spectrumList></run></mzML>\n`, 'latin1')
}

/** The tryptic peptides (7–18 residues, no missed cleavage) of the example database, in order. */
export function examplePeptides(): string[] {
  const fasta = readFileSync('public/example/DatabaseSuitability_database.fasta', 'utf8')
  const proteins = fasta.split('>').slice(1).map((entry) => entry.split('\n').slice(1).join('').trim())
  const out: string[] = []
  for (const protein of proteins) {
    for (const piece of protein.split(/(?<=[KR])(?!P)/)) {
      if (piece.length >= 7 && piece.length <= 18 && /^[ACDEFGHIKLMNPQRSTVWY]+$/.test(piece) && !out.includes(piece)) out.push(piece)
    }
  }
  return out
}

/**
 * The spectra of the PSM view's tests: 40 peptides of the example database at 2+, then the first
 * peptide with an M once more with that M oxidised, then a peptide with 4,000 noise peaks, then a
 * peptide that starts with M, oxidised (an open search finds it by its y ions, with a mass shift).
 */
export function psmTestSpectra(): {
  spectra: SyntheticSpectrum[]
  oxidised: SyntheticSpectrum
  noisy: SyntheticSpectrum
  shifted: SyntheticSpectrum
} {
  const peptides = examplePeptides()
  const plain = peptides.slice(0, 40).map((sequence) => ({ sequence, charge: 2 }))
  const withM = peptides.find((p) => p.includes('M') && !p.startsWith('M'))!
  const oxidised: SyntheticSpectrum = { sequence: withM, mods: { [withM.indexOf('M')]: OXIDATION }, charge: 2 }
  const noisy: SyntheticSpectrum = { sequence: peptides[45], charge: 2, noise: 4000 }
  const startsWithM = peptides.find((p) => p.startsWith('M') && p.length >= 10)!
  const shifted: SyntheticSpectrum = { sequence: startsWithM, mods: { 0: OXIDATION }, charge: 2, noise: 60 }
  return { spectra: [...plain, oxidised, noisy, shifted], oxidised, noisy, shifted }
}
