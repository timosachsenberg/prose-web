<script lang="ts">
  // A placeholder until Task 7 builds the Results view: the PSM count of the search that is open.
  import { formatPercent, formatQ } from '$lib/format/fdr'
  import { openResult } from '$lib/search/session.svelte'

  let { id }: { id: string | null } = $props()

  const result = $derived(openResult.current !== null && openResult.current.id === id ? openResult.current : null)

  /** Target PSMs at or below the search's PSM FDR. */
  const psms = $derived.by(() => {
    if (!result) return 0
    const { psms: t } = result.outcome.tables
    let n = 0
    for (let i = 0; i < t.count; i++) if (t.decoy[i] === 0 && t.qValue[i] <= result.psmFdr) n++
    return n
  })
</script>

<section data-testid="view-results">
  <h1 class="mb-1 text-xl font-semibold tracking-tight">Results</h1>
  {#if result}
    <p class="mb-5 text-muted-foreground">
      {result.outcome.summary.files.length}
      {result.outcome.summary.files.length === 1 ? 'file' : 'files'} · {result.design.samples.length}
      {result.design.samples.length === 1 ? 'sample' : 'samples'}
    </p>
    <p class="text-2xl font-semibold tracking-tight">
      <span data-testid="psm-count">{psms.toLocaleString('en-US')} PSMs</span>
    </p>
    <p class="text-muted-foreground">
      at PSM FDR ≤ {formatPercent(result.psmFdr)} ({formatQ(result.psmFdr)}), targets only
    </p>
  {:else}
    <p class="mb-5 text-muted-foreground">
      {#if id === null}No result is open. Start a search, or open one from History.{:else}Result {id} is not open in this
        session.{/if}
    </p>
  {/if}
</section>
