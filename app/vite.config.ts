import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { moduleId, stampServiceWorker } from './sw-stamp.ts'

// The threaded OpenMS module needs a cross-origin isolated page.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

const openmsId = moduleId(fileURLToPath(new URL('./public/openms', import.meta.url)))
const openms64Id = moduleId(fileURLToPath(new URL('./public/openms64', import.meta.url)))

/** Stamps the service worker of the build (sw-stamp.ts). */
function serviceWorker(): Plugin {
  let outDir = ''
  return {
    name: 'prose-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      stampServiceWorker(outDir, { module: openmsId, module64: openms64Id })
    },
  }
}

/**
 * The desktop build (PROSE_DESKTOP=1, desktop/build.sh): the page loads Neutralino's client library,
 * only to hold the connection whose end (the window closed) stops the program. Added at build time, so
 * the service worker's manifest has the page as it is served.
 */
function desktopPage(): Plugin {
  return {
    name: 'prose-desktop-page',
    apply: 'build',
    transformIndexHtml: (html) =>
      process.env.PROSE_DESKTOP === '1'
        ? html.replace('</head>', '  <script src="/neutralino.js"></script>\n    <script>Neutralino.init()</script>\n  </head>')
        : html,
  }
}

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the app at /prose-web/; the desktop build sets VITE_BASE=./
  base: process.env.VITE_BASE ?? '/prose-web/',
  plugins: [tailwindcss(), svelte(), desktopPage(), serviceWorker()],
  define: { __OPENMS_ID__: JSON.stringify(openmsId), __OPENMS64_ID__: JSON.stringify(openms64Id) },
  resolve: {
    alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) },
  },
  server: { headers: isolation },
  // PROSE_PREVIEW_ISOLATION=off: served as GitHub Pages serves it (the service worker's e2e tests)
  preview: { headers: process.env.PROSE_PREVIEW_ISOLATION === 'off' ? {} : isolation },
})
