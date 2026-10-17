<script lang="ts">
  import TopBar from '$lib/components/TopBar.svelte'
  import * as Tooltip from '$lib/components/ui/tooltip'
  import { startEngine } from '$lib/engine/app-engine.svelte'
  import { readHash, router } from '$lib/route.svelte'
  import NewSearch from './views/NewSearch.svelte'
  import Results from './views/Results.svelte'

  readHash()
  // OpenMS loads in the background from the start: the status chip and the search form need it
  void startEngine().catch(() => {})
</script>

<svelte:window onhashchange={readHash} />

<Tooltip.Provider delayDuration={300}>
  <div class="min-h-screen bg-muted/40">
    <TopBar route={router.route} resultId={router.resultId} />
    <main class="mx-auto max-w-[1120px] px-5 pt-6 pb-24">
      {#if router.route.view === 'search'}
        <NewSearch />
      {:else if router.route.view === 'results'}
        <Results id={router.route.id} />
      {:else}
        <section data-testid="view-history">
          <h1 class="mb-1 text-xl font-semibold tracking-tight">History</h1>
          <p class="mb-5 text-muted-foreground">Finished searches are listed here.</p>
        </section>
      {/if}
    </main>
  </div>
</Tooltip.Provider>
