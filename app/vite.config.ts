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
      stampServiceWorker(outDir, openmsId)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the app at /prose-web/; the desktop build sets VITE_BASE=./
  base: process.env.VITE_BASE ?? '/prose-web/',
  plugins: [tailwindcss(), svelte(), serviceWorker()],
  define: { __OPENMS_ID__: JSON.stringify(openmsId) },
  resolve: {
    alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) },
  },
  server: { headers: isolation },
  // PROSE_PREVIEW_ISOLATION=off: served as GitHub Pages serves it (the service worker's e2e tests)
  preview: { headers: process.env.PROSE_PREVIEW_ISOLATION === 'off' ? {} : isolation },
})
