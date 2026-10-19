<script lang="ts">
  // In place of the protein table when no protein passed the search's protein FDR but there are PSMs:
  // why, where the identifications are, and a search again at 5 %.
  import { Button } from '$lib/components/ui/button'
  import { formatPercent, formatQ } from '$lib/format/fdr'
  import { formatCount } from '$lib/results/display'
  import { proteinsNeeded } from '$lib/results/figures'
  import type { ResultsView } from '$lib/results/view.svelte'
  import { canSearchAgain, searchAgain } from '$lib/search/plan.svelte'

  let { view, peptides, psms }: { view: ResultsView; peptides: number; psms: number } = $props()

  /** The protein FDR the search again offers. */
  const looser = 0.05
  const cutoff = $derived(view.result.proteinFdr)
  const again = $derived(cutoff < looser && canSearchAgain(view.result))
</script>

<div class="flex min-h-0 flex-1 items-start justify-center rounded-lg border bg-background px-6 py-10" data-testid="proteins-empty">
  <div class="grid max-w-xl gap-3">
    <p class="text-sm font-medium">No protein reaches {formatQ(cutoff)} (protein FDR {formatPercent(cutoff)}).</p>
    <!-- N is not in the result: the engine drops the proteins above the cutoff, so the sentence stays general -->
    <p class="text-muted-foreground">
      With N target proteins, protein q-values cannot go below 1/(N + 1): a {formatPercent(cutoff)} protein FDR needs
      at least {formatCount(proteinsNeeded(cutoff))} target proteins with evidence. Small databases cannot reach low
      protein q-values.
    </p>
    <p class="text-muted-foreground">
      The identifications are there: {formatCount(peptides)}
      {peptides === 1 ? 'peptide' : 'peptides'} and {formatCount(psms)}
      {psms === 1 ? 'PSM' : 'PSMs'} at the PSM FDR.
    </p>
    <div class="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onclick={() => (view.tab = 'peptides')}>Show the peptides</Button>
      <Button variant="outline" size="sm" onclick={() => (view.tab = 'psms')}>Show the PSMs</Button>
      {#if again}
        <Button size="sm" onclick={() => searchAgain(view.result, { 'FDR:protein': looser })}
          >Search again with protein FDR {formatPercent(looser)}</Button>
      {/if}
    </div>
    {#if cutoff < looser && !again}
      <p class="text-xs text-muted-foreground">
        To search again with a looser protein FDR (e.g. {formatPercent(looser)}), set it under Search settings in New
        search.
      </p>
    {/if}
  </div>
</div>
