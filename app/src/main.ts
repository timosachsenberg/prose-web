import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { registerServiceWorker } from '$lib/sw-client'

// The service worker comes first (lib/sw-client.ts). On a page that is not cross-origin isolated (the
// first visit on GitHub Pages) the page reloads under it, so nothing starts before it has decided:
// OpenMS would load on one thread, and files added would be lost in the reload. An isolated page (a
// later visit, the desktop app, `vite dev`) starts at once.
const decided = registerServiceWorker()
const start = () => mount(App, { target: document.getElementById('app')! })

// ?debug=…: see lib/debug.ts
if (globalThis.crossOriginIsolated) start()
else void decided.then((outcome) => outcome !== 'reloading' && start())
