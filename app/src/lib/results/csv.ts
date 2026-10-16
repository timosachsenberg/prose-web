// CSV export of a table view: the rows given (the filtered, sorted view), the columns given.

import { columnDef, expandColumns } from './columns'
import type { Level, ResultModel } from './model'

/** A CSV field: quoted when it holds a comma, a quote or a line break (RFC 4180). */
function field(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * The rows of `level` as CSV: a header line, then one line per row, in the order given and joined by
 * "\n" (no final line break). Peptides are written as ProForma (all modifications, fixed ones too),
 * not in the display mode. `columns` are the ids of `columns.ts` ("accession", "psms", "qValue", ...);
 * "samples" stands for one column per sample (proteins and peptides). Missing numbers are empty.
 */
export function toCsv(m: ResultModel, level: Level, rows: Uint32Array, columns: string[]): string {
  const defs = expandColumns(m, level, columns).map((id) => columnDef(m, level, id)!)
  const lines: string[] = new Array(rows.length + 1)
  lines[0] = defs.map((d) => field(d.header)).join(',')
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    lines[i + 1] = defs
      .map((d) => {
        if (d.csv) return field(d.csv(m, row))
        if (d.number) {
          const x = d.number(m, row)
          return x === x ? String(x) : ''
        }
        return field(d.text!(m, row))
      })
      .join(',')
  }
  return lines.join('\n')
}
