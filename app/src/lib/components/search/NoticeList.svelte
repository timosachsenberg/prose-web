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

  // A live region announces changes, not what it holds when it appears: it mounts empty and takes the
  // summary a moment later, so that notices present from the start are announced too.
  let announced = $state('')
  $effect(() => {
    const text = summary
    const timer = setTimeout(() => (announced = text), 150)
    return () => clearTimeout(timer)
  })
</script>

<div class="sr-only" aria-live="polite" aria-atomic="true" data-testid="notice-announcer">{announced}</div>
{#each items as item, k (k)}
  <Notice onDismiss={item.onDismiss}>
    {item.message}
    {#if item.action}
      <button type="button" class="ml-1 underline underline-offset-2 hover:no-underline" onclick={item.action.run}
        >{item.action.label}</button>
    {/if}
  </Notice>
{/each}
