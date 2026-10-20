<script lang="ts">
  // The footer's text: the one-line plan, and beneath it why the search cannot start, the memory advice,
  // or how the last search ended.
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert'
  import { searchPlan as plan } from '$lib/search/plan.svelte'
  import { searchRun } from '$lib/search/session.svelte'
  import { cn } from '$lib/utils'
</script>

<div class="min-w-0 flex-1">
  <p class="truncate text-xs text-muted-foreground" data-testid="search-plan" title={plan.lineTitle}>{plan.line}</p>
  {#if plan.problemShown}
    <p class="truncate text-xs text-foreground" id="start-problem" title={plan.problem}>{plan.problem}</p>
  {:else if plan.advice}
    <p class={cn('flex items-center gap-1 text-xs', plan.advice.over ? 'text-destructive' : 'text-amber-700')} title={plan.advice.text}>
      <TriangleAlertIcon class="size-3 shrink-0" aria-hidden="true" /><span class="truncate">{plan.advice.text}</span>
    </p>
  {:else if searchRun.status === 'cancelled'}
    <p class="text-xs text-muted-foreground">The search was cancelled.</p>
  {:else if searchRun.status === 'failed'}
    <p class="text-xs text-destructive">The search stopped: see the message above.</p>
  {/if}
</div>
