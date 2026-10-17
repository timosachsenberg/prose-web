import { expect, test } from '@playwright/test'

// The real engine worker in the browser (the production build): the module loads with threads on the
// cross-origin isolated page, searches the example, annotates a PSM in the viewer worker and exports
// idXML. The page exposes an EngineClient as window.proseEngine with ?debug=engine.

/** What the test uses of EngineClient (the app's types are not visible to the e2e project). */
interface Engine {
  init(threads: number): Promise<{ threads: number; threaded: boolean; isolated: boolean; onnx: boolean; parameters: unknown[] }>
  search(
    request: unknown,
    onProgress: (p: { label: string; file: number; fraction: number }) => void,
  ): Promise<{
    summary: { files: { ms2Spectra: number; targetPSMs: number }[] }
    tables: {
      psms: { count: number; peptide: Uint32Array; charge: Int8Array }
      peptides: { openms: string[] }
      proteins: { accession: string[] }
    }
    spectra: { psmSpectrum: Int32Array; offsets: Uint32Array; mz: Float32Array; intensity: Float32Array }
  }>
  annotate(mz: Float32Array, intensity: Float32Array, peptide: string, charge: number, options: null): Promise<{ matches: unknown[] }>
  idXML(): Promise<Uint8Array>
}

test('the engine worker searches the example', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('./?debug=engine')
  await page.waitForFunction(() => 'proseEngine' in window)

  const result = await page.evaluate(async () => {
    const engine = (window as unknown as { proseEngine: Engine }).proseEngine
    const info = await engine.init(2)
    const file = async (path: string, name: string) => new File([await (await fetch(path)).blob()], name)
    const progress: { label: string; file: number; fraction: number }[] = []
    const outcome = await engine.search(
      {
        files: [{ id: 'run', file: await file('example/DatabaseSuitability_in_spec.mzML', 'run.mzML') }],
        database: await file('example/DatabaseSuitability_database.fasta', 'db.fasta'),
        contaminants: true,
        parameters: {},
        rescore: false,
        peptdeep: false,
      },
      (p) => progress.push(p),
    )
    const { tables, spectra } = outcome
    const row = spectra.psmSpectrum.findIndex((s) => s >= 0)
    const s = spectra.psmSpectrum[row]
    const [from, to] = [spectra.offsets[s], spectra.offsets[s + 1]]
    const peptide = tables.peptides.openms[tables.psms.peptide[row]]
    const [mz, intensity] = [spectra.mz.subarray(from, to), spectra.intensity.subarray(from, to)]
    const annotation = await engine.annotate(mz, intensity, peptide, tables.psms.charge[row], null)
    const xml = await engine.idXML()
    return {
      info: { ...info, parameters: info.parameters.length },
      files: outcome.summary.files,
      psms: tables.psms.count,
      contaminants: tables.proteins.accession.filter((a) => a.startsWith('CON__')).length,
      last: progress.at(-1),
      peaksKept: spectra.mz.length > 0,
      matches: annotation.matches.length,
      xmlStart: new TextDecoder().decode(xml.subarray(0, 5)),
    }
  })

  expect(result.info).toMatchObject({ threads: 2, threaded: true, isolated: true, onnx: true })
  expect(result.info.parameters).toBeGreaterThan(50)
  expect(result.files).toHaveLength(1)
  expect(result.files[0].ms2Spectra).toBe(2789)
  expect(result.psms).toBeGreaterThan(800)
  expect(result.contaminants).toBeGreaterThan(0)
  expect(result.last).toEqual({ label: 'Reading the spectra of the PSMs...', file: -1, fraction: 1 })
  expect(result.peaksKept).toBe(true)
  expect(result.matches).toBeGreaterThan(3)
  expect(result.xmlStart).toBe('<?xml')
})
