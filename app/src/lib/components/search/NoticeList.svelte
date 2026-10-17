<script lang="ts">
  // Notices (amber, never blocking) and one polite live region that announces their summary when it
  // changes, instead of a live region per notice.
  import Notice from './Notice.svelte'

  type Item = { message: string; action?: { label: string; run: () => void }; onDismiss?: () => void }

  let { items }: { items: Item[] } = $props()

  const summary = $derived(
    items.length === 0
      ? ''
      : `${items.length} ${items.length === 1 ? 'notice' : 'notices'}: ${items.map((i) => i.message).join(' ')}`,
  )
</script>

<div class="sr-only" aria-live="polite" aria-atomic="true">{summary}</div>
{#each items as item, k (k)}
  <Notice onDismiss={item.onDismiss}>
    {item.message}
    {#if item.action}
      <button type="button" class="ml-1 underline underline-offset-2 hover:no-underline" onclick={item.action.run}
        >{item.action.label}</button>
    {/if}
  </Notice>
{/each}
