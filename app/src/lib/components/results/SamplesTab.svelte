<script lang="ts">
  // The Samples tab: for each sample of the design, grouped by condition, how many PSMs, peptides and
  // proteins the search found in it, counted as the tables count (see `sampleTable`). A condition's row
  // and the last row count each peptide and protein once, so they are not the sums of the rows above.
  import { Switch } from '$lib/components/ui/switch'
  import * as Table from '$lib/components/ui/table'
  import { formatPercent, formatQ } from '$lib/format/fdr'
  import { formatCount } from '$lib/results/display'
  import { sampleTable, type SampleCounts } from '$lib/results/samples'
  import type { ResultsView } from '$lib/results/view.svelte'

  let { view }: { view: ResultsView } = $props()

  const m = $derived(view.model)
  const table = $derived(sampleTable(m))
  const files = (samples: { files: number }[]) => samples.reduce((n, s) => n + s.files, 0)
  const allFiles = $derived(table.groups.reduce((n, g) => n + files(g.samples), 0))

  const psmFdr = $derived(`${formatPercent(m.psmFdr)}, ${formatQ(m.psmFdr)}`)
  const proteinFdr = $derived(`${formatPercent(m.proteinFdr)}, ${formatQ(m.proteinFdr)}`)
  const titles = $derived({
    psms: `Target PSMs at the search PSM FDR (${psmFdr}), contaminants included, decoys not.`,
    peptides:
      `Counted as distinct peptide sequences with a target PSM at the search PSM FDR (${psmFdr}): a sequence and its modified forms count once, ` +
      `as the protein counts do. The Peptides tab lists each modified form as a row of its own. A condition's row and the last row count each sequence once.`,
    proteins:
      `Counted as protein groups at the search protein FDR (${proteinFdr}) with a PSM in the sample. Proteins that cannot be told apart count once, ` +
      `as in the key figures, while the Proteins tab lists every protein. A condition's row and the last row count each group once.`,
  })

  const head = 'h-auto border-b px-2.5 py-1.5 text-right font-medium text-muted-foreground'
  const cell = 'border-b px-2.5 py-1.5 text-right'
  const foot = 'px-2.5 py-1.5 text-right font-medium'
</script>

{#snippet numbers(c: SampleCounts, style: string)}
  <Table.Cell data-column="psms" class={style}>{formatCount(c.psms)}</Table.Cell>
  <Table.Cell data-column="peptides" class={style}>{formatCount(c.peptides)}</Table.Cell>
  <Table.Cell data-column="proteins" class={style}>{formatCount(c.proteins)}</Table.Cell>
{/snippet}

<div class="flex flex-col gap-3 pb-6">
  <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
    <p class="text-xs text-muted-foreground" data-testid="samples-note">
      Target PSMs at the search's PSM FDR ({psmFdr}). Peptides are distinct sequences, proteins are protein groups at the protein FDR.
      The key figures count peptide forms and protein groups; the totals here count distinct sequences and groups with a PSM.
    </p>
    {#if view.hasTechReplicates}
      <!-- the same setting as the Columns menu of the Proteins and Peptides tabs -->
      <label class="flex items-center gap-2 text-xs">
        <Switch size="sm" checked={view.showTechReplicates} onCheckedChange={(on) => view.setShowTechReplicates(on)} />
        Show technical replicates separately
      </label>
    {/if}
  </div>
  <div class="rounded-lg border bg-background">
    <Table.Root class="text-xs tabular-nums" aria-label="Samples by condition">
      <Table.Header>
        <Table.Row class="hover:bg-transparent">
          <Table.Head scope="col" class="{head} text-left">Sample</Table.Head>
          <Table.Head scope="col" class={head} title="Searched files of the sample: its fractions and, if technical replicates are merged, its repeats">Files</Table.Head>
          <Table.Head scope="col" class={head} title={titles.psms}>PSMs</Table.Head>
          <Table.Head scope="col" class={head} title={titles.peptides}>Peptides</Table.Head>
          <Table.Head scope="col" class={head} title={titles.proteins}>Proteins</Table.Head>
        </Table.Row>
      </Table.Header>
      {#each table.groups as group (group.name ?? '')}
        <Table.Body>
          {#if group.name !== null}
            <Table.Row class="bg-muted/40 hover:bg-muted/40" data-testid="condition-row">
              <Table.Head scope="rowgroup" class="h-auto border-b px-2.5 py-1.5 text-left font-semibold"
                >{group.name}<span class="ml-1.5 font-normal text-muted-foreground">· {group.sampleCount} {group.sampleCount === 1 ? 'sample' : 'samples'}</span></Table.Head>
              <Table.Cell data-column="files" class="{cell} font-medium">{formatCount(files(group.samples))}</Table.Cell>
              {@render numbers(group.counts, `${cell} font-medium`)}
            </Table.Row>
          {/if}
          {#each group.samples as s (s.column)}
            <Table.Row data-testid="sample-row">
              <Table.Head scope="row" class="h-auto border-b py-1.5 text-left font-normal {group.name !== null ? 'pr-2.5 pl-6' : 'px-2.5'}">{s.label}</Table.Head>
              <Table.Cell data-column="files" class={cell}>{formatCount(s.files)}</Table.Cell>
              {@render numbers(s.counts, cell)}
            </Table.Row>
          {/each}
        </Table.Body>
      {/each}
      <Table.Footer>
        <Table.Row class="hover:bg-transparent">
          <Table.Head scope="row" class="h-auto px-2.5 py-1.5 text-left font-semibold">All samples</Table.Head>
          <Table.Cell data-column="files" class={foot}>{formatCount(allFiles)}</Table.Cell>
          {@render numbers(table.total, foot)}
        </Table.Row>
      </Table.Footer>
    </Table.Root>
  </div>
</div>
