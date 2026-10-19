<script lang="ts">
  // The mass shifts of an open search, in the Overview: how many PSMs carry a shift, a histogram of the
  // delta-mass peaks (known modifications named, in the colour of modified residues), the peaks as a
  // table (the chart's table view) and the shifts the engine mapped to known modifications. All of it
  // is the engine's modification analysis of the search.
  import ShiftChart from '$lib/components/charts/ShiftChart.svelte'
  import * as Table from '$lib/components/ui/table'
  import type { ModificationAnalysis } from '$lib/engine/openms-types'
  import { COLORS } from '$lib/psm/psm'
  import { formatCount } from '$lib/results/display'
  import { massShiftBars, massShiftRows, ptmRows, shiftSummary } from '$lib/results/delta-mass'

  let { analysis }: { analysis: NonNullable<ModificationAnalysis> } = $props()

  const summary = $derived(shiftSummary(analysis))
  const bars = $derived(massShiftBars(analysis))
  const shifts = $derived(massShiftRows(analysis))
  const ptms = $derived(ptmRows(analysis))

  const description = $derived.by(() => {
    const top = [...bars].sort((a, b) => b.count - a.count)[0]
    return (
      `${bars.length} delta-mass peaks of ${formatCount(summary.shifted)} PSMs with a mass shift above 0.05 Da, ` +
      `from ${bars[0]?.label ?? ''} to ${bars.at(-1)?.label ?? ''} Da; ` +
      (top ? `the most frequent is ${top.label} with ${formatCount(top.count)} PSMs. ` : '') +
      `Bars of known modifications are green and carry the modification's name, the others are grey and carry their mass.`
    )
  })

  const head = 'border-b px-2.5 py-1.5 font-medium text-muted-foreground'
  const cell = 'border-b px-2.5 py-1'
</script>

