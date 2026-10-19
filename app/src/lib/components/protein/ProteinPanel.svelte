<script lang="ts">
  // The panel of one protein, at the right of the Proteins table: its accession and name, the share of
  // its sequence that peptides cover, the strip of those peptides with the modified sites, and the
  // tabs Coverage (the sequence as a map), Peptides (expanding to their PSMs) and PSMs. A labelled
  // region, not a dialog: the table beside it stays usable. Escape closes it (Results handles the
  // key, so that it works from the table as well); focus moves in when it opens and back to the
  // protein's row when it closes (Results does both).
  import Marker from '$lib/components/results/Marker.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Tabs from '$lib/components/ui/tabs'
  import { displaySettings } from '$lib/format/settings.svelte'
  import { formatCount, parseAccession, parseDescription } from '$lib/results/display'
  import { groupMates, proteinDetail } from '$lib/results/protein'
  import type { ResultsView } from '$lib/results/view.svelte'
  import XIcon from '@lucide/svelte/icons/x'
  import CoverageMap from './CoverageMap.svelte'
  import CoverageStrip from './CoverageStrip.svelte'
  import ProteinPeptides from './ProteinPeptides.svelte'
  import ProteinPsms from './ProteinPsms.svelte'

  let {
    view,
    protein,
    onClose,
    onOpenPsmTable,
    onOpenPsm,
  }: {
    view: ResultsView
    /** The protein: a row of `tables.proteins`. */
    protein: number
    onClose: () => void
    /** "Open in PSM table": the PSMs tab, filtered by this protein, or by one of its peptides. */
    onOpenPsmTable: (filter: { protein: number } | { peptide: number }) => void
    /** A PSM of the panel: of a peptide of the Peptides tab (`peptide`), or of the PSMs tab (null). */
    onOpenPsm: (psm: number, peptide: number | null) => void
  } = $props()

  const m = $derived(view.model)
  const pr = $derived(m.tables.proteins)
  const fixedMods = $derived(view.result.settings.fixedMods)
  const detail = $derived(proteinDetail(m, protein, fixedMods))
  const accession = $derived(parseAccession(pr.accession[protein]))
  const description = $derived(parseDescription(pr.description[protein]))
  const decoy = $derived(pr.decoy[protein] === 1)
  const mates = $derived(groupMates(m, protein))
  const mateNames = $derived(mates.map((q) => parseAccession(pr.accession[q]).id))
  const fixedText = $derived(fixedMods.length > 0 ? fixedMods.join(', ') : 'none')

  // the peptide that is open in the Peptides tab (a row of `tables.peptides`): the strip shows it. The
  // view keeps it, so that it is still open when the user comes back from a PSM
  const selectedSpans = $derived(detail.peptides.find((e) => e.peptide === view.panelPeptide)?.spans ?? [])

  let heading = $state<HTMLElement | null>(null)
  /** Moves the keyboard focus into the panel (to its heading, which names the protein). */
  export function focus(): void {
    heading?.focus()
  }

  let section = $state<HTMLElement | null>(null)
  /** Moves the focus to the button of PSM `psm` if the panel lists it, else to the heading. */
  export function focusPsm(psm: number): void {
    const button = section?.querySelector<HTMLElement>(`[data-psm="${psm}"]`)
    if (button) button.focus()
    else heading?.focus()
  }

  const badge = 'inline-flex h-5 items-center rounded-[5px] border bg-muted px-[7px] text-[11.5px] font-medium whitespace-nowrap'
</script>

