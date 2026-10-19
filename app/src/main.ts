import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { answerBuildQueries, registerServiceWorker } from '$lib/sw-client'

// The service worker comes first (lib/sw-client.ts). On a page that is not cross-origin isolated (the
// first visit on GitHub Pages) the page reloads under it, so nothing starts before it has decided:
// OpenMS would load on one thread, and files added would be lost in the reload. Meanwhile index.html
// says "Loading ProSE…". An isolated page (a later visit, the desktop app, `vite dev`) starts at once.
// the worker asks the pages for their build (it keeps an older generation while pages of it are open)
answerBuildQueries()

let started = false
function start() {
  if (started) return
  started = true
  const target = document.getElementById('app')!
  target.replaceChildren()
  // ?debug=…: see lib/debug.ts
  mount(App, { target })
}

if (globalThis.crossOriginIsolated) {
  start()
  void registerServiceWorker()
} else {
  // (registerServiceWorker never rejects; whatever goes wrong, the app starts)
  registerServiceWorker().then(
    (outcome) => outcome !== 'reloading' && start(),
    () => start(),
  )
}
