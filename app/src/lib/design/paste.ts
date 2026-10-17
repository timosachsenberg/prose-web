// Design fields that come from outside the table: rows pasted from a spreadsheet, and a loaded
// design.tsv or SDRF. Both are matched to the files of the table by name.

import { fileStem, type DesignInput } from './model'
import { cells, intCell, readLines } from './tsv'

/** The fields of a design row the user can enter. A key that is present but `undefined` clears the field. */
export type DesignFields = Partial<Pick<DesignInput, 'condition' | 'replicate' | 'fraction' | 'techReplicate'>>

/** New fields for row `index` of the table. */
export type DesignUpdate = { index: number; fields: DesignFields }

type Field = keyof DesignFields | 'file'

/** The file name without folders. */
function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

/**
 * The row of `fileNames` each of `names` refers to (-1: none): the same name, else the same stem in any
 * case (a design may list `run.raw` for `run.mzML`). Folders are ignored. Each file goes to one name only,
 * in order.
 */
export function matchFiles(names: string[], fileNames: string[]): number[] {
  const taken = new Set<number>()
  const find = (same: (file: string) => boolean) => {
    const i = fileNames.findIndex((f, k) => !taken.has(k) && same(f))
    if (i >= 0) taken.add(i)
    return i
  }
  const exact = names.map((n) => find((f) => f === baseName(n)))
  return exact.map((i, k) => {
    if (i >= 0) return i
    const stem = fileStem(names[k]).toLowerCase()
    return find((f) => fileStem(f).toLowerCase() === stem)
  })
}

const headerNames: [Field, RegExp][] = [
  ['techReplicate', /tech/i],
  // MaxQuant's experimental design template: Name (the raw file), Fraction, Experiment, PTM
  ['file', /file|spectra_filepath|^run$|^raw$|data file|^name$/i],
  ['condition', /condition|^group$|factor value|^experiment$/i],
  ['replicate', /replicate|^rep\.?$/i],
  ['fraction', /^fraction(?!_?group)|fraction identifier/i],
]

function headerField(cell: string): Field | null {
  return headerNames.find(([, pattern]) => pattern.test(cell))?.[0] ?? null
}

function fieldValue(field: keyof DesignFields, cell: string | undefined): DesignFields[keyof DesignFields] {
  if (field === 'condition') return cell === undefined || cell === '' ? undefined : cell
  return intCell(cell)
}

const notIn = (names: string[]) => `Not in the table: ${names.join(', ')}.`

/**
 * Rows copied from a spreadsheet (tab-separated). With a header, its columns are read by name (File,
 * Condition, Replicate, Fraction, Tech. replicate, in any order; MaxQuant's Name and Experiment are File
 * and Condition). Without one, the columns are File,
 * Condition, Replicate, Fraction, Tech. replicate if the first column names files, else Condition,
 * Replicate, Fraction, Tech. replicate for the files in table order (one row per file). Only the columns
 * pasted change; an empty cell clears its field.
 */
export function parsePastedDesign(text: string, fileNames: string[]): { rows: DesignUpdate[]; notices: string[] } {
  const lines = readLines(text)
    .filter((l) => l.trim() !== '')
    .map(cells)
  if (lines.length === 0) return { rows: [], notices: ['Nothing to paste.'] }

  let columns: (Field | null)[]
  let body = lines
  // a header names columns, and has no numbers and no file of the table in it
  const header = lines[0].map(headerField)
  const namesFile = matchFiles(lines[0], fileNames).some((i) => i >= 0)
  if (header.some((f) => f !== null) && !namesFile && lines[0].every((c) => intCell(c) === undefined)) {
    columns = header
    body = lines.slice(1)
  } else {
    const named = matchFiles(
      lines.map((l) => l[0]),
      fileNames,
    ).filter((i) => i >= 0).length
    const order: Field[] = ['condition', 'replicate', 'fraction', 'techReplicate']
    columns = named * 2 >= lines.length ? ['file', ...order] : order
  }

  const width = Math.max(...body.map((l) => l.length))
  const used = columns.slice(0, width)
  const fileColumn = used.indexOf('file')
  const notices: string[] = []
  let targets: number[]
  if (fileColumn >= 0) {
    targets = matchFiles(
      body.map((l) => l[fileColumn] ?? ''),
      fileNames,
    )
    const unknown = body.filter((_, k) => targets[k] < 0).map((l) => l[fileColumn])
    if (unknown.length > 0) notices.push(notIn(unknown))
  } else if (body.length === fileNames.length) {
    targets = body.map((_, k) => k)
  } else {
    return {
      rows: [],
      notices: [
        `The pasted rows name no files, and there are ${body.length} rows for ${fileNames.length} files. ` +
          'Paste one row per file, or include a column of file names.',
      ],
    }
  }

  const rows: DesignUpdate[] = []
  body.forEach((line, k) => {
    if (targets[k] < 0) return
    const fields: DesignFields = {}
    used.forEach((field, c) => {
      if (field === null || field === 'file') return
      ;(fields as Record<string, unknown>)[field] = fieldValue(field, line[c])
    })
    rows.push({ index: targets[k], fields })
  })
  return { rows, notices }
}

/**
 * A loaded design (`parseDesignTsv`, `parseSdrf`) for the files of the table: every field of a matched
 * file is set (or cleared). Rows naming no file of the table and files the design does not name are
 * reported.
 */
export function applyDesign(
  inputs: Partial<DesignInput>[],
  fileNames: string[],
): { rows: DesignUpdate[]; notices: string[] } {
  const targets = matchFiles(
    inputs.map((i) => i.fileName ?? ''),
    fileNames,
  )
  const rows: DesignUpdate[] = []
  inputs.forEach((input, k) => {
    if (targets[k] < 0) return
    rows.push({
      index: targets[k],
      fields: {
        condition: input.condition,
        replicate: input.replicate,
        fraction: input.fraction,
        techReplicate: input.techReplicate,
      },
    })
  })
  const notices: string[] = []
  const unknown = inputs.filter((_, k) => targets[k] < 0).map((i) => i.fileName ?? '')
  if (unknown.length > 0) notices.push(notIn(unknown))
  const covered = new Set(targets)
  const left = fileNames.filter((_, i) => !covered.has(i))
  if (left.length > 0) notices.push(`Not in the design (left as they were): ${left.join(', ')}.`)
  return { rows, notices }
}
