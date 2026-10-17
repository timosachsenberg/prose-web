// ProSE's parameters as the New search page handles them: the defaults of the module
// (`EngineInfo.parameters`), the values the page sends, and what the "All parameters" dialog shows.

import type { ParamEntry } from '../engine/protocol'

/**
 * Parameters the switches of the Rescoring card set through the search request (`rescore`,
 * `peptdeep`): never part of a preset or of `SearchRequest.parameters`, and not in the dialog.
 */
export const SWITCH_PARAMETERS: readonly string[] = ['rescore', 'peptdeep:enable', 'peptdeep:ms2_model', 'peptdeep:rt_model']

/** Parameters with their own control on the page outside the dialog (the PeptDeep instrument). */
export const CARD_PARAMETERS: readonly string[] = ['peptdeep:instrument']

/** The parameters the dialog lists: all but those of the Rescoring card. */
export function dialogEntries(entries: ParamEntry[]): ParamEntry[] {
  return entries.filter((e) => !SWITCH_PARAMETERS.includes(e.name) && !CARD_PARAMETERS.includes(e.name))
}

/** The section of a parameter: the part of its name before the last ":" ("general" without one). */
export function sectionOf(name: string): string {
  const colon = name.lastIndexOf(':')
  return colon < 0 ? 'general' : name.slice(0, colon)
}

/** The entries by section, in the order of their first parameter (ProSE's order). */
export function parameterSections(entries: ParamEntry[]): { name: string; entries: ParamEntry[] }[] {
  const sections = new Map<string, ParamEntry[]>()
  for (const e of entries) {
    const section = sectionOf(e.name)
    const list = sections.get(section)
    if (list) list.push(e)
    else sections.set(section, [e])
  }
  return [...sections].map(([name, list]) => ({ name, entries: list }))
}

/** ProSE's defaults by name. */
export function defaultsOf(entries: ParamEntry[]): Record<string, unknown> {
  return Object.fromEntries(entries.map((e) => [e.name, e.value]))
}

/** Whether two parameter values are the same (lists item by item, in order). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i])
  return a === b
}

/** The values that differ from the defaults (also those without a default). */
export function changedParameters(
  values: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const changed: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(values)) {
    if (!(name in defaults) || !sameValue(value, defaults[name])) changed[name] = copyValue(value)
  }
  return changed
}

/** The parameters of a search request: the changed values, without those the switches set. */
export function requestParameters(
  values: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const changed = changedParameters(values, defaults)
  for (const name of SWITCH_PARAMETERS) delete changed[name]
  return changed
}

/** A value that can be edited without changing the original (lists are copied). */
export function copyValue<T>(value: T): T {
  return (Array.isArray(value) ? [...value] : value) as T
}

/** A copy of a set of values (its lists copied too). */
export function copyValues(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, copyValue(v)]))
}
