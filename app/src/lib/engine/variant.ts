// The two builds of the OpenMS module, and which one runs a search.
//
// - wasm32 (`public/openms/`), the default: a module addresses at most 4 GB. It is what every
//   browser runs, the service worker stores it with the app, and it is 8–22 % faster than wasm64.
// - wasm64 (`public/openms64/`, Memory64): at most 16 GB. Chrome and Edge from 133 and Firefox from 134
//   have Memory64, Safari does not. It is downloaded (and stored by the service worker) when a search
//   first needs it. The two have one JavaScript API (OpenMS PR #10659); the PeptDeep models are the
//   same files and come from `openms/models/`.
//
// A search runs in wasm64 when its memory estimate with the wasm32 constants is above 3 GB and the
// browser has Memory64 (a feature test, not the browser's name). The spectrum views (the viewer
// worker: annotation, prediction) always use wasm32: they are small.

import { GB } from '../format/bytes'
import type { EngineVariant } from './protocol'

/**
 * The smallest module with a shared 64-bit memory, which the threaded wasm64 module needs: the header,
 * then a memory section (id 5, 4 bytes) with one memory whose limits flag 0x07 = has a maximum, shared,
 * 64-bit addresses; minimum 0, maximum 1 page. A browser without Memory64 does not validate it.
 */
export const MEMORY64_PROBE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x05, 0x04, 0x01, 0x07, 0x00, 0x01])

/** Whether this browser runs the 64-bit module (Memory64). `validate`: WebAssembly.validate (for the tests). */
export function supportsMemory64(validate: (bytes: Uint8Array<ArrayBuffer>) => boolean = (b) => WebAssembly.validate(b)): boolean {
  try {
    return validate(MEMORY64_PROBE) === true
  } catch {
    return false
  }
}

/** A search whose wasm32 estimate is above this runs in wasm64 (where the browser has it). */
export const SWITCH_BYTES = 3 * GB

/**
 * The module of a search: wasm64 when its estimate with the wasm32 constants (`estimate32`) is above
 * SWITCH_BYTES or a file is too large for wasm32 (`fileTooLarge32`), or when forced (the debug switch
 * `?debug=wasm64`), and only where the browser has Memory64; else wasm32.
 */
export function chooseEngine(i: { estimate32: number; fileTooLarge32?: boolean; memory64: boolean; force?: boolean }): EngineVariant {
  if (!i.memory64) return 'wasm32'
  return i.force || i.fileTooLarge32 || i.estimate32 > SWITCH_BYTES ? 'wasm64' : 'wasm32'
}

/** "32-bit", "64-bit": the module for people. */
export function engineLabel(variant: EngineVariant): string {
  return variant === 'wasm64' ? '64-bit' : '32-bit'
}
