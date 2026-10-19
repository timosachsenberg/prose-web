<script lang="ts">
  // The Overview tab: what was searched and how (the settings that matter for reading the numbers), a
  // table of the searched files with what the search reports of each, and, for an open search, the mass
  // shifts the PSMs carry. The key figures stand above the tabs.
  import * as Table from '$lib/components/ui/table'
  import { formatPercent, formatQ } from '$lib/format/fdr'
  import { formatCount } from '$lib/results/display'
  import { fileRows, formatSeconds, totalsOf } from '$lib/results/overview'
  import type { ResultsView } from '$lib/results/view.svelte'
  import DeltaMassPanel from './DeltaMassPanel.svelte'

  let { view }: { view: ResultsView } = $props()

  const result = $derived(view.result)
  const summary = $derived(result.outcome.summary)
  const settings = $derived(result.settings)
  const rows = $derived(fileRows(view.model, summary))
  const totals = $derived(totalsOf(rows))
  const showNce = $derived(rows.some((r) => r.nce !== null))

  const fdr = (q: number) => `${formatPercent(q)} (${formatQ(q)})`
  const rescoring = $derived.by(() => {
    const applied = summary.files.filter((f) => f.percolator?.applied).length
    const asked = summary.files.some((f) => f.percolator !== null)
    const percolator = applied === 0 ? (asked ? 'Percolator was skipped' : 'none') : applied < summary.files.length ? 'Percolator (not for every file)' : 'Percolator'
    return settings.peptdeep && applied > 0 ? `${percolator} with PeptDeep predictions` : percolator
  })

  const facts = $derived([
    { name: 'Database', value: `${settings.database}${settings.contaminants ? ' + contaminants' : ''}` },
    { name: 'Search', value: summary.openSearch ? 'Open search (wide precursor window)' : 'Standard precursor window' },
    { name: 'PSM FDR', value: fdr(summary.psmFdr) },
    { name: 'Protein FDR', value: summary.proteinFdrApplied ? fdr(summary.proteinFdr) : 'not applied' },
    { name: 'Fixed modifications', value: settings.fixedMods.length > 0 ? settings.fixedMods.join(', ') : 'none' },
    { name: 'Rescoring', value: rescoring },
    { name: 'Total time', value: formatSeconds(result.outcome.seconds) },
  ])

  const head = 'h-auto border-b px-2.5 py-1.5 font-medium text-muted-foreground'
  const cell = 'border-b px-2.5 py-1.5'
  const foot = 'px-2.5 py-1.5 font-medium'
</script>

