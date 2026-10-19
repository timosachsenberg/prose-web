<script lang="ts">
  // The results of the open search: key figures, the tabs of the three levels, one filter row and a
  // virtualized table per level, the column settings and "Export CSV · n rows". A protein opens its
  // panel beside the Proteins table; a PSM opens the PSM view beside the PSM table, which then narrows
  // to the list that "Previous" and "Next" go through. The Overview (files, and the mass shifts of an
  // open search), Samples and QC tabs show the search as a whole; Proteins stays the first view.
  import SaveNotice from '$lib/components/history/SaveNotice.svelte'
  import ColumnsMenu from '$lib/components/results/ColumnsMenu.svelte'
  import FilterBar from '$lib/components/results/FilterBar.svelte'
  import KeyFigures from '$lib/components/results/KeyFigures.svelte'
  import OverviewTab from '$lib/components/results/OverviewTab.svelte'
  import ProteinPanel from '$lib/components/protein/ProteinPanel.svelte'
  import PsmView from '$lib/components/psm/PsmView.svelte'
  import PeptidesTable from '$lib/components/results/PeptidesTable.svelte'
  import ProteinsEmpty from '$lib/components/results/ProteinsEmpty.svelte'
  import ProteinsTable from '$lib/components/results/ProteinsTable.svelte'
  import PsmsTable from '$lib/components/results/PsmsTable.svelte'
  import QcTab from '$lib/components/results/QcTab.svelte'
  import SamplesTab from '$lib/components/results/SamplesTab.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Tabs from '$lib/components/ui/tabs'
  import { displaySettings } from '$lib/format/settings.svelte'
  import { formatCount } from '$lib/results/display'
  import { exportCsv } from '$lib/results/exports'
  import { keyFigures, levelTotal } from '$lib/results/figures'
  import { restoreFromHistory } from '$lib/persist/history.svelte'
  import { resultsViewFor, type Tab } from '$lib/results/view.svelte'
  import { openResult } from '$lib/search/session.svelte'
  import { tick } from 'svelte'

  let { id }: { id: string | null } = $props()

  const result = $derived(openResult.current !== null && openResult.current.id === id ? openResult.current : null)
  const view = $derived(result ? resultsViewFor(result) : null)

  // An address of a search that is not open (after a reload): History may have it
  let restoring = $state<string | null>(null)
  let restoreFailed = $state<{ id: string; reason: string | null } | null>(null)
  $effect(() => {
    const wanted = id
    if (wanted === null || result !== null || restoring === wanted || restoreFailed?.id === wanted) return
    restoring = wanted
    restoreFromHistory(wanted)
      .then((found) => {
        if (!found) restoreFailed = { id: wanted, reason: null }
      })
      .catch((e) => (restoreFailed = { id: wanted, reason: String((e as Error)?.message ?? e) }))
      .finally(() => {
        if (restoring === wanted) restoring = null
      })
  })

  // at the search's cutoffs, without decoys: the key figures and the tabs' counts
  const figures = $derived(view ? keyFigures(view.model, view.result.outcome.summary) : null)
  const peptideTotal = $derived(view ? levelTotal(view.model, 'peptides', false) : 0)
  const proteinTotal = $derived(view ? levelTotal(view.model, 'proteins', false) : 0)

  const tabs = $derived<{ value: Tab; label: string; count?: number }[]>([
    { value: 'overview', label: 'Overview' },
    { value: 'proteins', label: 'Proteins', count: proteinTotal },
    { value: 'peptides', label: 'Peptides', count: peptideTotal },
    { value: 'psms', label: 'PSMs', count: figures?.psms ?? 0 },
    { value: 'samples', label: 'Samples' },
    { value: 'qc', label: 'QC' },
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
  // The PSM view stands beside the PSM table, which narrows to a list (its filter row stays)
  const psmOpen = $derived(view !== null && view.tab === 'psms' && view.psm !== null)

  let proteinsTable = $state<ProteinsTable | null>(null)
  let psmsTable = $state<PsmsTable | null>(null)
  let panel = $state<ProteinPanel | null>(null)
  let psmView = $state<PsmView | null>(null)

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

  /** "Open in PSM table": the PSMs tab with the chip of the protein or peptide; the focus goes to the table. */
  async function openInPsmTable(filter: { protein: number } | { peptide: number }) {
    view?.filterBy(filter)
    await tick()
    psmsTable?.focusRow(null)
  }

  /**
   * A PSM of the PSM table opens the PSM view beside it. The focus stays in the table (now the list
   * beside the view), so that the keyboard goes on through the PSMs; the view announces the PSM, and
   * Tab leads into it.
   */
  function openPsm(psm: number) {
    view?.openPsm(psm)
  }

  /** A PSM of the protein panel: the PSM view beside the PSMs of its peptide (or protein). */
  async function openPsmFromPanel(psm: number, peptide: number | null) {
    view?.openPsmFromPanel(psm, peptide)
    await tick()
    psmView?.focus()
  }

  /** Back from the PSM view: to the PSM table at the PSM, or to the protein panel at the PSM's button. */
  async function closePsm() {
    if (!view?.psm) return
    const psm = view.psm.row
    const origin = view.closePsm()
    await tick()
    if (origin?.kind === 'panel') panel?.focusPsm(psm)
    else psmsTable?.focusRow(psm)
  }

  /** A breadcrumb of the PSM view: a tab, a protein's panel, or the PSM table of a peptide. */
  async function breadcrumb(to: { tab: 'proteins' | 'peptides' } | { protein: number } | { peptide: number }) {
    if (!view) return
    view.closePsm()
    if ('tab' in to) view.tab = to.tab
    else if ('protein' in to) {
      view.tab = 'proteins'
      await openProtein(to.protein)
    } else await openInPsmTable({ peptide: to.peptide })
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
  <section data-testid="view-results" class="absolute inset-0 flex">
    <div
      class="flex min-w-0 flex-col gap-3 py-4 {psmOpen ? 'flex-none border-r pr-3 pl-4' : 'flex-1 px-5'}"
      style:width={psmOpen ? 'clamp(320px, 27vw, 400px)' : undefined}>
      <h1 class="sr-only">Results</h1>
      <SaveNotice id={view.result.id} />
      {#if !panelOpen && !psmOpen}
        <KeyFigures {figures} proteinFdr={view.result.proteinFdr} proteinFdrApplied={view.result.outcome.summary.proteinFdrApplied} />
      {/if}

      <Tabs.Root bind:value={view.tab} class="flex min-h-0 flex-1 flex-col gap-3">
        <div class="flex flex-wrap items-center justify-between gap-2" class:hidden={psmOpen}>
          <!-- scrolls sideways where the window is too narrow for all tabs -->
          <Tabs.List class="max-w-full overflow-x-auto">
            {#each tabs as t (t.value)}
              <Tabs.Trigger value={t.value} class="px-3 text-[13px]">
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
              <PsmsTable bind:this={psmsTable} {view} {level} onOpen={openPsm} compact={psmOpen} />
            {/if}
            {#if level.level !== 'proteins' && !psmOpen}
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
        {:else}
          <!-- Overview, Samples and QC: the search as a whole; they scroll in their own box -->
          <Tabs.Content value={view.tab} tabindex={-1} class="min-h-0 flex-1 overflow-y-auto" data-testid="{view.tab}-tab">
            {#if view.tab === 'overview'}
              <OverviewTab {view} />
            {:else if view.tab === 'samples'}
              <SamplesTab {view} />
            {:else}
              <QcTab {view} />
            {/if}
          </Tabs.Content>
        {/if}
      </Tabs.Root>
    </div>
    {#if panelOpen && view.panel !== null}
      {#key view.panel}
        <ProteinPanel bind:this={panel} {view} protein={view.panel} onClose={closePanel} onOpenPsmTable={openInPsmTable} onOpenPsm={openPsmFromPanel} />
      {/key}
    {/if}
    {#if psmOpen}
      <PsmView bind:this={psmView} {view} onClose={closePsm} onBreadcrumb={breadcrumb} />
    {/if}
  </section>
{:else}
  <section data-testid="view-results" class="mx-auto max-w-[1120px] px-5 pt-6 pb-24">
    <h1 class="mb-1 text-xl font-semibold tracking-tight">Results</h1>
    <p class="mb-5 text-muted-foreground" data-testid="results-none">
      {#if id === null}No result is open. Start a search, or open one from History.{:else if restoring === id}Opening result {id}
        from History…{:else if restoreFailed?.id === id && restoreFailed.reason}Result {id} could not be opened from
        History: {restoreFailed.reason}{:else}Result {id} is not open, and History does not have it. Open one from History.{/if}
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
