// CSV export of a table view: the rows given (the filtered, sorted view), the columns given.

import { columnDef, expandColumns } from './columns'
import type { FilterState } from './filters'
import { peptideCounts, type Level, type ResultModel } from './model'

/**
 * Excel and Sheets run a cell that starts with one of these as a formula (CSV injection); text cells
 * get an apostrophe in front, which they show as a text marker. Numeric columns are not touched.
 */
const formulaStart = /^[=+\-@\t\r]/

/** A CSV field: quoted when it holds a comma, a quote or a line break (RFC 4180). */
function field(text: string, isText: boolean): string {
  if (isText && formulaStart.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * The rows of `level` as CSV for a spreadsheet: a UTF-8 byte order mark, a header line, then one line
 * per row in the order given, each ended by "\n" (so a file of n rows has n + 1 lines). Peptides are
 * written as ProForma (all modifications, fixed ones too), not in the display mode. `columns` are the
 * ids of `columns.ts` ("accession", "psms", "qValue", ...); "samples" stands for one column per sample
 * (proteins and peptides). Missing numbers are empty. Text cells that start with `=`, `+`, `-`, `@`, a
 * tab or a carriage return get a leading apostrophe, as do such headers (sample labels come from
 * file names and conditions).
 *
 * `filters` is the level's filter state that made `rows`: the peptide counts are those at its
 * cutoff (see `peptideCounts`), as in the table and its sort order.
 */
export function toCsv(m: ResultModel, level: Level, rows: Uint32Array, columns: string[], filters: FilterState): string {
  const defs = expandColumns(m, level, columns).map((id) => columnDef(m, level, id)!)
  const counts = peptideCounts(m, level === 'peptides' ? filters.maxQ : NaN)
  const lines: string[] = new Array(rows.length + 1)
  lines[0] = defs.map((d) => field(d.header, true)).join(',')
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    lines[i + 1] = defs
      .map((d) => {
        if (d.csv) return field(d.csv(m, row, counts), d.csvText)
        if (d.number) {
          const x = d.number(m, row, counts)
          return x === x ? String(x) : ''
        }
        return field(d.text!(m, row, counts), d.csvText)
      })
      .join(',')
  }
  return '\uFEFF' + lines.join('\n') + '\n'
}
