// Display settings that persist across sessions.

export type ModMode = 'marked' | 'proforma'

const storageKey = 'prose.modMode'

function read(): ModMode {
  try {
    return localStorage.getItem(storageKey) === 'proforma' ? 'proforma' : 'marked'
  } catch {
    return 'marked' // no localStorage (tests, blocked storage)
  }
}

let modMode = $state<ModMode>(read())

export const displaySettings = {
  /** How peptides show their modifications: a marked residue (default) or ProForma text. */
  get modMode(): ModMode {
    return modMode
  },
  set modMode(value: ModMode) {
    modMode = value
    try {
      localStorage.setItem(storageKey, value)
    } catch {
      // the setting then lasts until the page closes
    }
  },
}