<section class="flex flex-col gap-3" data-testid="delta-mass-panel" aria-labelledby="delta-mass-heading">
  <div>
    <h2 id="delta-mass-heading" class="text-[13px] font-semibold">Mass shifts (open search)</h2>
    <p class="mt-0.5 text-xs text-muted-foreground" data-testid="shift-summary">
      {formatCount(summary.shifted)} of {formatCount(summary.total)} PSMs (targets and decoys) carry a mass shift above 0.05 Da ({(summary.shareShifted * 100).toFixed(1)} %);
      {formatCount(summary.unmodified)} are unmodified.
      {#if summary.shifted > 0}
        Of the shifted PSMs, {formatCount(summary.mapped)} match a known modification and {formatCount(summary.unassigned)} do not.
      {/if}
    </p>
  </div>

  {#if bars.length === 0}
    <p class="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground" data-testid="no-shifts">
      The open search found no mass shift above 0.05 Da.
    </p>
  {:else}
    <div class="rounded-lg border bg-background px-4 pt-3 pb-2">
      <ul class="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid="legend" aria-label="Legend">
        <li class="flex items-center gap-1.5"><span class="inline-block size-2.5 rounded-[3px]" style:background={COLORS.mod} aria-hidden="true"></span>Known modification</li>
        <li class="flex items-center gap-1.5"><span class="inline-block size-2.5 rounded-[3px]" style:background="#71717a" aria-hidden="true"></span>No known modification</li>
      </ul>
      <ShiftChart title="PSMs by delta mass in the open search" {description} {bars} unmodified={summary.unmodified} />
    </div>

    <div class="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div class="min-w-0">
        <h3 class="mb-1 text-xs font-medium text-muted-foreground">The shifts, most frequent first</h3>
        <div class="max-h-72 overflow-y-auto rounded-lg border bg-background">
          <Table.Root class="text-xs tabular-nums" aria-label="Mass shifts">
            <Table.Header class="sticky top-0 bg-background">
              <Table.Row class="hover:bg-transparent">
                <Table.Head scope="col" class="{head} h-auto text-right" title="Delta mass: observed minus theoretical mass of the peptide, in Da">Δ mass (Da)</Table.Head>
                <Table.Head scope="col" class="{head} h-auto text-right">PSMs</Table.Head>
                <Table.Head scope="col" class="{head} h-auto text-right" title="Share of the PSMs with a mass shift">%</Table.Head>
                <Table.Head scope="col" class="{head} h-auto text-left" title="The known modification (Unimod) with this mass">Modification</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each shifts as row (row.mass)}
                <Table.Row>
                  <Table.Cell data-column="mass" class="{cell} text-right">{row.mass}</Table.Cell>
                  <Table.Cell data-column="psms" class="{cell} text-right">{formatCount(row.psms)}</Table.Cell>
                  <Table.Cell data-column="share" class="{cell} text-right">{row.share}</Table.Cell>
                  <Table.Cell data-column="modification" class="{cell} text-left {row.modification ? '' : 'text-muted-foreground'}">{row.modification ?? '–'}</Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </div>
      </div>

      <div class="min-w-0">
        <h3 class="mb-1 text-xs font-medium text-muted-foreground" title="The engine matches a shift to a modification of the Unimod list within 0.02 Da; the deviation says how close the match is">
          Shifts matched to known modifications <span class="font-normal">(within 0.02 Da: check the deviation)</span>
        </h3>
        <div class="max-h-72 overflow-auto rounded-lg border bg-background">
          <Table.Root class="text-xs tabular-nums" aria-label="Mapped modifications">
            <Table.Header class="sticky top-0 bg-background">
              <Table.Row class="hover:bg-transparent">
                <Table.Head scope="col" class="{head} h-auto text-left">Modification</Table.Head>
                <Table.Head scope="col" class="{head} h-auto text-right" title="Mass of the modification (Unimod)">Δ mass (theor.)</Table.Head>
                <Table.Head scope="col" class="{head} h-auto text-right" title="Mean delta mass of its PSMs">Δ mass (obs.)</Table.Head>
                <Table.Head scope="col" class="{head} h-auto text-right" title="Observed minus theoretical mass, in mDa">Dev. (mDa)</Table.Head>
                <Table.Head scope="col" class="{head} h-auto text-right">PSMs</Table.Head>
                <Table.Head scope="col" class="{head} h-auto text-right" title="Distinct peptides (with their modifications) among those PSMs">Peptides</Table.Head>
                <Table.Head scope="col" class="{head} h-auto text-right" title="Share of the PSMs that match a known modification">%</Table.Head>
                <Table.Head scope="col" class="{head} h-auto text-left" title="The residues the modification can sit on, as the Unimod entry lists them">Residues (Unimod)</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each ptms as row (row.name)}
                <Table.Row data-testid="ptm-row">
                  <Table.Cell data-column="name" class="{cell} text-left font-medium">{row.name}</Table.Cell>
                  <Table.Cell data-column="theoretical" class="{cell} text-right">{row.theoretical}</Table.Cell>
                  <Table.Cell data-column="observed" class="{cell} text-right">{row.observed}</Table.Cell>
                  <Table.Cell data-column="deviation" class="{cell} text-right">{row.deviation}</Table.Cell>
                  <Table.Cell data-column="psms" class="{cell} text-right">{formatCount(row.psms)}</Table.Cell>
                  <Table.Cell data-column="peptides" class="{cell} text-right" title={row.peptides === null ? 'The engine reports more peptides than PSMs for this shift, so the count is not shown' : undefined}>{row.peptides === null ? '–' : formatCount(row.peptides)}</Table.Cell>
                  <Table.Cell data-column="share" class="{cell} text-right">{row.share}</Table.Cell>
                  <Table.Cell data-column="residues" class="{cell} text-left">{row.residues}</Table.Cell>
                </Table.Row>
              {:else}
                <Table.Row class="hover:bg-transparent" data-testid="ptm-empty">
                  <Table.Cell colspan={8} class="whitespace-normal px-3 py-3 text-muted-foreground">
                    The engine matched none of the {formatCount(summary.unassigned)} shifted PSMs to a known modification; the table on
                    the left lists their shifts.
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </div>
      </div>
    </div>
  {/if}
</section>
