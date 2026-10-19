<script lang="ts">
  // All PSMs of the protein in a table of their own (virtualized: a protein can have thousands),
  // best q-value first; a click opens the PSM in the PSM table.
  import PeptideSequence from '$lib/components/PeptideSequence.svelte'
  import { massShift, peptideView } from '$lib/format/peptide'
  import { formatQValue, spectrumLabel } from '$lib/results/display'
  import { defaultFilters, sortRows } from '$lib/results/filters'
  import { proteinPsms, type ProteinDetail } from '$lib/results/protein'
  import { spectrumTitle } from '$lib/results/table-columns'
  import type { ResultsView } from '$lib/results/view.svelte'
  import DataTable, { type Column, type Sort } from '../results/DataTable.svelte'
  import { signed } from '../results/cells'

  let { view, detail, label, onOpenPsm }: { view: ResultsView; detail: ProteinDetail; label: string; onOpenPsm: (psm: number) => void } = $props()

  const m = $derived(view.model)
  const ps = $derived(m.tables.psms)
  const fixedMods = $derived(view.result.settings.fixedMods)

  let sort = $state<Sort>({ key: 'qValue', dir: 'asc' })
  const all = $derived(proteinPsms(m, detail))
  const rows = $derived(sortRows(m, 'psms', all, sort.key, sort.dir, defaultFilters()))

  const numeric = new Set(['charge', 'precursorErrorPpm', 'qValue'])
  function onSort(key: string) {
    sort = sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: numeric.has(key) ? 'desc' : 'asc' }
  }

  const columns = $derived<Column[]>([
    { id: 'peptide', header: 'Peptide', width: 'auto', align: 'left', sortKey: 'sequence', cell: () => peptideCell, cellTitle: (i) => m.tables.peptides.proforma[ps.peptide[i]] },
    { id: 'sample', header: 'Sample', width: 80, align: 'left', sortKey: 'sample', cell: (i) => m.samples[m.psmSample[i]].label },
    { id: 'scan', header: 'Scan', width: 66, align: 'left', sortKey: 'nativeId', title: spectrumTitle, cell: (i) => spectrumLabel(ps.nativeId[i]), cellTitle: (i) => ps.nativeId[i] },
    { id: 'charge', header: 'z', width: 34, align: 'right', sortKey: 'charge', title: 'Charge', cell: (i) => String(ps.charge[i]) },
    { id: 'error', header: 'Δ ppm', width: 72, align: 'right', sortKey: 'precursorErrorPpm', title: 'Precursor mass error', cell: (i) => signed(ps.precursorErrorPpm[i], 2) },
    { id: 'qValue', header: 'q-value', width: 80, align: 'right', sortKey: 'qValue', cell: (i) => formatQValue(ps.qValue[i]) },
  ])
</script>

{#snippet peptideCell(i: number)}
  {@const shift = massShift(ps.deltaMass[i])}
  {#if shift !== null}<span class="font-mono text-[12.5px] text-muted-foreground" title="Unassigned mass shift (Da), not localized">[{shift}]?</span>{/if}<PeptideSequence
    view={peptideView(m.tables.peptides, ps.peptide[i], fixedMods)} />
{/snippet}

<DataTable {label} {rows} {columns} {sort} {onSort} onRowClick={onOpenPsm} autoMinWidth={170} empty="No PSM of this protein is at the search's PSM FDR." />
