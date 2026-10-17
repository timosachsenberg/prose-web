<script lang="ts">
  // New search (mockup 1): spectra with the experimental design, the protein database, the search
  // settings and rescoring, with a sticky footer to start the search. mzML and FASTA files can be
  // dropped anywhere on the page.
  import DatabaseCard from '$lib/components/search/DatabaseCard.svelte'
  import DesignTable from '$lib/components/search/DesignTable.svelte'
  import EmptyState from '$lib/components/search/EmptyState.svelte'
  import RescoringCard from '$lib/components/search/RescoringCard.svelte'
  import SearchFooter from '$lib/components/search/SearchFooter.svelte'
  import SettingsCard from '$lib/components/search/SettingsCard.svelte'
  import { searchForm as form } from '$lib/search/form.svelte'

  let dragging = $state(false)
  let depth = 0

  const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false

  function enter(event: DragEvent) {
    if (!hasFiles(event)) return
    depth++
    dragging = true
  }

  function leave(event: DragEvent) {
    if (!hasFiles(event)) return
    depth = Math.max(0, depth - 1)
    if (depth === 0) dragging = false
  }

  function over(event: DragEvent) {
    if (!hasFiles(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  function drop(event: DragEvent) {
    if (!hasFiles(event)) return
    event.preventDefault()
    depth = 0
    dragging = false
    if (event.dataTransfer) form.addFiles([...event.dataTransfer.files])
  }
</script>

<svelte:window ondragenter={enter} ondragleave={leave} ondragover={over} ondrop={drop} />

<section data-testid="view-search" class="flex flex-col gap-4">
  <div>
    <h1 class="mb-1 text-xl font-semibold tracking-tight">New search</h1>
    <p class="text-muted-foreground">Spectra and database stay on this computer.</p>
  </div>

  {#if form.files.length === 0}
    <EmptyState {dragging} />
  {:else}
    <div class={dragging ? 'rounded-lg ring-2 ring-foreground/30 ring-offset-2 ring-offset-muted' : ''}>
      <DesignTable />
    </div>
  {/if}
  <DatabaseCard />
  <SettingsCard />
  <RescoringCard />
  <SearchFooter />
</section>
