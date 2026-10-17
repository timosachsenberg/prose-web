<script lang="ts">
  // The sticky footer of New search: the plan (PlanLine), "Save as preset" and "Start search"
  // (Ctrl+Enter); during the search its progress (SearchProgress) and Cancel. The error of a failed
  // search is shown above it (SearchError).
  import { Button } from '$lib/components/ui/button'
  import { searchPlan as plan, startSearch } from '$lib/search/plan.svelte'
  import { cancelSearch, clearRunMessage, searchRun } from '$lib/search/session.svelte'
  import PlanLine from './PlanLine.svelte'
  import SavePresetDialog from './SavePresetDialog.svelte'
  import SearchError from './SearchError.svelte'
  import SearchProgress from './SearchProgress.svelte'

  let presetOpen = $state(false)

  function start() {
    if (!plan.canStart) return
    clearRunMessage()
    void startSearch()
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
    if (document.querySelector('[role="dialog"]')) return // Ctrl+Enter inside a dialog is the dialog's
    event.preventDefault()
    start()
  }

  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
</script>

<svelte:window onkeydown={onKey} />

<SearchError />

<div class="fixed inset-x-0 bottom-0 z-40 h-[60px] border-t bg-background/95 backdrop-blur-sm">
  <div class="mx-auto flex h-full max-w-[1120px] items-center gap-3 px-5">
    {#if searchRun.status === 'running'}
      <SearchProgress class="flex-1" />
      <Button variant="outline" onclick={cancelSearch}>Cancel</Button>
    {:else}
      <PlanLine />
      <Button variant="outline" onclick={() => (presetOpen = true)}>Save as preset</Button>
      <Button
        disabled={!plan.canStart}
        aria-describedby={plan.problemShown ? 'start-problem' : undefined}
        aria-keyshortcuts={mac ? 'Meta+Enter' : 'Control+Enter'}
        onclick={start}>
        Start search
        <kbd
          aria-hidden="true"
          class="ml-1 rounded-[4px] border border-zinc-700 bg-zinc-800 px-1 font-sans text-[11px] text-zinc-400"
          >{mac ? '⌘' : 'Ctrl'} ↵</kbd>
      </Button>
    {/if}
  </div>
</div>

<SavePresetDialog bind:open={presetOpen} />
