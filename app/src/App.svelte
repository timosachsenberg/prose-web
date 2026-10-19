<script lang="ts">
  import TopBar from '$lib/components/TopBar.svelte'
  import * as Tooltip from '$lib/components/ui/tooltip'
  import { debugFlag } from '$lib/debug'
  import { startEngine } from '$lib/engine/app-engine.svelte'
  import { openDebugResult } from '$lib/results/debug-result'
  import { readHash, router } from '$lib/route.svelte'
  import NewSearch from './views/NewSearch.svelte'
  import Results from './views/Results.svelte'

  readHash()
  // ?debug=large|large1|small: a stored synthetic result (?debug=engine is handled by the engine module)
  const debug = debugFlag(location.search)
  if (debug !== null && debug !== 'engine') openDebugResult(debug)
  // OpenMS loads in the background from the start: the status chip and the search form need it
  void startEngine().catch(() => {})
</script>

<svelte:window onhashchange={readHash} />

<Tooltip.Provider delayDuration={300}>
  <div class="min-h-screen bg-muted/40">
    <TopBar route={router.route} resultId={router.resultId} />
    {#if router.route.view === 'results'}
      <!-- the results use the whole width and height of the window -->
      <main>
        <Results id={router.route.id} />
      </main>
    {:else}
      <main class="mx-auto max-w-[1120px] px-5 pt-6 pb-24">
        {#if router.route.view === 'search'}
          <NewSearch />
        {:else}
          <section data-testid="view-history">
            <h1 class="mb-1 text-xl font-semibold tracking-tight">History</h1>
            <p class="mb-5 text-muted-foreground">Finished searches are listed here.</p>
          </section>
        {/if}
      </main>
    {/if}
  </div>
</Tooltip.Provider>
