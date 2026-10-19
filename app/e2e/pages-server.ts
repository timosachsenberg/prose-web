import { appendFileSync, cpSync, createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'

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

export async function pagesServer(phases: Record<string, string>, first = Object.keys(phases)[0]): Promise<PagesServer> {
  let phase = first
  const log: string[] = []
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    log.push(`${phase} ${url.pathname}${url.search}`)
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
    createReadStream(file).pipe(res)
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
 * A copy of the build `dist` as a later deployment with another module: its wasm carries one more
 * custom section (so it differs from the original in content and size, and still compiles), and the
 * build's ids are replaced by `ids` wherever the build has them (sw.js, index.html, the worker).
 */
export function fakeUpdate(dist: string, ids: { module: string; build: string }): string {
  const out = mkdtempSync(join(tmpdir(), 'prose-update-'))
  cpSync(dist, out, { recursive: true })
  const old = stampedIds(dist)
  const name = Buffer.from('prose-test-update')
  const payload = Buffer.from(ids.module)
  const body = Buffer.concat([Buffer.from([name.length]), name, payload])
  appendFileSync(join(out, 'openms/openms.wasm'), Buffer.concat([Buffer.from([0, body.length]), body]))
  const files = ['sw.js', 'index.html', ...readdirSync(join(out, 'assets')).filter((f) => f.endsWith('.js')).map((f) => `assets/${f}`)]
  for (const f of files) {
    const path = join(out, f)
    const text = readFileSync(path, 'utf8')
    const next = text.replaceAll(old.module, ids.module).replaceAll(old.build, ids.build)
    if (next !== text) writeFileSync(path, next)
  }
  return out
}
