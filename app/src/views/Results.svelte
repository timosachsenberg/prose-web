<script lang="ts">
  // The results of the open search: key figures, the tabs of the three levels, one filter row and a
  // virtualized table per level, the column settings and "Export CSV · n rows".
  import ColumnsMenu from '$lib/components/results/ColumnsMenu.svelte'
  import FilterBar from '$lib/components/results/FilterBar.svelte'
  import KeyFigures from '$lib/components/results/KeyFigures.svelte'
  import ProteinPanel from '$lib/components/protein/ProteinPanel.svelte'
  import PeptidesTable from '$lib/components/results/PeptidesTable.svelte'
  import ProteinsEmpty from '$lib/components/results/ProteinsEmpty.svelte'
  import ProteinsTable from '$lib/components/results/ProteinsTable.svelte'
  import PsmsTable from '$lib/components/results/PsmsTable.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Tabs from '$lib/components/ui/tabs'
  import { displaySettings } from '$lib/format/settings.svelte'
  import { formatCount } from '$lib/results/display'
  import { exportCsv } from '$lib/results/exports'
  import { keyFigures, levelTotal } from '$lib/results/figures'
  import { resultsViewFor, type Tab } from '$lib/results/view.svelte'
  import { openResult } from '$lib/search/session.svelte'
  import { tick } from 'svelte'

  let { id }: { id: string | null } = $props()

  const result = $derived(openResult.current !== null && openResult.current.id === id ? openResult.current : null)
  const view = $derived(result ? resultsViewFor(result) : null)

  // at the search's cutoffs, without decoys: the key figures and the tabs' counts
  const figures = $derived(view ? keyFigures(view.model, view.result.outcome.summary) : null)
  const peptideTotal = $derived(view ? levelTotal(view.model, 'peptides', false) : 0)
  const proteinTotal = $derived(view ? levelTotal(view.model, 'proteins', false) : 0)

  const tabs = $derived<{ value: Tab; label: string; count?: number; later?: string }[]>([
    // TODO(C10): Overview, Samples and QC
    { value: 'overview', label: 'Overview', later: 'The overview comes in a later version.' },
    { value: 'proteins', label: 'Proteins', count: proteinTotal },
    { value: 'peptides', label: 'Peptides', count: peptideTotal },
    { value: 'psms', label: 'PSMs', count: figures?.psms ?? 0 },
    { value: 'samples', label: 'Samples', later: 'The samples view comes in a later version.' },
    { value: 'qc', label: 'QC', later: 'Quality control comes in a later version.' },
  ])

  // no protein passed the search's protein FDR, but there are identifications: say why
  const noProteins = $derived(
    view !== null && figures !== null && view.result.outcome.summary.proteinFdrApplied && figures.psms > 0 &&
      levelTotal(view.model, 'proteins', true) === 0,
  )

  const fixedMods = $derived(view?.result.settings.fixedMods ?? [])
  const fixedText = $derived(fixedMods.length > 0 ? fixedMods.join(', ') : 'none')

  // The protein panel stands beside the Proteins table (the key figures give way to it, as in the
  // mockup). It opens with focus inside and closes with focus back on the protein's row.
  const panelOpen = $derived(view !== null && view.tab === 'proteins' && view.panel !== null && !noProteins)

  let proteinsTable = $state<ProteinsTable | null>(null)
  let psmsTable = $state<PsmsTable | null>(null)
  let panel = $state<ProteinPanel | null>(null)

  async function openProtein(protein: number) {
    view?.openProtein(protein)
    await tick()
    panel?.focus()
  }

  async function closePanel() {
    if (!view) return
    const protein = view.panel
    view.closeProtein()
    await tick()
    proteinsTable?.focusRow(protein)
  }

  /** "Open in PSM table": the PSMs tab with the protein's chip; the focus goes to the table. */
  async function openInPsmTable(protein: number) {
    view?.filterBy({ protein })
    await tick()
    psmsTable?.focusRow(null)
  }

  /** A PSM of the panel: until the PSM view (C9), the PSMs tab with the PSM selected, scrolled to and focused. */
  async function openPsm(psm: number) {
    view?.openPsm(psm)
    await tick()
    psmsTable?.focusRow(psm)
  }

  // Escape closes the panel from the panel and from the Proteins table (menus and fields that use
  // the key themselves have handled it first)
  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented || !panelOpen || !(event.target instanceof Element)) return
    const inside = event.target.closest('[data-testid="protein-panel"], [role="grid"][aria-label="Proteins"]')
    if (inside) {
      event.preventDefault()
      void closePanel()
    }
  }
