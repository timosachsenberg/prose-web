<script lang="ts">
  import TopBar from '$lib/components/TopBar.svelte'
  import { formatHash, parseHash, type Route } from '$lib/route'

  // The view lives in this rune; the URL hash mirrors it (#/search, #/results/<id>, #/history).
  let route = $state<Route>(parseHash(location.hash))
  // the result that was open last: the "Results" link returns to it
  let resultId = $state<string | null>(null)

  /** Takes the route from the hash; a hash that is not canonical (empty, unknown) is rewritten in place. */
  function readHash() {
    route = parseHash(location.hash)
    const canonical = formatHash(route)
    if (location.hash !== canonical) history.replaceState(null, '', canonical)
  }
  readHash()

  // a route set in code (not through the hash) is pushed to the URL
  $effect(() => {
    const hash = formatHash(route)
    if (location.hash !== hash) location.hash = hash
  })

  $effect(() => {
    if (route.view === 'results' && route.id !== null) resultId = route.id
  })
</script>

<svelte:window onhashchange={readHash} />

<div class="min-h-screen bg-muted/40">
  <TopBar {route} {resultId} />
  <main class="mx-auto max-w-[1120px] px-5 pt-6 pb-24">
    {#if route.view === 'search'}
      <section data-testid="view-search">
        <h1 class="mb-1 text-xl font-semibold tracking-tight">New search</h1>
        <p class="mb-5 text-muted-foreground">Spectra and database stay on this computer.</p>
      </section>
    {:else if route.view === 'results'}
      <section data-testid="view-results">
        <h1 class="mb-1 text-xl font-semibold tracking-tight">Results</h1>
        <p class="mb-5 text-muted-foreground">
          {#if route.id === null}No result is open. Start a search, or open one from History.{:else}Result {route.id}{/if}
        </p>
      </section>
    {:else}
      <section data-testid="view-history">
        <h1 class="mb-1 text-xl font-semibold tracking-tight">History</h1>
        <p class="mb-5 text-muted-foreground">Finished searches are listed here.</p>
      </section>
    {/if}
  </main>
</div>
