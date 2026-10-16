// The OpenMS experimental design file (design.tsv), one-table format, and a reader that also accepts
// the two-table format written by sdrf-pipelines. See OpenMS ExperimentalDesign.h.
import type { DesignInput, DesignResolution, Notice } from './model'
import { cells, collapseChannels, intCell, readLines } from './tsv'

const HEADER = [
  'Fraction_Group',
  'Fraction',
  'Spectra_Filepath',
  'Label',
  'Sample',
  'MSstats_Condition',
  'MSstats_BioReplicate',
] as const

const clean = (value: string) => value.replace(/[\t\r\n]+/g, ' ')

/**
 * The one-table format, one row per file, Label 1 (label-free). The files of one measurement of one
 * sample share a Fraction_Group; a technical replicate is a new group of the same sample. Sample and
 * MSstats_BioReplicate are the sample number, which is unique across conditions: a replicate number that
 * repeated under two conditions would declare a paired design.
 */
export function writeDesignTsv(r: DesignResolution): string {
  // OpenMS needs a unique (Spectra_Filepath, Label), and the label is always 1 here.
  const count = new Map<string, number>()
  for (const row of r.rows) count.set(clean(row.fileName), (count.get(clean(row.fileName)) ?? 0) + 1)
  const duplicates = [...count].filter(([, c]) => c > 1).map(([name]) => name)
  if (duplicates.length > 0) {
    throw new Error(
      `Cannot write design.tsv: file name used more than once: ${duplicates.join(', ')}. ` +
        'Rename or remove the duplicates.',
    )
  }
  const order = r.rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => a.row.fractionGroup - b.row.fractionGroup || a.row.fraction - b.row.fraction || a.i - b.i)
  const lines = [HEADER.join('\t')]
  for (const { row } of order) {
    const sample = row.sample + 1
    lines.push(
      [row.fractionGroup, row.fraction, clean(row.fileName), 1, sample, clean(row.condition ?? ''), sample].join('\t'),
    )
  }
  return lines.join('\n') + '\n'
}

type Table = string[][]

/** The tables of the file: lines starting with # are dropped, blank lines separate tables. */
function readTables(text: string): Table[] {
  const tables: Table[] = []
  let current: Table = []
  for (const line of readLines(text)) {
    if (line.trim().startsWith('#')) continue
    const row = cells(line)
    if (row.every((c) => c === '')) {
      if (current.length > 0) tables.push(current)
      current = []
    } else {
      current.push(row)
    }
  }
  if (current.length > 0) tables.push(current)
  return tables
}

const lower = (header: string[]) => header.map((h) => h.toLowerCase())
const FILE_COLUMNS = ['fraction_group', 'fraction', 'spectra_filepath', 'label', 'sample']
const SAMPLE_COLUMNS = ['sample', 'msstats_condition', 'msstats_bioreplicate']

type Raw = { fileName: string; fraction?: number; label: string; condition?: string; unit?: string }

/**
 * Reads a design.tsv. The condition is MSstats_Condition. The replicate comes from MSstats_BioReplicate
 * (or Sample without it), counted 1, 2, ... within each condition, so that both numbering conventions
 * give the same replicates. Fraction_Group and Label are not read: the app derives the groups again, and
 * a file with several labels becomes one row with a notice.
 */
export function parseDesignTsv(text: string): { inputs: Partial<DesignInput>[]; notices: Notice[] } {
  const tables = readTables(text)
  const fileTable = tables[0]
  const header = fileTable ? lower(fileTable[0]) : []
  if (!header.includes('spectra_filepath')) {
    return {
      inputs: [],
      notices: [
        {
          kind: 'unknownColumn',
          message: 'No Spectra_Filepath column found. This does not look like an OpenMS design.tsv.',
          rows: [],
        },
      ],
    }
  }

  const notices: Notice[] = []
  const col = (name: string) => header.indexOf(name)
  const unused = (names: string[], known: string[], original: string[]) =>
    original.filter((_, i) => !known.includes(names[i]))

  // Two-table format: the sample section gives the condition and replicate of each Sample.
  const second = tables.length > 1 ? lower(tables[1][0]) : []
  const sampleTable = second.includes('sample') && !second.includes('fraction_group') ? tables[1] : null
  const bySample = new Map<string, { condition?: string; unit?: string }>()
  let unknown: string[]
  if (sampleTable) {
    const sh = lower(sampleTable[0])
    const sCol = sh.indexOf('sample')
    const cCol = sh.indexOf('msstats_condition')
    const bCol = sh.indexOf('msstats_bioreplicate')
    for (const row of sampleTable.slice(1)) {
      bySample.set(row[sCol] ?? '', {
        condition: (cCol >= 0 && row[cCol]) || undefined,
        unit: (bCol >= 0 && row[bCol]) || (bCol < 0 ? row[sCol] : undefined) || undefined,
      })
    }
    unknown = [
      ...unused(header, FILE_COLUMNS, fileTable[0]),
      ...unused(sh, SAMPLE_COLUMNS, sampleTable[0]),
    ]
  } else {
    unknown = unused(header, [...FILE_COLUMNS, 'msstats_condition', 'msstats_bioreplicate'], fileTable[0])
  }
  if (unknown.length > 0) {
    notices.push({
      kind: 'unknownColumn',
      message: `Columns not used: ${[...new Set(unknown)].join(', ')}.`,
      rows: [],
    })
  }

  const cell = (row: string[], name: string) => {
    const c = col(name)
    return c >= 0 ? (row[c] ?? '') : ''
  }
  // The biological unit of a row: MSstats_BioReplicate, else Sample, else (as in OpenMS, where the
  // sample defaults to the fraction group) Fraction_Group.
  const unitOf = (row: string[]) => {
    const column = ['msstats_bioreplicate', 'sample', 'fraction_group'].find((name) => col(name) >= 0)
    return (column && cell(row, column)) || undefined
  }
  const raw: Raw[] = []
  for (const row of fileTable.slice(1)) {
    const fileName = cell(row, 'spectra_filepath')
    if (fileName === '') continue
    const fromSample = bySample.get(cell(row, 'sample'))
    raw.push({
      fileName,
      fraction: intCell(cell(row, 'fraction')),
      label: cell(row, 'label'),
      condition: fromSample ? fromSample.condition : cell(row, 'msstats_condition') || undefined,
      unit: fromSample ? fromSample.unit : unitOf(row),
    })
  }

  const collapsed = collapseChannels(raw, ['condition', 'unit', 'fraction'])
  if (collapsed.notice) notices.push(collapsed.notice)

  // Replicate = rank of the biological unit within its condition (numerically when all are numbers).
  const unitsOf = new Map<string, string[]>()
  for (const r of collapsed.rows) {
    if (r.unit === undefined) continue
    const key = r.condition ?? ''
    const list = unitsOf.get(key)
    if (!list) unitsOf.set(key, [r.unit])
    else if (!list.includes(r.unit)) list.push(r.unit)
  }
  for (const list of unitsOf.values()) {
    if (list.every((u) => u !== '' && Number.isFinite(Number(u)))) list.sort((a, b) => Number(a) - Number(b))
  }

  const inputs = collapsed.rows.map((r): Partial<DesignInput> => {
    const out: Partial<DesignInput> = { fileName: r.fileName }
    if (r.condition !== undefined) out.condition = r.condition
    if (r.unit !== undefined) out.replicate = unitsOf.get(r.condition ?? '')!.indexOf(r.unit) + 1
    if (r.fraction !== undefined) out.fraction = r.fraction
    return out
  })
  return { inputs, notices }
}
