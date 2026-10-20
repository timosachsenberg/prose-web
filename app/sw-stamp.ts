// The build's part of the service worker (public/sw.js): it names the worker's stores, lists the files
// it stores, and gives it a manifest to prove that what it stores is of its own build.
// - MODULE_ID: the content of public/openms (the module package, wasm32). The worker imports the module
//   as openms/openms.mjs?v=<MODULE_ID> (its wasm and models likewise) and the worker stores it in
//   openms-module-<MODULE_ID>, which a build of the app alone leaves in place.
// - MODULE64_ID: likewise the content of public/openms64 (the 64-bit module, without models: it uses
//   those of openms/), requested with ?v=<MODULE64_ID> and stored in openms64-module-<MODULE64_ID>.
// - BUILD_ID: the content of the whole build; the app's files are stored in prose-app-<BUILD_ID>.
//   index.html carries it too (<meta name="prose-build">): the page tells the worker its build.
// - SHELL: index.html and assets/, stored on installation; DATA: the example and fasta/, stored once
//   the app asks for them. The module (openms.mjs, openms.wasm) is stored when the page loads it, or on
//   the installation of an update; the PeptDeep models and the 64-bit module on first use.
// - MANIFEST: path → [size, SHA-256] of every file of the build (but sw.js), both modules included: the
//   worker stores a response only if its bytes are those of the manifest.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** The files below `dir` (relative paths with "/", sorted). */
function filesBelow(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name)
      if (statSync(path).isDirectory()) walk(path)
      else out.push(relative(dir, path).split(sep).join('/'))
    }
  }
  walk(dir)
  return out.sort()
}

/** 12 hex digits of the SHA-256 of the files' paths and contents. */
function contentId(dir: string, files: string[]): string {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file + '\0')
    hash.update(readFileSync(join(dir, file)))
  }
  return hash.digest('hex').slice(0, 12)
}

/** The id of a module package (public/openms, public/openms64). */
export function moduleId(openmsDir: string): string {
  return contentId(openmsDir, filesBelow(openmsDir))
}

/** The placeholder of the build id in index.html. */
export const BUILD_META = '<meta name="prose-build" content="__BUILD_ID__" />'

export type Manifest = Record<string, [number, string]>

/** The ids of the module packages: wasm32 (public/openms) and wasm64 (public/openms64). */
export type ModuleIds = { module: string; module64: string }

/**
 * Writes the ids, the lists and the manifest of the build in `outDir` into its sw.js (the template's
 * placeholders or an earlier stamp: each is one line `const NAME = …`).
 */
export function writeStamp(outDir: string, ids: { build: string } & ModuleIds): { shell: string[]; data: string[]; manifest: Manifest } {
  const swPath = join(outDir, 'sw.js')
  const files = filesBelow(outDir).filter((f) => f !== 'sw.js')
  const data = files.filter((f) => /^(example|fasta)\//.test(f))
  const shell = files.filter((f) => !/^(openms|openms64|example|fasta)\//.test(f))
  const manifest: Manifest = {}
  for (const f of files) {
    const bytes = readFileSync(join(outDir, f))
    manifest[f] = [bytes.length, createHash('sha256').update(bytes).digest('hex')]
  }
  const values: Record<string, string> = {
    BUILD_ID: `'${ids.build}'`,
    MODULE_ID: `'${ids.module}'`,
    MODULE64_ID: `'${ids.module64}'`,
    SHELL: JSON.stringify(shell),
    DATA: JSON.stringify(data),
    MANIFEST: JSON.stringify(manifest),
  }
  let sw = readFileSync(swPath, 'utf8')
  for (const [name, value] of Object.entries(values)) {
    const line = new RegExp(`^const ${name} = .*$`, 'm')
    if (!line.test(sw)) throw new Error(`${swPath}: no line "const ${name} = …"`)
    sw = sw.replace(line, () => `const ${name} = ${value}`)
  }
  if (/__(BUILD_ID|MODULE_ID|MODULE64_ID|SHELL|DATA|MANIFEST)__/.test(sw)) throw new Error(`${swPath}: a placeholder was not replaced`)
  writeFileSync(swPath, sw)
  return { shell, data, manifest }
}

/**
 * Stamps the build in `outDir` (a fresh one: sw.js still the template): index.html gets the build id,
 * sw.js the ids, lists and manifest. The build id is taken over the build, sw.js's template included,
 * with the placeholder still in index.html, so it is the same for the same sources; the manifest over
 * the stamped files.
 */
export function stampServiceWorker(outDir: string, modules: ModuleIds): { buildId: string; shell: string[]; data: string[] } {
  const pagePath = join(outDir, 'index.html')
  // (sw.js is still the template here: a new worker logic is a new build, with stores of its own)
  const buildId = contentId(outDir, filesBelow(outDir))
  const page = readFileSync(pagePath, 'utf8')
  if (!page.includes(BUILD_META)) throw new Error(`${pagePath}: no ${BUILD_META}`)
  writeFileSync(pagePath, page.replace(BUILD_META, BUILD_META.replace('__BUILD_ID__', buildId)))
  const { shell, data } = writeStamp(outDir, { build: buildId, ...modules })
  return { buildId, shell, data }
}
