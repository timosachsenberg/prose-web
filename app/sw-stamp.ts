// The build's part of the service worker (public/sw.js): it names the worker's stores and lists the
// files it stores on installation.
// - MODULE_ID: the content of public/openms (the module package). The worker imports the module as
//   openms/openms.mjs?v=<MODULE_ID> (a new module never meets an old one from the HTTP cache) and the
//   worker stores it in openms-module-<MODULE_ID>, which a build of the app alone leaves in place.
// - BUILD_ID: the content of the whole build; the app's files are stored in prose-app-<BUILD_ID>.
//   index.html carries it too (<meta name="prose-build">): the worker stores only a page of its build.
// - SHELL: index.html and assets/, stored on installation; DATA: the example and fasta/, stored once
//   the app asks for them. Not the module (stored when the page loads it) nor the PeptDeep models
//   (stored on first use).

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

/** The id of the module package (public/openms). */
export function moduleId(openmsDir: string): string {
  return contentId(openmsDir, filesBelow(openmsDir))
}

/** The placeholder of the build id in index.html. */
export const BUILD_META = '<meta name="prose-build" content="__BUILD_ID__" />'

/**
 * Stamps `<outDir>/sw.js` (its ids and lists) and `<outDir>/index.html` (the build id). The build id
 * is taken over the build with the placeholder still in index.html, so it is the same for the same
 * sources.
 */
export function stampServiceWorker(outDir: string, module: string): { buildId: string; shell: string[]; data: string[] } {
  const swPath = join(outDir, 'sw.js')
  const pagePath = join(outDir, 'index.html')
  const files = filesBelow(outDir).filter((f) => f !== 'sw.js')
  const buildId = contentId(outDir, files)
  const data = files.filter((f) => /^(example|fasta)\//.test(f))
  const shell = files.filter((f) => !/^(openms|example|fasta)\//.test(f))
  const stamped = readFileSync(swPath, 'utf8')
    .replace("const BUILD_ID = '__BUILD_ID__'", `const BUILD_ID = '${buildId}'`)
    .replace("const MODULE_ID = '__MODULE_ID__'", `const MODULE_ID = '${module}'`)
    .replace('const SHELL = /* __SHELL__ */ []', `const SHELL = ${JSON.stringify(shell)}`)
    .replace('const DATA = /* __DATA__ */ []', `const DATA = ${JSON.stringify(data)}`)
  if (/__(BUILD_ID|MODULE_ID|SHELL|DATA)__/.test(stamped)) throw new Error(`${swPath}: a placeholder was not replaced`)
  const page = readFileSync(pagePath, 'utf8')
  if (!page.includes(BUILD_META)) throw new Error(`${pagePath}: no ${BUILD_META}`)
  writeFileSync(swPath, stamped)
  writeFileSync(pagePath, page.replace(BUILD_META, BUILD_META.replace('__BUILD_ID__', buildId)))
  return { buildId, shell, data }
}