<section
  bind:this={section}
  aria-label="Protein {accession.id}"
  data-testid="protein-panel"
  class="flex h-full min-h-0 flex-none flex-col border-l bg-background px-[18px] pt-4 pb-3"
  style:width="clamp(520px, 45vw, 640px)">
  <header class="flex items-start justify-between gap-2">
    <div class="min-w-0">
      <div class="truncate font-mono text-xs text-muted-foreground" title={pr.accession[protein]}>
        <span data-testid="panel-accession">{accession.id}</span>{#if accession.entry}{' · '}{accession.entry}{/if}{#if detail.length > 0}{' · '}{formatCount(detail.length)} aa{/if}{#if accession.contaminant}<Marker text="contaminant" />{/if}{#if decoy}<span data-testid="panel-decoy"><Marker text="decoy" /></span>{/if}
      </div>
      <h2
        bind:this={heading}
        tabindex="-1"
        class="mt-0.5 rounded-sm text-xl font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        {description.name || accession.id}
      </h2>
      {#if mates.length > 0}
        <p class="mt-0.5 text-xs text-muted-foreground" data-testid="panel-group" title={mates.map((q) => pr.accession[q]).join('\n')}>
          Indistinguishable from: {mateNames.slice(0, 4).join(', ')}{#if mates.length > 4}
            and {mates.length - 4} more{/if}
        </p>
      {/if}
    </div>
    <Button variant="ghost" size="icon-sm" aria-label="Close protein panel" onclick={onClose}>
      <XIcon aria-hidden="true" />
    </Button>
  </header>

  <div class="mt-2.5 flex flex-wrap gap-1.5">
    <span class={badge} data-testid="panel-coverage" title="Residues covered by peptides with PSMs at the search PSM FDR"
      >Coverage {(detail.coverage * 100).toFixed(1)} %</span>
    <span class={badge} data-testid="panel-peptides" title="Peptides by plain sequence (modified forms count once)"
      >{formatCount(detail.sequences)} {detail.sequences === 1 ? 'peptide' : 'peptides'}</span>
    <span class={badge} data-testid="panel-psms">{formatCount(detail.psms)} PSMs</span>
    <span
      class="{badge} {detail.sites.length > 0 ? 'border-[#a7e9cf] bg-[#d7f5ea] text-[#065f46]' : 'text-muted-foreground'}"
      data-testid="panel-sites"
      title="Residues with a modification that the search did not fix, in peptides with PSMs"
      >{detail.sites.length} modified {detail.sites.length === 1 ? 'site' : 'sites'}</span>
  </div>

  <CoverageStrip {detail} selected={selectedSpans} />

  <Tabs.Root bind:value={view.panelTab} class="mt-2.5 flex min-h-0 flex-1 flex-col gap-2.5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <Tabs.List>
        <Tabs.Trigger value="coverage" class="px-3 text-[13px]">Coverage</Tabs.Trigger>
        <Tabs.Trigger value="peptides" class="px-3 text-[13px]"
          >Peptides<span class="ml-1 text-xs font-normal text-muted-foreground tabular-nums">{formatCount(detail.peptides.length)}</span></Tabs.Trigger>
        <Tabs.Trigger value="psms" class="px-3 text-[13px]"
          >PSMs<span class="ml-1 text-xs font-normal text-muted-foreground tabular-nums">{formatCount(detail.psms)}</span></Tabs.Trigger>
      </Tabs.List>
      <Button variant="outline" size="sm" class="h-7 px-2.5 text-xs" onclick={() => onOpenPsmTable({ protein })}>Open in PSM table ›</Button>
    </div>

    <!-- only the open tab is rendered: the map of a long protein is thousands of nodes, the PSM list a sort -->
    <Tabs.Content value="coverage" class="min-h-0 flex-1 overflow-auto pt-1">
      {#if view.panelTab === 'coverage'}
        {#if detail.length === 0}
          <p class="py-8 text-center text-muted-foreground">This protein has no sequence in the result, so there is no coverage map.</p>
        {:else}
          <CoverageMap {detail} sequence={pr.sequence[protein]} />
        {/if}
      {/if}
    </Tabs.Content>
    <Tabs.Content value="peptides" class="min-h-0 flex-1 overflow-auto">
      {#if view.panelTab === 'peptides'}
        <ProteinPeptides {view} {detail} bind:expanded={view.panelPeptide} onOpenPsm={(psm) => onOpenPsm(psm, view.panelPeptide)} {onOpenPsmTable} />
      {/if}
    </Tabs.Content>
    <Tabs.Content value="psms" class="flex min-h-0 flex-1 flex-col">
      {#if view.panelTab === 'psms'}
        <ProteinPsms {view} {detail} label="PSMs of {accession.id}" onOpenPsm={(psm) => onOpenPsm(psm, null)} />
      {/if}
    </Tabs.Content>
  </Tabs.Root>

  <!-- what a dot is, the strip says; this says what a marked residue is and what is not marked -->
  <p class="mt-2 text-xs text-muted-foreground" data-testid="panel-legend">
    {#if displaySettings.modMode === 'marked'}
      <span class="legend-mod">M<sup>ox</sup></span> modified residue (hover for the modification){#if fixedMods.length > 0}{' · '}fixed
        modifications are not marked: {fixedText}{/if}
    {:else}
      ProForma writes all modifications{#if fixedMods.length > 0}, the fixed ones too: {fixedText}. Only the others are dotted as
        sites{/if}
    {/if}
  </p>
</section>

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
