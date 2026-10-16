// Helpers shared by the design.tsv and SDRF readers.
import { positiveInt, type Notice } from './model'

/** The lines of a text file, without a byte-order mark and with CRLF or LF endings. */
export function readLines(text: string): string[] {
  return text.replace(/^\ufeff/, '').split(/\r\n|\n|\r/)
}

/** The trimmed cells of one tab-separated line. */
export function cells(line: string): string[] {
  return line.split('\t').map((c) => c.trim())
}

/** A whole number of at least 1 from a cell, or `undefined`. */
export function intCell(value: string | undefined): number | undefined {
  return value === undefined || value === '' ? undefined : positiveInt(Number(value))
}

/**
 * A multiplexed design lists one file once per label (channel). The app searches files, so such a file
 * becomes one row. The fields in `agree` are kept only where all channels of the file have the same value.
 */
export function collapseChannels<T extends { fileName: string; label?: string }>(
  rows: T[],
  agree: (keyof T)[],
): { rows: T[]; notice: Notice | null } {
  const byFile = new Map<string, T[]>()
  for (const row of rows) {
    const list = byFile.get(row.fileName)
    if (list) list.push(row)
    else byFile.set(row.fileName, [row])
  }
  const multiplexed = [...byFile].filter(([, list]) => new Set(list.map((r) => r.label ?? '')).size > 1)
  if (multiplexed.length === 0) return { rows, notice: null }

  const isMultiplexed = new Set(multiplexed.map(([name]) => name))
  const seen = new Set<string>()
  const out: T[] = []
  for (const row of rows) {
    if (!isMultiplexed.has(row.fileName)) {
      out.push(row)
    } else if (!seen.has(row.fileName)) {
      seen.add(row.fileName)
      const merged: Partial<T> & T = { ...row }
      for (const key of agree) {
        if (!byFile.get(row.fileName)!.every((r) => r[key] === row[key])) delete merged[key]
      }
      out.push(merged)
    }
  }
  const shown = multiplexed.slice(0, 3).map(([name]) => name).join(', ')
  const more = multiplexed.length > 3 ? ` and ${multiplexed.length - 3} more` : ''
  const count = multiplexed.length === 1 ? '1 file has' : `${multiplexed.length} files have`
  return {
    rows: out,
    notice: {
      kind: 'multiplexed',
      message:
        `${count} several labels (${shown}${more}). ` +
        'Each is loaded as one row; conditions and replicates are kept only where all its channels agree.',
      rows: [],
    },
  }
}
