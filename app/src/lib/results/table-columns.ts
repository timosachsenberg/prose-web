// The columns of the three results tables, without their cells (the table components add those):
// headers, groups, widths, sort keys and the CSV columns they export. The CSV of a view writes the
// visible columns, in their order, as `columns.ts` defines them.

import { formatPercent, formatQ } from '../format/fdr'
import { columnDef } from './columns'
import { parseDescription, sampleHeader } from './display'
import type { Level, ResultModel } from './model'

export type ColumnSpec = {
  id: string
  header: string
  /** The group header above the column (per-sample columns: their condition). */
  group?: string
  /** Pixels, or 'auto' for the one column that takes the rest of the width. */
  width: number | 'auto'
  align: 'left' | 'right'
  /** The `columns.ts` id the column sorts by; none: not sortable. */
  sortKey?: string
  /** The `columns.ts` ids the column writes to a CSV file (none: not exported). */
  csv?: string[]
  /** A tooltip of the header (what the numbers count). */
  title?: string
  /** The sort button's accessible name when the header is not enough (sample "1" is "control 1"). */
  ariaLabel?: string
  /** The Columns menu can hide it; 'hidden': hidden until shown. */
  optional?: 'shown' | 'hidden'
}

/** The tooltip of a spectrum column: how it sorts (the PSM table and the protein panel share it). */
export const spectrumTitle = 'Sorts by scan number when every spectrum has one, else by native ID in natural order (scan 2 before scan 10)'

/** The pseudo-id of the Columns menu that hides all per-sample columns. */
export const samplesColumn = 'samples'

const isSample = (id: string) => id.startsWith('sample:')

function col(id: string, header: string, width: number | 'auto', align: 'left' | 'right', more: Partial<ColumnSpec> = {}): ColumnSpec {
  return { id, header, width, align, sortKey: id, csv: [id], ...more }
}

/** The per-sample count columns, in the order of the model, grouped by condition. */
function sampleSpecs(m: ResultModel): ColumnSpec[] {
  return m.samples.map((s) =>
    col(`sample:${s.index}`, sampleHeader(s), 56, 'right', { group: s.condition ?? undefined, title: s.label, ariaLabel: s.label }),
  )
}

/**
 * The columns of a level's table. `openSearch` (from the search's summary) shows the PSMs' mass
 * shift column by default.
 */
export function columnSpecs(m: ResultModel, level: Level, search: { openSearch: boolean }): ColumnSpec[] {
  const nSamples = new Set(m.columnSample).size
  const foundTitle = `Biological samples (Condition + Replicate) with a PSM, of ${nSamples}`
  if (level === 'proteins') {
    const atSearch = `At the search PSM FDR (${formatPercent(m.psmFdr)}, ${formatQ(m.psmFdr)})`
    return [
      col('accession', 'Accession', 160, 'left'),
      col('gene', 'Gene', 84, 'left', { optional: 'shown' }),
      col('description', 'Description', 'auto', 'left'),
      col('coverage', 'Coverage', 112, 'left', { title: `Residues covered by peptides with PSMs at the search PSM FDR` }),
      col('peptides', 'Peptides', 90, 'right', { title: atSearch }),
      col('psms', 'PSMs', 84, 'right', { title: atSearch }),
      ...sampleSpecs(m).map((s) => ({ ...s, title: `${s.title}: ${atSearch.charAt(0).toLowerCase()}${atSearch.slice(1)}` })),
      col('foundIn', 'Found in', 84, 'left', { title: foundTitle }),
      col('qValue', 'q-value', 90, 'right', { optional: 'hidden', title: 'Protein q-value' }),
      col('score', columnDef(m, 'proteins', 'score')!.header, 170, 'right', { optional: 'hidden' }),
      col('length', 'Length', 70, 'right', { optional: 'hidden', title: 'Residues' }),
      col('group', 'Group', 70, 'right', { optional: 'hidden', title: 'Protein group' }),
    ]
  }
  if (level === 'peptides') {
    return [
      col('peptide', 'Peptide', 'auto', 'left', { sortKey: 'sequence' }),
      col('proteins', 'Proteins', 190, 'left'),
      col('psms', 'PSMs', 84, 'right', { title: 'At the best PSM q-value filter' }),
      ...sampleSpecs(m),
      col('foundIn', 'Found in', 84, 'left', { title: foundTitle }),
      col('bestQ', 'Best PSM q-value', 148, 'right'),
      col('length', 'Length', 70, 'right', { optional: 'hidden' }),
    ]
  }
  return [
    col('peptide', 'Peptide', 'auto', 'left', { sortKey: 'sequence' }),
    col('proteins', 'Proteins', 150, 'left'),
    col('sample', 'Sample', 96, 'left'),
    col('scan', 'Spectrum', 90, 'left', { sortKey: 'nativeId', csv: ['nativeId'], title: spectrumTitle }),
    col('charge', 'z', 44, 'right', { title: 'Charge' }),
    col('mz', 'm/z', 94, 'right'),
    col('rt', 'RT (min)', 84, 'right', { title: 'Retention time (the CSV writes seconds)' }),
    col('precursorError', 'Error (ppm)', 106, 'right', { sortKey: 'precursorErrorPpm', csv: ['precursorErrorPpm'], title: 'Precursor mass error' }),
    col('score', columnDef(m, 'psms', 'score')!.header, 130, 'right'),
    col('qValue', 'q-value', 90, 'right'),
    col('pep', 'PEP', 70, 'right', { optional: 'hidden', title: 'Posterior error probability (Percolator)' }),
    col('deltaMass', 'Δ mass (Da)', 104, 'right', { optional: search.openSearch ? 'shown' : 'hidden', title: 'Unassigned mass shift of an open search' }),
    col('file', 'File', 160, 'left', { optional: 'hidden' }),
    col('isotopeError', 'Isotope error', 110, 'right', { optional: 'hidden' }),
  ]
}

/**
 * The columns hidden at first: the optional ones marked 'hidden', and the gene column when no
 * description names a gene (GN=).
 */
export function defaultHidden(specs: ColumnSpec[], m: ResultModel): string[] {
  const hidden: string[] = []
  for (const s of specs) {
    if (s.id === 'gene') {
      const named = m.tables.proteins.description.some((d) => parseDescription(d).gene !== null)
      if (!named) hidden.push(s.id)
    } else if (s.optional === 'hidden') {
      hidden.push(s.id)
    }
  }
  return hidden
}

/** The columns not hidden; "samples" in `hidden` stands for all per-sample columns. */
export function visibleSpecs(specs: ColumnSpec[], hidden: readonly string[]): ColumnSpec[] {
  const noSamples = hidden.includes(samplesColumn)
  return specs.filter((s) => !hidden.includes(s.id) && !(noSamples && isSample(s.id)))
}

/** The `columns.ts` ids the CSV of these columns writes, in their order. */
export function csvColumns(specs: ColumnSpec[]): string[] {
  return specs.flatMap((s) => s.csv ?? [])
}
