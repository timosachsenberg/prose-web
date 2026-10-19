<script lang="ts">
  // The QC tab: three charts of the search's quality, each for the PSMs the search kept (its PSM FDR):
  // how well targets and decoys score, how far the precursor masses are off, and how many PSMs each
  // file gave. Targets are blue and decoys orange (a validated pair); every chart says in its subtitle
  // which PSMs it shows and has a table of its numbers.
  import ChartCard from '$lib/components/charts/ChartCard.svelte'
  import FileBars from '$lib/components/charts/FileBars.svelte'
  import HistogramChart from '$lib/components/charts/HistogramChart.svelte'
  import { tickLabel } from '$lib/format/chart'
  import { formatPercent, formatQ } from '$lib/format/fdr'
  import { signedNumber } from '$lib/format/number'
  import { COLORS } from '$lib/psm/psm'
  import { formatCount } from '$lib/results/display'
  import { precursorErrors, psmsPerFile, scoreDistribution } from '$lib/results/qc'
  import type { ResultsView } from '$lib/results/view.svelte'

  let { view }: { view: ResultsView } = $props()

  const m = $derived(view.model)
  const openSearch = $derived(view.result.outcome.summary.openSearch)
  const fdr = $derived(`${formatPercent(m.psmFdr)}, ${formatQ(m.psmFdr)}`)

  const targetColor = COLORS.b
  const decoyColor = COLORS.y

  const score = $derived(scoreDistribution(m))
  const errors = $derived(precursorErrors(m, openSearch))
  const files = $derived(psmsPerFile(m))

  const range = (edges: number[], b: number) => `${tickLabel(edges[b])} to ${tickLabel(edges[b + 1])}`
  const peak = (counts: number[]) => counts.indexOf(Math.max(...counts))

  const scoreDescription = $derived(
    score
      ? `Histogram of the ${score.scoreName} of the PSMs at the search FDR: ${formatCount(score.nTargets)} target PSMs (blue bars) and ${formatCount(score.nDecoys)} decoy PSMs (orange bars) in ${score.edges.length - 1} bins from ${tickLabel(score.edges[0])} to ${tickLabel(score.edges.at(-1)!)}. Most targets score between ${range(score.edges, peak(score.targets)).replace(' to ', ' and ')}.`
      : '',
  )
  const errorDescription = $derived(
    errors
      ? `Histogram of the precursor mass error of ${formatCount(errors.n)} target PSMs, in ppm, in ${errors.edges.length - 1} bins from ${tickLabel(errors.edges[0])} to ${tickLabel(errors.edges.at(-1)!)}. The median error is ${signedNumber(errors.median, 1)} ppm.`
      : '',
  )
  const filesDescription = $derived(
    `Bar chart of the target PSMs in each of the ${files.length} searched files, from ${formatCount(Math.min(...files.map((f) => f.count)))} to ${formatCount(Math.max(...files.map((f) => f.count)))}.`,
  )
</script>

<div class="grid grid-cols-1 items-start gap-4 pb-6 xl:grid-cols-2" data-testid="qc-content">
  <!-- the cards are h3: the tab's own heading comes first, for the outline of the page -->
  <h2 class="sr-only">Quality control</h2>
  <!-- targets against decoys -->
  {#if score}
    <ChartCard
      testid="qc-score"
      title="Score distribution"
      subtitle="PSMs at the search FDR ({fdr}) · decoys kept"
      notes={score.unscored > 0 ? [`${formatCount(score.unscored)} PSMs without a score (Percolator could not rescore them) are left out.`] : []}
      legend={[
        { label: 'Targets', color: targetColor, value: formatCount(score.nTargets) },
        { label: 'Decoys', color: decoyColor, value: formatCount(score.nDecoys) },
      ]}
      table={{
        name: 'Score distribution: PSMs per score range',
        columns: [
          { id: 'range', header: score.scoreName, align: 'left' },
          { id: 'targets', header: 'Targets' },
          { id: 'decoys', header: 'Decoys' },
        ],
        rows: score.targets.map((t, b) => [range(score.edges, b), formatCount(t), formatCount(score.decoys[b])]),
      }}>
      <HistogramChart
        title="Score distribution of target and decoy PSMs"
        description={scoreDescription}
        edges={score.edges}
        xLabel={score.scoreName}
        series={[
          { name: 'Targets', color: targetColor, counts: score.targets, testid: 'target-bar' },
          { name: 'Decoys', color: decoyColor, counts: score.decoys, testid: 'decoy-bar' },
        ]} />
    </ChartCard>
  {:else}
    <ChartCard testid="qc-score" title="Score distribution" subtitle="PSMs at the search FDR ({fdr}) · decoys kept">
      <p class="py-8 text-center text-xs text-muted-foreground">No PSM passes the search's PSM FDR, so there is nothing to plot.</p>
    </ChartCard>
  {/if}

  <!-- precursor error -->
  {#if errors}
    <ChartCard
      testid="qc-precursor"
      title="Precursor mass error"
      subtitle={openSearch
        ? `Unmodified PSMs only (|Δ| ≤ 0.05 Da): ${formatCount(errors.n)} of ${formatCount(errors.considered)} target PSMs at the search FDR (${fdr})`
        : `Target PSMs at the search FDR (${fdr}) · ${formatCount(errors.n)} PSMs`}
      notes={openSearch ? ["A PSM with a mass shift has that shift in its precursor error, so it is left out."] : []}
      table={{
        name: 'Precursor mass error: PSMs per range',
        columns: [
          { id: 'range', header: 'Error (ppm)', align: 'left' },
          { id: 'psms', header: 'PSMs' },
        ],
        rows: errors.counts.map((c, b) => [range(errors.edges, b), formatCount(c)]),
      }}>
      <HistogramChart
        title="Precursor mass error of target PSMs"
        description={errorDescription}
        edges={errors.edges}
        xLabel="Precursor error (ppm)"
        unit="ppm"
        zeroLine
        marker={{ x: errors.median, label: `median precursor error (unmodified) ${signedNumber(errors.median, 1)} ppm` }}
        series={[{ name: 'Target PSMs', color: targetColor, counts: errors.counts, testid: 'error-bar' }]} />
    </ChartCard>
  {:else}
    <ChartCard testid="qc-precursor" title="Precursor mass error" subtitle={openSearch ? 'Unmodified PSMs only (|Δ| ≤ 0.05 Da)' : `Target PSMs at the search FDR (${fdr})`}>
      <p class="py-8 text-center text-xs text-muted-foreground">
        {openSearch ? 'No unmodified PSM with a precursor error passes the search FDR.' : 'No PSM with a precursor error passes the search FDR.'}
      </p>
    </ChartCard>
  {/if}

  <!-- PSMs per file -->
  <ChartCard
    testid="qc-files"
    title="PSMs per file"
    subtitle="Target PSMs at the search FDR ({fdr})"
    class="xl:col-span-2"
    table={{
      name: 'PSMs per file',
      columns: [
        { id: 'file', header: 'File', align: 'left' },
        { id: 'psms', header: 'PSMs' },
      ],
      rows: files.map((f) => [f.file, formatCount(f.count)]),
    }}>
    <FileBars title="Target PSMs per file" description={filesDescription} items={files} color={targetColor} />
  </ChartCard>
</div>
