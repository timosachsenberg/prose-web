import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

// ?debug=engine: the app's EngineClient is window.__engine (lib/engine/app-engine.svelte.ts)
const app = mount(App, { target: document.getElementById('app')! })

export default app