</script>

<svelte:window {onkeydown} />

{#if view && figures}
  {@const level = view.level}
  <section data-testid="view-results" class="flex h-[calc(100vh-52px)] min-h-[480px]">
    <div class="flex min-w-0 flex-1 flex-col gap-3 px-5 py-4">
      <h1 class="sr-only">Results</h1>
      {#if !panelOpen}
        <KeyFigures {figures} proteinFdr={view.result.proteinFdr} proteinFdrApplied={view.result.outcome.summary.proteinFdrApplied} />
      {/if}

      <Tabs.Root bind:value={view.tab} class="flex min-h-0 flex-1 flex-col gap-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <Tabs.List>
            {#each tabs as t (t.value)}
              <Tabs.Trigger value={t.value} disabled={t.later !== undefined} title={t.later} class="px-3 text-[13px]">
                {t.label}{#if t.count !== undefined}<span class="ml-1 text-xs font-normal text-muted-foreground tabular-nums"
                    >{formatCount(t.count)}</span
                  >{/if}
              </Tabs.Trigger>
            {/each}
          </Tabs.List>
          {#if level}
            <div class="flex items-center gap-2">
              <ColumnsMenu {view} {level} />
              <Button size="sm" class="h-7 px-2.5 text-xs" disabled={view.exporting} onclick={() => exportCsv(view)}>
                {#if view.exporting}
                  Exporting…
                {:else}
                  Export CSV · {formatCount(level.rows.length)}
                  {level.rows.length === 1 ? 'row' : 'rows'}
                {/if}
              </Button>
            </div>
          {/if}
        </div>

        {#if level}
          <Tabs.Content value={view.tab} tabindex={-1} class="flex min-h-0 flex-1 flex-col gap-3" data-testid="results-table">
            {#key level}
              <FilterBar {view} {level} proteinFdrApplied={view.result.outcome.summary.proteinFdrApplied} />
            {/key}
            {#if level.level === 'proteins' && noProteins}
              <ProteinsEmpty {view} peptides={peptideTotal} psms={figures.psms} />
            {:else if level.level === 'proteins'}
              <ProteinsTable bind:this={proteinsTable} {view} {level} onOpen={openProtein} />
            {:else if level.level === 'peptides'}
              <PeptidesTable {view} {level} />
            {:else}
              <PsmsTable bind:this={psmsTable} {view} {level} />
            {/if}
            {#if level.level !== 'proteins'}
              <p class="-mt-1 text-xs text-muted-foreground" data-testid="mod-legend">
                {#if displaySettings.modMode === 'marked'}
                  <span class="legend-mod">M<sup>ox</sup></span> modified residue (hover for the modification) · fixed
                  modifications ({fixedText}) are not marked
                {:else}
                  ProForma: fixed modifications included ({fixedText})
                {/if}
                · CSV and copy write ProForma
              </p>
            {/if}
          </Tabs.Content>
        {/if}
      </Tabs.Root>
    </div>
    {#if panelOpen && view.panel !== null}
      {#key view.panel}
        <ProteinPanel bind:this={panel} {view} protein={view.panel} onClose={closePanel} onOpenPsmTable={openInPsmTable} onOpenPsm={openPsm} />
      {/key}
    {/if}
  </section>
{:else}
  <section data-testid="view-results" class="mx-auto max-w-[1120px] px-5 pt-6 pb-24">
    <h1 class="mb-1 text-xl font-semibold tracking-tight">Results</h1>
    <p class="mb-5 text-muted-foreground">
      {#if id === null}No result is open. Start a search, or open one from History.{:else}Result {id} is not open in this
        session.{/if}
    </p>
  </section>
{/if}

<style>
  .legend-mod {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace;
    background: #d7f5ea;
    color: #065f46;
    border-radius: 3px;
    padding: 0 1px;
    box-shadow: inset 0 -1.5px 0 #1baf7a;
  }
  .legend-mod sup {
    font-size: 9px;
    font-weight: 600;
    line-height: 0;
    margin-left: 1px;
  }
</style>
