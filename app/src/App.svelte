<script lang="ts">
  import TopBar from '$lib/components/TopBar.svelte'
  import * as Tooltip from '$lib/components/ui/tooltip'
  import { debugFlag, debugPeaks, debugSave } from '$lib/debug'
  import { startEngine } from '$lib/engine/app-engine.svelte'
  import { initHistory, saveFinished } from '$lib/persist/history.svelte'
  import { openDebugResult } from '$lib/results/debug-result'
  import { readHash, router } from '$lib/route.svelte'
  import { openResult } from '$lib/search/session.svelte'
  import History from './views/History.svelte'
  import NewSearch from './views/NewSearch.svelte'
  import Results from './views/Results.svelte'

  readHash()
  // finished searches are saved to History as they come
  initHistory()
  // ?debug=large|large1|dense|small: a stored synthetic result (?debug=engine is handled by the engine module);
  // with &save it is also saved to History
  const debug = debugFlag(location.search)
  if (debug !== null && debug !== 'engine') {
    openDebugResult(debug, debugPeaks(location.search))
    if (debugSave(location.search) && openResult.current) void saveFinished(openResult.current)
  }
  // OpenMS loads in the background from the start: the status chip and the search form need it
  void startEngine().catch(() => {})
</script>

<svelte:window onhashchange={readHash} />

<Tooltip.Provider delayDuration={300}>
  <!-- the results use the whole width and height of the window (below the top bar, which wraps on
       narrow windows) -->
  <div class={router.route.view === 'results' ? 'flex h-screen min-h-[540px] flex-col bg-muted/40' : 'min-h-screen bg-muted/40'}>
    <TopBar route={router.route} resultId={router.resultId} />
    {#if router.route.view === 'results'}
      <main class="min-h-0 flex-1">
        <Results id={router.route.id} />
      </main>
    {:else}
      <main class="mx-auto max-w-[1120px] px-5 pt-6 pb-24">
        {#if router.route.view === 'search'}
          <NewSearch />
        {:else}
          <History />
        {/if}
      </main>
    {/if}
  </div>
</Tooltip.Provider>
