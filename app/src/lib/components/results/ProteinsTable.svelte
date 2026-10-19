<script lang="ts">
  // The proteins of the open result: accession, gene, description, coverage, counts (at the search
  // PSM FDR), counts per sample grouped by condition, "found in".
  import { formatCount, formatQValue, formatScore, parseAccession, parseDescription } from '$lib/results/display'
  import type { LevelState, ResultsView } from '$lib/results/view.svelte'
  import { tableColumns, sampleIndex, type CellDef } from './cells'
  import DataTable from './DataTable.svelte'
  import Marker from './Marker.svelte'

  let { view, level }: { view: ResultsView; level: LevelState } = $props()

  const m = $derived(view.model)
  const pr = $derived(m.tables.proteins)
  const nS = $derived(m.samples.length)
  const nBio = $derived(new Set(m.columnSample).size)

  function cells(id: string): CellDef {
    const s = sampleIndex(id)
    if (s >= 0) {
      const count = (p: number) => m.protein.perSample[p * nS + s]
      return { cell: (p) => (count(p) === 0 ? '–' : formatCount(count(p))), placeholder: (p) => count(p) === 0 }
    }
    switch (id) {
      case 'accession':
        return { cell: () => accessionCell, cellTitle: (p) => pr.accession[p] }
      case 'gene':
        return { cell: (p) => parseDescription(pr.description[p]).gene ?? '–', placeholder: (p) => parseDescription(pr.description[p]).gene === null }
      case 'description':
        return { cell: (p) => parseDescription(pr.description[p]).name, cellTitle: (p) => pr.description[p] }
      case 'coverage':
        return { cell: () => coverageCell }
      case 'peptides':
        return { cell: (p) => formatCount(m.protein.peptides[p]) }
      case 'psms':
        return { cell: (p) => formatCount(m.protein.psms[p]) }
      case 'foundIn':
        return { cell: (p) => `${m.protein.foundIn[p]} / ${nBio}`, class: 'text-muted-foreground' }
      case 'qValue':
        return { cell: (p) => formatQValue(pr.qValue[p]) }
      case 'score':
        return { cell: (p) => formatScore(pr.score[p], 0) }
      case 'length':
        return { cell: (p) => formatCount(pr.sequence[p].length) }
      case 'group':
        return { cell: (p) => String(pr.group[p]) }
      default:
        return { cell: () => '' }
    }
  }

  const columns = $derived(tableColumns(level.visible, cells))
</script>

{#snippet accessionCell(p: number)}
  {@const a = parseAccession(pr.accession[p])}
  <span class="font-mono text-[12.5px]">{a.id}</span>{#if a.contaminant}<Marker text="contaminant" />{/if}{#if pr.decoy[p]}<Marker
      text="decoy" />{/if}
{/snippet}

{#snippet coverageCell(p: number)}
  {@const c = m.protein.coverage[p]}
  <span class="inline-flex items-center gap-1.5">
    <span class="h-1.5 w-[54px] overflow-hidden rounded-full bg-muted"
      ><span class="block h-full rounded-full bg-[#2a78d6]" style:width="{(c * 100).toFixed(1)}%"></span></span
    ><span class="text-xs text-muted-foreground">{(c * 100).toFixed(0)} %</span>
  </span>
{/snippet}

<DataTable
  label="Proteins"
  rows={level.rows}
  {columns}
  sort={level.effectiveSort}
  onSort={(key) => level.sortBy(key)}
  onRowClick={(p) => (level.selected = p)}
  selected={level.selected}
  empty={level.emptyText} />
