import { appendFileSync, cpSync, createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { writeStamp } from '../sw-stamp.ts'

// A static server as GitHub Pages serves the site: /prose-web/ from a directory, max-age=600, no
// COOP/COEP. It switches between builds ("phases", e.g. a deployment A and a later B) and logs the
// requests ("<phase> <path><query>").

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.fasta': 'text/plain',
  '.mzML': 'application/xml',
}

export interface PagesServer {
  url: string
  phase(name: string): void
  log: string[]
  close(): Promise<void>
}

/** Files served in every phase besides the build's (path below /prose-web/ → content type and body). */
export type Extra = Record<string, { type: string; body: string }>

export async function pagesServer(phases: Record<string, string>, first = Object.keys(phases)[0], extra: Extra = {}): Promise<PagesServer> {
  let phase = first
  const log: string[] = []
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    log.push(`${phase} ${url.pathname}${url.search}`)
    const added = extra[url.pathname.slice('/prose-web/'.length)]
    if (added) {
      res.setHeader('content-type', added.type)
      res.end(added.body)
      return
    }
    if (!url.pathname.startsWith('/prose-web/')) {
      res.statusCode = 404
      res.end()
      return
    }
    let rel = decodeURIComponent(url.pathname.slice('/prose-web/'.length)) || 'index.html'
    if (rel.endsWith('/')) rel += 'index.html'
    const file = join(phases[phase], rel)
    if (rel.includes('..') || !existsSync(file) || statSync(file).isDirectory()) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream')
    res.setHeader('cache-control', 'max-age=600')
    // (a client may abort a response: never let that end the server)
    const stream = createReadStream(file)
    stream.on('error', () => res.destroy())
    res.on('close', () => stream.destroy())
    stream.pipe(res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/prose-web/`,
    phase: (name) => {
      phase = name
      log.push(`--- ${name}`)
    },
    log,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

/** The ids the build stamped into `<dist>/sw.js`. */
export function stampedIds(dist: string): { module: string; build: string } {
  const sw = readFileSync(join(dist, 'sw.js'), 'utf8')
  const id = (name: string) => new RegExp(`const ${name} = '([0-9a-f]{12})'`).exec(sw)![1]
  return { module: id('MODULE_ID'), build: id('BUILD_ID') }
}

/**
 * A copy of the build `dist` as a later deployment B, as a real rebuild with another module makes it:
 * - the wasm carries one more custom section and the PeptDeep MS2 model one more (unknown) protobuf
 *   field: other bytes, still valid;
 * - the page's and the engine worker's chunks get new hashed names (unless `rename` is false), and
 *   every reference to them follows;
 * - the ids are `ids` wherever the build has them (index.html, the worker chunk), and sw.js is stamped
 *   again (its lists and manifest of B's files);
 * - `missing` files are removed after the stamp: B's worker then cannot install (an aborted update).
 */
export function fakeUpdate(
  dist: string,
  ids: { module: string; build: string },
  options: { rename?: boolean; missing?: string[] } = {},
): string {
  const { rename = true, missing = [] } = options
  const out = mkdtempSync(join(tmpdir(), 'prose-update-'))
  cpSync(dist, out, { recursive: true })
  const old = stampedIds(dist)
  const name = Buffer.from('prose-test-update')
  const payload = Buffer.from(ids.module)
  const body = Buffer.concat([Buffer.from([name.length]), name, payload])
  appendFileSync(join(out, 'openms/openms.wasm'), Buffer.concat([Buffer.from([0, body.length]), body]))
  appendFileSync(join(out, 'openms/models/peptdeep_ms2_dynamic.onnx'), Buffer.from([0xc0, 0x3e, 0x01])) // field 1000 = 1
  const renames = new Map<string, string>()
  if (rename) {
    for (const f of readdirSync(join(out, 'assets'))) {
      const m = /^(index|worker)-[^.]+\.js$/.exec(f)
      if (!m) continue
      const next = `${m[1]}-${ids.build.slice(0, 8)}.js`
      renameSync(join(out, 'assets', f), join(out, 'assets', next))
      renames.set(f, next)
    }
  }
  const texts = ['index.html', ...readdirSync(join(out, 'assets')).filter((f) => /\.(js|css)$/.test(f)).map((f) => `assets/${f}`)]
  for (const f of texts) {
    const path = join(out, f)
    let text = readFileSync(path, 'utf8')
    const before = text
    text = text.replaceAll(old.module, ids.module).replaceAll(old.build, ids.build)
    for (const [from, to] of renames) text = text.replaceAll(from, to)
    if (text !== before) writeFileSync(path, text)
  }
  writeStamp(out, ids)
  for (const f of missing) rmSync(join(out, f))
  return out
}
