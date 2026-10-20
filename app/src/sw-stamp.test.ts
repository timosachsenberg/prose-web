import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { moduleId, stampServiceWorker } from '../sw-stamp'

// The build's stamp of the service worker (sw-stamp.ts) on a miniature build: both module packages are
// in the manifest, neither is in the shell, and each has its id.

const template = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
let dir = ''

function build(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), 'prose-stamp-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

/** The value a stamped `const NAME = …` line holds. */
function stamped(sw: string, name: string): unknown {
  const line = new RegExp(`^const ${name} = (.*)$`, 'm').exec(sw)![1]
  return JSON.parse(line.replace(/^'(.*)'$/, '"$1"'))
}

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('stampServiceWorker', () => {
  it('puts both modules in the manifest and neither in the shell', () => {
    const out = build({
      'index.html': '<head><meta name="prose-build" content="__BUILD_ID__" /></head>',
      'assets/index-abc.js': 'app',
      'openms/openms.mjs': 'module',
      'openms/openms.wasm': 'wasm32',
      'openms/models/peptdeep_ms2_dynamic.onnx': 'model',
      'openms64/openms.mjs': 'module64',
      'openms64/openms.wasm': 'wasm64',
      'example/run.mzML': 'spectra',
      'fasta/crap.fasta': '>CON',
      'sw.js': template,
    })
    const ids = { module: moduleId(join(out, 'openms')), module64: moduleId(join(out, 'openms64')) }
    expect(ids.module).toMatch(/^[0-9a-f]{12}$/)
    expect(ids.module64).not.toBe(ids.module)
    const { buildId, shell, data } = stampServiceWorker(out, ids)
    const sw = readFileSync(join(out, 'sw.js'), 'utf8')
    expect(stamped(sw, 'BUILD_ID')).toBe(buildId)
    expect(stamped(sw, 'MODULE_ID')).toBe(ids.module)
    expect(stamped(sw, 'MODULE64_ID')).toBe(ids.module64)
    expect(shell).toEqual(['assets/index-abc.js', 'index.html'])
    expect(data).toEqual(['example/run.mzML', 'fasta/crap.fasta'])
    const manifest = stamped(sw, 'MANIFEST') as Record<string, [number, string]>
    expect(Object.keys(manifest)).toEqual(expect.arrayContaining(['openms/openms.wasm', 'openms64/openms.mjs', 'openms64/openms.wasm']))
    expect(manifest['openms64/openms.wasm'][0]).toBe(6)
    expect(manifest['openms64/openms.wasm'][1]).toMatch(/^[0-9a-f]{64}$/)
    expect(Object.keys(manifest)).not.toContain('sw.js')
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain(`content="${buildId}"`)
  })
})
