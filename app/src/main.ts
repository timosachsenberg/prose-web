import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

const app = mount(App, { target: document.getElementById('app')! })

// ?debug=engine: an EngineClient as window.proseEngine, for the end-to-end test of the engine worker
if (new URLSearchParams(location.search).get('debug') === 'engine') {
  void import('./lib/engine/client').then(({ EngineClient }) => {
    ;(window as unknown as { proseEngine: unknown }).proseEngine = new EngineClient()
  })
}

export default app
