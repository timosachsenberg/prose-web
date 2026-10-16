// Reads the experimental design out of an SDRF file (one row per data file or per file and label).
import type { DesignInput, Notice } from './model'
import { cells, collapseChannels, intCell, readLines } from './tsv'

const empty = (value: string | undefined) =>
  value === undefined || value === '' || /^not (available|applicable)$/i.test(value)

type Raw = Partial<DesignInput> & { fileName: string; label?: string }

/**
 * Columns used: `comment[data file]` (the file), every `factor value[...]` (the condition; several
 * factors are joined with "/"), `characteristics[biological replicate]`, `comment[fraction identifier]`,
 * `comment[technical replicate]`. A file listed with several `comment[label]` values becomes one row.
 */
export function parseSdrf(text: string): { inputs: Partial<DesignInput>[]; notices: Notice[] } {
  const lines = readLines(text).filter((l) => l.trim() !== '')
  const header = lines.length > 0 ? cells(lines[0]).map((h) => h.toLowerCase()) : []
  const fileCol = header.indexOf('comment[data file]')
  if (fileCol < 0) {
    return {
      inputs: [],
      notices: [
        {
          kind: 'unknownColumn',
          message: 'No comment[data file] column found. This does not look like an SDRF file.',
          rows: [],
        },
      ],
    }
  }
  const factorCols = header.flatMap((h, i) => (h.startsWith('factor value[') ? [i] : []))
  const replicateCol = header.indexOf('characteristics[biological replicate]')
  const fractionCol = header.indexOf('comment[fraction identifier]')
  const techCol = header.indexOf('comment[technical replicate]')
  const labelCol = header.indexOf('comment[label]')

  const raw: Raw[] = []
  for (const line of lines.slice(1)) {
    const row = cells(line)
    const fileName = row[fileCol] ?? ''
    if (fileName === '') continue
    const out: Raw = { fileName }
    const condition = factorCols.map((c) => row[c]).filter((v) => !empty(v)).join('/')
    if (condition !== '') out.condition = condition
    const replicate = intCell(row[replicateCol])
    if (replicate !== undefined) out.replicate = replicate
    const fraction = intCell(row[fractionCol])
    if (fraction !== undefined) out.fraction = fraction
    const tech = intCell(row[techCol])
    if (tech !== undefined) out.techReplicate = tech
    if (labelCol >= 0) out.label = row[labelCol] ?? ''
    raw.push(out)
  }

  const notices: Notice[] = []
  const collapsed = collapseChannels(raw, ['condition', 'replicate', 'fraction', 'techReplicate'])
  if (collapsed.notice) notices.push(collapsed.notice)
  return {
    inputs: collapsed.rows.map(({ label: _label, ...rest }) => rest),
    notices,
  }
}
