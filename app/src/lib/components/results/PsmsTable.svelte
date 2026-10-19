<script lang="ts">
  // The PSMs of the open result (the best hit of each spectrum). An open search's mass shift above
  // 0.05 Da goes before the sequence as an unlocalized ProForma mass ("[+15.9949]?"). A row opens the
  // PSM view (`onOpen`); while it is open, the table is the list beside it (`compact`): peptide,
  // charge, sample, q-value and precursor error, as in the mockup.
  import PeptideSequence from '$lib/components/PeptideSequence.svelte'
  import { massShift, peptideView } from '$lib/format/peptide'
  import { baseName } from '$lib/results/model'
  import { formatQValue, formatScore, spectrumLabel } from '$lib/results/display'
  import type { LevelState, ResultsView } from '$lib/results/view.svelte'
  import { fixed, signed, tableColumns, type CellDef } from './cells'
  import DataTable from './DataTable.svelte'
  import ProteinRefs from './ProteinRefs.svelte'

  let {
    view,
    level,
    onOpen,
    compact = false,
  }: { view: ResultsView; level: LevelState; onOpen: (psm: number) => void; compact?: boolean } = $props()

  const m = $derived(view.model)
  const ps = $derived(m.tables.psms)
  const fixedMods = $derived(view.result.settings.fixedMods)

  function cells(id: string): CellDef {
    switch (id) {
      case 'peptide':
        return { cell: () => peptideCell, cellTitle: (i) => m.tables.peptides.proforma[ps.peptide[i]] }
      case 'proteins':
        return {
          cell: () => proteinsCell,
          cellTitle: (i) => Array.from(m.peptide.proteins[ps.peptide[i]], (p) => m.tables.proteins.accession[p]).join('\n'),
        }
      case 'sample':
        return { cell: (i) => m.samples[m.psmSample[i]].label }
      case 'scan':
        return { cell: (i) => spectrumLabel(ps.nativeId[i]), cellTitle: (i) => ps.nativeId[i] }
      case 'charge':
        return { cell: (i) => String(ps.charge[i]) }
      case 'mz':
        return { cell: (i) => fixed(ps.mz[i], 4) }
      case 'rt':
        // negative or unknown (NaN): "–"
        return { cell: (i) => (ps.rt[i] >= 0 ? fixed(ps.rt[i] / 60, 2) : '–'), placeholder: (i) => !(ps.rt[i] >= 0) }
      case 'precursorError':
        return { cell: (i) => signed(ps.precursorErrorPpm[i], 2) }
      case 'score':
        return { cell: (i) => formatScore(ps.score[i], ps.qValue[i]) }
      case 'qValue':
        return { cell: (i) => formatQValue(ps.qValue[i]) }
      case 'pep':
        return { cell: (i) => formatQValue(ps.pep[i]) }
      case 'deltaMass':
        return { cell: (i) => signed(ps.deltaMass[i], 4), secondary: (i) => massShift(ps.deltaMass[i]) === null && ps.deltaMass[i] === ps.deltaMass[i], placeholder: (i) => ps.deltaMass[i] !== ps.deltaMass[i] }
      case 'file':
        return { cell: (i) => baseName(m.tables.files[ps.file[i]]) }
      case 'isotopeError':
        return { cell: (i) => String(ps.isotopeError[i]) }
      default:
        return { cell: () => '' }
    }
  }

  /** The list beside the PSM view: these columns, narrower. */
  const compactColumns: Record<string, { width: number | 'auto'; header?: string; title?: string }> = {
    peptide: { width: 'auto' },
    charge: { width: 32 },
    sample: { width: 74 },
    qValue: { width: 60, header: 'q' },
    precursorError: { width: 58, header: 'Δ ppm', title: 'Precursor mass error (ppm)' },
  }

  const columns = $derived.by(() => {
    if (!compact) return tableColumns(level.visible, cells)
    const specs = Object.entries(compactColumns).flatMap(([id, narrow]) => {
      const spec = level.specs.find((s) => s.id === id)
      return spec ? [{ ...spec, ...narrow }] : []
    })
    return tableColumns(specs, (id) => (id === 'precursorError' ? { cell: (i: number) => signed(ps.precursorErrorPpm[i], 1) } : cells(id)))
  })

  let table = $state<DataTable | null>(null)
  /** Makes the row the grid's active one, scrolls it into view and gives the grid the focus. */
  export function focusRow(row: number | null): void {
    table?.focusRow(row)
  }
</script>

{#snippet peptideCell(i: number)}
  {@const shift = massShift(ps.deltaMass[i])}
  {#if shift !== null}<span class="font-mono text-[12.5px] text-muted-foreground" title="Unassigned mass shift (Da), not localized"
      >[{shift}]?</span
    >{/if}<PeptideSequence view={peptideView(m.tables.peptides, ps.peptide[i], fixedMods)} />
{/snippet}

{#snippet proteinsCell(i: number)}
  <ProteinRefs model={m} peptide={ps.peptide[i]} />
{/snippet}

<DataTable
  bind:this={table}
  label="PSMs"
  rows={level.rows}
  {columns}
  sort={level.effectiveSort}
  onSort={(key) => level.sortBy(key)}
  onRowClick={onOpen}
  selected={level.selected}
  autoMinWidth={compact ? 80 : 220}
  empty={level.emptyText} />
