<script lang="ts">
  // A notice of the design table: amber, never blocking (spec: gaps and duplicates are notices).
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert'
  import XIcon from '@lucide/svelte/icons/x'
  import type { Snippet } from 'svelte'

  let { children, onDismiss }: { children: Snippet; onDismiss?: () => void } = $props()
</script>

<!-- not a live region itself: NoticeList announces the notices once -->
<div
  data-slot="notice"
  class="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12.5px] text-amber-900">
  <TriangleAlertIcon class="mt-px size-3.5 shrink-0" aria-hidden="true" />
  <div class="min-w-0 flex-1">{@render children()}</div>
  {#if onDismiss}
    <button
      type="button"
      class="-m-0.5 rounded p-0.5 text-amber-800 hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none"
      aria-label="Dismiss"
      onclick={onDismiss}><XIcon class="size-3.5" /></button>
  {/if}
</div>
