// The build's part of the service worker (public/sw.js): it names the worker's stores and lists the
// files it stores on installation.
// - MODULE_ID: the content of public/openms (the module package). The worker imports the module as
//   openms/openms.mjs?v=<MODULE_ID> (a new module never meets an old one from the HTTP cache) and the
//   worker stores it in openms-module-<MODULE_ID>, which a build of the app alone leaves in place.
// - BUILD_ID: the content of the whole build; the app's files are stored in prose-app-<BUILD_ID>.
// - PRECACHE: the app's files (not the module, which is stored when the page loads it, nor the
//   PeptDeep models, stored on first use), so the app and its example work offline after one visit.

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

/** Stamps `<outDir>/sw.js`: its ids and the files to store on installation. */
export function stampServiceWorker(outDir: string, module: string): { buildId: string; precache: string[] } {
  const swPath = join(outDir, 'sw.js')
  const files = filesBelow(outDir).filter((f) => f !== 'sw.js')
  const buildId = contentId(outDir, files)
  const precache = files.filter((f) => !f.startsWith('openms/'))
  const stamped = readFileSync(swPath, 'utf8')
    .replace("const BUILD_ID = '__BUILD_ID__'", `const BUILD_ID = '${buildId}'`)
    .replace("const MODULE_ID = '__MODULE_ID__'", `const MODULE_ID = '${module}'`)
    .replace('const PRECACHE = /* __PRECACHE__ */ []', `const PRECACHE = ${JSON.stringify(precache)}`)
  if (/__(BUILD_ID|MODULE_ID|PRECACHE)__/.test(stamped)) throw new Error(`${swPath}: a placeholder was not replaced`)
  writeFileSync(swPath, stamped)
  return { buildId, precache }
}
