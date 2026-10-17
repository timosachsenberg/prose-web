import type { ParamEntry } from '../engine/protocol'

// Modifications as ProSE names them ("Oxidation (M)", "Acetyl (Protein N-term)", "Gln->pyro-Glu (N-term Q)"):
// one residue per name. The page shows the residues of one modification together ("Phospho (STY)") and
// accepts such a name as input, expanded to one modification per residue.

export type ParsedModification = {
  name: string
  /** The residues ("STY"); empty for a terminus without a residue. */
  residues: string
  /** "N-term", "C-term", "Protein N-term", "Protein C-term", or null for a residue modification. */
  term: string | null
}

// the name (which may contain parentheses itself), then the site: [Protein ]N-term / C-term with an
// optional residue, or residue letters
const spec = /^(.*?)\s*\((?:((?:Protein\s+)?[NC]-term)(?:\s+([A-Z]))?|([A-Z]+))\)$/

/** The name and site of a modification, or null if it is not written as "Name (site)". */
export function parseModification(text: string): ParsedModification | null {
  const match = spec.exec(text.trim().replace(/\s+/g, ' '))
  if (!match || match[1] === '') return null
  const [, name, term, termResidue, residues] = match
  return term !== undefined
    ? { name, residues: termResidue ?? '', term: term.replace(/\s+/g, ' ') }
    : { name, residues, term: null }
}

function format(m: ParsedModification): string {
  const site = m.term === null ? m.residues : m.residues === '' ? m.term : `${m.term} ${m.residues}`
  return `${m.name} (${site})`
}

/** "Phospho (STY)" is "Phospho (S)", "Phospho (T)", "Phospho (Y)"; other names stay as they are. */
export function expandModification(text: string): string[] {
  const m = parseModification(text)
  if (!m) return [text.trim()]
  if (m.term !== null || m.residues.length <= 1) return [format(m)]
  return [...new Set(m.residues)].map((r) => format({ ...m, residues: r }))
}

/**
 * The modifications for display: residue modifications of the same name are shown as one
 * ("Phospho (STY)"), at the place of the first; terminal ones stay apart. `specs` are ProSE's names.
 */
export function groupModifications(specs: string[]): { label: string; specs: string[] }[] {
  const groups: { label: string; specs: string[]; parsed: ParsedModification | null }[] = []
  const byName = new Map<string, (typeof groups)[number]>()
  for (const s of specs) {
    const m = parseModification(s)
    if (m && m.term === null) {
      const group = byName.get(m.name)
      if (group) {
        group.specs.push(s)
        group.parsed!.residues += m.residues
        group.label = format(group.parsed!)
        continue
      }
      const created = { label: s, specs: [s], parsed: { ...m } }
      byName.set(m.name, created)
      groups.push(created)
    } else {
      groups.push({ label: s, specs: [s], parsed: m })
    }
  }
  return groups.map(({ label, specs }) => ({ label, specs }))
}

/**
 * The fixed and variable modifications of `values` that are not among ProSE's names (the allowed
 * values of its parameter definitions). Nothing without the definitions (OpenMS not loaded yet).
 */
export function unknownModifications(values: Record<string, unknown>, entries: ParamEntry[]): string[] {
  const unknown: string[] = []
  for (const name of ['modifications:fixed', 'modifications:variable']) {
    const valid = entries.find((e) => e.name === name)?.validStrings
    const list = values[name]
    if (!valid || !Array.isArray(list)) continue
    const known = new Set(valid)
    for (const spec of list) if (!known.has(spec) && !unknown.includes(spec)) unknown.push(spec)
  }
  return unknown
}
