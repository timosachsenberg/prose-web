<script lang="ts">
  // The peptides (peptidoforms) of the open result, with PSM counts at the "best PSM q-value" filter.
  import PeptideSequence from '$lib/components/PeptideSequence.svelte'
  import { peptideView } from '$lib/format/peptide'
  import { formatCount, formatQValue } from '$lib/results/display'
  import type { LevelState, ResultsView } from '$lib/results/view.svelte'
  import { tableColumns, sampleIndex, type CellDef } from './cells'
  import DataTable from './DataTable.svelte'
  import ProteinRefs from './ProteinRefs.svelte'

  let { view, level }: { view: ResultsView; level: LevelState } = $props()

  const m = $derived(view.model)
  const pt = $derived(m.tables.peptides)
  const nS = $derived(m.samples.length)
  const nBio = $derived(new Set(m.columnSample).size)
  const fixedMods = $derived(view.result.settings.fixedMods)

  function cells(id: string): CellDef {
    const counts = level.counts
    const s = sampleIndex(id)
    if (s >= 0) {
      const count = (k: number) => counts.perSample[k * nS + s]
      return { cell: (k) => (count(k) === 0 ? '–' : formatCount(count(k))), placeholder: (k) => count(k) === 0 }
    }
    switch (id) {
      case 'peptide':
        return { cell: () => peptideCell, cellTitle: (k) => pt.proforma[k] }
      case 'proteins':
        return { cell: () => proteinsCell, cellTitle: (k) => Array.from(m.peptide.proteins[k], (p) => m.tables.proteins.accession[p]).join('\n') }
      case 'psms':
        return { cell: (k) => formatCount(counts.psms[k]) }
      case 'foundIn':
        return { cell: (k) => `${counts.foundIn[k]} / ${nBio}`, class: 'text-muted-foreground' }
      case 'bestQ':
        return { cell: (k) => formatQValue(m.peptide.bestQ[k]) }
      case 'length':
        return { cell: (k) => String(pt.sequence[k].length) }
      default:
        return { cell: () => '' }
    }
  }

  const columns = $derived(tableColumns(level.visible, cells))
</script>

{#snippet peptideCell(k: number)}
  <PeptideSequence view={peptideView(pt, k, fixedMods)} />
{/snippet}

{#snippet proteinsCell(k: number)}
  <ProteinRefs model={m} peptide={k} />
{/snippet}

<DataTable
  label="Peptides"
  rows={level.rows}
  {columns}
  sort={level.effectiveSort}
  onSort={(key) => level.sortBy(key)}
  onRowClick={(k) => (level.selected = k)}
  selected={level.selected}
  empty={level.emptyText} />