<div class="flex flex-col gap-6 pb-6">
  <section aria-labelledby="overview-search">
    <h2 id="overview-search" class="mb-2 text-[13px] font-semibold">Search</h2>
    <dl class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-6 gap-y-2 text-xs" data-testid="search-facts">
      {#each facts as fact (fact.name)}
        <div class="min-w-0">
          <dt class="text-muted-foreground">{fact.name}</dt>
          <dd class="truncate" title={fact.value}>{fact.value}</dd>
        </div>
      {/each}
    </dl>
  </section>

  <section aria-labelledby="overview-files">
    <h2 id="overview-files" class="mb-2 text-[13px] font-semibold">Files</h2>
    <div class="rounded-lg border bg-background">
      <Table.Root class="text-xs tabular-nums" aria-label="Searched files">
        <Table.Header>
          <Table.Row class="hover:bg-transparent">
            <Table.Head scope="col" class="{head} text-left">File</Table.Head>
            <Table.Head scope="col" class="{head} text-left" title="The sample of the design that the file belongs to">Sample</Table.Head>
            <Table.Head scope="col" class="{head} text-right" title="MS2 spectra in the file">MS2 spectra</Table.Head>
            <Table.Head scope="col" class="{head} text-right" title="Target PSMs the search reports for the file">Target PSMs</Table.Head>
            <Table.Head scope="col" class="{head} text-right" title="Decoy PSMs the search reports for the file">Decoy PSMs</Table.Head>
            <Table.Head scope="col" class="{head} text-left" title="Whether Percolator rescored the PSMs of the file, and why not if it did not">Percolator</Table.Head>
            {#if showNce}
              <Table.Head scope="col" class="{head} text-right" title="The normalised collision energy that PeptDeep calibrated for the file">PeptDeep NCE</Table.Head>
            {/if}
            <Table.Head scope="col" class="{head} text-right" title="How long the database search of the file took (the engine's own measure, without reading the files and loading the models)">Database search</Table.Head>
            <Table.Head scope="col" class="{head} text-left">Status</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each rows as r (r.index)}
            <Table.Row>
              <Table.Cell data-column="file" class="{cell} text-left font-medium">{r.file}</Table.Cell>
              <Table.Cell data-column="sample" class="{cell} text-left">{r.sample ?? '–'}</Table.Cell>
              <Table.Cell data-column="ms2" class="{cell} text-right">{r.ms2 === null ? '–' : formatCount(r.ms2)}</Table.Cell>
              <Table.Cell data-column="targets" class="{cell} text-right">{r.targets === null ? '–' : formatCount(r.targets)}</Table.Cell>
              <Table.Cell data-column="decoys" class="{cell} text-right">{r.decoys === null ? '–' : formatCount(r.decoys)}</Table.Cell>
              <Table.Cell data-column="percolator" class="{cell} text-left whitespace-normal {r.percolator.kind === 'off' ? 'text-muted-foreground' : ''}">
                {r.percolator.label}{#if r.percolator.detail}<span class="block max-w-[28rem] font-normal text-muted-foreground">{r.percolator.detail}</span>{/if}{#if r.percolator.warning}<span class="block max-w-[28rem] font-normal text-muted-foreground">Warning: {r.percolator.warning}</span>{/if}
              </Table.Cell>
              {#if showNce}
                <Table.Cell data-column="nce" class="{cell} text-right">{r.nce === null ? '–' : String(Number(r.nce.toFixed(1)))}</Table.Cell>
              {/if}
              <Table.Cell data-column="time" class="{cell} text-right">{r.seconds === null ? '–' : formatSeconds(r.seconds)}</Table.Cell>
              <Table.Cell data-column="status" class="{cell} text-left {r.status.ok ? '' : 'font-medium text-destructive'}">{r.status.label}</Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
        {#if rows.length > 1}
          <Table.Footer>
            <Table.Row class="hover:bg-transparent">
              <Table.Head scope="row" colspan={2} class="h-auto px-2.5 py-1.5 text-left font-semibold">All files</Table.Head>
              <Table.Cell data-column="ms2" class="{foot} text-right">{formatCount(totals.ms2)}</Table.Cell>
              <Table.Cell data-column="targets" class="{foot} text-right">{formatCount(totals.targets)}</Table.Cell>
              <Table.Cell data-column="decoys" class="{foot} text-right">{formatCount(totals.decoys)}</Table.Cell>
              <Table.Cell colspan={showNce ? 2 : 1} class={foot}></Table.Cell>
              <Table.Cell data-column="time" class="{foot} text-right">{formatSeconds(totals.seconds)}</Table.Cell>
              <Table.Cell class={foot}></Table.Cell>
            </Table.Row>
          </Table.Footer>
        {/if}
      </Table.Root>
    </div>
  </section>

  {#if summary.openSearch}
    {#if summary.modificationAnalysis}
      <DeltaMassPanel analysis={summary.modificationAnalysis} />
    {:else}
      <section data-testid="delta-mass-missing" aria-labelledby="delta-mass-heading">
        <h2 id="delta-mass-heading" class="mb-1 text-[13px] font-semibold">Mass shifts (open search)</h2>
        <p class="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
          The search reports no analysis of its mass shifts. The Δ mass column of the PSM table has them.
        </p>
      </section>
    {/if}
  {/if}
</div>
