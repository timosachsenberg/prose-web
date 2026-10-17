<script lang="ts">
  // The error of the last search: where it happened (stage and file), what happened, and OpenMS' own
  // text as a collapsed detail; "Reload the page" when OpenMS cannot be started again.
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert'
  import * as Alert from '$lib/components/ui/alert'
  import { Button } from '$lib/components/ui/button'
  import { clearRunMessage, searchRun } from '$lib/search/session.svelte'

  let box = $state<HTMLElement | null>(null)
  // shown above the footer: scrolled into view when it appears
  $effect(() => {
    box?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
</script>

{#if searchRun.status === 'failed' && searchRun.failure}
  {@const failure = searchRun.failure}
  <Alert.Root bind:ref={box} variant="destructive" class="scroll-mb-20 border-destructive/30" data-testid="search-error">
    <CircleAlertIcon />
    <Alert.Title class="font-semibold">The search stopped</Alert.Title>
    <Alert.Description class="text-[12.5px]">
      <p class="text-foreground"><span class="font-medium">{failure.context}:</span> {failure.summary}</p>
      {#if failure.detail}
        <details class="mt-1 text-muted-foreground">
          <summary class="cursor-pointer text-xs select-none hover:text-foreground">OpenMS message</summary>
          <p class="mt-1 font-mono text-[11.5px] break-all whitespace-pre-line">{failure.detail}</p>
        </details>
      {/if}
      <div class="mt-2 flex gap-2">
        {#if searchRun.reload}
          <Button size="sm" onclick={() => location.reload()}>Reload the page</Button>
        {/if}
        <Button variant="outline" size="sm" class="text-foreground" onclick={clearRunMessage}>Dismiss</Button>
      </div>
    </Alert.Description>
  </Alert.Root>
{/if}
