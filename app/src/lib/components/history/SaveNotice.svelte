<script lang="ts">
  // Says when a finished search could not be saved to History (and why), on Results and on History.
  // Amber and never blocking: the results stay usable, and Export › Project keeps them as a file.
  import { dismissSaveStatus, history } from '$lib/persist/history.svelte'
  import Notice from '$lib/components/search/Notice.svelte'

  /** Only the notice of this search (Results); without, the last one (History). */
  let { id }: { id?: string } = $props()

  const save = $derived(history.save)
  const message = $derived(save && save.state === 'unsaved' && (id === undefined || save.id === id) ? save.message : null)
</script>

{#if message}
  <div role="status" data-testid="history-not-saved">
    <Notice onDismiss={dismissSaveStatus}>{message}</Notice>
  </div>
{/if}
