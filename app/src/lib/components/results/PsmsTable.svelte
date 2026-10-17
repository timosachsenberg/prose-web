<script lang="ts">
  // The PSMs of the open result (the best hit of each spectrum). An open search's mass shift above
  // 0.05 Da goes before the sequence as an unlocalized ProForma mass ("[+15.9949]?").
  import PeptideSequence from '$lib/components/PeptideSequence.svelte'
  import { massShift, peptideView } from '$lib/format/peptide'
  import { baseName } from '$lib/results/model'
  import { formatQValue, formatScore } from '$lib/results/display'
  import type { LevelState, ResultsView } from '$lib/results/view.svelte'
  import { fixed, signed, tableColumns, type CellDef } from './cells'
  import DataTable from './DataTable.svelte'
  import ProteinRefs from './ProteinRefs.svelte'

  let { view, level }: { view: ResultsView; level: LevelState } = $props()

  const m = $derived(view.model)
  const ps = $derived(m.tables.psms)
  const fixedMods = $derived(view.result.settings.fixedMods)

  const scan = (nativeId: string) => /(?:^|\s)scan=(\d+)/.exec(nativeId)?.[1] ?? nativeId

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
        return { cell: (i) => scan(ps.nativeId[i]), cellTitle: (i) => ps.nativeId[i] }
      case 'charge':
        return { cell: (i) => String(ps.charge[i]) }
      case 'mz':
        return { cell: (i) => fixed(ps.mz[i], 4) }
      case 'rt':
        return { cell: (i) => fixed(ps.rt[i] / 60, 2) }
      case 'precursorError':
        return { cell: (i) => signed(ps.precursorErrorPpm[i], 2) }
      case 'score':
        return { cell: (i) => formatScore(ps.score[i], ps.qValue[i]) }
      case 'qValue':
        return { cell: (i) => formatQValue(ps.qValue[i]) }
      case 'pep':
        return { cell: (i) => formatQValue(ps.pep[i]) }
      case 'deltaMass':
        return { cell: (i) => signed(ps.deltaMass[i], 4), muted: (i) => massShift(ps.deltaMass[i]) === null }
      case 'file':
        return { cell: (i) => baseName(m.tables.files[ps.file[i]]) }
      case 'isotopeError':
        return { cell: (i) => String(ps.isotopeError[i]) }
      default:
        return { cell: () => '' }
    }
  }

  const columns = $derived(tableColumns(level.visible, cells))
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
  label="PSMs"
  rows={level.rows}
  {columns}
  sort={level.effectiveSort}
  onSort={(key) => level.sortBy(key)}
  onRowClick={(i) => (level.selected = i)}
  selected={level.selected}
  empty={level.emptyText} />
