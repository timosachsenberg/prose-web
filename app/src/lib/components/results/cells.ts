// Helpers of the results tables' columns.

import { signedNumber } from '$lib/format/number'
import type { ColumnSpec } from '$lib/results/table-columns'
import type { Column } from './DataTable.svelte'

/** What a table adds to a column spec: at least its cell. */
export type CellDef = Pick<Column, 'cell'> & Partial<Pick<Column, 'cellTitle' | 'placeholder' | 'secondary' | 'class'>>

/** The DataTable columns of `specs`, with the cells of `cells` (by id, or by `fallback` for e.g. sample columns). */
export function tableColumns(specs: ColumnSpec[], cells: (id: string) => CellDef): Column[] {
  return specs.map((s) => ({
    id: s.id,
    header: s.header,
    group: s.group,
    width: s.width,
    align: s.align,
    sortKey: s.sortKey,
    title: s.title,
    ariaLabel: s.ariaLabel,
    ...cells(s.id),
  }))
}

/** The sample column index of an id "sample:<n>", or -1. */
export function sampleIndex(id: string): number {
  return id.startsWith('sample:') ? Number(id.slice(7)) : -1
}

/** A number with fixed decimals; NaN as "–". */
export function fixed(x: number, digits: number): string {
  return x === x ? x.toFixed(digits) : '–'
}

/** A signed number with fixed decimals ("+1.25", "−0.40" with a real minus; what rounds to zero is "0.00"); NaN as "–". */
export function signed(x: number, digits: number): string {
  return signedNumber(x, digits)
}
